/**
 * Shared Download Utilities
 *
 * Common functions for downloading files with safety limits.
 */

import fs from 'fs-extra';

// Safety limits
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT_MS = 10000; // 10 seconds

export { MAX_IMAGE_SIZE_BYTES, FETCH_TIMEOUT_MS };

/**
 * Download an image with size limits and timeout protection.
 *
 * @param url - URL of the image to download
 * @param filepath - Local path to save the image
 * @throws Error if image is too large, fetch times out, or download fails
 */
export async function downloadImage(url: string, filepath: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScrapperSuite/1.0)' }
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Status ${response.status}`);

        // Check content-length early to reject oversized images
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        if (contentLength > MAX_IMAGE_SIZE_BYTES) {
            throw new Error('Image too large (max 10MB)');
        }

        const buffer = await response.arrayBuffer();

        // Double-check size after download
        if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
            throw new Error('Image too large (max 10MB)');
        }

        await fs.writeFile(filepath, Buffer.from(buffer));
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}
