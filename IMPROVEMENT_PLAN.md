# Scrapper Suite - Repository Analysis & Improvement Plan

## Executive Summary

This repository is a **web scraping and design reconstruction toolkit** that converts websites into editable Figma designs. It consists of three main components:
- **Scrapper Suite** (Next.js backend) - API server for scraping
- **Figma Plugin** - Visual reconstruction engine
- **Chrome Extension** - Client-side scraper for protected pages

**Overall Assessment: B+ (Good with room for improvement)**

---

## Completed Improvements ✅

The following improvements have been implemented:

### Phase 1: Foundation
- [x] **CI/CD Pipeline** - Added `.github/workflows/ci.yml` with test, lint, type-check, and build jobs
- [x] **Security Headers** - Added X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy to `next.config.ts`
- [x] **.gitignore** - Added patterns for `.env*`, `.next/`, `dist/`, `coverage/`, editor directories

### Phase 2: Type Safety
- [x] **Replaced `any` types** - Fixed error handling in API routes and library files to use proper `Error` type checking

### Phase 3: Code Quality
- [x] **Logger Utility** - Created `app/lib/logger.ts` for structured logging with environment-aware behavior
- [x] **Config Constants** - Created `app/lib/config.ts` to centralize magic numbers and configuration

### Phase 4: Testing
- [x] **url-normalizer.ts tests** - Added comprehensive tests (35 test cases)
- [x] **sanitize.ts tests** - Added comprehensive tests (23 test cases)
- [x] **crawler.ts tests** - Added comprehensive tests (16 test cases)

**New test coverage: 87 new tests added, all passing**

---

## Remaining Improvements

---

## 2. Code Quality Issues (Priority 2 - High)

### 2.1 Type Safety Violations (31 instances)

| File | Issue | Line |
|------|-------|------|
| `app/api/website-to-figma/route.ts` | `catch (error: any)` | 199 |
| `app/api/web-to-llm/route.ts` | `catch (error: any)` | 400 |
| `app/api/proxy-image/route.ts` | `catch (error: any)` | 100 |
| `app/api/web-to-png/route.ts` | `page: any` | 12, 19, 26 |
| `app/lib/cookie-dismissal.ts` | `catch (error: any)` | 146 |
| `app/lib/crawler.ts` | `catch (error: any)` | 175 |
| `clients/figma-plugin/src/code.ts` | Multiple `any` params | 50, 55, 72, etc. |

**Recommendation:** Replace `any` with proper error types:
```typescript
// Instead of: catch (error: any)
catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
}
```

### 2.2 @ts-ignore Comments (2 instances)
| File | Line |
|------|------|
| `scrapper-suite/next.config.ts` | 4 |
| `app/api/website-to-figma/route.ts` | 173 |

### 2.3 Console Statements (52 instances)
Production code contains debug logging that should use a proper logger:
- `app/api/web-to-llm/route.ts` - 8 instances
- `app/api/website-to-figma/route.ts` - 1 instance
- `app/api/proxy-image/route.ts` - 2 instances
- `clients/figma-plugin/src/code.ts` - 16 instances

**Recommendation:** Implement a logging utility:
```typescript
// app/lib/logger.ts
const isDev = process.env.NODE_ENV === 'development';
export const logger = {
  info: isDev ? console.log : () => {},
  error: console.error, // Always log errors
  warn: isDev ? console.warn : () => {},
};
```

### 2.4 Large Files Needing Refactoring

| File | Lines | Recommendation |
|------|-------|----------------|
| `clients/figma-plugin/src/code.ts` | 1,934 | Split into modules: `renderer.ts`, `styles.ts`, `images.ts` |
| `scrapper-suite/app/lib/dom-serializer.js` | 609 | Convert to TypeScript, split by node type |

### 2.5 Magic Numbers (15+ instances)
Hardcoded values should move to configuration:

```typescript
// app/lib/config.ts (new file)
export const CONFIG = {
  viewport: { width: 1440, height: 900 },
  timeouts: {
    navigation: 30000,
    networkIdle: 3000,
    scrollDelay: 100,
  },
  limits: {
    maxPages: 500,
    maxImageSize: 10 * 1024 * 1024, // 10MB
    maxUrlLength: 2048,
  },
  browserPool: {
    maxSize: 3,
    idleTimeout: 60000,
  },
};
```

---

## 3. Testing Gaps (Priority 2 - High)

### Current Coverage: ~35%

### Untested Critical Components

| Component | Lines | Risk Level | Recommended Test File |
|-----------|-------|------------|----------------------|
| `crawler.ts` | 351 | HIGH | `crawler.test.ts` |
| `cookie-dismissal.ts` | 392 | HIGH | `cookie-dismissal.test.ts` |
| `url-normalizer.ts` | 350 | HIGH | `url-normalizer.test.ts` |
| `sanitize.ts` | 68 | MEDIUM | `sanitize.test.ts` |
| `puppeteer-utils.ts` | 88 | MEDIUM | `puppeteer-utils.test.ts` |
| `archive.ts` | 38 | LOW | `archive.test.ts` |

### Test Coverage Targets
Add to `jest.config.js`:
```javascript
coverageThreshold: {
  global: {
    branches: 70,
    functions: 75,
    lines: 75,
  },
},
```

---

## 4. Security Improvements (Priority 2 - High)

### 4.1 Strengths (Already Implemented)
- SSRF protection with private IP blocking (`validation.ts`)
- URL validation (protocol, length, credentials)
- Safe SVG handling in Figma plugin
- Containerized with non-root user

### 4.2 Gaps to Address

| Issue | File | Recommendation |
|-------|------|----------------|
| No rate limiting | API routes | Add express-rate-limit or similar |
| Verbose error logging | `web-to-llm/route.ts:401` | Sanitize error messages in production |
| Image size unlimited | `downloadImage()` | Add Content-Length check |
| Missing security headers | `next.config.ts` | Add OWASP security headers |

**Security Headers (add to next.config.ts):**
```typescript
headers: async () => [{
  source: '/(.*)',
  headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-XSS-Protection', value: '1; mode=block' },
  ],
}],
```

---

## 5. Documentation Gaps (Priority 3 - Medium)

### Current State
- Architecture docs exist (`docs/architecture/`)
- Getting started guide exists (`docs/guides/how-to-run.md`)
- Good JSDoc in library files

### Missing Documentation

| Document | Purpose |
|----------|---------|
| `docs/API.md` | Request/response schemas for all endpoints |
| `docs/TROUBLESHOOTING.md` | Common issues and solutions |
| `scrapper-suite/README.md` | Replace generic Next.js template |
| `clients/figma-plugin/README.md` | Plugin installation & usage |

---

## 6. Architecture Improvements (Priority 3 - Medium)

### 6.1 Convert dom-serializer.js to TypeScript
**Current:** Only JavaScript file in TypeScript codebase
**Benefit:** Type safety, better IDE support, consistent codebase

```typescript
// app/lib/types/figma.ts (new file)
export interface FigmaNode {
  type: 'FRAME' | 'TEXT_NODE' | 'IMAGE' | 'VECTOR';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fills?: FigmaFill[];
  strokes?: FigmaStroke[];
  children?: FigmaNode[];
}
```

### 6.2 Extract Shared Types
Create `app/lib/types/index.ts` to centralize interfaces used across modules.

### 6.3 Split Large Components

**Figma Plugin (`code.ts` → multiple files):**
```
clients/figma-plugin/src/
├── code.ts          # Main entry, messaging
├── renderer.ts      # buildNode(), createFrame()
├── styles.ts        # Color parsing, fills, strokes
├── typography.ts    # Font loading, text handling
├── images.ts        # Image loading, SVG handling
└── types.ts         # Shared interfaces
```

---

## 7. Feature Enhancement Ideas (Priority 4 - Low)

### 7.1 Performance Improvements
- [ ] Add response caching for repeated URLs
- [ ] Implement streaming responses for large exports
- [ ] Add progress events via Server-Sent Events

### 7.2 Developer Experience
- [ ] Add Swagger/OpenAPI documentation generation
- [ ] Create Postman collection for API testing
- [ ] Add VS Code launch configurations for debugging

### 7.3 Monitoring
- [ ] Add health check endpoint with dependency status
- [ ] Implement structured logging (JSON format)
- [ ] Add request tracing with correlation IDs

---

## 8. Implementation Roadmap

### Phase 1: Foundation (1-2 days)
- [ ] Add CI/CD pipeline (GitHub Actions)
- [ ] Fix .gitignore patterns
- [ ] Add security headers to Next.js config

### Phase 2: Type Safety (2-3 days)
- [ ] Replace `any` types with proper error handling
- [ ] Remove @ts-ignore comments
- [ ] Convert dom-serializer.js to TypeScript

### Phase 3: Test Coverage (3-5 days)
- [ ] Add crawler.ts tests
- [ ] Add url-normalizer.ts tests
- [ ] Add cookie-dismissal.ts tests
- [ ] Add sanitize.ts tests
- [ ] Add puppeteer-utils.ts tests

### Phase 4: Code Quality (2-3 days)
- [ ] Extract magic numbers to config
- [ ] Replace console.log with logger utility
- [ ] Split large files into modules

### Phase 5: Documentation (1-2 days)
- [ ] Create API.md with endpoint documentation
- [ ] Update scrapper-suite/README.md
- [ ] Create TROUBLESHOOTING.md

---

## 9. Quick Wins (Can Do Today)

1. **Add .env to .gitignore** - 1 line change
2. **Add security headers** - 10 lines in next.config.ts
3. **Replace `catch (error: any)`** - Search/replace pattern
4. **Create basic CI workflow** - Copy/paste YAML template

---

## Appendix: File Reference

### Key Files for Each Improvement Area

**Type Safety:**
- `scrapper-suite/app/api/*/route.ts` - All API routes
- `scrapper-suite/app/lib/*.ts` - Library modules
- `clients/figma-plugin/src/code.ts` - Plugin logic

**Testing:**
- `scrapper-suite/jest.config.js` - Test configuration
- `scrapper-suite/app/lib/__tests__/` - Existing tests

**Security:**
- `scrapper-suite/app/lib/validation.ts` - URL validation
- `scrapper-suite/next.config.ts` - Next.js config
- `.gitignore` - Git ignore patterns

**Documentation:**
- `docs/` - Existing documentation
- `README.md` - Project root README
- `AGENTS.md` - Development workflow
