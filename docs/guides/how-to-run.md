# Website to Figma - How to Run

Phase 1 (Raw Import) has been implemented! Here is how to test the end-to-end workflow.

## 1. Start the Scraper Service
The scraper runs inside your Next.js application (`scrapper-suite`).

1.  Open a terminal in `/Users/moz/dribbble-scrapper/scrapper-suite`.
2.  Run the development server:
    ```bash
    npm run dev
    ```
    *Ensure it is running on http://localhost:3000*

## 2. Load the Plugin in Figma
1.  Open Figma Desktop App.
2.  Go to **Menu** > **Plugins** > **Development** > **Import plugin from manifest...**
3.  Navigate to: `/Users/moz/dribbble-scrapper/figma-plugin/manifest.json`
4.  The plugin "Website to Figma" should appear.

## 3. Run the Import
1.  Open a new Figma Design file.
2.  Run the plugin: **Right-click canvas** > **Plugins** > **Development** > **Website to Figma**.
3.  In the plugin UI:
    *   **Scraper API URL**: Keep default (`http://localhost:3000/api/website-to-figma`).
    *   **Target Website URL**: Enter a URL (e.g., `https://example.com` or `https://stripe.com`).
4.  Click **Import**.
5.  Wait a few seconds (Puppeteer needs to launch and scrape).
6.  **Success!** You should see the website reconstructed as Figma frames.

## Troubleshooting
*   **CORS Error**: If the plugin says "Scraper failed", check the Next.js console. If it's a CORS issue, ensure `next.config.ts` was reloaded (restart `npm run dev`).
*   **Empty Result**: Some websites block scrapers. Try a simple site first.
*   **Layout Issues**: This is "Phase 1", so complex layouts (Grid, float) might look off. It uses pure AutoLayout approximations.

## 3. (Optional) Run Chrome Extension
Use this if you want to scrape password-protected or local pages that the server cannot reach.

1.  Open Chrome and navigate to `chrome://extensions`.
2.  Enable **Developer mode** (top right).
3.  Click **Load unpacked**.
4.  Select the `/Users/moz/dribbble-scrapper/chrome-extension` folder.
5.  Go to any website you want to scrape.
6.  Click the extension icon and select **Scan Current Page**.
7.  The JSON data will be copied to your clipboard.
8.  *(Note: Phase 3 will allow pasting this data directly into the Figma Plugin)*.
