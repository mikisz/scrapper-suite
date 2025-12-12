const { scrapeProfile } = require('./scraper');

(async () => {
    try {
        console.log("Starting debug scrape...");
        const zipPath = await scrapeProfile('jordanhughes');
        console.log("Scrape finished. Zip path:", zipPath);
    } catch (error) {
        console.error("Scrape failed:", error);
    }
})();
