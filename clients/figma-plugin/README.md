# Website to Figma - Figma Plugin

A Figma plugin that imports websites as editable Figma designs. Supports full-page imports and component extraction from documentation sites.

## Installation

### Development (Local)

1. Build the plugin:
   ```bash
   cd clients/figma-plugin
   npm install
   npm run build
   ```

2. In Figma Desktop:
   - Go to **Plugins** > **Development** > **Import plugin from manifest...**
   - Select `clients/figma-plugin/manifest.json`

3. Run the plugin:
   - Right-click on canvas > **Plugins** > **Development** > **Website to Figma**

### Watch Mode (Development)

```bash
npm run watch
```

Rebuilds automatically when you edit `src/code.ts` or `src/ui.html`.

## Usage

### Full Page Mode

1. Enter the API endpoint (default: Railway deployment)
2. Select **Full Page** mode
3. Enter a website URL (e.g., `https://dribbble.com`)
4. Click **Import Layout**

The plugin will:
- Scrape the website via the backend API
- Convert DOM elements to Figma layers
- Download and embed images via the image proxy
- Preserve layout, colors, typography, shadows, and gradients

### Component Docs Mode

Extracts individual UI components from documentation pages (e.g., Shadcn, Radix, Chakra):

1. Select **Components** mode
2. Choose a theme (Tailwind recommended for unstyled components)
3. Enter a component documentation URL (e.g., `https://ui.shadcn.com/docs/components/button`)
4. Click **Import Layout**

Each detected component becomes a separate Figma frame with proper naming and variant labels.

### JSON Import

Paste raw JSON from the Chrome Extension for protected pages:

1. Leave the URL field empty
2. Paste the JSON output in the text area
3. Click **Import Layout**

## Features

### Visual Fidelity

- **Layout**: Accurate positioning and dimensions
- **Colors**: RGB, RGBA, hex, named colors
- **Gradients**: Linear and radial gradients with angle parsing
- **Shadows**: Box shadows with blur, spread, offset
- **Borders**: Width, color, radius
- **Typography**: Font family, size, weight, line-height, letter-spacing
- **Images**: Automatic download via CORS proxy with WebP/AVIF conversion
- **SVG**: Inline SVG support with vector preservation

### Progress Tracking

Real-time progress updates show:
- Connection status
- Scraping progress
- Layer building progress
- Image loading progress

### Error Handling

User-friendly error messages with suggestions:
- Network connectivity issues
- Invalid URLs
- Protected pages (suggests Chrome Extension)
- Server errors

## Configuration

### API Endpoint

Default: `https://scrappers.up.railway.app/api/website-to-figma`

For local development: `http://localhost:3000/api/website-to-figma`

The plugin derives the image proxy URL from the API endpoint automatically.

### Themes (Component Mode)

| Theme | Description |
|-------|-------------|
| `tailwind` | Injects Tailwind CSS for unstyled components (recommended) |
| `none` | Use existing page styles |

## Project Structure

```
clients/figma-plugin/
├── src/
│   ├── code.ts       # Main plugin thread (Figma API)
│   └── ui.html       # Plugin UI (iframe)
├── dist/             # Build output
├── manifest.json     # Figma plugin manifest
├── package.json
├── tsconfig.json
├── vite.code.config.ts
└── vite.ui.config.ts
```

### Architecture

- **code.ts**: Runs in Figma's main thread with access to the Figma API. Handles:
  - Frame/text/rectangle creation
  - Fill/stroke/effect application
  - Image embedding
  - Font loading

- **ui.html**: Runs in an iframe. Handles:
  - User input (URL, JSON)
  - API communication
  - Image proxying via fetch
  - Progress display

Communication between UI and code happens via `parent.postMessage` / `figma.ui.onmessage`.

## Dependencies

- **@figma/plugin-typings**: TypeScript types for Figma API
- **Vite**: Build tool with hot reload
- **vite-plugin-singlefile**: Bundles UI into single HTML file

## Troubleshooting

### "Cannot connect to the scraper server"

- Check the API endpoint URL is correct
- Ensure the backend server is running
- For local development, use `http://localhost:3000`

### Images not loading

- The plugin uses an image proxy to bypass CORS
- Check the backend server is accessible
- WebP/AVIF images are automatically converted to PNG

### "Access forbidden" or "403"

- Some sites block automated scraping
- Use the Chrome Extension instead for protected pages
- Paste the JSON output from the extension

### Fonts look different

- Figma can only use fonts installed locally or in Figma
- The plugin attempts font matching but may fall back to system fonts
- Install the original fonts locally for exact matching

## Related Components

- [Scrapper Suite](../../scrapper-suite/) - Backend API server
- [Chrome Extension](../chrome-extension/) - Client-side scraper for protected pages
