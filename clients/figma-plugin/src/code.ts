/// <reference types="@figma/plugin-typings" />

/**
 * Website-to-Figma Plugin - Main Entry Point
 *
 * This file handles the plugin initialization, message handling, and build orchestration.
 * The actual rendering logic is split into separate modules for maintainability.
 */

import type { VisualNode, ComponentDocsMetadata, ComponentDocsDoneSummary, ComponentData } from './types';
import { loadFonts } from './fonts';
import {
    resolveImage,
    extractImageUrls,
    preloadImages,
    clearImageCache,
    getLoadedImageCount,
    getTotalImageCount
} from './images';
import {
    buildNode,
    countNodes,
    setTotalNodes,
    resetProcessedNodes,
    setProgressCallback,
    setWarningCallback,
    processedNodes
} from './renderer';

// Initialize UI
figma.showUI(__html__, { width: 300, height: 450 });

// =====================
// State Management
// =====================

let warnings: string[] = [];
let isImporting = false;

// =====================
// UI Communication
// =====================

function sendProgress(stage: string, percent: number | null = null, detail: string = '', status: string = '') {
    figma.ui.postMessage({ type: 'progress', stage, percent, detail, status });
}

function sendError(message: string, details?: string) {
    console.error('Import Error:', message, details);
    figma.ui.postMessage({
        type: 'error',
        message,
        details,
        suggestion: getErrorSuggestion(message)
    });
}

function sendWarning(message: string) {
    console.warn('Import Warning:', message);
    warnings.push(message);
}

function getErrorSuggestion(error: string): string {
    if (error.includes('font')) {
        return 'The font is not available in Figma. Using Inter as fallback.';
    }
    if (error.includes('image')) {
        return 'Some images could not be loaded. They may be protected or unavailable.';
    }
    if (error.includes('SVG')) {
        return 'Some SVGs could not be parsed. They are shown as placeholders.';
    }
    if (error.includes('size') || error.includes('resize')) {
        return 'Some elements have invalid sizes and were skipped.';
    }
    return 'Try using the Chrome Extension for protected pages.';
}

// Connect renderer callbacks
setProgressCallback((stage, percent, detail) => {
    sendProgress(stage, percent, detail);
});

setWarningCallback((message) => {
    sendWarning(message);
});

// =====================
// Message Handler
// =====================

figma.ui.onmessage = async (msg) => {
    // Handle Image Response from UI
    if (msg.type === 'image-data') {
        resolveImage(msg.id, msg.data ? msg.data : null);
        return;
    }

    // Handle Website Build
    if (msg.type === 'build') {
        await handleBuild(msg.data);
    }

    // Handle Component-Docs Build
    if (msg.type === 'build-components') {
        await handleBuildComponents(msg.data);
    }
};

// =====================
// Build Orchestration
// =====================

/**
 * Higher-order function to orchestrate build operations with common error handling
 */
async function orchestrateBuild(
    buildLogic: () => Promise<void>,
    errorContext: string
): Promise<void> {
    if (isImporting) {
        sendError('Import in progress', 'Please wait for the current import to complete.');
        return;
    }

    isImporting = true;

    try {
        // Reset state
        warnings = [];
        resetProcessedNodes();
        clearImageCache();

        await buildLogic();

    } catch (error: unknown) {
        const err = error as Error;
        console.error(`${errorContext} error:`, err);
        if (err.stack) {
            console.error('Error stack:', err.stack);
        }
        sendError(
            `Failed to ${errorContext.toLowerCase()}`,
            err.message || String(err) || 'An unexpected error occurred during import.'
        );
    } finally {
        isImporting = false;
    }
}

// =====================
// Build Handlers
// =====================

async function handleBuild(rootData: VisualNode) {
    await orchestrateBuild(async () => {
        // Validate input data
        if (!rootData) {
            sendError('No data to import', 'The data object is empty or undefined.');
            return;
        }

        if (!rootData.type) {
            sendError('Invalid data format', 'Expected a visual tree with a "type" field. Make sure you\'re using the Chrome Extension output.');
            return;
        }

        // Count total nodes for progress tracking
        const totalNodes = countNodes(rootData);
        setTotalNodes(totalNodes);

        if (totalNodes === 0) {
            sendError('Empty page', 'The scraped page has no visible content. Try a different page.');
            return;
        }

        // Step 1: Load fonts
        sendProgress('Loading fonts', 10, '', 'Preparing fonts...');
        await loadFonts(rootData);
        sendProgress('Loading fonts', 25, '', 'Fonts ready');

        // Step 2: Preload all images in parallel
        const urls = new Set<string>();
        extractImageUrls(rootData, urls);
        if (urls.size > 0) {
            sendProgress('Loading images', 30, `0/${urls.size} images`, 'Downloading images in parallel...');
            await preloadImages(rootData);

            const loadedCount = getLoadedImageCount();
            if (loadedCount < urls.size) {
                sendWarning(`${urls.size - loadedCount} of ${urls.size} images could not be loaded`);
            }
            sendProgress('Loading images', 50, `${loadedCount}/${urls.size} loaded`, 'Images ready');
        }

        // Step 3: Build the node tree (images are now cached)
        sendProgress('Building layout', 55, `0/${totalNodes} nodes`, 'Creating Figma layers...');
        const rootNode = await buildNode(rootData, figma.currentPage, undefined);

        // Success! Select the imported content
        if (rootNode) {
            figma.currentPage.selection = [rootNode];
            figma.viewport.scrollAndZoomIntoView([rootNode]);
        }

        // Send completion with summary
        const summary: { type: string; stats: object; warnings?: string[] } = {
            type: 'done',
            stats: {
                totalNodes: processedNodes,
                imagesLoaded: getLoadedImageCount(),
                totalImages: getTotalImageCount(),
            },
        };

        if (warnings.length > 0) {
            summary.warnings = warnings;
        }

        figma.ui.postMessage(summary);
    }, 'build layout');
}

async function handleBuildComponents(data: { components: ComponentData[]; metadata: ComponentDocsMetadata }) {
    await orchestrateBuild(async () => {
        const { components, metadata } = data;

        if (!components || components.length === 0) {
            sendError('No components to import', 'No component data was provided.');
            return;
        }

        // Count total nodes across all components
        const totalNodes = components.reduce((sum, c) => sum + countNodes(c.tree), 0);
        setTotalNodes(totalNodes);

        // Step 1: Load fonts from all components
        sendProgress('Loading fonts', 10, '', 'Preparing fonts...');
        for (const component of components) {
            await loadFonts(component.tree);
        }
        sendProgress('Loading fonts', 20, '', 'Fonts ready');

        // Step 2: Preload all images from all components
        const allUrls = new Set<string>();
        for (const component of components) {
            extractImageUrls(component.tree, allUrls);
        }

        if (allUrls.size > 0) {
            sendProgress('Loading images', 25, `0/${allUrls.size} images`, 'Downloading images...');
            for (const component of components) {
                await preloadImages(component.tree);
            }
            const loadedCount = getLoadedImageCount();
            if (loadedCount < allUrls.size) {
                sendWarning(`${allUrls.size - loadedCount} of ${allUrls.size} images could not be loaded`);
            }
            sendProgress('Loading images', 40, `${loadedCount}/${allUrls.size} loaded`, 'Images ready');
        }

        // Step 3: Build each component in a grid layout
        sendProgress('Building components', 45, `0/${components.length}`, 'Creating Figma layers...');

        const builtNodes: SceneNode[] = [];
        const GRID_GAP = 40;
        const COMPONENTS_PER_ROW = 3;
        let currentX = 0;
        let currentY = 0;
        let maxHeightInRow = 0;

        for (let i = 0; i < components.length; i++) {
            const component = components[i];

            sendProgress(
                'Building components',
                45 + Math.round((i / components.length) * 50),
                `${i + 1}/${components.length}`,
                `Building ${component.name}`
            );

            try {
                const node = await buildNode(component.tree, figma.currentPage, undefined);

                if (node) {
                    // Generate frame name
                    const frameName = component.variant
                        ? `${component.name} / ${component.variant}`
                        : component.name;
                    node.name = frameName;

                    // Position in grid
                    node.x = currentX;
                    node.y = currentY;

                    // Track max height for row spacing
                    maxHeightInRow = Math.max(maxHeightInRow, node.height);

                    // Move to next grid position
                    const colIndex = (i + 1) % COMPONENTS_PER_ROW;
                    if (colIndex === 0) {
                        // New row
                        currentX = 0;
                        currentY += maxHeightInRow + GRID_GAP;
                        maxHeightInRow = 0;
                    } else {
                        currentX += node.width + GRID_GAP;
                    }

                    builtNodes.push(node);
                }
            } catch (err: unknown) {
                const error = err as Error;
                console.warn(`Failed to build component ${component.name}:`, error);
                sendWarning(`Failed to build component: ${component.name}`);
            }
        }

        // Select all imported components
        if (builtNodes.length > 0) {
            figma.currentPage.selection = builtNodes;
            figma.viewport.scrollAndZoomIntoView(builtNodes);
        }

        // Send completion
        const summary: ComponentDocsDoneSummary = {
            type: 'done',
            mode: 'component-docs',
            stats: {
                totalNodes: processedNodes,
                totalComponents: builtNodes.length,
                imagesLoaded: getLoadedImageCount(),
                totalImages: getTotalImageCount(),
            },
            metadata,
            ...(warnings.length > 0 && { warnings }),
        };

        figma.ui.postMessage(summary);
    }, 'build components');
}
