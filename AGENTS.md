# Context for AI Agents

**Current Status**: Phase 2 Complete (Chrome Extension Boilerplate & Shared Logic)
**Project Goal**: Create a robust "Website to Figma" workflow using both server-side scraping and client-side extension scanning.

## Key Files & Structure
*   **`scrapper-suite/`**: Next.js app. The "Brain" and API server.
    *   `app/api/website-to-figma/route.ts`: Main API endpoint for public URLs.
    *   `app/lib/dom-serializer.js`: **CRITICAL**. This file is the shared logic for DOM parsing. It is injected into Puppeteer AND copied to the Chrome Extension.
    *   *Note: If you modify `dom-serializer.js`, ensure it is synced to `chrome-extension/lib/`.*

*   **`figma-plugin/`**: Logic for reconstructing the UI.
    *   `src/code.ts`: Main thread. Handles `createFrame`, `loadFonts`, etc.
    *   `src/ui.html`: The UI window. Fetches data or (in Phase 3) will accept pasted JSON.

*   **`chrome-extension/`**: User-side scraper.
    *   `manifest.json`: V3 Manifest.
    *   `popup.js`: Injects the serializer.

## Conventions
*   **Visual Tree JSON**: The output of `dom-serializer.js`. It's a recursive object with `type: 'FRAME' | 'TEXT' | 'TEXT_NODE'`, `styles` object, and `children` array.
*   **Styling**: We extract computed styles (`getComputedStyle`). We try to map Flexbox to Figma AutoLayout (`layoutMode`).
*   **Docker**: The backend runs in Docker. We optimized it to skip Chrome download (`PUPPETEER_SKIP_CHROMIUM_DOWNLOAD`).

## Current Roadmap (checked = done)
- [x] **Phase 1**: Raw Import & Basic Scraper (Puppeteer + Figma Plugin).
- [x] **DevOps**: Fix Docker build, optimize dependencies.
- [x] **Phase 2 (Extension)**:
    - [x] Shared `dom-serializer.js` library.
    - [x] Chrome Extension Boilerplate (Manifest V3, Popup).
    - [ ] **Phase 3 (Integration)**: Connect Extension output to Figma Plugin (e.g., via clipboard or local server).
- [ ] **Future**:
    - [ ] AI Component Mapping (Match raw frames to Design System components).
    - [ ] Design Token extraction (Variables).

## Verified Workflows
*   **Build**: `docker build .` works.
*   **Figma Connectivity**: Plugin has a health check dot (Green = API up, Red = API down).
*   **Extension**: Can scan page and output JSON to clipboard.
