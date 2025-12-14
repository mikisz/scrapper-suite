import {
    sanitizeScreenshotFilename,
    sanitizeImageFilename,
    sanitizeString
} from '../sanitize';

describe('sanitizeScreenshotFilename', () => {
    it('should create filename from URL with index', () => {
        const result = sanitizeScreenshotFilename('https://example.com/path', 1);
        expect(result).toBe('1_example_com_path.png');
    });

    it('should handle root URL', () => {
        const result = sanitizeScreenshotFilename('https://example.com/', 1);
        expect(result).toBe('1_example_com.png');
    });

    it('should replace special characters with underscores', () => {
        const result = sanitizeScreenshotFilename('https://example.com/path-with_special.chars', 2);
        expect(result).toMatch(/^2_example_com_path_with_special_chars\.png$/);
    });

    it('should handle nested paths', () => {
        const result = sanitizeScreenshotFilename('https://example.com/a/b/c', 3);
        expect(result).toBe('3_example_com_a_b_c.png');
    });

    it('should truncate long filenames', () => {
        const longPath = 'https://example.com/' + 'a'.repeat(200);
        const result = sanitizeScreenshotFilename(longPath, 1, 50);
        // Should be truncated to maxLength
        expect(result.length).toBeLessThanOrEqual(50 + 5 + 4); // index + underscore + .png
    });

    it('should handle invalid URLs gracefully', () => {
        const result = sanitizeScreenshotFilename('not-a-valid-url', 1);
        expect(result).toBe('1_screenshot.png');
    });

    it('should handle URLs with query params', () => {
        const result = sanitizeScreenshotFilename('https://example.com/page?foo=bar', 1);
        expect(result).toMatch(/^1_example_com_page/);
    });
});

describe('sanitizeImageFilename', () => {
    it('should extract filename from URL', () => {
        const result = sanitizeImageFilename('https://example.com/images/photo.jpg');
        expect(result).toBe('photo.jpg');
    });

    it('should preserve file extension', () => {
        expect(sanitizeImageFilename('https://example.com/image.png')).toBe('image.png');
        expect(sanitizeImageFilename('https://example.com/image.gif')).toBe('image.gif');
        expect(sanitizeImageFilename('https://example.com/image.webp')).toBe('image.webp');
    });

    it('should add .png extension if none present', () => {
        const result = sanitizeImageFilename('https://example.com/image');
        expect(result).toBe('image.png');
    });

    it('should remove query parameters', () => {
        const result = sanitizeImageFilename('https://example.com/image.jpg?size=large');
        expect(result).toBe('image.jpg');
    });

    it('should replace special characters', () => {
        const result = sanitizeImageFilename('https://example.com/my-image_1.jpg');
        expect(result).toBe('my-image_1.jpg');
    });

    it('should handle URLs with no path', () => {
        const result = sanitizeImageFilename('https://example.com');
        expect(result).toBe('image.png');
    });

    it('should handle invalid URLs gracefully', () => {
        const result = sanitizeImageFilename('not-a-valid-url');
        expect(result).toMatch(/^image_\d+\.png$/);
    });

    it('should handle data URLs by extracting path-like segments', () => {
        // Data URLs are parsed and the path component is extracted
        const result = sanitizeImageFilename('data:image/png;base64,abc');
        expect(result).toMatch(/\.png$/);
    });
});

describe('sanitizeString', () => {
    it('should replace special characters with underscores', () => {
        expect(sanitizeString('hello world!')).toBe('hello_world');
    });

    it('should collapse multiple underscores', () => {
        expect(sanitizeString('hello   world')).toBe('hello_world');
    });

    it('should remove leading and trailing underscores', () => {
        expect(sanitizeString('  hello  ')).toBe('hello');
    });

    it('should handle empty string', () => {
        expect(sanitizeString('')).toBe('untitled');
    });

    it('should handle string with only special characters', () => {
        expect(sanitizeString('!@#$%^&*()')).toBe('untitled');
    });

    it('should truncate long strings', () => {
        const longString = 'a'.repeat(200);
        expect(sanitizeString(longString, 50)).toBe('a'.repeat(50));
    });

    it('should preserve alphanumeric characters', () => {
        expect(sanitizeString('Hello123World')).toBe('Hello123World');
    });

    it('should handle mixed case', () => {
        expect(sanitizeString('HelloWorld')).toBe('HelloWorld');
    });
});
