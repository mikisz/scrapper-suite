# Scraper Suite & Website-to-Figma

A comprehensive toolkit for scraping websites and reconstructing them as editable designs in Figma.

## Overview

This project consists of three main components working together to bridge the gap between "Web" and "Design":

1.  **Scraper Suite (Next.js Application)**:
    *   A backend service running Puppeteer.
    *   Exposes APIs to scrape websites and return structured "Figma-ready" JSON data.
    *   Also handles other tools like "Web to LLM" export.

2.  **Figma Plugin ("Website to Figma")**:
    *   A plugin running inside Figma.
    *   Ui allows users to enter a URL.
    *   Communicates with the Scraper Suite API (or uses data from the Chrome Extension) to rebuild the website using Frames, AutoLayout, and text styles.

3.  **Chrome Extension (Dual-Input Architecture)**:
    *   A browser extension for scanning the *current* active tab.
    *   Useful for password-protected pages, local environments (`localhost`), or sites blocking headless scrapers.
    *   Generates the same JSON structure as the backend scraper.

## 🚀 Quick Start

### 1. Run the Backend (Scraper Suite)
The core engine needs to be running for the plugin to work (API mode) or for general utility.
```bash
cd scrapper-suite
npm install
npm run dev
# Running on http://localhost:3000
```

### 2. Load the Figma Plugin
1. Open Figma Desktop App.
2. Go to **Plugins > Development > Import plugin from manifest...**
3. Select `clients/figma-plugin/manifest.json`.
4. Run it in any design file.

### 3. (Optional) Load the Chrome Extension
1. Open Chrome `chrome://extensions`.
2. Enable **Developer Mode**.
3. **Load Unpacked** -> Select `clients/chrome-extension/` folder.
4. Click the extension icon on any page to "Scan" it.

## 📚 Documentation
*   [How to Run & Walkthrough](docs/guides/how-to-run.md)
*   [Architecture Analysis](docs/architecture/website-to-figma-analysis.md)
*   [Project Roadmap](docs/project/roadmap.md)
*   [For AI Agents](AGENTS.md) - Context for future LLMs working on this codebase.

## Architecture: "The Dual-Input System"
To handle both public and private websites, we effectively have two "Scrapers":
1.  **Puppeteer (Server-side)**: Good for public URLs, batch processing.
2.  **Chrome Content Script (Client-side)**: Good for "what I see is what I get", Auth pages.

Both systems rely on a shared kernel: `scrapper-suite/app/lib/dom-serializer.js`. This ensures that whether the DOM is parsed by a headless server or a user's browser, the output JSON provided to Figma is identical.
