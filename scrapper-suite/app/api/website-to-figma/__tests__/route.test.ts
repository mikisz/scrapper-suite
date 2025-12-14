/**
 * Tests for website-to-figma API route
 *
 * These tests mock Puppeteer to avoid actually launching browsers.
 */

import { POST } from '../route';
import { NextRequest } from 'next/server';

// Mock rate limiter to bypass rate limiting in tests
jest.mock('../../../lib/rate-limiter', () => ({
  applyRateLimit: jest.fn(() => null),
  RATE_LIMITS: {
    scraping: { maxRequests: 10, windowMs: 60000 },
    proxy: { maxRequests: 100, windowMs: 60000 },
    health: { maxRequests: 60, windowMs: 60000 },
  },
}));

// Mock page and browser objects
const mockPage = {
  setViewport: jest.fn().mockResolvedValue(undefined),
  goto: jest.fn().mockResolvedValue(undefined),
  evaluate: jest.fn().mockResolvedValue({ type: 'FRAME', children: [] }),
  close: jest.fn().mockResolvedValue(undefined),
  url: jest.fn(() => 'https://example.com'),
};

const mockBrowser = {
  newPage: jest.fn(() => Promise.resolve(mockPage)),
  close: jest.fn(),
  on: jest.fn(),
  connected: true,
  pages: jest.fn(() => Promise.resolve([mockPage])),
};

// Mock the browser-pool module to return our mock browser
jest.mock('../../../lib/browser-pool', () => ({
  browserPool: {
    acquire: jest.fn(() => Promise.resolve(mockBrowser)),
    release: jest.fn(() => Promise.resolve()),
    getStats: jest.fn(() => ({ total: 1, inUse: 0, available: 1 })),
    shutdown: jest.fn(() => Promise.resolve()),
  },
}));

// Mock fs for reading serializer
jest.mock('fs', () => ({
  readFileSync: jest.fn(() => `
    window.FigmaSerializer = {
      serialize: function() {
        return { type: 'FRAME', children: [] };
      }
    };
  `),
}));

describe('POST /api/website-to-figma', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mockPage.evaluate to return a valid figma tree
    mockPage.evaluate.mockResolvedValue({ type: 'FRAME', children: [] });
  });

  it('should return 400 if URL is not provided', async () => {
    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    
    const response = await POST(request);
    const data = await response.json();
    
    expect(response.status).toBe(400);
    expect(data.error).toBe('URL is required');
  });

  it('should return 400 for empty URL', async () => {
    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: '' }),
    });
    
    const response = await POST(request);
    const data = await response.json();
    
    expect(response.status).toBe(400);
    expect(data.error).toBe('URL is required');
  });

  it('should successfully scrape a valid URL', async () => {
    const mockFigmaTree = {
      type: 'FRAME',
      tag: 'body',
      children: [
        { type: 'TEXT_NODE', content: 'Hello World' }
      ],
    };

    // Mock all 4 evaluate calls in order:
    // 1. Scroll to trigger lazy loading
    // 2. Wait for images to load
    // 3. Inject serializer code
    // 4. Run serializer and return result
    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // Scroll
      .mockResolvedValueOnce(undefined) // Wait for images
      .mockResolvedValueOnce(undefined) // Inject serializer
      .mockResolvedValueOnce(mockFigmaTree); // Run serializer

    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe('Scraping successful');
    expect(data.data).toEqual(mockFigmaTree);
  });

  it('should acquire browser from pool', async () => {
    mockPage.evaluate.mockResolvedValue({ type: 'FRAME', children: [] });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { browserPool } = require('../../../lib/browser-pool');

    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });

    await POST(request);

    expect(browserPool.acquire).toHaveBeenCalled();
  });

  it('should set correct viewport', async () => {
    mockPage.evaluate.mockResolvedValue({ type: 'FRAME', children: [] });
    
    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    await POST(request);
    
    expect(mockPage.setViewport).toHaveBeenCalledWith({ width: 1440, height: 900 });
  });

  it('should navigate with networkidle0 wait strategy', async () => {
    mockPage.evaluate.mockResolvedValue({ type: 'FRAME', children: [] });
    
    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    await POST(request);
    
    expect(mockPage.goto).toHaveBeenCalledWith(
      'https://example.com',
      { waitUntil: 'networkidle0', timeout: 30000 }
    );
  });

  it('should release browser to pool after successful scrape', async () => {
    mockPage.evaluate.mockResolvedValue({ type: 'FRAME', children: [] });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { browserPool } = require('../../../lib/browser-pool');

    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });

    await POST(request);

    // Browser pool release should be called
    expect(browserPool.release).toHaveBeenCalled();
  });

  it('should handle navigation error gracefully', async () => {
    mockPage.goto.mockRejectedValueOnce(new Error('Navigation timeout'));

    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://slow-site.com' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    // Error is mapped to user-friendly message
    expect(data.error).toBe('Navigation timeout');
  });

  it('should handle serialization errors', async () => {
    // Mock all 4 evaluate calls, with the 4th one failing
    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // Scroll
      .mockResolvedValueOnce(undefined) // Wait for images
      .mockResolvedValueOnce(undefined) // Inject serializer
      .mockRejectedValueOnce(new Error('Serialization failed')); // Serialization fails

    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.details).toBe('Serialization failed');
  });

  it('should return figma tree with correct structure', async () => {
    const complexTree = {
      type: 'FRAME',
      tag: 'body',
      styles: {
        width: 1440,
        height: 900,
        display: 'block',
      },
      children: [
        {
          type: 'FRAME',
          tag: 'header',
          children: [
            { type: 'TEXT_NODE', content: 'Site Title' }
          ],
        },
        {
          type: 'IMAGE',
          src: 'https://example.com/logo.png',
          tag: 'img',
        },
      ],
    };

    // Mock all 4 evaluate calls
    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // Scroll
      .mockResolvedValueOnce(undefined) // Wait for images
      .mockResolvedValueOnce(undefined) // Inject serializer
      .mockResolvedValueOnce(complexTree); // Run serializer

    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.data.type).toBe('FRAME');
    expect(data.data.children).toHaveLength(2);
    expect(data.data.children[0].type).toBe('FRAME');
    expect(data.data.children[1].type).toBe('IMAGE');
  });
});
