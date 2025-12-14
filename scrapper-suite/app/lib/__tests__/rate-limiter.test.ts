/**
 * Tests for rate limiter utility
 */

import {
    checkRateLimit,
    getClientIp,
    RATE_LIMITS,
} from '../rate-limiter';

describe('rate-limiter', () => {
    describe('checkRateLimit', () => {
        it('should allow first request', () => {
            const result = checkRateLimit('test-ip-1', { maxRequests: 5, windowMs: 60000 });

            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(4);
        });

        it('should track request count', () => {
            const identifier = 'test-ip-2';
            const config = { maxRequests: 3, windowMs: 60000 };

            checkRateLimit(identifier, config);
            checkRateLimit(identifier, config);
            const result = checkRateLimit(identifier, config);

            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('should limit after max requests exceeded', () => {
            const identifier = 'test-ip-3';
            const config = { maxRequests: 2, windowMs: 60000 };

            checkRateLimit(identifier, config);
            checkRateLimit(identifier, config);
            const result = checkRateLimit(identifier, config);

            expect(result.limited).toBe(true);
            expect(result.remaining).toBe(0);
        });

        it('should track different identifiers separately', () => {
            const config = { maxRequests: 1, windowMs: 60000 };

            checkRateLimit('ip-a', config);
            const resultA = checkRateLimit('ip-a', config);
            const resultB = checkRateLimit('ip-b', config);

            expect(resultA.limited).toBe(true);
            expect(resultB.limited).toBe(false);
        });

        it('should reset limit after windowMs', () => {
            jest.useFakeTimers();
            const identifier = 'test-ip-timer';
            const config = { maxRequests: 1, windowMs: 60000 };

            // First request, should be allowed
            checkRateLimit(identifier, config);
            const result1 = checkRateLimit(identifier, config);
            expect(result1.limited).toBe(true);

            // Advance time by windowMs
            jest.advanceTimersByTime(60001);

            // Request after window expired, should be allowed again
            const result2 = checkRateLimit(identifier, config);
            expect(result2.limited).toBe(false);
            expect(result2.remaining).toBe(0);

            jest.useRealTimers();
        });
    });

    describe('getClientIp', () => {
        it('should extract IP from x-forwarded-for header', () => {
            const request = new Request('http://localhost', {
                headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
            });

            expect(getClientIp(request)).toBe('1.2.3.4');
        });

        it('should extract IP from x-real-ip header', () => {
            const request = new Request('http://localhost', {
                headers: { 'x-real-ip': '10.0.0.1' },
            });

            expect(getClientIp(request)).toBe('10.0.0.1');
        });

        it('should extract IP from cf-connecting-ip header (Cloudflare)', () => {
            const request = new Request('http://localhost', {
                headers: { 'cf-connecting-ip': '203.0.113.50' },
            });

            expect(getClientIp(request)).toBe('203.0.113.50');
        });

        it('should return local-dev when no IP headers present', () => {
            const request = new Request('http://localhost');

            expect(getClientIp(request)).toBe('local-dev');
        });
    });

    describe('RATE_LIMITS', () => {
        it('should have correct scraping limits', () => {
            expect(RATE_LIMITS.scraping.maxRequests).toBe(10);
            expect(RATE_LIMITS.scraping.windowMs).toBe(60000);
        });

        it('should have higher proxy limits', () => {
            expect(RATE_LIMITS.proxy.maxRequests).toBe(100);
            expect(RATE_LIMITS.proxy.windowMs).toBe(60000);
        });

        it('should have health check limits', () => {
            expect(RATE_LIMITS.health.maxRequests).toBe(60);
            expect(RATE_LIMITS.health.windowMs).toBe(60000);
        });
    });
});
