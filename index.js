const puppeteer = require('puppeteer');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs/promises');

(async () => {
    try {
        // Read configuration file
        const configFile = await fs.readFile('config.json', 'utf-8');
        const config = JSON.parse(configFile);

        const browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: ["--start-maximized"],
        });

        const page = await browser.newPage();

        // Navigate to LinkedIn login page
        await page.goto("https://www.linkedin.com/checkpoint/lg/login");

        // Login to LinkedIn
        await page.type("#username", config.username);
        await page.type("#password", config.password);
        await page.click('.login__form_action_container');
        await page.waitForNavigation();

        // Perform LinkedIn search and apply filters
        await page.waitForSelector('.search-global-typeahead__input');
        await page.click('.search-global-typeahead__input');

        // Take user input for keywords
        await page.type('.search-global-typeahead__input', config.userKeywords);

        await page.keyboard.press('Enter');
        await page.waitForNavigation();

        await page.waitForSelector('.search-reusables__primary-filter');
        await page.evaluate(() => {
            const peopleButton = document.querySelector('.search-reusables__primary-filter button');
            if (peopleButton) {
                peopleButton.click();
            }
        });

        await page.waitForSelector('.search-reusables__all-filters-pill-button');
        await page.click('.search-reusables__all-filters-pill-button');

        // Add location filter
        await page.waitForSelector('.search-reusables__filter-value-item button[data-add-filter-button]', {
            timeout: 30000
        });
        await page.evaluate(() => {
            const addButton = Array.from(document.querySelectorAll('.search-reusables__filter-value-item button[data-add-filter-button]')).find(button => button.textContent.includes('Add a location'));
            if (addButton) {
                addButton.click();
            }
        });

        await page.waitForTimeout(1000);

        // Type the desired location
        const inputFieldSelector = 'input[placeholder="Add a location"]';
        await page.waitForSelector(inputFieldSelector);
        const inputField = await page.$(inputFieldSelector);
        await inputField.focus();
        await page.type(inputFieldSelector, config.userLocation);
        await page.waitForTimeout(1000);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');

        // Take user input for job title
        await page.waitForSelector('.search-reusables__filter-value-item:nth-child(3) input[type="text"]', {
            timeout: 60000
        });
        await page.type('.search-reusables__filter-value-item:nth-child(3) input[type="text"]', config.userJobTitle);

        await page.waitForTimeout(2000);

        await page.waitForSelector('.search-reusables__secondary-filters-show-results-button');
        await page.click('.search-reusables__secondary-filters-show-results-button');

        await page.waitForTimeout(5000);

        const initialUrl = page.url();
        const geoUrnMatch = initialUrl.match(/geoUrn=([^&]+)/);
        const geoUrn = geoUrnMatch ? geoUrnMatch[1] : null;

        const profiles = [];

        for (let currentPage = 1; currentPage <= config.MAX_PAGES; currentPage++) {
            // Build the URL with the extracted geoUrn for subsequent pages
            const url = `https://www.linkedin.com/search/results/people/?geoUrn=${geoUrn}&keywords=${config.userKeywords}&origin=FACETED_SEARCH&page=${currentPage}&titleFreeText=${config.userJobTitle}`;

            await page.goto(url);
            await page.waitForTimeout(5000);
            const results = await page.evaluate(() => {
                const data = [];
                const results = document.querySelectorAll('.entity-result__item');
                const nameRegex = /^(.*?)View .*?$/;

                // Inside the loop where you extract results
                results.forEach(result => {
                    const nameElement = result.querySelector('.entity-result__title-text a');
                    const nameMatch = nameElement.textContent.trim().match(/^(.*?)View .*?$/);
                    const name = nameMatch ? nameMatch[1].trim() : nameElement.textContent.trim();

                    // Remove unnecessary information like degrees of connection
                    const cleanName = name.replace(/(?:• \d+(?:st|nd|rd|th) degree connection)/g, '').trim();

                    const profileUrl = nameElement.href;
                    const designation = result.querySelector('.entity-result__primary-subtitle').textContent.trim();
                    const location = result.querySelector('.entity-result__secondary-subtitle').textContent.trim();

                    data.push({
                        name: cleanName,
                        profileUrl,
                        designation,
                        location
                    });
                });

                return data;
            });

            profiles.push(...results);
        }

        const csvWriter = createCsvWriter({
            path: config.csvFilePath || 'linkedin_profiles.csv', // Use config.csvFilePath if available, otherwise default to 'linkedin_profiles.csv'
            header: [
                { id: 'name', title: 'Name' },
                { id: 'profileUrl', title: 'Profile URL' },
                { id: 'designation', title: 'Designation' },
                { id: 'location', title: 'Location' }
            ]
        });

        const records = profiles.map(profile => ({
            name: profile.name,
            profileUrl: profile.profileUrl,
            designation: profile.designation,
            location: profile.location
        }));

        await csvWriter.writeRecords(records);

        console.log('Data extracted and CSV file created successfully.');

    } catch (error) {
        console.error("Error occurred: ", error);
    } 
})();

