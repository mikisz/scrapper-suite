import { crawlWebsite, buildLinkGraph, CrawlResult } from '../crawler';
import type { Page } from 'puppeteer';

// Mock the cookie-dismissal module
jest.mock('../cookie-dismissal', () => ({
    dismissCookieModals: jest.fn().mockResolvedValue({ dismissed: false })
}));

// Create mock page
function createMockPage(pageData: {
    title?: string;
    html?: string;
    links?: string[];
    images?: string[];
} = {}): jest.Mocked<Page> {
    const {
        title = 'Test Page',
        html = '<html><body>Test</body></html>',
        links = [],
        images = []
    } = pageData;

    return {
        goto: jest.fn().mockResolvedValue(null),
        evaluate: jest.fn().mockImplementation((fn: (...fnArgs: unknown[]) => unknown) => {
            // Mock the extractPageData evaluate call
            if (typeof fn === 'function') {
                return Promise.resolve({
                    title,
                    html,
                    links,
                    images
                });
            }
            return Promise.resolve(null);
        }),
        setViewport: jest.fn(),
        content: jest.fn().mockResolvedValue(html),
        url: jest.fn().mockReturnValue('https://example.com'),
    } as unknown as jest.Mocked<Page>;
}

describe('crawlWebsite', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should crawl a single page when maxPages is 1', async () => {
        const mockPage = createMockPage({
            title: 'Home Page',
            links: ['https://example.com/about', 'https://example.com/contact']
        });

        const result = await crawlWebsite(mockPage, {
            maxPages: 1,
            baseUrl: 'https://example.com'
        });

        expect(result.totalPages).toBe(1);
        expect(result.successfulPages).toBe(1);
        expect(result.failedPages).toBe(0);
        expect(mockPage.goto).toHaveBeenCalledTimes(1);
    });

    it('should respect maxPages limit', async () => {
        const mockPage = createMockPage({
            links: ['https://example.com/page1', 'https://example.com/page2', 'https://example.com/page3']
        });

        const result = await crawlWebsite(mockPage, {
            maxPages: 2,
            baseUrl: 'https://example.com'
        });

        expect(result.totalPages).toBeLessThanOrEqual(2);
    });

    it('should track crawl duration', async () => {
        const mockPage = createMockPage();

        const result = await crawlWebsite(mockPage, {
            maxPages: 1,
            baseUrl: 'https://example.com'
        });

        expect(result.crawlDuration).toBeGreaterThanOrEqual(0);
    });

    it('should handle navigation errors gracefully', async () => {
        const mockPage = createMockPage();
        mockPage.goto = jest.fn().mockRejectedValue(new Error('Navigation failed'));

        const result = await crawlWebsite(mockPage, {
            maxPages: 1,
            baseUrl: 'https://example.com'
        });

        expect(result.failedPages).toBe(1);
        expect(result.successfulPages).toBe(0);
        expect(result.results[0].error).toBe('Navigation failed');
    });

    it('should exclude URLs matching exclude patterns', async () => {
        const mockPage = createMockPage({
            links: [
                'https://example.com/valid',
                'https://example.com/wp-admin/page',
                'https://example.com/login'
            ]
        });

        const result = await crawlWebsite(mockPage, {
            maxPages: 10,
            baseUrl: 'https://example.com'
        });

        // Should only crawl the base URL since the other links match default excludes
        const crawledUrls = result.results.map(r => r.url);
        expect(crawledUrls).not.toContain('https://example.com/wp-admin/page');
        expect(crawledUrls).not.toContain('https://example.com/login');
    });

    it('should call progress callback', async () => {
        const mockPage = createMockPage();
        const progressCallback = jest.fn();

        await crawlWebsite(mockPage, {
            maxPages: 1,
            baseUrl: 'https://example.com'
        }, progressCallback);

        expect(progressCallback).toHaveBeenCalled();
        expect(progressCallback).toHaveBeenCalledWith(expect.objectContaining({
            processed: expect.any(Number),
            total: expect.any(Number),
            queued: expect.any(Number),
            currentUrl: expect.any(String),
            errors: expect.any(Number)
        }));
    });

    it('should not visit the same URL twice', async () => {
        let callCount = 0;
        const mockPage = createMockPage({
            links: ['https://example.com/', 'https://example.com', 'https://example.com/']
        });
        mockPage.goto = jest.fn().mockImplementation(() => {
            callCount++;
            return Promise.resolve(null);
        });

        await crawlWebsite(mockPage, {
            maxPages: 5,
            baseUrl: 'https://example.com'
        });

        // Should only visit once due to URL normalization
        expect(callCount).toBe(1);
    });

    it('should return correct result structure', async () => {
        const mockPage = createMockPage({
            title: 'Test Title',
            html: '<html><body>Content</body></html>',
            links: ['https://example.com/other'],
            images: ['https://example.com/image.png']
        });

        const result = await crawlWebsite(mockPage, {
            maxPages: 1,
            baseUrl: 'https://example.com'
        });

        expect(result).toMatchObject({
            startUrl: 'https://example.com',
            totalPages: 1,
            successfulPages: 1,
            failedPages: 0,
            results: expect.arrayContaining([
                expect.objectContaining({
                    url: 'https://example.com',
                    title: 'Test Title',
                    html: '<html><body>Content</body></html>',
                    crawledAt: expect.any(Date)
                })
            ])
        });
    });

    it('should respect custom exclude patterns', async () => {
        const mockPage = createMockPage({
            links: ['https://example.com/keep', 'https://example.com/skip-this']
        });

        await crawlWebsite(mockPage, {
            maxPages: 10,
            baseUrl: 'https://example.com',
            excludePatterns: [/skip-this/]
        });

        // Verify the excluded URL was not crawled by checking goto calls
        const gotoCalls = mockPage.goto.mock.calls.map(call => call[0]);
        expect(gotoCalls).not.toContain('https://example.com/skip-this');
    });
});

describe('buildLinkGraph', () => {
    it('should build empty graph for empty results', () => {
        const graph = buildLinkGraph([]);
        expect(graph.size).toBe(0);
    });

    it('should create nodes for successful pages', () => {
        const results: CrawlResult[] = [
            {
                url: 'https://example.com/page1',
                normalizedUrl: 'https://example.com/page1',
                filePath: 'page1',
                title: 'Page 1',
                html: '<html></html>',
                internalLinks: [],
                externalLinks: [],
                images: [],
                crawledAt: new Date()
            }
        ];

        const graph = buildLinkGraph(results);
        expect(graph.size).toBe(1);
        expect(graph.has('https://example.com/page1')).toBe(true);
    });

    it('should skip failed pages', () => {
        const results: CrawlResult[] = [
            {
                url: 'https://example.com/failed',
                normalizedUrl: 'https://example.com/failed',
                filePath: 'failed',
                title: '',
                html: '',
                internalLinks: [],
                externalLinks: [],
                images: [],
                error: 'Failed to load',
                crawledAt: new Date()
            }
        ];

        const graph = buildLinkGraph(results);
        expect(graph.size).toBe(0);
    });

    it('should track outgoing links between crawled pages', () => {
        const results: CrawlResult[] = [
            {
                url: 'https://example.com/page1',
                normalizedUrl: 'https://example.com/page1',
                filePath: 'page1',
                title: 'Page 1',
                html: '',
                internalLinks: ['https://example.com/page2'],
                externalLinks: [],
                images: [],
                crawledAt: new Date()
            },
            {
                url: 'https://example.com/page2',
                normalizedUrl: 'https://example.com/page2',
                filePath: 'page2',
                title: 'Page 2',
                html: '',
                internalLinks: [],
                externalLinks: [],
                images: [],
                crawledAt: new Date()
            }
        ];

        const graph = buildLinkGraph(results);
        const page1 = graph.get('https://example.com/page1');

        expect(page1?.outgoingLinks).toContain('https://example.com/page2');
    });

    it('should track incoming links', () => {
        const results: CrawlResult[] = [
            {
                url: 'https://example.com/page1',
                normalizedUrl: 'https://example.com/page1',
                filePath: 'page1',
                title: 'Page 1',
                html: '',
                internalLinks: ['https://example.com/page2'],
                externalLinks: [],
                images: [],
                crawledAt: new Date()
            },
            {
                url: 'https://example.com/page2',
                normalizedUrl: 'https://example.com/page2',
                filePath: 'page2',
                title: 'Page 2',
                html: '',
                internalLinks: [],
                externalLinks: [],
                images: [],
                crawledAt: new Date()
            }
        ];

        const graph = buildLinkGraph(results);
        const page2 = graph.get('https://example.com/page2');

        expect(page2?.incomingLinks).toContain('https://example.com/page1');
    });

    it('should not duplicate incoming links', () => {
        const results: CrawlResult[] = [
            {
                url: 'https://example.com/page1',
                normalizedUrl: 'https://example.com/page1',
                filePath: 'page1',
                title: 'Page 1',
                html: '',
                internalLinks: ['https://example.com/page2', 'https://example.com/page2'],
                externalLinks: [],
                images: [],
                crawledAt: new Date()
            },
            {
                url: 'https://example.com/page2',
                normalizedUrl: 'https://example.com/page2',
                filePath: 'page2',
                title: 'Page 2',
                html: '',
                internalLinks: [],
                externalLinks: [],
                images: [],
                crawledAt: new Date()
            }
        ];

        const graph = buildLinkGraph(results);
        const page2 = graph.get('https://example.com/page2');

        // Should only have one incoming link even though page1 links to it twice
        expect(page2?.incomingLinks.filter(l => l === 'https://example.com/page1')).toHaveLength(1);
    });
});
