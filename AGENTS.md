# Context for AI Agents

**Current Status**: Complete Suite (Figma Plugin + Chrome Extension + LLM Tool + Image Proxy)
**Project Goal**: Maintain a robust scraping suite for designers and AI.

---

## Multi-Model Coordination

This repository uses **Git worktrees** for parallel AI development. Multiple models can work simultaneously on different features.

### Active Worktrees
| Worktree | Branch | Purpose | Suggested Model |
|----------|--------|---------|-----------------|
| `opus/` | `dev/opus-main` | Complex features, architecture | Claude Opus |
| `sonnet/` | `dev/sonnet-main` | Implementation, tests | Claude Sonnet |
| `gemini/` | `dev/gemini-main` | Experiments, alternatives | Gemini |

### Before You Start
1. **Check your worktree**: Look at the folder path to know which model role you're in
2. **Fetch latest**: `git fetch origin` to see other models' work
3. **Avoid duplicating work**: Check commits on other branches first
4. **Use commit prefixes**: `[opus]`, `[sonnet]`, `[gemini]` etc.

### Commit Message Format
```
[model] type: description

Examples:
[opus] feat: add gradient angle parsing
[sonnet] test: add serializer unit tests
[gemini] refactor: improve image loading
```

### Coordination Rules
- **Don't edit the same file** as another active worktree (check first)
- **Pull from main** frequently to reduce conflicts
- **Document decisions** in commit messages for other models to read

---

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

---

## Conventions

*   **Visual Tree JSON**: Output of `dom-serializer.js`.
*   **Fidelity**: We capture computed styles including `box-shadow`, `border`, `linear-gradient`.
*   **Proxy**: Images are fetched via `/api/proxy-image` to bypass CORS.

---

## Current Roadmap (checked = done)

- [x] **Phase 1**: Raw Import & Basic Scraper.
- [x] **Phase 2-3**: Extension & Integration.
- [x] **Phase 4-5**: High Fidelity (Shadows, Gradients, SVGs).
- [x] **Phase 6**: Plugin Experience (Proxy, Dark Mode).
- [x] **Phase 7**: Web-to-LLM (Metadata, Markdown).
- [x] **Phase 8**: Repo Reorganization.
- [ ] **Phase 9**: Testing & Quality (see `docs/CODEBASE_ANALYSIS.md`)
- [ ] **Phase 10**: Visual Fidelity Improvements

---

## Task Assignment by Model

Based on capabilities, here are suggested task assignments:

### For Opus (Complex/Architecture)
- Gradient angle parsing
- Font matching system
- AI component detection
- Design token extraction

### For Sonnet (Implementation/Tests)
- Add test suite for dom-serializer
- Fix TypeScript issues (require → import)
- Add progress indicators to plugin
- Improve error messages

### For Gemini (Experiments/Alternatives)
- Parallel image loading
- Chrome Extension v2
- Alternative scraping approaches
- Performance optimization

---

## Verified Workflows

*   **Build**: `cd scrapper-suite && npm run dev`.
*   **Plugin**: `cd clients/figma-plugin && npm run build`.
*   **Extension**: Load `clients/chrome-extension`.

---

## Quick Reference

| Task | Location |
|------|----------|
| Main API | `scrapper-suite/app/api/website-to-figma/route.ts` |
| DOM Serializer | `scrapper-suite/app/lib/dom-serializer.js` |
| Plugin Logic | `clients/figma-plugin/src/code.ts` |
| Plugin UI | `clients/figma-plugin/src/ui.html` |
| Extension | `clients/chrome-extension/popup.js` |
| Analysis | `docs/CODEBASE_ANALYSIS.md` |
| Workflow Guide | `docs/MULTI_MODEL_WORKFLOW.md` |
