/**
 * Puppeteer utility functions for Scrapper Suite
 *
 * Shared browser automation helpers used across API endpoints.
 */

import type { Page } from 'puppeteer';

/**
 * Auto-scrolls a page to trigger lazy-loaded content
 *
 * @param page - Puppeteer page instance
 * @param options - Scroll options
 * @returns Promise that resolves when scrolling is complete
 */
export async function autoScroll(
    page: Page,
    options: {
        distance?: number;
        delay?: number;
        maxScrollHeight?: number;
    } = {}
): Promise<void> {
    const { distance = 100, delay = 100, maxScrollHeight = 20000 } = options;

    await page.evaluate(
        async (distance: number, delay: number, maxScrollHeight: number) => {
            await new Promise<void>((resolve) => {
                let totalHeight = 0;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    // Stop when we've scrolled to the bottom or hit the max
                    if (totalHeight >= scrollHeight || totalHeight > maxScrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, delay);
            });
        },
        distance,
        delay,
        maxScrollHeight
    );
}

/**
 * Scrolls through a page to load all lazy images
 *
 * @param page - Puppeteer page instance
 * @param viewportHeight - Height of the viewport
 * @returns Promise that resolves when all sections have been scrolled
 */
export async function scrollToLoadImages(
    page: Page,
    viewportHeight: number
): Promise<void> {
    await page.evaluate(async (viewportHeight: number) => {
        const scrollHeight = document.body.scrollHeight;
        const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

        for (let y = 0; y < scrollHeight; y += viewportHeight) {
            window.scrollTo(0, y);
            await delay(100);
        }
        // Reset to top
        window.scrollTo(0, 0);
    }, viewportHeight);
}

/**
 * Waits for network to be idle with a custom timeout
 *
 * @param page - Puppeteer page instance
 * @param timeout - Maximum time to wait in ms
 */
export async function waitForNetworkIdle(
    page: Page,
    timeout: number = 5000
): Promise<void> {
    try {
        await page.waitForNetworkIdle({ timeout });
    } catch {
        // Timeout is acceptable, continue
    }
}
