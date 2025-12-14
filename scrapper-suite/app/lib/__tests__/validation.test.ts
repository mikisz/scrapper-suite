/**
 * Tests for URL validation utilities
 */

import { validateScrapingUrl, isValidScrapingUrl, validateImageUrl } from '../validation';

describe('validateScrapingUrl', () => {
  describe('Valid URLs', () => {
    it('should accept valid HTTP URLs', () => {
      const result = validateScrapingUrl('http://example.com');
      expect(result.valid).toBe(true);
      expect(result.url).toBeDefined();
      expect(result.url?.hostname).toBe('example.com');
    });

    it('should accept valid HTTPS URLs', () => {
      const result = validateScrapingUrl('https://example.com');
      expect(result.valid).toBe(true);
    });

    it('should accept URLs with paths', () => {
      const result = validateScrapingUrl('https://example.com/path/to/page');
      expect(result.valid).toBe(true);
      expect(result.url?.pathname).toBe('/path/to/page');
    });

    it('should accept URLs with query parameters', () => {
      const result = validateScrapingUrl('https://example.com/search?q=test&page=1');
      expect(result.valid).toBe(true);
      expect(result.url?.search).toBe('?q=test&page=1');
    });

    it('should accept URLs with ports', () => {
      const result = validateScrapingUrl('https://example.com:8080/api');
      expect(result.valid).toBe(true);
      expect(result.url?.port).toBe('8080');
    });

    it('should accept URLs with fragments', () => {
      const result = validateScrapingUrl('https://example.com/page#section');
      expect(result.valid).toBe(true);
    });

    it('should accept international domain names', () => {
      const result = validateScrapingUrl('https://例え.jp/');
      expect(result.valid).toBe(true);
    });

    it('should trim whitespace from URLs', () => {
      const result = validateScrapingUrl('  https://example.com  ');
      expect(result.valid).toBe(true);
      expect(result.url?.hostname).toBe('example.com');
    });
  });

  describe('Invalid URLs - Format', () => {
    it('should reject empty string', () => {
      const result = validateScrapingUrl('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL is required');
    });

    it('should reject null/undefined', () => {
      expect(validateScrapingUrl(null as unknown as string).valid).toBe(false);
      expect(validateScrapingUrl(undefined as unknown as string).valid).toBe(false);
    });

    it('should reject whitespace-only string', () => {
      const result = validateScrapingUrl('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL is required');
    });

    it('should reject malformed URLs', () => {
      const result = validateScrapingUrl('not-a-valid-url');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid URL format');
    });

    it('should reject URLs without protocol', () => {
      const result = validateScrapingUrl('example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid URL format');
    });

    it('should reject extremely long URLs', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2100);
      const result = validateScrapingUrl(longUrl);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL is too long (max 2048 characters)');
    });
  });

  describe('Invalid URLs - Protocol', () => {
    it('should reject file:// URLs', () => {
      const result = validateScrapingUrl('file:///etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid protocol');
    });

    it('should reject ftp:// URLs', () => {
      const result = validateScrapingUrl('ftp://files.example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid protocol');
    });

    it('should reject javascript: URLs', () => {
      const result = validateScrapingUrl('javascript:alert(1)');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid protocol');
    });

    it('should reject data: URLs', () => {
      const result = validateScrapingUrl('data:text/html,<script>alert(1)</script>');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid protocol');
    });
  });

  describe('SSRF Protection - Localhost', () => {
    it('should reject localhost by default', () => {
      const result = validateScrapingUrl('http://localhost/admin');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Localhost URLs are not allowed');
    });

    it('should reject localhost with port', () => {
      const result = validateScrapingUrl('http://localhost:3000/api');
      expect(result.valid).toBe(false);
    });

    it('should reject 127.0.0.1', () => {
      const result = validateScrapingUrl('http://127.0.0.1/');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Private/internal IP addresses are not allowed');
    });

    it('should reject 127.x.x.x range', () => {
      const result = validateScrapingUrl('http://127.0.0.2/');
      expect(result.valid).toBe(false);
    });

    it('should allow localhost when option is set', () => {
      const result = validateScrapingUrl('http://localhost:3000/', { allowLocalhost: true });
      expect(result.valid).toBe(true);
    });
  });

  describe('SSRF Protection - Private IPs', () => {
    it('should reject 10.x.x.x (Class A private)', () => {
      const result = validateScrapingUrl('http://10.0.0.1/internal');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Private/internal IP addresses are not allowed');
    });

    it('should reject 172.16-31.x.x (Class B private)', () => {
      expect(validateScrapingUrl('http://172.16.0.1/').valid).toBe(false);
      expect(validateScrapingUrl('http://172.20.0.1/').valid).toBe(false);
      expect(validateScrapingUrl('http://172.31.255.255/').valid).toBe(false);
    });

    it('should allow 172.32.x.x (outside private range)', () => {
      // This is actually a valid public IP
      const result = validateScrapingUrl('http://172.32.0.1/');
      expect(result.valid).toBe(true);
    });

    it('should reject 192.168.x.x (Class C private)', () => {
      const result = validateScrapingUrl('http://192.168.1.1/router');
      expect(result.valid).toBe(false);
    });

    it('should reject 169.254.x.x (Link-local)', () => {
      const result = validateScrapingUrl('http://169.254.169.254/metadata');
      expect(result.valid).toBe(false);
    });

    it('should allow private IPs when option is set', () => {
      const result = validateScrapingUrl('http://192.168.1.100/', { allowPrivateIPs: true });
      expect(result.valid).toBe(true);
    });
  });

  describe('Credential Protection', () => {
    it('should reject URLs with username', () => {
      const result = validateScrapingUrl('https://user@example.com/');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URLs with embedded credentials are not allowed');
    });

    it('should reject URLs with username and password', () => {
      const result = validateScrapingUrl('https://user:pass@example.com/');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URLs with embedded credentials are not allowed');
    });
  });
});

describe('isValidScrapingUrl', () => {
  it('should return true for valid URLs', () => {
    expect(isValidScrapingUrl('https://example.com')).toBe(true);
  });

  it('should return false for invalid URLs', () => {
    expect(isValidScrapingUrl('')).toBe(false);
    expect(isValidScrapingUrl('file:///etc/passwd')).toBe(false);
    expect(isValidScrapingUrl('http://localhost/')).toBe(false);
  });

  it('should pass options through', () => {
    expect(isValidScrapingUrl('http://localhost/', { allowLocalhost: true })).toBe(true);
  });
});

describe('validateImageUrl', () => {
  it('should accept valid HTTP/HTTPS URLs', () => {
    expect(validateImageUrl('https://example.com/image.png').valid).toBe(true);
    expect(validateImageUrl('http://example.com/photo.jpg').valid).toBe(true);
  });

  it('should accept data: URIs for images', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = validateImageUrl(dataUri);
    expect(result.valid).toBe(true);
  });

  it('should reject data: URIs for non-images', () => {
    const dataUri = 'data:text/html,<script>alert(1)</script>';
    const result = validateImageUrl(dataUri);
    expect(result.valid).toBe(false);
  });

  it('should reject empty URLs', () => {
    expect(validateImageUrl('').valid).toBe(false);
    expect(validateImageUrl('   ').valid).toBe(false);
  });

  it('should apply SSRF protections', () => {
    expect(validateImageUrl('http://localhost/image.png').valid).toBe(false);
    expect(validateImageUrl('http://192.168.1.1/logo.png').valid).toBe(false);
  });
});
