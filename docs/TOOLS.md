# Scrapper Suite Tools

This repository is a monorepo containing a powerful set of scraping tools. This document explains where they are and how to use them.

## 1. Scraper Suite (Backend)
**Location:** `/scrapper-suite`

The core engine. It runs a Next.js server with Puppeteer to handle heavy scraping tasks.

**Capabilities:**
*   **Dribbble Scraper:** (`/dribbble`) - Visual scraper for design inspiration.
*   **Website to Figma API:** (`/api/website-to-figma`) - Returns JSON layout for Figma.
*   **Web to LLM API:** (`/api/web-to-llm`) - Converts websites to clean Markdown for AI.
*   **Web to PNG:** (`/api/web-to-png`) - Recursive screenshot tool.
*   **Image Proxy:** (`/api/proxy-image`) - Bypasses CORS for frontend tools.

**How to Run:**
```bash
cd scrapper-suite
npm install
npm run dev
# Server running at http://localhost:3000
```

---

## 2. Figma Plugin ("Website to Figma")
**Location:** `/clients/figma-plugin`

A plugin for Figma that imports layouts from the Scraper Suite.

**Features:**
*   **1-Click Import:** Enter a URL and get editable Figma layers.
*   **High Fidelity:** Supports Shadows, Gradients, Borders, and Typography.
*   **Dark Mode UI:** Professional interface utilizing the Image Proxy.

**How to Build & Install:**
1.  **Build:**
    ```bash
    cd clients/figma-plugin
    npm install
    npm run build
    ```
2.  **Install in Figma:**
    *   Open Figma -> Plugins -> Development -> Import plugin from manifest...
    *   Select `/clients/figma-plugin/manifest.json`.

---

## 3. Chrome Extension
**Location:** `/clients/chrome-extension`

A browser extension for scraping "what you see". Ideal for password-protected or local sites.

**Features:**
*   **Dual-Architecture:** Uses the same serializer as the backend scraper.
*   **JSON Export:** Copies the layout JSON to clipboard.
*   **Paste to Plugin:** Paste the JSON into the Figma Plugin "Paste" mode.

**How to Install:**
1.  **Prepare:**
    Copy the shared kernel (if updated):
    ```bash
    cp scrapper-suite/app/lib/dom-serializer.js clients/chrome-extension/lib/dom-serializer.js
    ```
2.  **Load in Chrome:**
    *   Go to `chrome://extensions`
    *   Enable **Developer Mode**
    *   Click **Load Unpacked**
    *   Select `/clients/chrome-extension` folder.
