/**
 * URL Validation utilities for Scrapper Suite
 * 
 * Provides security validation for URLs to prevent:
 * - Invalid URL formats
 * - Non-HTTP(S) protocols (file://, ftp://, etc.)
 * - SSRF attacks (accessing internal networks)
 */

// Private/internal IP ranges that should be blocked
const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // Loopback
  /^10\./,                           // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./,     // Class B private
  /^192\.168\./,                     // Class C private
  /^169\.254\./,                     // Link-local
  /^0\./,                            // Current network
  /^224\./,                          // Multicast
  /^240\./,                          // Reserved
];

const BLOCKED_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '::1',
  '[::]',
];

export interface ValidationResult {
  valid: boolean;
  error?: string;
  url?: URL;
}

/**
 * Validates a URL for safe scraping operations
 * 
 * @param urlString - The URL string to validate
 * @param options - Validation options
 * @returns ValidationResult with valid flag and optional error message
 */
export function validateScrapingUrl(
  urlString: string,
  options: {
    allowLocalhost?: boolean;  // For development, default false
    allowPrivateIPs?: boolean; // For internal tools, default false
  } = {}
): ValidationResult {
  const { allowLocalhost = false, allowPrivateIPs = false } = options;

  // Check if URL is provided
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  // Trim whitespace
  const trimmedUrl = urlString.trim();
  
  if (trimmedUrl.length === 0) {
    return { valid: false, error: 'URL is required' };
  }

  // Check for maximum URL length (prevent DoS with extremely long URLs)
  if (trimmedUrl.length > 2048) {
    return { valid: false, error: 'URL is too long (max 2048 characters)' };
  }

  // Try to parse the URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Validate protocol (only http and https allowed)
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return { 
      valid: false, 
      error: `Invalid protocol: ${parsedUrl.protocol}. Only HTTP and HTTPS are allowed` 
    };
  }

  // Check for blocked hostnames
  const hostname = parsedUrl.hostname.toLowerCase();
  
  if (!allowLocalhost && BLOCKED_HOSTNAMES.includes(hostname)) {
    return { valid: false, error: 'Localhost URLs are not allowed' };
  }

  // Check for private/internal IP addresses
  if (!allowPrivateIPs) {
    // Check if hostname looks like an IP address
    const ipMatch = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
    if (ipMatch) {
      for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.test(hostname)) {
          return { valid: false, error: 'Private/internal IP addresses are not allowed' };
        }
      }
    }
  }

  // Check for credentials in URL (potential security issue)
  if (parsedUrl.username || parsedUrl.password) {
    return { valid: false, error: 'URLs with embedded credentials are not allowed' };
  }

  return { valid: true, url: parsedUrl };
}

/**
 * Simple validation check that returns boolean
 * Use validateScrapingUrl() if you need the error message
 */
export function isValidScrapingUrl(
  urlString: string,
  options: { allowLocalhost?: boolean; allowPrivateIPs?: boolean } = {}
): boolean {
  return validateScrapingUrl(urlString, options).valid;
}

/**
 * Validates an image URL for the proxy endpoint
 * More permissive than scraping URLs (allows data: URIs for example)
 */
export function validateImageUrl(urlString: string): ValidationResult {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  const trimmedUrl = urlString.trim();
  
  if (trimmedUrl.length === 0) {
    return { valid: false, error: 'URL is required' };
  }

  // Allow data: URIs for images
  if (trimmedUrl.startsWith('data:image/')) {
    return { valid: true };
  }

  // For regular URLs, use standard validation
  return validateScrapingUrl(trimmedUrl);
}
