/**
 * Browser Pool for Puppeteer
 * 
 * Reuses browser instances across requests to avoid the overhead of launching
 * a new Chrome process for each request (~1-2 seconds startup time).
 * 
 * Usage:
 *   const browser = await browserPool.acquire();
 *   try {
 *     const page = await browser.newPage();
 *     // ... use page ...
 *     await page.close();
 *   } finally {
 *     await browserPool.release(browser);
 *   }
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser } from 'puppeteer';

puppeteer.use(StealthPlugin());

const POOL_CONFIG = {
    maxSize: 3,           // Maximum browsers in pool
    launchTimeout: 30000, // Timeout for launching a browser
    idleTimeout: 60000,   // Close idle browsers after 60s
};

const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
];

interface PooledBrowser {
    browser: Browser;
    lastUsed: number;
    inUse: boolean;
}

class BrowserPool {
    private pool: PooledBrowser[] = [];
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Start cleanup interval to close idle browsers
        this.cleanupInterval = setInterval(() => this.cleanupIdleBrowsers(), 30000);
    }

    /**
     * Acquire a browser from the pool or launch a new one
     */
    async acquire(): Promise<Browser> {
        // Try to find an available browser in the pool
        const available = this.pool.find(pb => !pb.inUse);
        
        if (available) {
            // Check if browser is still connected
            if (available.browser.connected) {
                available.inUse = true;
                available.lastUsed = Date.now();
                return available.browser;
            } else {
                // Browser disconnected, remove from pool
                this.pool = this.pool.filter(pb => pb !== available);
            }
        }

        // No available browser, launch a new one if under max size
        if (this.pool.length < POOL_CONFIG.maxSize) {
            const browser = await puppeteer.launch({
                headless: true,
                args: BROWSER_ARGS,
            });

            const pooledBrowser: PooledBrowser = {
                browser,
                lastUsed: Date.now(),
                inUse: true,
            };

            // Handle browser disconnect
            browser.on('disconnected', () => {
                this.pool = this.pool.filter(pb => pb.browser !== browser);
            });

            this.pool.push(pooledBrowser);
            return browser;
        }

        // Pool is full and all browsers are in use, wait for one to become available
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for available browser'));
            }, POOL_CONFIG.launchTimeout);

            const checkInterval = setInterval(() => {
                const available = this.pool.find(pb => !pb.inUse && pb.browser.connected);
                if (available) {
                    clearInterval(checkInterval);
                    clearTimeout(timeout);
                    available.inUse = true;
                    available.lastUsed = Date.now();
                    resolve(available.browser);
                }
            }, 100);
        });
    }

    /**
     * Release a browser back to the pool
     */
    async release(browser: Browser): Promise<void> {
        const pooledBrowser = this.pool.find(pb => pb.browser === browser);
        
        if (pooledBrowser) {
            // Close all pages except the default blank page
            try {
                const pages = await browser.pages();
                for (const page of pages) {
                    if (page.url() !== 'about:blank') {
                        await page.close();
                    }
                }
            } catch {
                // Browser might have crashed, remove from pool
                this.pool = this.pool.filter(pb => pb !== pooledBrowser);
                return;
            }

            pooledBrowser.inUse = false;
            pooledBrowser.lastUsed = Date.now();
        }
    }

    /**
     * Close idle browsers that haven't been used recently
     */
    private async cleanupIdleBrowsers(): Promise<void> {
        const now = Date.now();
        const toRemove: PooledBrowser[] = [];

        for (const pb of this.pool) {
            if (!pb.inUse && (now - pb.lastUsed) > POOL_CONFIG.idleTimeout) {
                toRemove.push(pb);
            }
        }

        for (const pb of toRemove) {
            try {
                await pb.browser.close();
            } catch {
                // Ignore errors when closing
            }
            this.pool = this.pool.filter(p => p !== pb);
        }
    }

    /**
     * Close all browsers and cleanup (for graceful shutdown)
     */
    async shutdown(): Promise<void> {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        for (const pb of this.pool) {
            try {
                await pb.browser.close();
            } catch {
                // Ignore errors when closing
            }
        }
        this.pool = [];
    }

    /**
     * Get pool statistics for monitoring
     */
    getStats(): { total: number; inUse: number; available: number } {
        const inUse = this.pool.filter(pb => pb.inUse).length;
        return {
            total: this.pool.length,
            inUse,
            available: this.pool.length - inUse,
        };
    }
}

// Export singleton instance
export const browserPool = new BrowserPool();
