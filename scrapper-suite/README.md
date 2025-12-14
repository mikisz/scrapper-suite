# Scrapper Suite - Backend API Server

The backend service for the Scrapper Suite toolkit. Provides APIs for converting websites into Figma designs, LLM-ready content, and screenshots.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The server runs at `http://localhost:3000`.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/website-to-figma` | POST | Convert website to Figma-compatible JSON |
| `/api/web-to-llm` | POST | Export website to Markdown/HTML for LLMs |
| `/api/web-to-png` | POST | Capture full-page screenshots |
| `/api/proxy-image` | GET | Proxy images with CORS bypass + format conversion |
| `/api/dribbble` | GET | Download Dribbble portfolio images |
| `/api/health` | GET | Service health check |

See [docs/API.md](../docs/API.md) for full API reference.

## Project Structure

```
scrapper-suite/
├── app/
│   ├── api/                    # API route handlers
│   │   ├── website-to-figma/   # Main Figma conversion
│   │   ├── web-to-llm/         # LLM export with crawling
│   │   ├── web-to-png/         # Screenshot capture
│   │   ├── proxy-image/        # Image proxy + conversion
│   │   ├── dribbble/           # Dribbble scraper
│   │   └── health/             # Health check
│   └── lib/                    # Shared libraries
│       ├── dom-serializer.js   # DOM → Figma tree conversion
│       ├── browser-pool.ts     # Puppeteer instance pool
│       ├── crawler.ts          # Multi-page crawling
│       ├── cookie-dismissal.ts # Cookie modal handling
│       ├── validation.ts       # URL security validation
│       ├── logger.ts           # Structured logging
│       └── config.ts           # Configuration constants
├── downloads/                  # Temporary file storage
└── jest.config.js              # Test configuration
```

## Key Features

### DOM Serializer
The `dom-serializer.js` is the core engine that converts HTML DOM into Figma-compatible visual trees. It captures:
- Layout and positioning
- Colors, gradients, shadows
- Typography and fonts
- Images and SVGs
- Pseudo-elements

### Browser Pool
Manages a pool of Puppeteer browser instances for efficient concurrent scraping without resource exhaustion.

### Security
- URL validation (blocks private IPs, localhost)
- SSRF protection
- Security headers on all responses
- Input sanitization

## Development

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type checking
npm run type-check

# Linting
npm run lint

# Build for production
npm run build
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | Server port |

## Dependencies

- **Next.js 15** - React framework with API routes
- **Puppeteer** - Headless browser automation
- **Sharp** - Image processing and format conversion
- **JSDOM** - Server-side DOM parsing
- **Readability** - Article content extraction
- **Turndown** - HTML to Markdown conversion

## Related Components

- [Figma Plugin](../clients/figma-plugin/) - Renders visual trees in Figma
- [Chrome Extension](../clients/chrome-extension/) - Client-side scraping for protected pages

## License

See root [LICENSE](../LICENSE) file.
