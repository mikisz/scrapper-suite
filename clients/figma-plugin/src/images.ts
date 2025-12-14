/// <reference types="@figma/plugin-typings" />

import type { VisualNode } from './types';

/**
 * Image downloading and caching utilities for the Website-to-Figma plugin
 */

// Pending image download resolvers
export const pendingImages: { [key: string]: (data: Uint8Array | null) => void } = {};

// Cache of downloaded images (URL -> image bytes)
export const imageCache: Map<string, Uint8Array | null> = new Map();

/**
 * Download an image via the UI thread
 * Returns the image as Uint8Array, or null if failed
 */
export function downloadImage(url: string): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
        const id = Math.random().toString(36).substring(7);

        // Store resolver
        (pendingImages as any)[id] = resolve;

        // Request image from UI
        figma.ui.postMessage({ type: 'fetch-image', url, id });

        // Timeout safety (5 seconds)
        setTimeout(() => {
            if ((pendingImages as any)[id]) {
                delete (pendingImages as any)[id];
                resolve(null);
            }
        }, 5000);
    });
}

/**
 * Resolve a pending image download
 * Called when UI sends back image-data message
 */
export function resolveImage(id: string, data: Uint8Array | null): void {
    const resolver = pendingImages[id];
    if (resolver) {
        delete pendingImages[id];
        resolver(data);
    }
}

/**
 * Extract all image URLs from a visual tree node
 */
export function extractImageUrls(node: VisualNode, urls: Set<string>): void {
    if (!node) return;

    // Direct image nodes
    if (node.type === 'IMAGE' && node.src) {
        urls.add(node.src);
    }

    // Background images (from styles or pseudo-elements)
    const styles = node.styles || (node as any);
    if (styles.backgroundImage && styles.backgroundImage.type === 'IMAGE' && styles.backgroundImage.url) {
        urls.add(styles.backgroundImage.url);
    }

    // Pseudo-elements with images
    if (node.type === 'PSEUDO_ELEMENT') {
        // content: url() images
        if (node.imageUrl) {
            urls.add(node.imageUrl);
        }
        // Background images
        if (styles.backgroundImage && styles.backgroundImage.type === 'IMAGE' && styles.backgroundImage.url) {
            urls.add(styles.backgroundImage.url);
        }
    }

    // Recurse through children
    if (node.children) {
        for (const child of node.children) {
            extractImageUrls(child, urls);
        }
    }
}

/**
 * Download all images in parallel and cache them
 */
export async function preloadImages(rootData: VisualNode): Promise<void> {
    const urls = new Set<string>();
    extractImageUrls(rootData, urls);

    if (urls.size === 0) return;

    console.log(`Preloading ${urls.size} images in parallel...`);

    // Download all images in parallel
    const downloadPromises = Array.from(urls).map(async (url) => {
        const imageData = await downloadImage(url);
        imageCache.set(url, imageData);
    });

    await Promise.all(downloadPromises);
    console.log(`Preloaded ${urls.size} images successfully`);
}

/**
 * Clear the image cache (should be called before each new import)
 */
export function clearImageCache(): void {
    imageCache.clear();
}

/**
 * Get count of successfully loaded images
 */
export function getLoadedImageCount(): number {
    return Array.from(imageCache.values()).filter(v => v !== null).length;
}

/**
 * Get total image count in cache
 */
export function getTotalImageCount(): number {
    return imageCache.size;
}
