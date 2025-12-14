/**
 * Application Configuration
 *
 * Centralized configuration for magic numbers and constants.
 * All timeouts, limits, and defaults should be defined here.
 */

export const CONFIG = {
    /** Default viewport dimensions for screenshots and scraping */
    viewport: {
        width: 1440,
        height: 900,
        mobileWidth: 390,
        mobileHeight: 844
    },

    /** Timeout values in milliseconds */
    timeouts: {
        /** Page navigation timeout */
        navigation: 30000,
        /** Wait for network idle */
        networkIdle: 3000,
        /** Delay between scroll steps for lazy loading */
        scrollDelay: 100,
        /** Wait after scrolling for images to load */
        imageLoadDelay: 200,
        /** Image fetch timeout */
        imageFetch: 10000,
        /** Cookie modal detection timeout */
        cookieModal: 3000,
        /** Delay between retry attempts */
        retryDelay: 500
    },

    /** Resource limits */
    limits: {
        /** Maximum pages to crawl in recursive mode */
        maxPages: 500,
        /** Default pages if not specified */
        defaultMaxPages: 20,
        /** Maximum image file size in bytes (10MB) */
        maxImageSize: 10 * 1024 * 1024,
        /** Maximum URL length */
        maxUrlLength: 2048
    },

    /** Browser pool settings */
    browserPool: {
        /** Maximum concurrent browsers */
        maxSize: 3,
        /** Browser launch timeout */
        launchTimeout: 30000,
        /** Idle browser timeout before cleanup */
        idleTimeout: 60000,
        /** Cleanup check interval */
        cleanupInterval: 30000
    },

    /** Crawler settings */
    crawler: {
        /** Default delay between requests in ms */
        delayBetweenRequests: 500,
        /** Maximum retry attempts for failed pages */
        maxRetries: 2
    },

    /** Cookie dismissal settings */
    cookieDismissal: {
        /** Maximum retry attempts */
        retryCount: 2,
        /** Delay between retries in ms */
        retryDelay: 500,
        /** Polling interval for modal close detection */
        pollInterval: 100,
        /** Maximum poll attempts for modal close */
        maxPollAttempts: 10
    }
} as const;

export type Config = typeof CONFIG;

export default CONFIG;
