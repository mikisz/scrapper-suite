/**
 * Website Crawler Module
 *
 * BFS-based crawler for scraping multiple pages from a website.
 * Used by web-to-llm for full website content extraction.
 */

import type { Page } from 'puppeteer';
import { dismissCookieModals } from './cookie-dismissal';
import {
    normalizeUrl,
    categorizeLinks,
    deduplicateUrls,
    urlToFilePath
} from './url-normalizer';
import { logger } from './logger';

export interface CrawlOptions {
    maxPages: number;                    // Maximum pages to crawl
    baseUrl: string;                     // Starting URL
    dismissCookies?: boolean;            // Auto-dismiss cookie modals (default: true)
    delayBetweenRequests?: number;       // Rate limiting in ms (default: 500)
    timeout?: number;                    // Page load timeout in ms (default: 30000)
    stayWithinPath?: string;             // Only crawl URLs under this path
    excludePatterns?: RegExp[];          // Skip URLs matching these patterns
}

export interface CrawlResult {
    url: string;                         // Original URL
    normalizedUrl: string;               // Normalized URL (for deduplication)
    filePath: string;                    // Suggested file path for storage
    title: string;                       // Page title
    html: string;                        // Raw HTML content
    internalLinks: string[];             // Internal links found on this page
    externalLinks: string[];             // External links found on this page
    images: string[];                    // Image URLs found
    error?: string;                      // Error message if page failed
    crawledAt: Date;                     // Timestamp
}

export interface CrawlProgress {
    processed: number;                   // Pages processed so far
    total: number;                       // Max pages (or queue size if smaller)
    queued: number;                      // Pages waiting in queue
    currentUrl: string;                  // Currently processing
    errors: number;                      // Error count
}

export interface CrawlSummary {
    startUrl: string;
    totalPages: number;
    successfulPages: number;
    failedPages: number;
    totalImages: number;
    crawlDuration: number;               // In milliseconds
    results: CrawlResult[];
}

/**
 * Crawl a website starting from a URL using BFS
 */
export async function crawlWebsite(
    page: Page,
    options: CrawlOptions,
    onProgress?: (progress: CrawlProgress) => void
): Promise<CrawlSummary> {
    const {
        maxPages,
        baseUrl,
        dismissCookies = true,
        delayBetweenRequests = 500,
        timeout = 30000,
        stayWithinPath,
        excludePatterns = []
    } = options;

    const startTime = Date.now();
    const visited = new Set<string>();
    const queue: string[] = [baseUrl];
    const results: CrawlResult[] = [];
    let errorCount = 0;
    let isFirstPage = true;

    // Add default exclude patterns for common non-content pages
    const defaultExcludes = [
        /\/wp-admin\//i,
        /\/wp-login/i,
        /\/login/i,
        /\/logout/i,
        /\/sign-?in/i,
        /\/sign-?out/i,
        /\/cart/i,
        /\/checkout/i,
        /\/account/i,
        /\/admin/i,
        /\?replytocom=/i,
        /\/feed\/?$/i,
        /\/rss\/?$/i,
        /\/print\//i,
    ];

    const allExcludePatterns = [...defaultExcludes, ...excludePatterns];

    while (queue.length > 0 && results.length < maxPages) {
        const currentUrl = queue.shift()!;
        const normalizedUrl = normalizeUrl(currentUrl);

        // Skip if already visited
        if (visited.has(normalizedUrl)) {
            continue;
        }
        visited.add(normalizedUrl);

        // Check exclude patterns
        if (shouldExclude(currentUrl, allExcludePatterns)) {
            continue;
        }

        // Check path restriction
        if (stayWithinPath && !currentUrl.includes(stayWithinPath)) {
            continue;
        }

        // Report progress
        onProgress?.({
            processed: results.length,
            total: Math.min(maxPages, results.length + queue.length + 1),
            queued: queue.length,
            currentUrl,
            errors: errorCount
        });

        try {
            // Navigate to page
            await page.goto(currentUrl, {
                waitUntil: 'networkidle2',
                timeout
            });

            // Dismiss cookie modals on first page only (cookie usually persists)
            if (dismissCookies && isFirstPage) {
                const dismissResult = await dismissCookieModals(page);
                if (dismissResult.dismissed) {
                    logger.info(`Cookie modal dismissed via ${dismissResult.method}: ${dismissResult.selector}`);
                    // Wait a bit for modal to close and content to be visible
                    await new Promise(r => setTimeout(r, 500));
                }
                isFirstPage = false;
            }

            // Extract page content
            const pageData = await extractPageData(page, currentUrl, baseUrl);

            results.push({
                url: currentUrl,
                normalizedUrl,
                filePath: urlToFilePath(currentUrl, baseUrl),
                title: pageData.title,
                html: pageData.html,
                internalLinks: pageData.internalLinks,
                externalLinks: pageData.externalLinks,
                images: pageData.images,
                crawledAt: new Date()
            });

            // Add new internal links to queue
            const newLinks = deduplicateUrls(pageData.internalLinks);
            for (const link of newLinks) {
                const normalizedLink = normalizeUrl(link);
                if (!visited.has(normalizedLink) && !shouldExclude(link, allExcludePatterns)) {
                    queue.push(link);
                }
            }

        } catch (error) {
            errorCount++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to crawl ${currentUrl}`, { error: errorMessage });

            results.push({
                url: currentUrl,
                normalizedUrl,
                filePath: urlToFilePath(currentUrl, baseUrl),
                title: '',
                html: '',
                internalLinks: [],
                externalLinks: [],
                images: [],
                error: errorMessage,
                crawledAt: new Date()
            });

            // Don't add isFirstPage = false here, try cookie dismissal on next successful page
        }

        // Rate limiting
        if (delayBetweenRequests > 0 && queue.length > 0) {
            await new Promise(r => setTimeout(r, delayBetweenRequests));
        }
    }

    const endTime = Date.now();

    return {
        startUrl: baseUrl,
        totalPages: results.length,
        successfulPages: results.filter(r => !r.error).length,
        failedPages: errorCount,
        totalImages: results.reduce((sum, r) => sum + r.images.length, 0),
        crawlDuration: endTime - startTime,
        results
    };
}

/**
 * Extract data from a loaded page
 */
async function extractPageData(
    page: Page,
    _currentUrl: string,
    baseUrl: string
): Promise<{
    title: string;
    html: string;
    internalLinks: string[];
    externalLinks: string[];
    images: string[];
}> {
    const data = await page.evaluate((_baseUrl: string) => {
        // Get title
        const title = document.title || '';

        // Get HTML content
        const html = document.documentElement.outerHTML;

        // Get all links
        const linkElements = Array.from(document.querySelectorAll('a[href]'));
        const links = linkElements
            .map(a => {
                try {
                    // Resolve relative URLs
                    return new URL(a.getAttribute('href') || '', window.location.href).href;
                } catch {
                    return null;
                }
            })
            .filter((href): href is string => href !== null);

        // Get all images
        const imgElements = Array.from(document.querySelectorAll('img[src]'));
        const images = imgElements
            .map(img => {
                try {
                    const src = img.getAttribute('src') || '';
                    if (src.startsWith('data:')) return null;
                    return new URL(src, window.location.href).href;
                } catch {
                    return null;
                }
            })
            .filter((src): src is string => src !== null);

        return { title, html, links, images };
    }, baseUrl);

    // Categorize links
    const categorized = categorizeLinks(data.links, baseUrl);

    return {
        title: data.title,
        html: data.html,
        internalLinks: categorized.internal,
        externalLinks: categorized.external,
        images: data.images
    };
}

/**
 * Check if URL should be excluded based on patterns
 */
function shouldExclude(url: string, patterns: RegExp[]): boolean {
    for (const pattern of patterns) {
        if (pattern.test(url)) {
            return true;
        }
    }
    return false;
}

/**
 * Build a link graph from crawl results (for sitemap generation)
 */
export function buildLinkGraph(results: CrawlResult[]): Map<string, {
    url: string;
    title: string;
    filePath: string;
    outgoingLinks: string[];
    incomingLinks: string[];
}> {
    const graph = new Map<string, {
        url: string;
        title: string;
        filePath: string;
        outgoingLinks: string[];
        incomingLinks: string[];
    }>();

    // Build URL to result map
    const urlToResult = new Map<string, CrawlResult>();
    for (const result of results) {
        if (!result.error) {
            urlToResult.set(result.normalizedUrl, result);
        }
    }

    // Initialize graph nodes
    for (const result of results) {
        if (!result.error) {
            graph.set(result.normalizedUrl, {
                url: result.url,
                title: result.title,
                filePath: result.filePath,
                outgoingLinks: [],
                incomingLinks: []
            });
        }
    }

    // Build edges
    for (const result of results) {
        if (result.error) continue;

        const node = graph.get(result.normalizedUrl)!;

        for (const link of result.internalLinks) {
            const normalizedLink = normalizeUrl(link);
            if (urlToResult.has(normalizedLink)) {
                // This is a link to another crawled page
                node.outgoingLinks.push(normalizedLink);

                // Add incoming link to target
                const targetNode = graph.get(normalizedLink);
                if (targetNode && !targetNode.incomingLinks.includes(result.normalizedUrl)) {
                    targetNode.incomingLinks.push(result.normalizedUrl);
                }
            }
        }
    }

    return graph;
}
