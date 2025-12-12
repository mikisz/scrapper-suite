# Scraper Suite - How to Run

This guide explains how to run the full stack: Backend, Figma Plugin, and Chrome Extension.

## 1. Start the Scraper Service (Backend)
The backend (`scrapper-suite`) powers all the tools.

```bash
cd scrapper-suite
npm install
npm run dev
# Server running at http://localhost:3000
```
*Note: If you have a live deployment (e.g. Railway), you can skip this and use the production URL.*

## 2. Load the Figma Plugin
The plugin imports layouts into Figma.

1.  **Build the Plugin:**
    ```bash
    cd clients/figma-plugin
    npm install
    npm run build
    ```
2.  **Import to Figma:**
    *   Open Figma Desktop App.
    *   **Menu** > **Plugins** > **Development** > **Import plugin from manifest...**
    *   Select: `clients/figma-plugin/manifest.json`

## 3. Using the Plugin
1.  Run the **Website to Figma** plugin in a design file.
2.  **API URL:** `http://localhost:3000/api/website-to-figma` (or your Railway URL).
3.  **Target URL:** Enter any website (e.g. `https://dribbble.com`).
4.  **Click Import:** The layout will be generated with high fidelity (Shadows, Gradients, etc.).

## 4. (Optional) Chrome Extension
Use this for password-protected or local pages (`localhost`).

1.  **Load in Chrome:**
    *   `chrome://extensions` -> **Developer Mode** -> **Load Unpacked**.
    *   Select `clients/chrome-extension/`.
2.  **Scan:** Click the icon on any page.
3.  **Import:** Paste the copied JSON into the Figma Plugin (toggle to "Paste JSON" mode).

## 5. Other Tools
The suite also includes:
*   **Web to LLM:** `http://localhost:3000/web-to-llm` (Convert sites to Markdown).
*   **Dribbble Scraper:** `http://localhost:3000/dribbble` (Visual inspiration).
