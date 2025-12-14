/**
 * In-Memory Rate Limiter
 *
 * Simple sliding window rate limiter for API protection.
 * Note: This is per-instance only. For distributed systems,
 * use Redis-based rate limiting.
 */

import { NextResponse } from 'next/server';

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

interface RateLimitConfig {
    /** Maximum requests allowed in the window */
    maxRequests: number;
    /** Window duration in milliseconds */
    windowMs: number;
}

// Store request counts per IP
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpiredEntries(): void {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL) return;

    lastCleanup = now;
    for (const [key, entry] of rateLimitStore.entries()) {
        if (now > entry.resetTime) {
            rateLimitStore.delete(key);
        }
    }
}

/**
 * Default rate limit configurations per endpoint type
 */
export const RATE_LIMITS = {
    /** Heavy endpoints (scraping) - 10 requests per minute */
    scraping: {
        maxRequests: 10,
        windowMs: 60 * 1000
    },
    /** Medium endpoints (image proxy) - 100 requests per minute */
    proxy: {
        maxRequests: 100,
        windowMs: 60 * 1000
    },
    /** Light endpoints (health check) - 60 requests per minute */
    health: {
        maxRequests: 60,
        windowMs: 60 * 1000
    }
} as const;

/**
 * Extract client IP from request headers
 */
export function getClientIp(request: Request): string {
    // Check common proxy headers
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
        // Take first IP in chain (original client)
        return forwardedFor.split(',')[0].trim();
    }

    const realIp = request.headers.get('x-real-ip');
    if (realIp) {
        return realIp;
    }

    // Fallback - won't work in production but handles local dev
    return 'unknown';
}

/**
 * Check if request is rate limited
 *
 * @param identifier - Unique identifier (typically IP address)
 * @param config - Rate limit configuration
 * @returns Object with limited status and remaining requests
 */
export function checkRateLimit(
    identifier: string,
    config: RateLimitConfig
): { limited: boolean; remaining: number; resetTime: number } {
    cleanupExpiredEntries();

    const now = Date.now();
    const key = identifier;
    const entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetTime) {
        // First request or window expired - create new entry
        const newEntry: RateLimitEntry = {
            count: 1,
            resetTime: now + config.windowMs
        };
        rateLimitStore.set(key, newEntry);
        return {
            limited: false,
            remaining: config.maxRequests - 1,
            resetTime: newEntry.resetTime
        };
    }

    // Increment counter
    entry.count++;
    rateLimitStore.set(key, entry);

    const remaining = Math.max(0, config.maxRequests - entry.count);
    const limited = entry.count > config.maxRequests;

    return { limited, remaining, resetTime: entry.resetTime };
}

/**
 * Apply rate limiting to a request
 *
 * @param request - Incoming request
 * @param endpointKey - Key to identify endpoint for separate limits
 * @param config - Rate limit configuration
 * @returns NextResponse if rate limited, null otherwise
 */
export function applyRateLimit(
    request: Request,
    endpointKey: string,
    config: RateLimitConfig
): NextResponse | null {
    const clientIp = getClientIp(request);
    const identifier = `${endpointKey}:${clientIp}`;

    const result = checkRateLimit(identifier, config);

    if (result.limited) {
        const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);

        return NextResponse.json(
            {
                error: 'Too many requests',
                suggestion: `Please wait ${retryAfter} seconds before trying again.`,
                retryAfter
            },
            {
                status: 429,
                headers: {
                    'Retry-After': String(retryAfter),
                    'X-RateLimit-Limit': String(config.maxRequests),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': String(Math.ceil(result.resetTime / 1000))
                }
            }
        );
    }

    return null;
}

/**
 * Get rate limit headers for successful responses
 */
export function getRateLimitHeaders(
    request: Request,
    endpointKey: string,
    config: RateLimitConfig
): Record<string, string> {
    const clientIp = getClientIp(request);
    const identifier = `${endpointKey}:${clientIp}`;
    const entry = rateLimitStore.get(identifier);

    if (!entry) {
        return {
            'X-RateLimit-Limit': String(config.maxRequests),
            'X-RateLimit-Remaining': String(config.maxRequests),
            'X-RateLimit-Reset': String(Math.ceil((Date.now() + config.windowMs) / 1000))
        };
    }

    return {
        'X-RateLimit-Limit': String(config.maxRequests),
        'X-RateLimit-Remaining': String(Math.max(0, config.maxRequests - entry.count)),
        'X-RateLimit-Reset': String(Math.ceil(entry.resetTime / 1000))
    };
}
