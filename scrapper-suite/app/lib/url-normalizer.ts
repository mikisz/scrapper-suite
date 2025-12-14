/**
 * URL Normalization and Deduplication Utilities
 *
 * Used to prevent crawling the same page multiple times when URLs
 * differ only in trailing slashes, fragments, or tracking parameters.
 */

// Common tracking parameters to strip
const TRACKING_PARAMS = [
    // Google Analytics
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'gclsrc', 'dclid',

    // Facebook
    'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_source', 'fb_ref',

    // Microsoft
    'msclkid',

    // Twitter
    'twclid',

    // Other common ones
    'ref', 'source', 'mc_cid', 'mc_eid', // Mailchimp
    '_ga', '_gl', // Google
    'oly_enc_id', 'oly_anon_id', // Omeda
    'vero_id', 'vero_conv',
    'wickedid',
    'igshid', // Instagram
];

// Default index files to normalize
const DEFAULT_INDEX_FILES = [
    'index.html',
    'index.htm',
    'index.php',
    'index.asp',
    'index.aspx',
    'index.jsp',
    'default.html',
    'default.htm',
    'default.asp',
    'default.aspx',
];

export interface NormalizeOptions {
    removeTrailingSlash?: boolean;      // default: true
    removeDefaultIndex?: boolean;        // default: true
    removeTrackingParams?: boolean;      // default: true
    removeAllQueryParams?: boolean;      // default: false
    removeFragment?: boolean;            // default: true
    sortQueryParams?: boolean;           // default: true
    lowercaseHostname?: boolean;         // default: true
    lowercasePath?: boolean;             // default: false (some servers are case-sensitive)
    customParamsToRemove?: string[];     // additional params to strip
}

const DEFAULT_OPTIONS: NormalizeOptions = {
    removeTrailingSlash: true,
    removeDefaultIndex: true,
    removeTrackingParams: true,
    removeAllQueryParams: false,
    removeFragment: true,
    sortQueryParams: true,
    lowercaseHostname: true,
    lowercasePath: false,
};

/**
 * Normalize a URL for deduplication purposes
 */
export function normalizeUrl(urlString: string, options: NormalizeOptions = {}): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    try {
        const url = new URL(urlString);

        // Lowercase hostname
        if (opts.lowercaseHostname) {
            url.hostname = url.hostname.toLowerCase();
        }

        // Lowercase path (careful - some servers are case-sensitive)
        if (opts.lowercasePath) {
            url.pathname = url.pathname.toLowerCase();
        }

        // Remove default port
        if ((url.protocol === 'http:' && url.port === '80') ||
            (url.protocol === 'https:' && url.port === '443')) {
            url.port = '';
        }

        // Remove fragment
        if (opts.removeFragment) {
            url.hash = '';
        }

        // Handle query parameters
        if (opts.removeAllQueryParams) {
            url.search = '';
        } else if (url.searchParams.toString()) {
            const paramsToRemove = opts.removeTrackingParams
                ? [...TRACKING_PARAMS, ...(opts.customParamsToRemove || [])]
                : (opts.customParamsToRemove || []);

            // Remove tracking params
            for (const param of paramsToRemove) {
                url.searchParams.delete(param);
            }

            // Sort remaining params for consistent comparison
            if (opts.sortQueryParams && url.searchParams.toString()) {
                const sortedParams = new URLSearchParams(
                    [...url.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]))
                );
                url.search = sortedParams.toString();
            }
        }

        // Remove default index files
        if (opts.removeDefaultIndex) {
            const pathLower = url.pathname.toLowerCase();
            for (const indexFile of DEFAULT_INDEX_FILES) {
                if (pathLower.endsWith('/' + indexFile)) {
                    url.pathname = url.pathname.slice(0, -(indexFile.length));
                    break;
                }
            }
        }

        // Remove trailing slash (but keep root path)
        if (opts.removeTrailingSlash && url.pathname !== '/' && url.pathname.endsWith('/')) {
            url.pathname = url.pathname.slice(0, -1);
        }

        return url.toString();

    } catch {
        // If URL parsing fails, return original
        return urlString;
    }
}

/**
 * Check if two URLs point to the same page (after normalization)
 */
export function isSamePage(url1: string, url2: string, options?: NormalizeOptions): boolean {
    return normalizeUrl(url1, options) === normalizeUrl(url2, options);
}

/**
 * Check if a URL is an internal link (same origin as base)
 */
export function isInternalLink(link: string, baseUrl: string): boolean {
    try {
        const linkUrl = new URL(link, baseUrl);
        const base = new URL(baseUrl);

        // Same hostname (case-insensitive)
        return linkUrl.hostname.toLowerCase() === base.hostname.toLowerCase();
    } catch {
        return false;
    }
}

/**
 * Check if a URL is within a specific path
 */
export function isWithinPath(link: string, baseUrl: string, pathPrefix: string): boolean {
    try {
        const linkUrl = new URL(link, baseUrl);
        const base = new URL(baseUrl);

        if (linkUrl.hostname.toLowerCase() !== base.hostname.toLowerCase()) {
            return false;
        }

        return linkUrl.pathname.startsWith(pathPrefix);
    } catch {
        return false;
    }
}

/**
 * Get relative path from one URL to another (for inter-page linking)
 */
export function getRelativePath(fromUrl: string, toUrl: string): string {
    try {
        const from = new URL(fromUrl);
        const to = new URL(toUrl);

        // If different origins, return absolute URL
        if (from.origin !== to.origin) {
            return toUrl;
        }

        const fromParts = from.pathname.split('/').filter(Boolean);
        const toParts = to.pathname.split('/').filter(Boolean);

        // Find common prefix
        let commonLength = 0;
        for (let i = 0; i < Math.min(fromParts.length - 1, toParts.length); i++) {
            if (fromParts[i] === toParts[i]) {
                commonLength++;
            } else {
                break;
            }
        }

        // Go up from 'from' to common ancestor
        const ups = fromParts.length - 1 - commonLength;
        const upPath = '../'.repeat(ups);

        // Go down to 'to'
        const downPath = toParts.slice(commonLength).join('/');

        return upPath + downPath || '.';

    } catch {
        return toUrl;
    }
}

/**
 * Convert a URL to a safe filename/path for local storage
 */
export function urlToFilePath(urlString: string, baseUrl: string): string {
    try {
        const url = new URL(urlString);
        const base = new URL(baseUrl);

        // Get pathname relative to base
        let pathname = url.pathname;

        // Remove leading slash
        if (pathname.startsWith('/')) {
            pathname = pathname.slice(1);
        }

        // Handle root/index
        if (!pathname || pathname === '/') {
            return 'index';
        }

        // Remove trailing slash
        if (pathname.endsWith('/')) {
            pathname = pathname.slice(0, -1);
        }

        // Remove file extensions for cleaner names
        pathname = pathname.replace(/\.(html?|php|asp|aspx|jsp)$/i, '');

        // Replace problematic characters
        pathname = pathname
            .replace(/[<>:"|?*]/g, '_')
            .replace(/\\/g, '/');

        return pathname || 'index';

    } catch {
        // Fallback: hash the URL
        return `page_${hashString(urlString)}`;
    }
}

/**
 * Simple string hash for fallback filenames
 */
function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

/**
 * Extract all links from HTML content and categorize them
 */
export function categorizeLinks(links: string[], baseUrl: string): {
    internal: string[];
    external: string[];
    assets: string[];
    anchors: string[];
} {
    const result = {
        internal: [] as string[],
        external: [] as string[],
        assets: [] as string[],
        anchors: [] as string[],
    };

    const assetExtensions = /\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|tar|gz|mp3|mp4|wav|avi|mov|doc|docx|xls|xlsx|ppt|pptx)$/i;

    for (const link of links) {
        // Skip empty or javascript: links
        if (!link || link.startsWith('javascript:') || link.startsWith('data:') || link.startsWith('mailto:') || link.startsWith('tel:')) {
            continue;
        }

        // Anchor only
        if (link.startsWith('#')) {
            result.anchors.push(link);
            continue;
        }

        try {
            const url = new URL(link, baseUrl);

            // Asset file
            if (assetExtensions.test(url.pathname)) {
                result.assets.push(url.href);
                continue;
            }

            // Internal vs external
            if (isInternalLink(link, baseUrl)) {
                result.internal.push(url.href);
            } else {
                result.external.push(url.href);
            }
        } catch {
            // Invalid URL, skip
        }
    }

    return result;
}

/**
 * Deduplicate a list of URLs using normalization
 */
export function deduplicateUrls(urls: string[], options?: NormalizeOptions): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const url of urls) {
        const normalized = normalizeUrl(url, options);
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(url); // Keep original URL, just deduplicate
        }
    }

    return result;
}
