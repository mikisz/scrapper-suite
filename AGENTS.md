# Context for AI Agents

**Current Status**: Complete Suite (Figma Plugin + Chrome Extension + LLM Tool + Image Proxy)
**Project Goal**: Maintain a robust scraping suite for designers and AI.

## Key Files & Structure
*   **`scrapper-suite/`**: Next.js app. The "Brain" and API server.
    *   `app/api/website-to-figma/route.ts`: Main API endpoint for public URLs.
    *   `app/api/web-to-llm/route.ts`: API for converting sites to Markdown.
    *   `app/lib/dom-serializer.js`: **CRITICAL**. Shared logic. Injected into Puppeteer AND copied to Extension.
    *   *Note: Sync changes from here to `clients/chrome-extension/lib/`.*

*   **`clients/figma-plugin/`**: Website-to-Figma Plugin.
    *   `src/code.ts`: Main thread. Handles rendering (Shadows, Borders, Gradients).
    *   `src/ui.html`: Dark Mode UI with Image Proxy logic.

*   **`clients/chrome-extension/`**: Client-side Scraper.
    *   `manifest.json`: V3 Manifest.
    *   `popup.js`: Injects the serializer.

## Conventions
*   **Visual Tree JSON**: Output of `dom-serializer.js`.
*   **Fidelity**: We capture computed styles including `box-shadow`, `border`, `linear-gradient`.
*   **Proxy**: Images are fetched via `/api/proxy-image` to bypass CORS.

## Current Roadmap (checked = done)
- [x] **Phase 1**: Raw Import & Basic Scraper.
- [x] **Phase 2-3**: Extension & Integration.
- [x] **Phase 4-5**: High Fidelity (Shadows, Gradients, SVGs).
- [x] **Phase 6**: Plugin Experience (Proxy, Dark Mode).
- [x] **Phase 7**: Web-to-LLM (Metadata, Markdown).
- [x] **Phase 8**: Repo Reorganization.

## Verified Workflows
*   **Build**: `cd scrapper-suite && npm run dev`.
*   **Plugin**: `cd clients/figma-plugin && npm run build`.
*   **Extension**: Load `clients/chrome-extension`.
