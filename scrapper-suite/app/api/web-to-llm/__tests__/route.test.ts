/**
 * Tests for web-to-llm API route
 * 
 * These tests mock Puppeteer, fs operations, and other dependencies.
 */

import { POST } from '../route';
import { NextRequest } from 'next/server';

// Mock puppeteer-extra
const mockPage = {
  setViewport: jest.fn(),
  goto: jest.fn(),
  content: jest.fn(),
  pdf: jest.fn(),
  close: jest.fn(),
  url: jest.fn(() => 'https://example.com'),
};

const mockBrowser = {
  newPage: jest.fn(() => Promise.resolve(mockPage)),
  close: jest.fn(),
  on: jest.fn(),
  connected: true,
  pages: jest.fn(() => Promise.resolve([mockPage])),
};

jest.mock('puppeteer-extra', () => ({
  __esModule: true,
  default: {
    use: jest.fn(),
    launch: jest.fn(() => Promise.resolve(mockBrowser)),
  },
}));

jest.mock('puppeteer-extra-plugin-stealth', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn(),
  writeFile: jest.fn(),
  remove: jest.fn(),
  readFile: jest.fn(() => Promise.resolve(Buffer.from('mock-zip-content'))),
  createWriteStream: jest.fn(() => ({
    on: jest.fn((event, cb) => {
      if (event === 'close') setTimeout(cb, 10);
      return { on: jest.fn() };
    }),
  })),
}));

// Mock archiver
jest.mock('archiver', () => {
  return jest.fn(() => ({
    directory: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    pipe: jest.fn().mockReturnThis(),
    finalize: jest.fn(),
  }));
});

// Mock JSDOM and Readability
jest.mock('jsdom', () => ({
  JSDOM: jest.fn().mockImplementation((html, options) => ({
    window: {
      document: {
        body: {
          innerHTML: '<p>Test content</p>',
          prepend: jest.fn(),
        },
        querySelectorAll: jest.fn(() => []),
        createElement: jest.fn(() => ({
          innerHTML: '',
        })),
      },
    },
  })),
}));

jest.mock('@mozilla/readability', () => ({
  Readability: jest.fn().mockImplementation(() => ({
    parse: jest.fn(() => ({
      title: 'Test Article',
      content: '<p>Cleaned content</p>',
      excerpt: 'Test excerpt',
      siteName: 'Test Site',
      byline: 'Test Author',
    })),
  })),
}));

jest.mock('turndown', () => {
  return jest.fn().mockImplementation(() => ({
    turndown: jest.fn(() => '# Test Article\n\nTest content'),
  }));
});

// Import after mocks
const puppeteer = require('puppeteer-extra').default;
const fs = require('fs-extra');

describe('POST /api/web-to-llm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPage.content.mockResolvedValue('<html><body><p>Test content</p></body></html>');
  });

  it('should return 400 if URL is not provided', async () => {
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    
    const response = await POST(request);
    const data = await response.json();
    
    expect(response.status).toBe(400);
    expect(data.error).toBe('URL is required');
  });

  it('should create job directories', async () => {
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    await POST(request);
    
    expect(fs.ensureDir).toHaveBeenCalledTimes(2);
  });

  it('should launch browser with correct options', async () => {
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    await POST(request);
    
    expect(puppeteer.launch).toHaveBeenCalledWith({
      headless: true,
      args: expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox']),
    });
  });

  it('should navigate with networkidle2 wait strategy', async () => {
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    await POST(request);
    
    expect(mockPage.goto).toHaveBeenCalledWith(
      'https://example.com',
      { waitUntil: 'networkidle2', timeout: 60000 }
    );
  });

  it('should generate PDF when includePdf is true', async () => {
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({ 
        url: 'https://example.com',
        includePdf: true,
      }),
    });
    
    await POST(request);
    
    expect(mockPage.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'A4',
        printBackground: true,
      })
    );
  });

  it('should not generate PDF when includePdf is false', async () => {
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({ 
        url: 'https://example.com',
        includePdf: false,
      }),
    });
    
    await POST(request);
    
    expect(mockPage.pdf).not.toHaveBeenCalled();
  });

  it('should release browser to pool after processing', async () => {
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    await POST(request);
    
    // Browser pool keeps browsers open for reuse, pages get closed instead
    expect(mockPage.close).toHaveBeenCalled();
  });

  it('should return zip file response', async () => {
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    const response = await POST(request);
    
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Content-Disposition')).toContain('llm-export.zip');
  });

  it('should clean up temp files after response', async () => {
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    await POST(request);
    
    // Should remove both job directory and zip file
    expect(fs.remove).toHaveBeenCalledTimes(2);
  });

  it('should handle navigation errors gracefully', async () => {
    mockPage.goto.mockRejectedValueOnce(new Error('Navigation timeout'));
    
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://slow-site.com' }),
    });
    
    const response = await POST(request);
    const data = await response.json();
    
    expect(response.status).toBe(500);
    expect(data.error).toBeDefined();
  });

  it('should set correct viewport', async () => {
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    await POST(request);
    
    expect(mockPage.setViewport).toHaveBeenCalledWith({ width: 1366, height: 768 });
  });
});

describe('sanitizeFilename helper', () => {
  // Note: sanitizeFilename is a private function in the module
  // If we want to test it directly, we'd need to export it
  // For now, we test its behavior indirectly through the route
  
  it('should handle various URL formats through the API', async () => {
    // This is more of an integration test
    mockPage.content.mockResolvedValue(`
      <html>
        <body>
          <img src="https://example.com/path/to/image.png" />
          <img src="https://example.com/image?query=param" />
          <img src="https://example.com/noextension" />
        </body>
      </html>
    `);
    
    const request = new NextRequest('http://localhost:3000/api/web-to-llm', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    
    const response = await POST(request);
    
    // Just verify it doesn't crash with various URL formats
    expect(response.status).toBe(200);
  });
});
