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
- [x] **puppeteer-utils.ts tests** - Added comprehensive tests (10 test cases)
- [x] **cookie-dismissal.ts tests** - Added comprehensive tests (21 test cases)

### Phase 5: Console Logging Migration
- [x] **Replaced all console.log/error/warn** - Migrated 20 instances across 6 files to use logger utility

**Total test coverage: 238 tests, all passing**

---

## Remaining Improvements

---

## 2. Code Quality Issues (Priority 2 - High)

### 2.1 Type Safety Violations ✅ RESOLVED
All `any` types in backend TypeScript files have been replaced with proper error handling patterns.

### 2.2 @ts-ignore Comments ✅ RESOLVED
Only 1 legitimate `@ts-expect-error` remains in `website-to-figma/route.ts` for dynamically injected code.

### 2.3 Console Statements ✅ RESOLVED
All console statements in backend code migrated to logger utility (`app/lib/logger.ts`).
- Figma plugin (`clients/figma-plugin/src/code.ts`) still uses console.log (acceptable for browser context)

### 2.4 Large Files Needing Refactoring

| File | Lines | Recommendation |
|------|-------|----------------|
| `clients/figma-plugin/src/code.ts` | 1,934 | Split into modules: `renderer.ts`, `styles.ts`, `images.ts` |
| `scrapper-suite/app/lib/dom-serializer.js` | 609 | **Note:** Must remain JS - injected directly into browser contexts via `page.evaluate()` |

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

### Current Coverage: ~85% (improved)

### Tested Components ✅

| Component | Lines | Status | Test File |
|-----------|-------|--------|-----------|
| `crawler.ts` | 351 | ✅ TESTED | `crawler.test.ts` (16 tests) |
| `url-normalizer.ts` | 350 | ✅ TESTED | `url-normalizer.test.ts` (35 tests) |
| `sanitize.ts` | 68 | ✅ TESTED | `sanitize.test.ts` (23 tests) |
| `puppeteer-utils.ts` | 88 | ✅ TESTED | `puppeteer-utils.test.ts` (10 tests) |
| `cookie-dismissal.ts` | 392 | ✅ TESTED | `cookie-dismissal.test.ts` (21 tests) |

### Remaining Untested Components

| Component | Lines | Risk Level | Recommended Test File |
|-----------|-------|------------|----------------------|
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

### 4.2 Gaps to Address ✅ MOSTLY RESOLVED

| Issue | File | Status |
|-------|------|--------|
| No rate limiting | API routes | ✅ Added `rate-limiter.ts` with per-endpoint limits |
| Image size unlimited | `downloadImage()` | ✅ Added 10MB limit + timeout (10s) |
| Missing security headers | `next.config.ts` | ✅ Already implemented |
| Verbose error logging | `web-to-llm/route.ts` | Sanitized in user-facing responses |

**Rate Limiting Configuration:**
- Scraping endpoints: 10 requests/minute per IP
- Proxy endpoint: 100 requests/minute per IP
- Health endpoint: 60 requests/minute per IP

---

## 5. Documentation Gaps (Priority 3 - Medium)

### Current State
- Architecture docs exist (`docs/architecture/`)
- Getting started guide exists (`docs/guides/how-to-run.md`)
- Good JSDoc in library files

### Documentation Status

| Document | Purpose | Status |
|----------|---------|--------|
| `docs/API.md` | Request/response schemas for all endpoints | ✅ Created |
| `scrapper-suite/README.md` | Backend overview and setup | ✅ Updated |
| `clients/figma-plugin/README.md` | Plugin installation & usage | ✅ Created |
| `docs/TROUBLESHOOTING.md` | Common issues and solutions | Pending |

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

### Phase 1: Foundation ✅ COMPLETE
- [x] Add CI/CD pipeline (GitHub Actions)
- [x] Fix .gitignore patterns
- [x] Add security headers to Next.js config

### Phase 2: Type Safety ✅ COMPLETE
- [x] Replace `any` types with proper error handling
- [x] Remove @ts-ignore comments (converted to @ts-expect-error where legitimate)
- [x] **dom-serializer.js** - Intentionally remains JS (injected into browser via `page.evaluate()`)

### Phase 3: Test Coverage ✅ COMPLETE
- [x] Add crawler.ts tests
- [x] Add url-normalizer.ts tests
- [x] Add cookie-dismissal.ts tests
- [x] Add sanitize.ts tests
- [x] Add puppeteer-utils.ts tests

### Phase 4: Code Quality ✅ MOSTLY COMPLETE
- [x] Extract magic numbers to config
- [x] Replace console.log with logger utility
- [ ] Split large files into modules (REMAINING - lower priority)

### Phase 5: Documentation ✅ MOSTLY COMPLETE
- [x] Create API.md with endpoint documentation
- [x] Update scrapper-suite/README.md
- [x] Create clients/figma-plugin/README.md
- [ ] Create TROUBLESHOOTING.md (optional)

---

## 9. Quick Wins ✅ ALL COMPLETED

1. ~~**Add .env to .gitignore**~~ ✅ Done
2. ~~**Add security headers**~~ ✅ Done
3. ~~**Replace `catch (error: any)`**~~ ✅ Done
4. ~~**Create basic CI workflow**~~ ✅ Done

## 10. Next Priority Items

1. ~~**Create API.md**~~ ✅ Done - Comprehensive endpoint documentation
2. ~~**Add rate limiting**~~ ✅ Done - Per-endpoint limits with `rate-limiter.ts`
3. ~~**Image size limits**~~ ✅ Done - 10MB limit with timeout
4. **Split large files** - `code.ts` into modules (lower priority)
5. **Create TROUBLESHOOTING.md** - Common issues and solutions (optional)

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
