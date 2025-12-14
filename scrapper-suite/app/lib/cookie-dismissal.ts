import type { Page } from 'puppeteer';

// Known cookie consent button selectors (specific libraries)
const COOKIE_BUTTON_SELECTORS = [
    // OneTrust
    '#onetrust-accept-btn-handler',
    '#accept-recommended-btn-handler',

    // CookieBot
    '#CybotCookiebotDialogBodyButtonAccept',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',

    // Cookie Consent (Osano)
    '.cc-btn.cc-allow',
    '.cc-accept-all',

    // Funding Choices (Google)
    '.fc-cta-consent',
    '.fc-button-label',

    // Quantcast
    '.qc-cmp2-summary-buttons button[mode="primary"]',

    // Termly
    '.t-acceptAllButton',

    // TrustArc
    '.trustarc-agree-btn',

    // Generic patterns
    '#cookie-accept',
    '#accept-cookies',
    '#cookies-accept',
    '#gdpr-cookie-accept',
    '#cookie-consent-accept',
    '.cookie-accept',
    '.accept-cookies',
    '.cookie-consent-accept',
    '[data-testid="cookie-accept"]',
    '[data-cy="cookie-accept"]',

    // Aria-based
    'button[aria-label*="accept" i]',
    'button[aria-label*="cookie" i][aria-label*="accept" i]',
];

// Text patterns to match in button text
const COOKIE_BUTTON_TEXT_PATTERNS = [
    /^accept$/i,
    /^accept all$/i,
    /^accept all cookies$/i,
    /^accept cookies$/i,
    /^allow$/i,
    /^allow all$/i,
    /^allow all cookies$/i,
    /^allow cookies$/i,
    /^i agree$/i,
    /^agree$/i,
    /^i accept$/i,
    /^ok$/i,
    /^okay$/i,
    /^got it$/i,
    /^continue$/i,
    /^dismiss$/i,
    /^yes, i agree$/i,
    /^yes, i accept$/i,
];

// Modal container selectors to detect presence
const MODAL_CONTAINER_SELECTORS = [
    '#onetrust-consent-sdk',
    '#onetrust-banner-sdk',
    '#CybotCookiebotDialog',
    '.cc-window',
    '.qc-cmp2-container',
    '.fc-consent-root',
    '[class*="cookie-banner"]',
    '[class*="cookie-consent"]',
    '[class*="consent-banner"]',
    '[class*="gdpr-banner"]',
    '[id*="cookie-consent"]',
    '[id*="cookie-banner"]',
    '[role="dialog"][aria-label*="cookie" i]',
    '[role="dialog"][aria-label*="consent" i]',
];

export interface DismissOptions {
    timeout?: number;       // Max time to wait for modals (default: 3000ms)
    retryCount?: number;    // Number of retry attempts (default: 2)
    retryDelay?: number;    // Delay between retries (default: 500ms)
}

export interface DismissResult {
    dismissed: boolean;
    method?: string;
    selector?: string;
    error?: string;
}

/**
 * Attempts to dismiss cookie consent modals on a page
 * Should be called after page.goto() completes
 */
export async function dismissCookieModals(
    page: Page,
    options: DismissOptions = {}
): Promise<DismissResult> {
    const {
        timeout = 3000,
        retryCount = 2,
        retryDelay = 500
    } = options;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
        try {
            // Wait a bit for modal to appear (they often load after page)
            if (attempt === 0) {
                await page.waitForSelector(MODAL_CONTAINER_SELECTORS.join(', '), {
                    timeout: timeout
                }).catch(() => null); // Ignore if no modal appears
            }

            // Strategy 1: Try known selectors directly
            const selectorResult = await tryKnownSelectors(page);
            if (selectorResult.dismissed) {
                return selectorResult;
            }

            // Strategy 2: Try text-based button search
            const textResult = await tryTextBasedButtons(page);
            if (textResult.dismissed) {
                return textResult;
            }

            // Strategy 3: Try shadow DOM
            const shadowResult = await tryShadowDomButtons(page);
            if (shadowResult.dismissed) {
                return shadowResult;
            }

            // Wait before retry
            if (attempt < retryCount) {
                await new Promise(r => setTimeout(r, retryDelay));
            }

        } catch (error) {
            if (attempt === retryCount) {
                return {
                    dismissed: false,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        }
    }

    return { dismissed: false };
}

/**
 * Try clicking known cookie consent button selectors
 */
async function tryKnownSelectors(page: Page): Promise<DismissResult> {
    for (const selector of COOKIE_BUTTON_SELECTORS) {
        try {
            const button = await page.$(selector);
            if (button) {
                const isVisible = await page.evaluate((el) => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return (
                        rect.width > 0 &&
                        rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0'
                    );
                }, button);

                if (isVisible) {
                    await button.click();
                    // Wait for modal to disappear by polling
                    await waitForModalToClose(page);
                    return {
                        dismissed: true,
                        method: 'selector',
                        selector
                    };
                }
            }
        } catch {
            // Continue to next selector
        }
    }
    return { dismissed: false };
}

/**
 * Find and click buttons by their text content
 */
async function tryTextBasedButtons(page: Page): Promise<DismissResult> {
    try {
        const result = await page.evaluate((patterns: string[]) => {
            // Convert pattern strings back to RegExp
            const regexPatterns = patterns.map(p => {
                const match = p.match(/^\/(.+)\/([gimsu]*)$/);
                if (match) {
                    return new RegExp(match[1], match[2]);
                }
                return new RegExp(p, 'i');
            });

            // Find all buttons and clickable elements
            const clickables = Array.from(document.querySelectorAll(
                'button, [role="button"], a.btn, a.button, input[type="button"], input[type="submit"]'
            ));

            for (const el of clickables) {
                const text = (el.textContent || '').trim();
                const ariaLabel = el.getAttribute('aria-label') || '';
                const value = (el as HTMLInputElement).value || '';

                const textToCheck = text || ariaLabel || value;

                for (const pattern of regexPatterns) {
                    if (pattern.test(textToCheck)) {
                        // Check if visible
                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        if (
                            rect.width > 0 &&
                            rect.height > 0 &&
                            style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            style.opacity !== '0'
                        ) {
                            (el as HTMLElement).click();
                            return { found: true, text: textToCheck };
                        }
                    }
                }
            }
            return { found: false };
        }, COOKIE_BUTTON_TEXT_PATTERNS.map(p => p.toString()));

        if (result.found) {
            // Wait for modal to disappear by polling
            await waitForModalToClose(page);
            return {
                dismissed: true,
                method: 'text',
                selector: result.text
            };
        }
    } catch {
        // Continue
    }
    return { dismissed: false };
}

/**
 * Try to find cookie buttons inside shadow DOM
 */
async function tryShadowDomButtons(page: Page): Promise<DismissResult> {
    try {
        const result = await page.evaluate((selectors: string[], patterns: string[]) => {
            const regexPatterns = patterns.map(p => {
                const match = p.match(/^\/(.+)\/([gimsu]*)$/);
                if (match) {
                    return new RegExp(match[1], match[2]);
                }
                return new RegExp(p, 'i');
            });

            // Find all shadow roots
            function findShadowRoots(root: Document | ShadowRoot): ShadowRoot[] {
                const shadows: ShadowRoot[] = [];
                const elements = root.querySelectorAll('*');
                for (const el of elements) {
                    if (el.shadowRoot) {
                        shadows.push(el.shadowRoot);
                        shadows.push(...findShadowRoots(el.shadowRoot));
                    }
                }
                return shadows;
            }

            const shadowRoots = findShadowRoots(document);

            for (const shadow of shadowRoots) {
                // Try selectors
                for (const selector of selectors) {
                    try {
                        const el = shadow.querySelector(selector);
                        if (el) {
                            const rect = el.getBoundingClientRect();
                            const style = window.getComputedStyle(el);
                            if (
                                rect.width > 0 &&
                                rect.height > 0 &&
                                style.display !== 'none' &&
                                style.visibility !== 'hidden'
                            ) {
                                (el as HTMLElement).click();
                                return { found: true, method: 'shadow-selector', selector };
                            }
                        }
                    } catch {
                        // Continue
                    }
                }

                // Try text-based
                const buttons = shadow.querySelectorAll('button, [role="button"]');
                for (const btn of buttons) {
                    const text = (btn.textContent || '').trim();
                    for (const pattern of regexPatterns) {
                        if (pattern.test(text)) {
                            const rect = btn.getBoundingClientRect();
                            const style = window.getComputedStyle(btn);
                            if (
                                rect.width > 0 &&
                                rect.height > 0 &&
                                style.display !== 'none' &&
                                style.visibility !== 'hidden'
                            ) {
                                (btn as HTMLElement).click();
                                return { found: true, method: 'shadow-text', text };
                            }
                        }
                    }
                }
            }

            return { found: false };
        }, COOKIE_BUTTON_SELECTORS, COOKIE_BUTTON_TEXT_PATTERNS.map(p => p.toString()));

        if (result.found) {
            // Wait for modal to disappear by polling
            await waitForModalToClose(page);
            return {
                dismissed: true,
                method: result.method,
                selector: result.selector || result.text
            };
        }
    } catch {
        // Continue
    }
    return { dismissed: false };
}

/**
 * Check if a cookie modal is currently visible on the page
 */
export async function hasCookieModal(page: Page): Promise<boolean> {
    try {
        return await page.evaluate((selectors: string[]) => {
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    if (
                        rect.width > 0 &&
                        rect.height > 0 &&
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0'
                    ) {
                        return true;
                    }
                }
            }
            return false;
        }, MODAL_CONTAINER_SELECTORS);
    } catch {
        return false;
    }
}

/**
 * Wait for cookie modal to close by polling
 */
async function waitForModalToClose(page: Page, maxAttempts: number = 10, intervalMs: number = 100): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
        if (!(await hasCookieModal(page))) {
            return;
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
}
