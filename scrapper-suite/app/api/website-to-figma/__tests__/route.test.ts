/**
 * Tests for website-to-figma API route
 * 
 * These tests mock Puppeteer to avoid actually launching browsers.
 */

import { POST } from '../route';
import { NextRequest } from 'next/server';

// Mock puppeteer-extra
jest.mock('puppeteer-extra', () => {
  const mockPage = {
    setViewport: jest.fn(),
    goto: jest.fn(),
    evaluate: jest.fn(),
  };
  
  const mockBrowser = {
    newPage: jest.fn(() => Promise.resolve(mockPage)),
    close: jest.fn(),
  };
  
  return {
    __esModule: true,
    default: {
      use: jest.fn(),
      launch: jest.fn(() => Promise.resolve(mockBrowser)),
    },
    mockBrowser,
    mockPage,
  };
});

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

// Get mock references
const puppeteer = require('puppeteer-extra').default;
const { mockBrowser, mockPage } = require('puppeteer-extra');

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
    
    // First evaluate injects the serializer, second runs it
    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // Serializer injection
      .mockResolvedValueOnce(mockFigmaTree); // Serialization result
    
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

  it('should launch browser with correct options', async () => {
    mockPage.evaluate.mockResolvedValue({ type: 'FRAME', children: [] });
    
    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    await POST(request);
    
    expect(puppeteer.launch).toHaveBeenCalledWith({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
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

  it('should close browser after successful scrape', async () => {
    mockPage.evaluate.mockResolvedValue({ type: 'FRAME', children: [] });
    
    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    await POST(request);
    
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('should close browser on navigation error', async () => {
    mockPage.goto.mockRejectedValueOnce(new Error('Navigation timeout'));
    
    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://slow-site.com' }),
    });
    
    const response = await POST(request);
    const data = await response.json();
    
    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to scrape website');
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('should handle serialization errors', async () => {
    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // Serializer injection
      .mockRejectedValueOnce(new Error('Serialization failed')); // Serialization error
    
    const request = new NextRequest('http://localhost:3000/api/website-to-figma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    const response = await POST(request);
    const data = await response.json();
    
    expect(response.status).toBe(500);
    expect(data.details).toBe('Serialization failed');
    expect(mockBrowser.close).toHaveBeenCalled();
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
    
    mockPage.evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(complexTree);
    
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
