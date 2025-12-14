/**
 * Filename sanitization utilities for Scrapper Suite
 *
 * Provides safe filename generation from URLs and strings.
 */

import { URL } from 'url';
import path from 'path';

/**
 * Sanitizes a URL into a safe filename for screenshots
 *
 * @param url - URL to convert to filename
 * @param index - Index number to prefix the filename
 * @param maxLength - Maximum length for the base filename (default 100)
 * @returns Safe filename like "1_example_com_path.png"
 */
export function sanitizeScreenshotFilename(
    url: string,
    index: number,
    maxLength: number = 100
): string {
    try {
        const u = new URL(url);
        let name = u.hostname + u.pathname.replace(/\//g, '_');
        if (name.endsWith('_')) name = name.slice(0, -1);
        return `${index}_${name.replace(/[^a-z0-9]/gi, '_').substring(0, maxLength)}.png`;
    } catch {
        return `${index}_screenshot.png`;
    }
}

/**
 * Sanitizes a URL into a safe filename for downloaded images
 * Preserves file extension when possible
 *
 * @param url - URL to extract filename from
 * @returns Safe filename with extension like "image_name.png"
 */
export function sanitizeImageFilename(url: string): string {
    try {
        const u = new URL(url);
        const basename = path.basename(u.pathname) || 'image';
        // Remove query params and weird chars
        const cleanName = basename.split('?')[0].replace(/[^a-z0-9._-]/gi, '_');
        // Ensure extension
        if (!cleanName.includes('.')) return `${cleanName}.png`;
        return cleanName;
    } catch {
        return `image_${Date.now()}.png`;
    }
}

/**
 * Sanitizes any string into a safe filename
 *
 * @param str - String to sanitize
 * @param maxLength - Maximum length (default 100)
 * @returns Safe filename string
 */
export function sanitizeString(str: string, maxLength: number = 100): string {
    return str
        .replace(/[^a-z0-9]/gi, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, maxLength) || 'untitled';
}
