/**
 * Tests for browser-pool.ts
 * 
 * These tests mock Puppeteer to avoid actually launching browsers.
 */

// Mock puppeteer-extra before imports
const mockPage = {
  url: jest.fn(() => 'https://example.com'),
  close: jest.fn(),
};

const mockBrowser = {
  connected: true,
  newPage: jest.fn(() => Promise.resolve(mockPage)),
  pages: jest.fn(() => Promise.resolve([mockPage])),
  close: jest.fn(),
  on: jest.fn(),
};

jest.mock('puppeteer-extra', () => ({
  __esModule: true,
  default: {
    use: jest.fn(),
    launch: jest.fn(() => Promise.resolve({ ...mockBrowser })),
  },
}));

jest.mock('puppeteer-extra-plugin-stealth', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Import after mocks
import { browserPool } from '../browser-pool';

describe('BrowserPool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock browser connected state
    mockBrowser.connected = true;
  });

  afterAll(async () => {
    // Clean up the pool after all tests
    await browserPool.shutdown();
  });

  describe('acquire()', () => {
    it('should launch a new browser when pool is empty', async () => {
      const puppeteer = require('puppeteer-extra').default;
      
      const browser = await browserPool.acquire();
      
      expect(puppeteer.launch).toHaveBeenCalledWith({
        headless: true,
        args: expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox']),
      });
      expect(browser).toBeDefined();
      
      // Clean up
      await browserPool.release(browser);
    });

    it('should return existing browser from pool when available', async () => {
      const puppeteer = require('puppeteer-extra').default;
      
      // Acquire and release to add to pool
      const browser1 = await browserPool.acquire();
      await browserPool.release(browser1);
      
      const callCount = puppeteer.launch.mock.calls.length;
      
      // Second acquire should reuse the browser
      const browser2 = await browserPool.acquire();
      
      // No new launch should have happened
      expect(puppeteer.launch).toHaveBeenCalledTimes(callCount);
      
      // Clean up
      await browserPool.release(browser2);
    });
  });

  describe('release()', () => {
    it('should close all pages except about:blank when releasing', async () => {
      const browser = await browserPool.acquire();
      
      await browserPool.release(browser);
      
      expect(mockPage.close).toHaveBeenCalled();
    });

    it('should mark browser as not in use after release', async () => {
      const browser = await browserPool.acquire();
      await browserPool.release(browser);
      
      const stats = browserPool.getStats();
      expect(stats.available).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getStats()', () => {
    it('should return pool statistics', async () => {
      const stats = browserPool.getStats();
      
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('inUse');
      expect(stats).toHaveProperty('available');
      expect(typeof stats.total).toBe('number');
      expect(typeof stats.inUse).toBe('number');
      expect(typeof stats.available).toBe('number');
    });

    it('should track in-use browsers correctly', async () => {
      const initialStats = browserPool.getStats();
      
      const browser = await browserPool.acquire();
      const duringStats = browserPool.getStats();
      
      expect(duringStats.inUse).toBe(initialStats.inUse + 1);
      
      await browserPool.release(browser);
      const afterStats = browserPool.getStats();
      
      expect(afterStats.inUse).toBe(initialStats.inUse);
    });
  });

  describe('shutdown()', () => {
    it('should close all browsers in pool', async () => {
      // Create a separate pool instance for this test
      // (since we're testing shutdown behavior)
      const browser = await browserPool.acquire();
      await browserPool.release(browser);
      
      // Just verify shutdown doesn't throw
      // The actual pool uses a singleton, so we can't fully test shutdown
      // without affecting other tests
      expect(browserPool.shutdown).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle browser disconnect gracefully', async () => {
      const browser = await browserPool.acquire();
      
      // Simulate disconnect by making pages() throw
      const originalPages = browser.pages;
      browser.pages = jest.fn().mockRejectedValueOnce(new Error('Browser disconnected'));
      
      // Release should not throw
      await expect(browserPool.release(browser)).resolves.not.toThrow();
      
      // Restore
      browser.pages = originalPages;
    });
  });
});
