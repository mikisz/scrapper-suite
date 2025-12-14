# Scrapper Suite API Reference

Base URL: `http://localhost:3000/api`

---

## Endpoints Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/website-to-figma` | POST | Convert website to Figma-compatible JSON |
| `/web-to-llm` | POST | Export website to Markdown/HTML for LLMs |
| `/web-to-png` | POST | Capture screenshots of websites |
| `/proxy-image` | GET | Proxy images with format conversion |
| `/dribbble` | GET | Download Dribbble portfolio images |
| `/health` | GET | Service health check |

---

## POST /website-to-figma

Scrapes a website and returns a Figma-compatible visual tree JSON structure.

### Request

```json
{
  "url": "https://example.com",
  "mode": "full-page",
  "options": {
    "theme": "tailwind",
    "excludeSelectors": [".ads", "#cookie-banner"]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | **required** | URL to scrape (must be public, http/https) |
| `mode` | string | `"full-page"` | `"full-page"` or `"component-docs"` |
| `options.theme` | string | `"tailwind"` | Theme for unstyled components (component-docs mode) |
| `options.excludeSelectors` | string[] | `[]` | CSS selectors to exclude |

### Response (full-page mode)

```json
{
  "message": "Scraping successful",
  "data": {
    "type": "FRAME",
    "name": "Root",
    "children": [
      {
        "type": "FRAME",
        "name": "div.header",
        "x": 0,
        "y": 0,
        "width": 1440,
        "height": 80,
        "fills": [...],
        "children": [...]
      }
    ]
  }
}
```

### Response (component-docs mode)

```json
{
  "message": "Extracted 5 component(s)",
  "mode": "component-docs",
  "components": [
    {
      "name": "Button",
      "variant": "primary",
      "tree": { ... },
      "bounds": { "x": 100, "y": 200, "width": 120, "height": 40 }
    }
  ],
  "metadata": {
    "pageTitle": "Component Library",
    "libraryDetected": "shadcn/ui",
    "totalComponentsFound": 5,
    "themeApplied": "tailwind"
  }
}
```

### Error Responses

| Status | Error | Suggestion |
|--------|-------|------------|
| 400 | `Invalid request format` | Send valid JSON with "url" field |
| 400 | `Invalid URL` | Provide valid public http/https URL |
| 404 | `No components detected` | Page may not have recognizable components |
| 500 | `Could not find this website` | Check URL spelling |
| 500 | `Connection refused` | Website may be blocking automated access |
| 500 | `Access forbidden` | Use Chrome Extension for protected pages |

---

## POST /web-to-llm

Converts websites to Markdown or HTML format optimized for LLM consumption. Supports single-page and multi-page crawling.

### Request

```json
{
  "url": "https://example.com",
  "format": "markdown",
  "cleanup": "article",
  "mode": "single",
  "maxPages": 20,
  "dismissCookies": true,
  "includePdf": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | **required** | URL to process |
| `format` | string | `"markdown"` | Output format: `"markdown"` or `"html"` |
| `cleanup` | string | `"article"` | `"article"` (extract main content) or `"full"` (keep all) |
| `mode` | string | `"single"` | `"single"` (one page) or `"crawl"` (follow links) |
| `maxPages` | number | `20` | Max pages to crawl (1-500, crawl mode only) |
| `dismissCookies` | boolean | `true` | Attempt to dismiss cookie modals |
| `includePdf` | boolean | `false` | Generate PDF (single mode only) |

### Response

Returns a **ZIP file** (`application/zip`) containing:

**Single mode:**
```
llm-export.zip/
├── content.md (or content.html)
└── images/
    ├── page_0_image1.jpg
    └── page_1_image2.png
```

**Crawl mode:**
```
llm-export.zip/
├── sitemap.md
├── metadata.json
├── pages/
│   ├── index.md
│   ├── about.md
│   └── blog/
│       └── post-1.md
└── images/
    └── ...
```

### metadata.json Structure

```json
{
  "crawlDate": "2024-01-15T10:30:00.000Z",
  "startUrl": "https://example.com",
  "totalPages": 15,
  "totalImages": 42,
  "totalWords": 12500,
  "crawlDurationMs": 45000,
  "format": "markdown",
  "pages": [
    {
      "url": "https://example.com/about",
      "file": "pages/about.md",
      "title": "About Us",
      "wordCount": 350,
      "imageCount": 2,
      "outgoingLinks": 5,
      "incomingLinks": 3
    }
  ]
}
```

---

## POST /web-to-png

Captures full-page screenshots of websites. Supports recursive crawling or bulk URL processing.

### Request

**Recursive mode** (crawl and screenshot internal pages):
```json
{
  "mode": "recursive",
  "url": "https://example.com"
}
```

**Bulk mode** (screenshot specific URLs):
```json
{
  "mode": "bulk",
  "urls": [
    "https://example.com/page1",
    "https://example.com/page2"
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `mode` | string | `"recursive"` or `"bulk"` |
| `url` | string | Start URL (recursive mode) |
| `urls` | string[] | List of URLs (bulk mode) |

### Response

Returns a **ZIP file** (`application/zip`) containing PNG screenshots:

```
screenshots.zip/
├── 001_example_com.png
├── 002_example_com_about.png
└── 003_example_com_contact.png
```

### Limits

- Recursive mode: Maximum 20 pages
- Screenshots are full-page (1366x768 viewport, full scroll height)

---

## GET /proxy-image

Proxies external images through the server to bypass CORS restrictions. Automatically converts WebP/AVIF to PNG for Figma compatibility.

### Request

```
GET /api/proxy-image?url=https://example.com/image.webp
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Image URL to proxy (required) |

### Response

Returns the image binary with appropriate headers:

```
Content-Type: image/png (or original type)
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=31536000, immutable
```

### Automatic Format Conversion

The following formats are automatically converted to PNG:
- `image/webp`
- `image/avif`
- `image/heic`
- `image/heif`

### Limits

| Limit | Value |
|-------|-------|
| Max image size | 10 MB |
| Fetch timeout | 10 seconds |

### Error Responses

| Status | Error |
|--------|-------|
| 400 | Invalid URL or blocked (private IPs) |
| 413 | Image too large (max 10MB) |
| 504 | Image fetch timed out |

---

## GET /dribbble

Downloads all shots from a Dribbble user's portfolio.

### Request

```
GET /api/dribbble?username=johndoe
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `username` | string | Dribbble username (required) |

### Response

Returns a **ZIP file** (`application/zip`) containing up to 50 high-resolution images:

```
johndoe-shots.zip/
├── johndoe_shot_1.jpg
├── johndoe_shot_2.png
└── ...
```

### Error Responses

| Status | Error |
|--------|-------|
| 400 | Username is required |
| 500 | User not found |

---

## GET /health

Returns service health status. Used for monitoring and container health checks.

### Request

```
GET /api/health
```

### Response

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "version": "1.0.0",
  "services": {
    "browserPool": {
      "status": "healthy",
      "total": 2,
      "inUse": 1,
      "available": 1
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"healthy"`, `"degraded"`, or `"unhealthy"` |
| `uptime` | number | Seconds since server start |
| `services.browserPool.total` | number | Total browser instances |
| `services.browserPool.inUse` | number | Currently active browsers |
| `services.browserPool.available` | number | Available browser slots |

### HTTP Status Codes

| Status | Meaning |
|--------|---------|
| 200 | Service healthy |
| 503 | Service degraded/unhealthy |

---

## Security

### URL Validation

All endpoints that accept URLs validate against:

- **Protocol**: Only `http://` and `https://` allowed
- **Private IPs**: Blocked (127.0.0.1, 10.x.x.x, 192.168.x.x, etc.)
- **Localhost**: Blocked
- **URL Length**: Maximum 2048 characters
- **Credentials**: URLs with embedded credentials rejected

### Headers

All responses include security headers:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
```

---

## Error Response Format

All error responses follow this structure:

```json
{
  "error": "Human-readable error message",
  "suggestion": "What the user can do to fix it",
  "details": "Technical error message (optional)"
}
```

---

## Rate Limits

Currently no rate limiting is implemented. See [IMPROVEMENT_PLAN.md](project/IMPROVEMENT_PLAN.md) for planned security improvements.

---

## Examples

### cURL Examples

**Scrape website to Figma JSON:**
```bash
curl -X POST http://localhost:3000/api/website-to-figma \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

**Export website to Markdown:**
```bash
curl -X POST http://localhost:3000/api/web-to-llm \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "format": "markdown"}' \
  -o export.zip
```

**Crawl website (multi-page):**
```bash
curl -X POST http://localhost:3000/api/web-to-llm \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "mode": "crawl", "maxPages": 50}' \
  -o site-export.zip
```

**Proxy an image:**
```bash
curl "http://localhost:3000/api/proxy-image?url=https://example.com/image.webp" \
  -o image.png
```

**Health check:**
```bash
curl http://localhost:3000/api/health
```
