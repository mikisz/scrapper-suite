/**
 * Tests for proxy-image API route
 */

import { GET } from '../route';
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

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('GET /api/proxy-image', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 400 if URL is not provided', async () => {
    const request = new NextRequest('http://localhost:3000/api/proxy-image');
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(400);
    expect(data.error).toBe('URL is required');
  });

  it('should proxy image successfully', async () => {
    const imageBuffer = Buffer.from('fake-image-data');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: () => Promise.resolve(imageBuffer),
    });

    const request = new NextRequest(
      'http://localhost:3000/api/proxy-image?url=https://example.com/image.png'
    );
    
    const response = await GET(request);
    
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toContain('max-age=31536000');
  });

  it('should include User-Agent header when fetching', async () => {
    const imageBuffer = Buffer.from('fake-image-data');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: () => Promise.resolve(imageBuffer),
    });

    const request = new NextRequest(
      'http://localhost:3000/api/proxy-image?url=https://example.com/photo.jpg'
    );
    
    await GET(request);
    
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/photo.jpg',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
      })
    );
  });

  it('should return error status when upstream fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const request = new NextRequest(
      'http://localhost:3000/api/proxy-image?url=https://example.com/missing.png'
    );
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(404);
    expect(data.error).toContain('Failed to fetch image');
  });

  it('should handle fetch exceptions gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const request = new NextRequest(
      'http://localhost:3000/api/proxy-image?url=https://example.com/image.png'
    );
    
    const response = await GET(request);
    const data = await response.json();
    
    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch image');
  });

  it('should use default content-type if not provided', async () => {
    const imageBuffer = Buffer.from('fake-image-data');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(), // No content-type
      arrayBuffer: () => Promise.resolve(imageBuffer),
    });

    const request = new NextRequest(
      'http://localhost:3000/api/proxy-image?url=https://example.com/image'
    );
    
    const response = await GET(request);
    
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('should handle URLs with special characters', async () => {
    const imageBuffer = Buffer.from('fake-image-data');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: () => Promise.resolve(imageBuffer),
    });

    const encodedUrl = encodeURIComponent('https://example.com/path/image with spaces.png');
    const request = new NextRequest(
      `http://localhost:3000/api/proxy-image?url=${encodedUrl}`
    );
    
    const response = await GET(request);
    
    expect(response.status).toBe(200);
  });
});
