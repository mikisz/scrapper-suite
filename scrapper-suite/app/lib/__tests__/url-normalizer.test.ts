import {
    normalizeUrl,
    isSamePage,
    isInternalLink,
    isWithinPath,
    getRelativePath,
    urlToFilePath,
    categorizeLinks,
    deduplicateUrls
} from '../url-normalizer';

describe('normalizeUrl', () => {
    it('should lowercase hostname', () => {
        expect(normalizeUrl('https://EXAMPLE.COM/path')).toBe('https://example.com/path');
    });

    it('should remove trailing slash from paths', () => {
        expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });

    it('should keep trailing slash for root path', () => {
        expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('should remove fragment by default', () => {
        expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
    });

    it('should keep fragment when removeFragment is false', () => {
        expect(normalizeUrl('https://example.com/page#section', { removeFragment: false }))
            .toBe('https://example.com/page#section');
    });

    it('should remove common tracking parameters', () => {
        expect(normalizeUrl('https://example.com/page?utm_source=google&id=123'))
            .toBe('https://example.com/page?id=123');
    });

    it('should remove multiple tracking parameters', () => {
        const url = 'https://example.com/page?utm_source=google&utm_medium=cpc&fbclid=abc&real=param';
        expect(normalizeUrl(url)).toBe('https://example.com/page?real=param');
    });

    it('should sort query parameters', () => {
        expect(normalizeUrl('https://example.com/page?z=1&a=2&m=3'))
            .toBe('https://example.com/page?a=2&m=3&z=1');
    });

    it('should remove default port 80 for http', () => {
        expect(normalizeUrl('http://example.com:80/path')).toBe('http://example.com/path');
    });

    it('should remove default port 443 for https', () => {
        expect(normalizeUrl('https://example.com:443/path')).toBe('https://example.com/path');
    });

    it('should keep non-default ports', () => {
        expect(normalizeUrl('https://example.com:8080/path')).toBe('https://example.com:8080/path');
    });

    it('should remove default index files', () => {
        // After removing index file, trailing slash is also removed
        expect(normalizeUrl('https://example.com/path/index.html')).toBe('https://example.com/path');
        expect(normalizeUrl('https://example.com/path/index.php')).toBe('https://example.com/path');
        expect(normalizeUrl('https://example.com/path/default.aspx')).toBe('https://example.com/path');
    });

    it('should remove all query params when removeAllQueryParams is true', () => {
        expect(normalizeUrl('https://example.com/page?a=1&b=2', { removeAllQueryParams: true }))
            .toBe('https://example.com/page');
    });

    it('should handle custom params to remove', () => {
        expect(normalizeUrl('https://example.com/page?custom=1&keep=2', {
            removeTrackingParams: false,
            customParamsToRemove: ['custom']
        })).toBe('https://example.com/page?keep=2');
    });

    it('should return original string for invalid URLs', () => {
        expect(normalizeUrl('not-a-valid-url')).toBe('not-a-valid-url');
    });

    it('should handle URLs with no path', () => {
        expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
    });
});

describe('isSamePage', () => {
    it('should return true for identical URLs', () => {
        expect(isSamePage('https://example.com/page', 'https://example.com/page')).toBe(true);
    });

    it('should return true for URLs differing only in trailing slash', () => {
        expect(isSamePage('https://example.com/page', 'https://example.com/page/')).toBe(true);
    });

    it('should return true for URLs differing only in fragment', () => {
        expect(isSamePage('https://example.com/page', 'https://example.com/page#section')).toBe(true);
    });

    it('should return true for URLs differing only in tracking params', () => {
        expect(isSamePage('https://example.com/page', 'https://example.com/page?utm_source=google')).toBe(true);
    });

    it('should return false for different pages', () => {
        expect(isSamePage('https://example.com/page1', 'https://example.com/page2')).toBe(false);
    });

    it('should return false for different domains', () => {
        expect(isSamePage('https://example.com/page', 'https://other.com/page')).toBe(false);
    });
});

describe('isInternalLink', () => {
    const baseUrl = 'https://example.com/path/page';

    it('should return true for same hostname', () => {
        expect(isInternalLink('https://example.com/other', baseUrl)).toBe(true);
    });

    it('should return true for relative URLs', () => {
        expect(isInternalLink('/other/page', baseUrl)).toBe(true);
        expect(isInternalLink('../other', baseUrl)).toBe(true);
        expect(isInternalLink('sibling', baseUrl)).toBe(true);
    });

    it('should return false for different hostname', () => {
        expect(isInternalLink('https://other.com/page', baseUrl)).toBe(false);
    });

    it('should be case-insensitive for hostname', () => {
        expect(isInternalLink('https://EXAMPLE.COM/page', baseUrl)).toBe(true);
    });

    it('should return false for invalid URLs', () => {
        expect(isInternalLink('not-a-url-://invalid', baseUrl)).toBe(false);
    });
});

describe('isWithinPath', () => {
    const baseUrl = 'https://example.com';

    it('should return true for URLs within path prefix', () => {
        expect(isWithinPath('https://example.com/blog/post', baseUrl, '/blog')).toBe(true);
        expect(isWithinPath('https://example.com/blog/', baseUrl, '/blog')).toBe(true);
    });

    it('should return false for URLs outside path prefix', () => {
        expect(isWithinPath('https://example.com/about', baseUrl, '/blog')).toBe(false);
    });

    it('should return false for different domain', () => {
        expect(isWithinPath('https://other.com/blog/post', baseUrl, '/blog')).toBe(false);
    });
});

describe('getRelativePath', () => {
    it('should return relative path for same directory', () => {
        expect(getRelativePath('https://example.com/a/b/c', 'https://example.com/a/b/d'))
            .toBe('d');
    });

    it('should return path with ../ for parent directory', () => {
        expect(getRelativePath('https://example.com/a/b/c', 'https://example.com/a/d'))
            .toBe('../d');
    });

    it('should return absolute URL for different origins', () => {
        expect(getRelativePath('https://example.com/a', 'https://other.com/b'))
            .toBe('https://other.com/b');
    });

    it('should handle root to nested path', () => {
        // When from path is root, the relative path calculation returns the full URL
        // because there's no common ancestor to traverse
        const result = getRelativePath('https://example.com/', 'https://example.com/a/b');
        expect(result).toMatch(/a\/b$/);
    });
});

describe('urlToFilePath', () => {
    const baseUrl = 'https://example.com';

    it('should return index for root URL', () => {
        expect(urlToFilePath('https://example.com/', baseUrl)).toBe('index');
        expect(urlToFilePath('https://example.com', baseUrl)).toBe('index');
    });

    it('should convert path to filepath', () => {
        expect(urlToFilePath('https://example.com/blog/post', baseUrl)).toBe('blog/post');
    });

    it('should remove html extensions', () => {
        expect(urlToFilePath('https://example.com/page.html', baseUrl)).toBe('page');
        expect(urlToFilePath('https://example.com/page.php', baseUrl)).toBe('page');
    });

    it('should handle trailing slash', () => {
        expect(urlToFilePath('https://example.com/path/', baseUrl)).toBe('path');
    });

    it('should handle special characters in path', () => {
        // URL encoding may occur, and the function replaces certain chars with _
        const result = urlToFilePath('https://example.com/path-name', baseUrl);
        expect(result).toBe('path-name');
    });
});

describe('categorizeLinks', () => {
    const baseUrl = 'https://example.com';

    it('should categorize internal links', () => {
        const links = ['https://example.com/page', '/relative'];
        const result = categorizeLinks(links, baseUrl);
        expect(result.internal).toHaveLength(2);
    });

    it('should categorize external links', () => {
        const links = ['https://other.com/page'];
        const result = categorizeLinks(links, baseUrl);
        expect(result.external).toEqual(['https://other.com/page']);
    });

    it('should categorize asset links', () => {
        const links = ['https://example.com/image.png', 'https://example.com/file.pdf'];
        const result = categorizeLinks(links, baseUrl);
        expect(result.assets).toHaveLength(2);
    });

    it('should categorize anchor links', () => {
        const links = ['#section1', '#section2'];
        const result = categorizeLinks(links, baseUrl);
        expect(result.anchors).toEqual(['#section1', '#section2']);
    });

    it('should skip javascript: and mailto: links', () => {
        const links = ['javascript:void(0)', 'mailto:test@example.com', 'tel:+1234567890'];
        const result = categorizeLinks(links, baseUrl);
        expect(result.internal).toHaveLength(0);
        expect(result.external).toHaveLength(0);
    });

    it('should handle mixed links', () => {
        const links = [
            'https://example.com/page',
            'https://other.com/external',
            '/image.png',
            '#anchor',
            'javascript:void(0)'
        ];
        const result = categorizeLinks(links, baseUrl);
        expect(result.internal).toHaveLength(1);
        expect(result.external).toHaveLength(1);
        expect(result.assets).toHaveLength(1);
        expect(result.anchors).toHaveLength(1);
    });
});

describe('deduplicateUrls', () => {
    it('should remove duplicate URLs', () => {
        const urls = [
            'https://example.com/page',
            'https://example.com/page',
            'https://example.com/other'
        ];
        expect(deduplicateUrls(urls)).toHaveLength(2);
    });

    it('should dedupe URLs that differ only in normalization', () => {
        const urls = [
            'https://example.com/page',
            'https://example.com/page/',
            'https://example.com/page?utm_source=google'
        ];
        expect(deduplicateUrls(urls)).toHaveLength(1);
    });

    it('should keep original URL format, not normalized', () => {
        const urls = ['https://EXAMPLE.COM/page', 'https://example.com/page'];
        const result = deduplicateUrls(urls);
        expect(result).toEqual(['https://EXAMPLE.COM/page']);
    });

    it('should handle empty array', () => {
        expect(deduplicateUrls([])).toEqual([]);
    });
});
