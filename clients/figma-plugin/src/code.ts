/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 300, height: 450 });

// Progress tracking
let totalNodes = 0;
let processedNodes = 0;
let warnings: string[] = [];
let errors: string[] = [];

// Import lock to prevent concurrent builds
let isImporting = false;

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

// Helper to strip alpha from color objects (Figma doesn't accept 'a' in color)
function toRGB(color: any): RGB | null {
    if (!color) return null;
    return { r: color.r, g: color.g, b: color.b };
}

function countNodes(data: any): number {
    if (!data) return 0;
    let count = 1;
    if (data.children) {
        for (const child of data.children) {
            count += countNodes(child);
        }
    }
    return count;
}

// Helper to request image from UI and wait for response
function downloadImage(url: string): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
        const id = Math.random().toString(36).substring(7);

        // Handler for the response
        const handler = (msg: any) => {
            if (msg.type === 'image-data' && msg.id === id) {
                delete (pendingImages as any)[id];
                if (msg.error) resolve(null);
                else resolve(msg.data);
            }
        };

        // Store resolver
        (pendingImages as any)[id] = resolve;

        figma.ui.postMessage({ type: 'fetch-image', url, id });

        // Timeout safety
        setTimeout(() => {
            if ((pendingImages as any)[id]) {
                delete (pendingImages as any)[id];
                resolve(null);
            }
        }, 5000); // 5s timeout
    });
}

const pendingImages: { [key: string]: (data: Uint8Array | null) => void } = {};
const imageCache: Map<string, Uint8Array | null> = new Map();

// Extract all image URLs from the visual tree
function extractImageUrls(node: any, urls: Set<string>): void {
    if (!node) return;

    // Direct image nodes
    if (node.type === 'IMAGE' && node.src) {
        urls.add(node.src);
    }

    // Background images (from styles or pseudo-elements)
    // Handle both nested styles (FRAME) and flattened styles (TEXT_NODE)
    const styles = node.styles || node;
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

// Download all images in parallel and cache them
async function preloadImages(rootData: any): Promise<void> {
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

// Update main listener to dispatch image responses
figma.ui.onmessage = async (msg) => {
    // Handle Image Response
    if (msg.type === 'image-data') {
        const resolver = pendingImages[msg.id];
        if (resolver) resolver(msg.data ? msg.data : null);
        return;
    }

    // Original Logic
    if (msg.type === 'build') {
        // Prevent concurrent imports
        if (isImporting) {
            sendError('Import in progress', 'Please wait for the current import to complete.');
            return;
        }

        isImporting = true;

        try {
            const rootData = msg.data;

            // Reset state
            warnings = [];
            errors = [];

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
            totalNodes = countNodes(rootData);
            processedNodes = 0;

            if (totalNodes === 0) {
                sendError('Empty page', 'The scraped page has no visible content. Try a different page.');
                return;
            }

            // Clear cache from previous imports
            imageCache.clear();

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

                // Check how many images loaded successfully
                const loadedCount = Array.from(imageCache.values()).filter(v => v !== null).length;
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
            const summary: any = {
                type: 'done',
                stats: {
                    totalNodes: processedNodes,
                    imagesLoaded: Array.from(imageCache.values()).filter(v => v !== null).length,
                    totalImages: imageCache.size,
                },
            };

            if (warnings.length > 0) {
                summary.warnings = warnings;
            }

            figma.ui.postMessage(summary);

        } catch (error: any) {
            console.error('Build error:', error);
            console.error('Error stack:', error.stack);
            sendError(
                'Failed to build layout',
                error.message || error.toString() || 'An unexpected error occurred during import.'
            );
        } finally {
            isImporting = false;
        }
    }
};

// Font loading with dynamic fallback
const loadedFonts = new Set<string>();
const FALLBACK_FONT = { family: "Inter", style: "Regular" };
const FALLBACK_FONT_BOLD = { family: "Inter", style: "Bold" };

// Font category fallbacks
const FALLBACK_SERIF = { family: "Georgia", style: "Regular" };
const FALLBACK_MONO = { family: "Roboto Mono", style: "Regular" };

/**
 * Font matching database - maps common web fonts to Figma-available alternatives
 * Keys are lowercase for case-insensitive matching
 */
const FONT_MAP: Record<string, string> = {
    // System fonts → Figma equivalents
    '-apple-system': 'SF Pro Text',
    'blinkmacsystemfont': 'SF Pro Text',
    'system-ui': 'Inter',
    'segoe ui': 'Inter',
    
    // Sans-serif mappings
    'arial': 'Inter',
    'helvetica': 'Helvetica Neue',
    'helvetica neue': 'Helvetica Neue',
    'verdana': 'Inter',
    'tahoma': 'Inter',
    'trebuchet ms': 'Inter',
    'gill sans': 'Inter',
    'avenir': 'Inter',
    'avenir next': 'Inter',
    'futura': 'Inter',
    'century gothic': 'Inter',
    'calibri': 'Inter',
    'candara': 'Inter',
    'optima': 'Inter',
    'lucida grande': 'Inter',
    'lucida sans': 'Inter',
    
    // Serif mappings
    'times': 'Times New Roman',
    'times new roman': 'Times New Roman',
    'georgia': 'Georgia',
    'palatino': 'Georgia',
    'palatino linotype': 'Georgia',
    'book antiqua': 'Georgia',
    'baskerville': 'Georgia',
    'garamond': 'Georgia',
    'cambria': 'Georgia',
    'didot': 'Georgia',
    'bodoni': 'Georgia',
    
    // Monospace mappings
    'courier': 'Courier New',
    'courier new': 'Courier New',
    'consolas': 'Roboto Mono',
    'monaco': 'Roboto Mono',
    'menlo': 'Roboto Mono',
    'lucida console': 'Roboto Mono',
    'source code pro': 'Roboto Mono',
    'fira code': 'Roboto Mono',
    'jetbrains mono': 'Roboto Mono',
    'sf mono': 'Roboto Mono',
    'andale mono': 'Roboto Mono',
    
    // Popular Google Fonts (often available in Figma)
    'roboto': 'Roboto',
    'open sans': 'Open Sans',
    'lato': 'Lato',
    'montserrat': 'Montserrat',
    'oswald': 'Oswald',
    'raleway': 'Raleway',
    'poppins': 'Poppins',
    'nunito': 'Nunito',
    'playfair display': 'Playfair Display',
    'merriweather': 'Merriweather',
    'source sans pro': 'Source Sans Pro',
    'pt sans': 'PT Sans',
    'ubuntu': 'Ubuntu',
    'noto sans': 'Noto Sans',
    'work sans': 'Work Sans',
    'rubik': 'Rubik',
    'quicksand': 'Quicksand',
    'karla': 'Karla',
    'manrope': 'Manrope',
    'dm sans': 'DM Sans',
    'ibm plex sans': 'IBM Plex Sans',
    'ibm plex mono': 'IBM Plex Mono',
    'space mono': 'Space Mono',
    'space grotesk': 'Space Grotesk',
    'plus jakarta sans': 'Plus Jakarta Sans',
};

/**
 * Detect font category from font name
 */
function detectFontCategory(fontName: string): 'sans-serif' | 'serif' | 'monospace' | 'unknown' {
    const lower = fontName.toLowerCase();
    
    // Monospace indicators
    if (lower.includes('mono') || lower.includes('code') || lower.includes('console') ||
        lower.includes('courier') || lower.includes('terminal')) {
        return 'monospace';
    }
    
    // Serif indicators
    if (lower.includes('serif') || lower.includes('times') || lower.includes('georgia') ||
        lower.includes('garamond') || lower.includes('baskerville') || lower.includes('bodoni') ||
        lower.includes('palatino') || lower.includes('cambria') || lower.includes('antiqua') ||
        lower.includes('merriweather') || lower.includes('playfair') || lower.includes('didot')) {
        return 'serif';
    }
    
    // Default to sans-serif for most modern fonts
    return 'sans-serif';
}

/**
 * Parse CSS font-family string and return the best matching font name
 * Uses intelligent font mapping for common web fonts
 */
function parseFontFamily(fontFamily: string): string {
    if (!fontFamily) return FALLBACK_FONT.family;
    
    // Split by comma and process each font in order
    const fonts = fontFamily.split(',').map(f => f.trim().replace(/^["']|["']$/g, ''));
    
    for (const font of fonts) {
        const lowerFont = font.toLowerCase();
        
        // Skip generic font families
        const generics = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];
        if (generics.includes(lowerFont)) continue;
        
        // Check if we have a direct mapping
        if (FONT_MAP[lowerFont]) {
            return FONT_MAP[lowerFont];
        }
        
        // Return the original font name (will be tried as-is)
        return font;
    }
    
    return FALLBACK_FONT.family;
}

/**
 * Get the appropriate category fallback font
 */
function getCategoryFallback(originalFont: string, weight: string | number): FontName {
    const category = detectFontCategory(originalFont);
    const isBold = parseInt(String(weight)) >= 600;
    
    switch (category) {
        case 'serif':
            return { family: FALLBACK_SERIF.family, style: isBold ? 'Bold' : 'Regular' };
        case 'monospace':
            return { family: FALLBACK_MONO.family, style: isBold ? 'Bold' : 'Regular' };
        default:
            return isBold ? FALLBACK_FONT_BOLD : FALLBACK_FONT;
    }
}

/**
 * Map CSS font-weight to Figma style name
 */
function getFontStyle(weight: string | number, isItalic: boolean = false): string {
    const w = typeof weight === 'string' ? parseInt(weight) || 400 : weight;

    let style: string;
    if (w <= 100) style = 'Thin';
    else if (w <= 200) style = 'ExtraLight';
    else if (w <= 300) style = 'Light';
    else if (w <= 400) style = 'Regular';
    else if (w <= 500) style = 'Medium';
    else if (w <= 600) style = 'SemiBold';
    else if (w <= 700) style = 'Bold';
    else if (w <= 800) style = 'ExtraBold';
    else style = 'Black';

    // Append Italic if needed (common Figma font naming convention)
    if (isItalic) {
        // Common patterns: "Italic", "Regular Italic", "Bold Italic"
        return style === 'Regular' ? 'Italic' : `${style} Italic`;
    }
    return style;
}

/**
 * Try to load a font with intelligent fallback
 * 1. Try the exact font/style
 * 2. Try style variations of the same font
 * 3. Try mapped alternative (from FONT_MAP)
 * 4. Fall back to category-appropriate font (serif/sans-serif/mono)
 */
async function tryLoadFont(family: string, weight: string | number, originalFamily?: string, isItalic: boolean = false): Promise<FontName> {
    const style = getFontStyle(weight, isItalic);
    const fontKey = `${family}:${style}`;

    // Already loaded this exact font
    if (loadedFonts.has(fontKey)) {
        return { family, style };
    }

    // Try loading the requested font
    try {
        await figma.loadFontAsync({ family, style });
        loadedFonts.add(fontKey);
        return { family, style };
    } catch {
        // Try common style variations
        let styleVariations: string[];
        if (isItalic) {
            // Italic variations
            styleVariations = ['Italic', 'Regular Italic', 'Medium Italic', 'Oblique'];
            if (parseInt(String(weight)) >= 600) {
                styleVariations.unshift('Bold Italic', 'SemiBold Italic');
            }
        } else {
            styleVariations = ['Regular', 'Medium', 'Normal', 'Book'];
            if (parseInt(String(weight)) >= 600) {
                styleVariations.unshift('Bold', 'SemiBold', 'DemiBold');
            }
        }

        for (const altStyle of styleVariations) {
            const altKey = `${family}:${altStyle}`;
            if (loadedFonts.has(altKey)) {
                return { family, style: altStyle };
            }
            try {
                await figma.loadFontAsync({ family, style: altStyle });
                loadedFonts.add(altKey);
                return { family, style: altStyle };
            } catch {
                // Continue to next variation
            }
        }

        // If italic not found, fall back to non-italic version
        if (isItalic) {
            try {
                return await tryLoadFont(family, weight, originalFamily, false);
            } catch {
                // Continue to mapped alternative
            }
        }
    }

    // Try mapped alternative if we haven't already
    const lowerFamily = family.toLowerCase();
    const mappedFont = FONT_MAP[lowerFamily];
    if (mappedFont && mappedFont !== family) {
        try {
            return await tryLoadFont(mappedFont, weight, originalFamily || family, isItalic);
        } catch {
            // Continue to category fallback
        }
    }

    // Fall back to category-appropriate font
    const fallback = getCategoryFallback(originalFamily || family, weight);
    const fallbackKey = `${fallback.family}:${fallback.style}`;
    if (!loadedFonts.has(fallbackKey)) {
        try {
            await figma.loadFontAsync(fallback);
            loadedFonts.add(fallbackKey);
        } catch {
            // Ultimate fallback to Inter if category fallback fails
            const ultimateFallback = parseInt(String(weight)) >= 600 ? FALLBACK_FONT_BOLD : FALLBACK_FONT;
            const ultimateKey = `${ultimateFallback.family}:${ultimateFallback.style}`;
            if (!loadedFonts.has(ultimateKey)) {
                await figma.loadFontAsync(ultimateFallback);
                loadedFonts.add(ultimateKey);
            }
            return ultimateFallback;
        }
    }
    return fallback;
}

/**
 * Extract all unique fonts from the visual tree for pre-loading
 */
function extractFonts(node: any, fonts: Set<string>): void {
    if (!node) return;
    
    const styles = node.styles || node;
    if (styles.fontFamily) {
        const family = parseFontFamily(styles.fontFamily);
        const weight = styles.fontWeight || '400';
        fonts.add(`${family}:${weight}`);
    }
    
    // Handle pseudo-elements with text content
    if (node.type === 'PSEUDO_ELEMENT' && node.contentType === 'TEXT' && styles.fontFamily) {
        const family = parseFontFamily(styles.fontFamily);
        const weight = styles.fontWeight || '400';
        fonts.add(`${family}:${weight}`);
    }
    
    if (node.children) {
        for (const child of node.children) {
            extractFonts(child, fonts);
        }
    }
}

async function loadFonts(rootData?: any) {
    // Always load fallback fonts for each category
    const fallbackFonts = [
        FALLBACK_FONT,
        FALLBACK_FONT_BOLD,
        FALLBACK_SERIF,
        { family: FALLBACK_SERIF.family, style: 'Bold' },
        FALLBACK_MONO,
        { family: FALLBACK_MONO.family, style: 'Bold' },
    ];
    
    for (const font of fallbackFonts) {
        try {
            await figma.loadFontAsync(font);
            loadedFonts.add(`${font.family}:${font.style}`);
        } catch {
            // Font not available, skip
        }
    }
    
    // Pre-load fonts from the data if available
    if (rootData) {
        const fonts = new Set<string>();
        extractFonts(rootData, fonts);
        
        // Attempt to load each unique font
        for (const fontKey of fonts) {
            const [family, weight] = fontKey.split(':');
            await tryLoadFont(family, weight).catch(() => {});
        }
    }
}

// --- HELPER: Parse Box Shadow ---
function parseBoxShadow(shadowStr: string): Effect[] {
    if (!shadowStr || shadowStr === 'none') return [];

    const effects: Effect[] = [];
    // Split by comma, ignoring commas inside parentheses (rgb/a)
    const shadows = shadowStr.split(/,(?![^()]*\))/);

    for (const shadow of shadows) {
        let s = shadow.trim();

        // Check for inset keyword (can appear at start or end)
        const isInset = /\binset\b/i.test(s);
        if (isInset) {
            s = s.replace(/\binset\b/gi, '').trim();
        }

        // Regex to extract color and lengths:
        // matches: rgba?(...) | #...  AND  ...px ...px ...px ...px
        // Simplified approach: Extract color, then remove it, then parse numbers.

        let color = { r: 0, g: 0, b: 0, a: 0.2 }; // default
        let remaining = s;

        // Try RGBA/RGB
        const colorMatch = s.match(/rgba?\(.*?\)/) || s.match(/#[a-fA-F0-9]{3,6}/);
        if (colorMatch) {
            // We need a helper to parse RGB string to objects, but for now let's assume standard format
            // Just clearing it from string to parse dimensions
            remaining = s.replace(colorMatch[0], '').trim();
            // TODO: Proper color parsing if strict fidelity needed.
            // For now, default black shadow is better than nothing, or try to enable basic parsing?
            // Let's rely on a basic extraction if possible.
            if (colorMatch[0].startsWith('rgba')) {
                const numbers = colorMatch[0].match(/[\d.]+/g)?.map(Number);
                if (numbers && numbers.length >= 3) {
                    color = { r: numbers[0] / 255, g: numbers[1] / 255, b: numbers[2] / 255, a: numbers[3] ?? 1 };
                }
            } else if (colorMatch[0].startsWith('rgb')) {
                const numbers = colorMatch[0].match(/[\d.]+/g)?.map(Number);
                if (numbers && numbers.length >= 3) {
                    color = { r: numbers[0] / 255, g: numbers[1] / 255, b: numbers[2] / 255, a: 1 };
                }
            }
        }

        const parts = remaining.split(/\s+/).map(p => parseFloat(p));
        // CSS: offset-x | offset-y | blur-radius | spread-radius
        // Figma: DropShadowEffect or InnerShadowEffect for inset
        if (parts.length >= 2) {
            effects.push({
                type: isInset ? 'INNER_SHADOW' : 'DROP_SHADOW',
                color: color,
                offset: { x: parts[0] || 0, y: parts[1] || 0 },
                radius: parts[2] || 0,
                spread: parts[3] || 0,
                visible: true,
                blendMode: 'NORMAL'
            });
        }
    }
    return effects;
}

// --- HELPER: Parse Text Shadow (similar to box-shadow but no spread or inset) ---
function parseTextShadow(shadowStr: string): Effect[] {
    if (!shadowStr || shadowStr === 'none') return [];

    const effects: Effect[] = [];
    // Split by comma, ignoring commas inside parentheses (rgb/a)
    const shadows = shadowStr.split(/,(?![^()]*\))/);

    for (const shadow of shadows) {
        const s = shadow.trim();

        let color = { r: 0, g: 0, b: 0, a: 0.5 }; // default
        let remaining = s;

        // Try RGBA/RGB
        const colorMatch = s.match(/rgba?\(.*?\)/) || s.match(/#[a-fA-F0-9]{3,6}/);
        if (colorMatch) {
            remaining = s.replace(colorMatch[0], '').trim();
            if (colorMatch[0].startsWith('rgba')) {
                const numbers = colorMatch[0].match(/[\d.]+/g)?.map(Number);
                if (numbers && numbers.length >= 3) {
                    color = { r: numbers[0] / 255, g: numbers[1] / 255, b: numbers[2] / 255, a: numbers[3] ?? 1 };
                }
            } else if (colorMatch[0].startsWith('rgb')) {
                const numbers = colorMatch[0].match(/[\d.]+/g)?.map(Number);
                if (numbers && numbers.length >= 3) {
                    color = { r: numbers[0] / 255, g: numbers[1] / 255, b: numbers[2] / 255, a: 1 };
                }
            }
        }

        const parts = remaining.split(/\s+/).map(p => parseFloat(p));
        // CSS text-shadow: offset-x | offset-y | blur-radius (no spread)
        if (parts.length >= 2) {
            effects.push({
                type: 'DROP_SHADOW',
                color: color,
                offset: { x: parts[0] || 0, y: parts[1] || 0 },
                radius: parts[2] || 0,
                spread: 0, // text-shadow doesn't have spread
                visible: true,
                blendMode: 'NORMAL'
            });
        }
    }
    return effects;
}

// --- HELPER: Text Case & Decoration ---
function getTextCase(transform: string): TextCase {
    if (transform === 'uppercase') return 'UPPER';
    if (transform === 'lowercase') return 'LOWER';
    if (transform === 'capitalize') return 'TITLE';
    return 'ORIGINAL';
}

function getTextDecoration(decoration: string): TextDecoration {
    if (decoration && decoration.includes('underline')) return 'UNDERLINE';
    if (decoration && decoration.includes('line-through')) return 'STRIKETHROUGH';
    return 'NONE';
}

// --- HELPER: Text Alignment ---
function getTextAlignHorizontal(align: string): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' {
    if (align === 'center') return 'CENTER';
    if (align === 'right' || align === 'end') return 'RIGHT';
    if (align === 'justify') return 'JUSTIFIED';
    return 'LEFT'; // default, includes 'left' and 'start'
}

// --- HELPER: Parse Line Height ---
function parseLineHeight(value: string | undefined, fontSize: number): number | null {
    if (!value || value === 'normal') return null; // Let Figma use default
    // Check for unitless multiplier (e.g., "1.5")
    const unitless = parseFloat(value);
    if (!isNaN(unitless) && !value.includes('px') && !value.includes('em') && !value.includes('%')) {
        return unitless * fontSize;
    }
    // Check for px value
    if (value.includes('px')) {
        return parseFloat(value) || null;
    }
    // Check for em value
    if (value.includes('em')) {
        return (parseFloat(value) || 1) * fontSize;
    }
    // Check for percentage
    if (value.includes('%')) {
        return (parseFloat(value) / 100) * fontSize;
    }
    return null;
}

// --- HELPER: Apply CSS Transform ---
function applyTransform(node: SceneNode, transform: string | null | undefined): void {
    if (!transform || transform === 'none') return;

    // Check if node supports rotation (most layout nodes do)
    const supportsRotation = 'rotation' in node;

    // Parse matrix(a, b, c, d, tx, ty) - the computed form of most transforms
    const matrixMatch = transform.match(/matrix\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (matrixMatch) {
        const [, a, b, c, d, tx, ty] = matrixMatch.map((v, i) => i === 0 ? v : parseFloat(v));
        const aNum = a as number, bNum = b as number;

        // Calculate rotation from matrix: atan2(b, a) gives angle in radians
        const rotationRad = Math.atan2(bNum, aNum);
        const rotationDeg = rotationRad * (180 / Math.PI);

        // Apply rotation (Figma uses counterclockwise positive)
        if (supportsRotation && Math.abs(rotationDeg) > 0.1) {
            (node as FrameNode).rotation = -rotationDeg;
        }

        // Apply translation
        const txNum = tx as number, tyNum = ty as number;
        if (Math.abs(txNum) > 0.1 || Math.abs(tyNum) > 0.1) {
            node.x += txNum;
            node.y += tyNum;
        }

        // Note: scale is embedded in the matrix but Figma doesn't support non-uniform scale
        // Skew is also not directly supported in Figma
        return;
    }

    // Handle individual transform functions as fallback
    // rotate(Xdeg) or rotate(Xrad)
    const rotateMatch = transform.match(/rotate\(\s*(-?[\d.]+)(deg|rad|turn)?\s*\)/);
    if (rotateMatch && supportsRotation) {
        let degrees = parseFloat(rotateMatch[1]);
        const unit = rotateMatch[2] || 'deg';
        if (unit === 'rad') degrees = degrees * (180 / Math.PI);
        else if (unit === 'turn') degrees = degrees * 360;
        (node as FrameNode).rotation = -degrees; // Figma uses counterclockwise
    }

    // translate(X, Y) or translateX/Y
    const translateMatch = transform.match(/translate\(\s*(-?[\d.]+)(?:px)?\s*(?:,\s*(-?[\d.]+)(?:px)?)?\s*\)/);
    if (translateMatch) {
        const tx = parseFloat(translateMatch[1]) || 0;
        const ty = parseFloat(translateMatch[2]) || 0;
        node.x += tx;
        node.y += ty;
    }

    const translateXMatch = transform.match(/translateX\(\s*(-?[\d.]+)(?:px)?\s*\)/);
    if (translateXMatch) {
        node.x += parseFloat(translateXMatch[1]) || 0;
    }

    const translateYMatch = transform.match(/translateY\(\s*(-?[\d.]+)(?:px)?\s*\)/);
    if (translateYMatch) {
        node.y += parseFloat(translateYMatch[1]) || 0;
    }
}

// --- HELPER: Parse Gradient Angle ---
function parseGradientAngle(gradientStr: string): number {
    // Default: 180deg (top to bottom) - CSS default for linear-gradient
    let angle = 180;
    
    // Match explicit angle: "linear-gradient(45deg, ..."
    const degMatch = gradientStr.match(/linear-gradient\(\s*(-?\d+(?:\.\d+)?)\s*deg/i);
    if (degMatch) {
        angle = parseFloat(degMatch[1]);
        return angle;
    }
    
    // Match direction keywords: "linear-gradient(to right, ..."
    const dirMatch = gradientStr.match(/linear-gradient\(\s*to\s+([^,]+)/i);
    if (dirMatch) {
        const direction = dirMatch[1].trim().toLowerCase();
        
        // Single directions
        if (direction === 'top') return 0;
        if (direction === 'right') return 90;
        if (direction === 'bottom') return 180;
        if (direction === 'left') return 270;
        
        // Corner directions
        if (direction === 'top right' || direction === 'right top') return 45;
        if (direction === 'bottom right' || direction === 'right bottom') return 135;
        if (direction === 'bottom left' || direction === 'left bottom') return 225;
        if (direction === 'top left' || direction === 'left top') return 315;
    }
    
    return angle;
}

// --- HELPER: Convert CSS angle to Figma gradient transform ---
function angleToGradientTransform(angleDeg: number): Transform {
    // CSS angles: 0deg = to top, 90deg = to right, 180deg = to bottom
    // Convert to radians and adjust for Figma's coordinate system
    const angleRad = (angleDeg - 90) * (Math.PI / 180);
    
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    
    // Figma gradient transform is a 2x3 matrix that defines the gradient line
    // The gradient goes from (0,0) to (1,0) in transformed space
    // We need to map this to the actual angle in the node's space
    return [
        [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
        [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]
    ];
}

// --- HELPER: Parse Color String to RGBA ---
function parseColorString(colorStr: string): RGBA | null {
    let r = 0, g = 0, b = 0, a = 1;
    if (colorStr.startsWith('rgba')) {
        const nums = colorStr.match(/[\d.]+/g)?.map(Number);
        if (nums && nums.length >= 3) { r = nums[0]/255; g = nums[1]/255; b = nums[2]/255; a = nums[3] ?? 1; }
    } else if (colorStr.startsWith('rgb')) {
        const nums = colorStr.match(/[\d.]+/g)?.map(Number);
        if (nums && nums.length >= 3) { r = nums[0]/255; g = nums[1]/255; b = nums[2]/255; }
    } else if (colorStr.startsWith('#')) {
        const hex = colorStr.slice(1);
        if (hex.length === 3) { r = parseInt(hex[0]+hex[0],16)/255; g = parseInt(hex[1]+hex[1],16)/255; b = parseInt(hex[2]+hex[2],16)/255; }
        else if (hex.length >= 6) { r = parseInt(hex.slice(0,2),16)/255; g = parseInt(hex.slice(2,4),16)/255; b = parseInt(hex.slice(4,6),16)/255; if(hex.length===8) a = parseInt(hex.slice(6,8),16)/255; }
    } else { return null; }
    return { r, g, b, a };
}

// --- HELPER: Extract gradient color stops ---
// Returns stops and average opacity (Figma doesn't support per-stop opacity)
function extractGradientStops(gradientStr: string): { stops: ColorStop[]; opacity: number } {
    const colorStopRegex = /(rgba?\([^)]+\)|#[a-fA-F0-9]{3,8})(?:\s+(\d+(?:\.\d+)?%?))?/g;
    let match;
    const rawStops: { color: RGBA; position?: number }[] = [];
    while ((match = colorStopRegex.exec(gradientStr)) !== null) {
        const color = parseColorString(match[1]);
        if (!color) continue;
        rawStops.push({ color, position: match[2] ? parseFloat(match[2])/100 : undefined });
    }
    if (rawStops.length < 2) return { stops: [], opacity: 1 };
    for (let i = 0; i < rawStops.length; i++) {
        if (rawStops[i].position === undefined) {
            if (i === 0) rawStops[i].position = 0;
            else if (i === rawStops.length - 1) rawStops[i].position = 1;
            else {
                const prevIdx = i - 1;
                let nextIdx = i + 1;
                while (nextIdx < rawStops.length && rawStops[nextIdx].position === undefined) nextIdx++;
                const prevPos = rawStops[prevIdx].position || 0;
                const nextPos = rawStops[nextIdx].position || 1;
                rawStops[i].position = prevPos + (nextPos - prevPos) * ((i - prevIdx) / (nextIdx - prevIdx));
            }
        }
    }

    // Calculate average opacity from all stops (Figma doesn't support per-stop alpha)
    const avgOpacity = rawStops.reduce((sum, s) => sum + (s.color.a ?? 1), 0) / rawStops.length;

    // Figma ColorStop expects color as {r,g,b,a}
    const stops: ColorStop[] = rawStops.map(s => ({
        position: s.position || 0,
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a ?? 1 }
    }));

    return { stops, opacity: avgOpacity };
}

// --- HELPER: Parse Radial Gradient Position ---
function parseRadialGradientPosition(gradientStr: string): { x: number; y: number } {
    let x = 0.5, y = 0.5;
    const atMatch = gradientStr.match(/at\s+([^,)]+)/i);
    if (atMatch) {
        const parts = atMatch[1].trim().split(/\s+/);
        const parsePos = (val: string): number => {
            if (val === 'center') return 0.5;
            if (val === 'left' || val === 'top') return 0;
            if (val === 'right' || val === 'bottom') return 1;
            if (val.endsWith('%')) return parseFloat(val) / 100;
            return 0.5;
        };
        if (parts.length >= 2) { x = parsePos(parts[0]); y = parsePos(parts[1]); }
        else if (parts.length === 1) {
            const val = parts[0];
            if (val === 'left') { x = 0; } else if (val === 'right') { x = 1; }
            else if (val === 'top') { y = 0; } else if (val === 'bottom') { y = 1; }
            else { x = parsePos(val); }
        }
    }
    return { x, y };
}

// --- HELPER: Parse Radial Gradient Shape and Size ---
interface RadialGradientShape {
    isCircle: boolean;
    scaleX: number;
    scaleY: number;
}

function parseRadialGradientShape(gradientStr: string): RadialGradientShape {
    // Default: ellipse with farthest-corner sizing
    let isCircle = false;
    let scaleX = 1;
    let scaleY = 1;
    
    // Extract the part before "at" or first color
    const shapeMatch = gradientStr.match(/radial-gradient\(\s*([^,]*?)(?:\s+at\s+|,)/i);
    const shapePart = shapeMatch ? shapeMatch[1].trim().toLowerCase() : '';
    
    // Check for explicit shape
    if (shapePart.includes('circle')) {
        isCircle = true;
    }
    
    // Check for size keywords
    if (shapePart.includes('closest-side')) {
        scaleX = 0.5;
        scaleY = isCircle ? 0.5 : 0.5;
    } else if (shapePart.includes('closest-corner')) {
        // Closest corner is approximately 0.7 (sqrt(2)/2) of the element
        scaleX = 0.707;
        scaleY = isCircle ? 0.707 : 0.707;
    } else if (shapePart.includes('farthest-side')) {
        scaleX = 1;
        scaleY = 1;
    } else if (shapePart.includes('farthest-corner')) {
        // Farthest corner extends beyond the element (default for ellipse)
        scaleX = 1.414; // sqrt(2) to reach corners
        scaleY = isCircle ? 1.414 : 1.414;
    }
    
    // Check for explicit size (e.g., "50px 100px" or "50px")
    const sizeMatch = shapePart.match(/(\d+(?:\.\d+)?)(px|%)\s*(\d+(?:\.\d+)?)?(px|%)?/);
    if (sizeMatch) {
        // Explicit sizes - normalize to roughly 0-1 scale (assuming 100px = 0.5 scale)
        const size1 = parseFloat(sizeMatch[1]);
        const unit1 = sizeMatch[2];
        const size2 = sizeMatch[3] ? parseFloat(sizeMatch[3]) : size1;
        
        if (unit1 === '%') {
            scaleX = size1 / 100;
            scaleY = size2 / 100;
        } else {
            // px values - approximate scaling (100px ≈ 0.5 in normalized space)
            scaleX = size1 / 200;
            scaleY = size2 / 200;
        }
        
        if (!sizeMatch[3]) {
            // Single value means circle
            isCircle = true;
            scaleY = scaleX;
        }
    }
    
    return { isCircle, scaleX, scaleY };
}

// --- HELPER: Parse Radial Gradient ---
function parseRadialGradient(gradientStr: string): GradientPaint | null {
    if (!gradientStr?.includes('radial-gradient')) return null;
    
    const { x, y } = parseRadialGradientPosition(gradientStr);
    const { scaleX, scaleY } = parseRadialGradientShape(gradientStr);
    
    // Figma radial gradient transform: maps unit circle to desired ellipse
    // Center at (x, y), scale by (scaleX, scaleY)
    const transform: Transform = [
        [scaleX, 0, x - scaleX / 2],
        [0, scaleY, y - scaleY / 2]
    ];
    
    const { stops, opacity } = extractGradientStops(gradientStr);
    if (stops.length < 2) return null;

    return { type: 'GRADIENT_RADIAL', gradientStops: stops, gradientTransform: transform, opacity };
}

// --- HELPER: Parse Linear Gradient ---
function parseLinearGradient(gradientStr: string): GradientPaint | null {
    if (!gradientStr?.includes('linear-gradient')) return null;
    const angle = parseGradientAngle(gradientStr);
    const transform = angleToGradientTransform(angle);
    const { stops, opacity } = extractGradientStops(gradientStr);
    if (stops.length < 2) return null;
    return { type: 'GRADIENT_LINEAR', gradientStops: stops, gradientTransform: transform, opacity };
}

// --- HELPER: Parse Any Gradient ---
function parseGradient(gradientStr: string): GradientPaint | null {
    if (!gradientStr) return null;
    if (gradientStr.includes('radial-gradient')) return parseRadialGradient(gradientStr);
    if (gradientStr.includes('linear-gradient')) return parseLinearGradient(gradientStr);
    return null;
}

// --- HELPERS: CSS Grid Parsing ---
interface GridTrackInfo {
    count: number;
    tracks: { value: number; unit: 'px' | 'fr' | 'auto' | 'minmax' }[];
    hasAutoFit: boolean;
    hasAutoFill: boolean;
}

/**
 * Parse CSS grid-template-columns/rows value into structured data
 * Handles: repeat(n, value), fr units, px, auto, minmax()
 */
function parseGridTemplate(template: string | undefined, containerSize: number = 0): GridTrackInfo {
    const result: GridTrackInfo = {
        count: 0,
        tracks: [],
        hasAutoFit: false,
        hasAutoFill: false,
    };
    
    if (!template || template === 'none') {
        return result;
    }
    
    // Handle repeat() function
    const repeatMatch = template.match(/repeat\(\s*(auto-fill|auto-fit|\d+)\s*,\s*(.+?)\s*\)/i);
    if (repeatMatch) {
        const repeatCount = repeatMatch[1];
        const repeatValue = repeatMatch[2].trim();
        
        if (repeatCount === 'auto-fit') {
            result.hasAutoFit = true;
            // For auto-fit, estimate columns based on minmax if available
            const minmaxMatch = repeatValue.match(/minmax\(\s*(\d+)(?:px)?\s*,/);
            if (minmaxMatch && containerSize > 0) {
                const minWidth = parseInt(minmaxMatch[1]);
                result.count = Math.max(1, Math.floor(containerSize / minWidth));
            } else {
                result.count = 3; // Default fallback
            }
        } else if (repeatCount === 'auto-fill') {
            result.hasAutoFill = true;
            const minmaxMatch = repeatValue.match(/minmax\(\s*(\d+)(?:px)?\s*,/);
            if (minmaxMatch && containerSize > 0) {
                const minWidth = parseInt(minmaxMatch[1]);
                result.count = Math.max(1, Math.floor(containerSize / minWidth));
            } else {
                result.count = 3; // Default fallback
            }
        } else {
            result.count = parseInt(repeatCount) || 1;
        }
        
        // Parse the repeated value
        const trackInfo = parseTrackValue(repeatValue);
        for (let i = 0; i < result.count; i++) {
            result.tracks.push(trackInfo);
        }
        
        return result;
    }
    
    // Handle space-separated values (e.g., "100px 1fr 200px")
    // Need to handle minmax() which contains spaces
    const tracks = splitGridTracks(template);
    
    for (const track of tracks) {
        const trackInfo = parseTrackValue(track);
        result.tracks.push(trackInfo);
    }
    
    result.count = result.tracks.length;
    return result;
}

/**
 * Split grid template into individual tracks, respecting parentheses
 */
function splitGridTracks(template: string): string[] {
    const tracks: string[] = [];
    let current = '';
    let parenDepth = 0;
    
    for (const char of template) {
        if (char === '(') {
            parenDepth++;
            current += char;
        } else if (char === ')') {
            parenDepth--;
            current += char;
        } else if (char === ' ' && parenDepth === 0) {
            if (current.trim()) {
                tracks.push(current.trim());
            }
            current = '';
        } else {
            current += char;
        }
    }
    
    if (current.trim()) {
        tracks.push(current.trim());
    }
    
    return tracks;
}

/**
 * Parse a single track value (e.g., "1fr", "100px", "auto", "minmax(100px, 1fr)")
 */
function parseTrackValue(value: string): { value: number; unit: 'px' | 'fr' | 'auto' | 'minmax' } {
    const trimmed = value.trim();
    
    if (trimmed === 'auto') {
        return { value: 0, unit: 'auto' };
    }
    
    if (trimmed.startsWith('minmax')) {
        // For minmax, use the min value as a hint
        const match = trimmed.match(/minmax\(\s*(\d+)(?:px)?\s*,/);
        if (match) {
            return { value: parseInt(match[1]), unit: 'minmax' };
        }
        return { value: 0, unit: 'minmax' };
    }
    
    if (trimmed.endsWith('fr')) {
        return { value: parseFloat(trimmed) || 1, unit: 'fr' };
    }
    
    if (trimmed.endsWith('px')) {
        return { value: parseFloat(trimmed) || 0, unit: 'px' };
    }
    
    if (trimmed.endsWith('%')) {
        // Convert percentage to approximate pixels (assuming container context)
        return { value: parseFloat(trimmed) || 0, unit: 'px' };
    }
    
    // Try parsing as number (default to px)
    const num = parseFloat(trimmed);
    if (!isNaN(num)) {
        return { value: num, unit: 'px' };
    }
    
    return { value: 0, unit: 'auto' };
}

/**
 * Parse grid-column or grid-row value to extract span information
 * Examples: "1", "span 2", "1 / 3", "1 / span 2"
 */
function parseGridSpan(value: string | undefined): { start: number; span: number } {
    if (!value || value === 'auto') {
        return { start: 0, span: 1 };
    }
    
    // Handle "span N" format
    const spanMatch = value.match(/span\s+(\d+)/);
    if (spanMatch) {
        return { start: 0, span: parseInt(spanMatch[1]) || 1 };
    }
    
    // Handle "start / end" format
    const slashMatch = value.match(/(\d+)\s*\/\s*(\d+)/);
    if (slashMatch) {
        const start = parseInt(slashMatch[1]) || 1;
        const end = parseInt(slashMatch[2]) || start + 1;
        return { start: start, span: end - start };
    }
    
    // Handle "start / span N" format
    const startSpanMatch = value.match(/(\d+)\s*\/\s*span\s+(\d+)/);
    if (startSpanMatch) {
        return { start: parseInt(startSpanMatch[1]) || 1, span: parseInt(startSpanMatch[2]) || 1 };
    }
    
    // Single number
    const num = parseInt(value);
    if (!isNaN(num)) {
        return { start: num, span: 1 };
    }
    
    return { start: 0, span: 1 };
}


// Main Build Function
async function buildNode(data: any, parent: SceneNode | PageNode, parentData?: any) {
    if (!data) return;

    // Update progress
    processedNodes++;
    if (processedNodes % 10 === 0 || processedNodes === totalNodes) {
        const percent = 30 + Math.round((processedNodes / totalNodes) * 65);
        sendProgress('Building layout', percent, `${processedNodes}/${totalNodes} nodes`);
    }

    let node!: SceneNode; // Definite assignment assertion - all non-returning branches assign node
    // Handle both nested styles (FRAME) and flattened styles (TEXT_NODE from serializer)
    const s = data.styles || data;

    // --- 1. CREATE NODE BASED ON TYPE ---
    if (data.type === 'VECTOR') {
        // SVG element - create editable vector from SVG string
        let svgParsed = false;
        
        try {
            // Clean up SVG string for better Figma compatibility
            let cleanedSvg = data.svgString;
            
            // Remove problematic attributes that Figma doesn't handle well
            cleanedSvg = cleanedSvg.replace(/\s*xmlns:xlink="[^"]*"/g, '');
            cleanedSvg = cleanedSvg.replace(/\s*class="[^"]*"/g, '');
            cleanedSvg = cleanedSvg.replace(/\s*data-[a-z-]+="[^"]*"/g, '');
            
            // Ensure there's an xmlns attribute for SVG namespace
            if (!cleanedSvg.includes('xmlns="')) {
                cleanedSvg = cleanedSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
            }
            
            // Remove inline styles that might cause issues (Figma handles style differently)
            // But keep stroke and fill attributes
            cleanedSvg = cleanedSvg.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
            
            // Try to create the vector node
            const svgNode = figma.createNodeFromSvg(cleanedSvg);
            svgNode.name = 'SVG';
            node = svgNode;
            svgParsed = true;

            // Apply size from styles if available
            if (s.width && s.height && s.width > 0 && s.height > 0) {
                // Maintain aspect ratio if viewBox is defined
                if (data.viewBox) {
                    const viewBoxParts = data.viewBox.split(/\s+/).map(Number);
                    if (viewBoxParts.length === 4) {
                        const vbWidth = viewBoxParts[2];
                        const vbHeight = viewBoxParts[3];
                        const aspectRatio = vbWidth / vbHeight;
                        
                        // Use the smaller dimension to fit within bounds
                        const targetWidth = s.width;
                        const targetHeight = s.height;
                        
                        if (targetWidth / targetHeight > aspectRatio) {
                            // Height-constrained
                            svgNode.resize(targetHeight * aspectRatio, targetHeight);
                        } else {
                            // Width-constrained
                            svgNode.resize(targetWidth, targetWidth / aspectRatio);
                        }
                    } else {
                        svgNode.resize(s.width, s.height);
                    }
                } else {
                    svgNode.resize(s.width, s.height);
                }
            }

            // Apply shadows if present
            if (s.boxShadow) {
                svgNode.effects = parseBoxShadow(s.boxShadow);
            }
            
            // Apply fill color override if specified and SVG is a simple icon
            if (data.svgFill && svgNode.children && svgNode.children.length <= 5) {
                // Only apply to simple SVGs to avoid messing up complex illustrations
                try {
                    const fillRgb = toRGB(data.svgFill);
                    if (fillRgb) {
                        for (const child of svgNode.findAll()) {
                            if ('fills' in child && (child as GeometryMixin).fills) {
                                const fills = (child as GeometryMixin).fills as readonly Paint[];
                                if (fills.length > 0 && fills[0].type === 'SOLID') {
                                    (child as GeometryMixin).fills = [{
                                        type: 'SOLID',
                                        color: fillRgb,
                                        opacity: data.svgFill.a ?? 1
                                    }];
                                }
                            }
                        }
                    }
                } catch {
                    // Ignore fill application errors
                }
            }
        } catch (e) {
            // SVG parsing failed
            svgParsed = false;
        }
        
        if (!svgParsed) {
            // Fallback: If SVG parsing fails, try simplified cleanup
            try {
                // Extract just path data and try again
                const pathMatch = data.svgString.match(/<path[^>]*d="([^"]+)"[^>]*>/);
                if (pathMatch) {
                    const simpleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.width || 24} ${s.height || 24}"><path d="${pathMatch[1]}" fill="currentColor"/></svg>`;
                    const svgNode = figma.createNodeFromSvg(simpleSvg);
                    svgNode.name = 'SVG (simplified)';
                    node = svgNode;
                    svgParsed = true;
                    
                    if (s.width && s.height) {
                        svgNode.resize(s.width, s.height);
                    }
                }
            } catch {
                // Second attempt also failed
            }
            
            if (!svgParsed) {
                // Ultimate fallback: Create a placeholder with an indicator
                console.warn('Failed to parse SVG, creating placeholder');
                const rect = figma.createRectangle();
                rect.name = 'SVG (parse failed)';
                rect.fills = [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95 } }];
                rect.strokes = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
                rect.strokeWeight = 1;
                rect.strokeAlign = 'INSIDE';
                node = rect;
            }
        }
    }
    else if (data.type === 'IMAGE') {
        const rect = figma.createRectangle();
        rect.name = 'Image';
        node = rect;

        // Use cached image (already downloaded in parallel)
        let imageLoaded = false;
        if (data.src) {
            const imageBytes = imageCache.get(data.src);
            if (imageBytes) {
                try {
                    const imageHash = figma.createImage(imageBytes).hash;
                    // Map CSS object-fit to Figma scaleMode
                    // CSS cover = scale to fill & crop -> Figma FILL
                    // CSS contain = scale to fit inside -> Figma FIT
                    // CSS fill = stretch to fill (ignore aspect ratio) -> Figma FILL (closest, no stretch mode)
                    // CSS none = no scaling, original size -> Figma CROP
                    let scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' = 'FILL';
                    if (data.objectFit === 'contain') {
                        scaleMode = 'FIT';
                    } else if (data.objectFit === 'none' || data.objectFit === 'scale-down') {
                        scaleMode = 'CROP';
                    }
                    // 'cover', 'fill' and default -> FILL (scale to fill, crop if needed)
                    rect.fills = [{ type: 'IMAGE', scaleMode, imageHash }];
                    imageLoaded = true;
                } catch (e) {
                    // Image format not supported (WebP, AVIF, etc.) - use placeholder color
                    console.warn('Image format unsupported:', data.src?.substring(0, 80), e);
                }
            } else {
                // Image was in the tree but not in cache (download failed or wasn't extracted)
                console.warn('Image not in cache:', data.src?.substring(0, 80));
            }
        }

        // Set placeholder if image didn't load
        if (!imageLoaded) {
            rect.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
        }

        // Apply Shadows to Image too if present
        if (s.boxShadow) {
            node.effects = parseBoxShadow(s.boxShadow);
        }

    }
    else if (data.type === 'PSEUDO_ELEMENT') {
        // Handle CSS pseudo-elements (::before/::after)
        const pseudoName = data.pseudo === '::before' ? 'Before' : 'After';
        
        if (data.contentType === 'TEXT' && data.content) {
            // Text pseudo-element
            const text = figma.createText();
            node = text;
            text.name = `::${pseudoName.toLowerCase()}`;

            try {
                // Load font with fallback
                const fontFamily = parseFontFamily(s.fontFamily);
                const fontWeight = s.fontWeight || '400';
                const isItalic = s.fontStyle === 'italic' || s.fontStyle === 'oblique';
                const loadedFont = await tryLoadFont(fontFamily, fontWeight, undefined, isItalic);
                text.fontName = loadedFont;

                text.characters = data.content;

                if (s.fontSize) text.fontSize = s.fontSize;
                if (s.color) {
                    const rgb = toRGB(s.color);
                    if (rgb) text.fills = [{ type: 'SOLID', color: rgb, opacity: s.color.a ?? 1 }];
                }

                // Apply letter spacing
                if (s.letterSpacing) {
                    text.letterSpacing = { value: s.letterSpacing, unit: 'PIXELS' };
                }

                // Apply text transform
                if (s.textTransform) {
                    text.textCase = getTextCase(s.textTransform);
                }

                // Text shadow (with box-shadow fallback)
                if (s.textShadow) {
                    text.effects = parseTextShadow(s.textShadow);
                } else if (s.boxShadow) {
                    text.effects = parseBoxShadow(s.boxShadow);
                }
            } catch (e) {
                console.warn('Pseudo-element text creation failed:', e);
                // Load fallback font before setting characters
                try {
                    await figma.loadFontAsync(FALLBACK_FONT);
                    text.fontName = FALLBACK_FONT;
                    text.characters = data.content?.replace(/[^\x00-\x7F]/g, '?') || '?';
                } catch (fallbackErr) {
                    console.warn('Fallback font load also failed:', fallbackErr);
                }
            }
        } else {
            // Decorative, gradient, or image pseudo-element - create a frame
            const frame = figma.createFrame();
            frame.name = `::${pseudoName.toLowerCase()}`;
            node = frame;
            
            // Apply background
            const fills: Paint[] = [];
            if (s.backgroundColor) {
                // Use alpha from backgroundColor if available, otherwise fall back to opacity
                const bgAlpha = s.backgroundColor.a !== undefined ? s.backgroundColor.a : 1;
                const finalOpacity = bgAlpha * (s.opacity ?? 1);
                fills.push({ type: 'SOLID', color: { r: s.backgroundColor.r, g: s.backgroundColor.g, b: s.backgroundColor.b }, opacity: finalOpacity });
            }
            
            // Handle content: url() images
            if (data.imageUrl) {
                const imgBytes = imageCache.get(data.imageUrl);
                if (imgBytes) {
                    try {
                        const imgHash = figma.createImage(imgBytes).hash;
                        fills.push({ type: 'IMAGE', scaleMode: 'FILL', imageHash: imgHash });
                    } catch (e) {
                        console.warn('Pseudo-element image format unsupported:', data.imageUrl?.substring(0, 80));
                        fills.push({ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } });
                    }
                }
            }
            // Handle background-image
            else if (s.backgroundImage && s.backgroundImage.type === 'IMAGE') {
                const bgBytes = imageCache.get(s.backgroundImage.url);
                if (bgBytes) {
                    try {
                        const bgHash = figma.createImage(bgBytes).hash;
                        // Map CSS background-size and background-repeat to Figma scaleMode
                        let scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' = 'FILL';
                        const bgSize = s.backgroundImage.size || '';
                        const bgRepeat = s.backgroundRepeat || 'no-repeat';

                        if (bgRepeat === 'repeat' || bgRepeat === 'repeat-x' || bgRepeat === 'repeat-y') {
                            scaleMode = 'TILE';
                        } else if (bgSize === 'contain') {
                            scaleMode = 'FIT';
                        }
                        fills.push({ type: 'IMAGE', scaleMode, imageHash: bgHash });
                    } catch (e) {
                        console.warn('Pseudo-element bg image format unsupported:', s.backgroundImage.url?.substring(0, 80));
                        fills.push({ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } });
                    }
                }
            } else if (s.backgroundImage && s.backgroundImage.type === 'GRADIENT') {
                const gradient = parseGradient(s.backgroundImage.raw);
                if (gradient) fills.push(gradient);
            }
            frame.fills = fills.length > 0 ? fills : [];
            
            // Apply border radius
            if (s.borderRadius) {
                frame.topLeftRadius = s.borderRadius.topLeft || 0;
                frame.topRightRadius = s.borderRadius.topRight || 0;
                frame.bottomRightRadius = s.borderRadius.bottomRight || 0;
                frame.bottomLeftRadius = s.borderRadius.bottomLeft || 0;
            }
            
            // Apply shadows
            if (s.boxShadow) {
                frame.effects = parseBoxShadow(s.boxShadow);
            }
            
            // Apply borders
            if (s.border && s.border.width > 0 && s.border.color) {
                const borderRgb = toRGB(s.border.color);
                if (borderRgb) {
                    frame.strokes = [{ type: 'SOLID', color: borderRgb, opacity: s.border.color.a ?? 1 }];
                    frame.strokeWeight = s.border.width;
                    frame.strokeAlign = 'INSIDE';
                }
            }
            
            // Set reasonable default size for pseudo-elements
            if (s.width === 'auto' || !s.width || s.width === 0) {
                // If no explicit width, use a default or inherit from content
                if (data.contentType === 'IMAGE' || data.contentType === 'GRADIENT') {
                    frame.resize(24, 24); // Default icon size
                }
            }
        }
    }
    else if (data.type === 'TEXT_NODE' || (data.type === 'TEXT' && data.content)) {
        const text = figma.createText();
        node = text;

        try {
            // Load the appropriate font (with fallback)
            const fontFamily = parseFontFamily(s.fontFamily);
            const fontWeight = s.fontWeight || '400';
            const isItalic = s.fontStyle === 'italic' || s.fontStyle === 'oblique';
            const loadedFont = await tryLoadFont(fontFamily, fontWeight, undefined, isItalic);
            text.fontName = loadedFont;

            // Character Content - handle potential issues with special characters
            const content = data.content || "";
            text.characters = content;

            // Basic Color/Size
            if (s.fontSize) text.fontSize = s.fontSize;
            if (s.color) {
                const rgb = toRGB(s.color);
                if (rgb) text.fills = [{ type: 'SOLID', color: rgb, opacity: s.color.a ?? 1 }];
            }

            // Advanced Typography
            if (s.letterSpacing) {
                text.letterSpacing = { value: s.letterSpacing, unit: 'PIXELS' };
            }
            if (s.textTransform) {
                text.textCase = getTextCase(s.textTransform);
            }
            if (s.textDecoration) {
                text.textDecoration = getTextDecoration(s.textDecoration);
            }

            // Text Alignment
            if (s.textAlign) {
                text.textAlignHorizontal = getTextAlignHorizontal(s.textAlign);
            }

            // Line Height
            if (s.lineHeight && s.fontSize) {
                const lineHeightPx = parseLineHeight(s.lineHeight, s.fontSize);
                if (lineHeightPx) {
                    text.lineHeight = { value: lineHeightPx, unit: 'PIXELS' };
                }
            }

            // Shadows on text (text-shadow takes priority, fall back to box-shadow)
            if (s.textShadow) {
                text.effects = parseTextShadow(s.textShadow);
            } else if (s.boxShadow) {
                text.effects = parseBoxShadow(s.boxShadow);
            }
        } catch (e) {
            // If text creation fails, load fallback font before setting characters
            console.warn('Text node creation failed:', e, 'Content:', data.content?.substring(0, 50));
            try {
                await figma.loadFontAsync(FALLBACK_FONT);
                text.fontName = FALLBACK_FONT;
                text.characters = data.content?.replace(/[^\x00-\x7F]/g, '?') || "?";
            } catch (fallbackErr) {
                console.warn('Fallback font load also failed:', fallbackErr);
            }
        }
    }
    else if (data.type === 'FRAME') {
        const frame = figma.createFrame();
        node = frame;
        frame.name = data.tag || 'Frame';

        // Backgrounds
        const fills: Paint[] = [];
        if (s.backgroundColor) {
            // Use alpha from backgroundColor if available, otherwise fall back to opacity
            const bgAlpha = s.backgroundColor.a !== undefined ? s.backgroundColor.a : 1;
            const finalOpacity = bgAlpha * (s.opacity ?? 1);
            fills.push({ type: 'SOLID', color: { r: s.backgroundColor.r, g: s.backgroundColor.g, b: s.backgroundColor.b }, opacity: finalOpacity });
        }
        if (s.backgroundImage && s.backgroundImage.type === 'IMAGE') {
            // Use cached image (already downloaded in parallel)
            const bgBytes = imageCache.get(s.backgroundImage.url);
            if (bgBytes) {
                try {
                    const bgHash = figma.createImage(bgBytes).hash;
                    // Map CSS background-size and background-repeat to Figma scaleMode
                    let scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' = 'FILL';
                    const bgSize = s.backgroundImage.size || '';
                    const bgRepeat = s.backgroundRepeat || 'no-repeat';

                    // Check for repeat first (takes priority)
                    if (bgRepeat === 'repeat' || bgRepeat === 'repeat-x' || bgRepeat === 'repeat-y') {
                        scaleMode = 'TILE';
                    } else if (bgSize === 'contain') {
                        // CSS contain = scale to fit inside -> Figma FIT
                        scaleMode = 'FIT';
                    }
                    // 'cover', 'auto', '100% 100%', and default -> FILL (scale to fill)
                    fills.push({ type: 'IMAGE', scaleMode, imageHash: bgHash });
                } catch (e) {
                    console.warn('Frame bg image format unsupported:', s.backgroundImage.url?.substring(0, 80));
                    fills.push({ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } });
                }
            }
        } else if (s.backgroundImage && s.backgroundImage.type === 'GRADIENT') {
            const gradient = parseGradient(s.backgroundImage.raw);
            if (gradient) fills.push(gradient);
        }
        frame.fills = fills.length > 0 ? fills : [];

        if (s.boxShadow) {
            frame.effects = parseBoxShadow(s.boxShadow);
        }

        // Borders -> Strokes
        if (s.border && s.border.width > 0 && s.border.color) {
            const borderRgb = toRGB(s.border.color);
            if (borderRgb) {
                frame.strokes = [{ type: 'SOLID', color: borderRgb, opacity: s.border.color.a ?? 1 }];
                frame.strokeWeight = s.border.width;
                // Align strokes to inside usually for web box-sizing: border-box
                frame.strokeAlign = 'INSIDE';
            }
        }

        // Clipping
        if (s.overflowX === 'hidden' || s.overflowY === 'hidden') {
            frame.clipsContent = true;
        } else {
            frame.clipsContent = false;
        }

        // Radius
        if (s.borderRadius) {
            frame.topLeftRadius = s.borderRadius.topLeft || 0;
            frame.topRightRadius = s.borderRadius.topRight || 0;
            frame.bottomRightRadius = s.borderRadius.bottomRight || 0;
            frame.bottomLeftRadius = s.borderRadius.bottomLeft || 0;
        }
    } else {
        // Unknown type
        return;
    }

    // --- 2. COMMON SIZE & POSITION ---
    // Size - check if node supports resize (not all node types do)
    if (s.width && s.height && 'resize' in node) {
        try {
            (node as FrameNode).resize(s.width, s.height);
        } catch (e) {
            // Some nodes may fail resize in certain contexts, ignore
        }
    }

    // Append to parent BEFORE setting absolute positioning
    // (Layout positioning requires parent)
    if (parent.type !== 'PAGE') {
        (parent as FrameNode | GroupNode | ComponentNode).appendChild(node);
    } else {
        (parent as PageNode).appendChild(node);
    }

    // Positioning
    const isAbsolute = s.position === 'absolute' || s.position === 'fixed';

    if (isAbsolute) {
        // Set Absolute Positioning
        // Note: PAGE children are always absolute in Figma terms (x/y),
        // but Frame children depend on layout mode.
        // Only set layoutPositioning on nodes that support it (not TextNodes in some contexts)
        if (parent.type !== 'PAGE' && 'layoutPositioning' in node) {
            try {
                node.layoutPositioning = 'ABSOLUTE';
            } catch (e) {
                // Some nodes don't support layoutPositioning, ignore
            }
        }

        // Calculate Coordinates
        // If we have globalBounds for both, use the difference
        if (data.globalBounds && parentData && parentData.globalBounds) {
            node.x = data.globalBounds.x - parentData.globalBounds.x;
            node.y = data.globalBounds.y - parentData.globalBounds.y;
        } else {
            // Fallback to CSS top/left, adding margin offset
            const marginLeft = s.margin?.left || 0;
            const marginTop = s.margin?.top || 0;
            node.x = (s.left || 0) + marginLeft;
            node.y = (s.top || 0) + marginTop;
        }
    } else {
        // Static / AutoLayout
        // We configure the parent's AutoLayout properties in the PARENT's type check,
        // but here we are the child.
        // If parent is a FRAME, we rely on parent's auto-layout settings to place this node.
    }

    // --- 3. FRAME SPECIFIC: AUTO LAYOUT CONFIG ---
    if (data.type === 'FRAME' && node.type === 'FRAME') {
        const frame = node;
        
        if (s.display === 'grid') {
            // Parse grid template for better understanding
            const containerWidth = s.width || 0;
            const gridInfo = parseGridTemplate(s.gridTemplateColumns, containerWidth);
            const columns = gridInfo.count || 1;
            
            // Calculate available width for grid items (excluding padding)
            const paddingH = (s.padding?.left || 0) + (s.padding?.right || 0);
            const columnGap = s.columnGap || s.gap || 0;
            const availableWidth = containerWidth - paddingH;
            
            // Store grid info for children to use (via parentData in recursion)
            (data as any)._gridInfo = {
                columns,
                tracks: gridInfo.tracks,
                containerWidth: availableWidth,
                columnGap,
                rowGap: s.rowGap || s.gap || 0,
            };
            
            if (columns > 1) {
                // Multi-column grid: Use HORIZONTAL with WRAP
                frame.layoutMode = 'HORIZONTAL';
                frame.layoutWrap = 'WRAP';
                
                // For grids with fixed or fr columns, we need to size children appropriately
                // Check if all tracks use fr units
                const allFr = gridInfo.tracks.length > 0 && gridInfo.tracks.every(t => t.unit === 'fr');
                const allPx = gridInfo.tracks.length > 0 && gridInfo.tracks.every(t => t.unit === 'px');
                
                if (allFr) {
                    // All fr units: children will fill based on fr values
                    // We'll handle this in child processing
                } else if (allPx) {
                    // All px: children have fixed widths
                    // We'll apply these widths in child processing
                }
            } else {
                // Single column or row-based: Use VERTICAL
                frame.layoutMode = 'VERTICAL';
            }
            
            // Gap handling (CSS Grid has separate column-gap and row-gap)
            frame.itemSpacing = columnGap;
            frame.counterAxisSpacing = s.rowGap || s.gap || 0;
            
            // Padding
            frame.paddingTop = s.padding?.top || 0;
            frame.paddingRight = s.padding?.right || 0;
            frame.paddingBottom = s.padding?.bottom || 0;
            frame.paddingLeft = s.padding?.left || 0;
            
            // Alignment - map CSS align-items/justify-items/place-items
            const alignItems = s.alignItems || 'stretch';
            switch (alignItems) {
                case 'center': frame.counterAxisAlignItems = 'CENTER'; break;
                case 'end': case 'flex-end': frame.counterAxisAlignItems = 'MAX'; break;
                case 'start': case 'flex-start': frame.counterAxisAlignItems = 'MIN'; break;
                default: frame.counterAxisAlignItems = 'MIN';
            }
            
            const justifyContent = s.justifyContent || 'start';
            switch (justifyContent) {
                case 'center': frame.primaryAxisAlignItems = 'CENTER'; break;
                case 'space-between': frame.primaryAxisAlignItems = 'SPACE_BETWEEN'; break;
                case 'space-around': case 'space-evenly': frame.primaryAxisAlignItems = 'SPACE_BETWEEN'; break;
                case 'end': case 'flex-end': frame.primaryAxisAlignItems = 'MAX'; break;
                default: frame.primaryAxisAlignItems = 'MIN';
            }
        } else if (s.display === 'flex') {
            frame.layoutMode = s.flexDirection === 'row' ? 'HORIZONTAL' : 'VERTICAL';
            
            // Handle flex-wrap
            if (s.flexWrap === 'wrap' || s.flexWrap === 'wrap-reverse') {
                frame.layoutWrap = 'WRAP';
                frame.counterAxisSpacing = s.rowGap || s.gap || 0;
            }
            
            frame.itemSpacing = s.columnGap || s.gap || 0;
            frame.paddingTop = s.padding?.top || 0;
            frame.paddingRight = s.padding?.right || 0;
            frame.paddingBottom = s.padding?.bottom || 0;
            frame.paddingLeft = s.padding?.left || 0;

            // Alignment
            switch (s.alignItems) {
                case 'center': frame.counterAxisAlignItems = 'CENTER'; break;
                case 'flex-end': frame.counterAxisAlignItems = 'MAX'; break;
                default: frame.counterAxisAlignItems = 'MIN';
            }
            switch (s.justifyContent) {
                case 'center': frame.primaryAxisAlignItems = 'CENTER'; break;
                case 'space-between': frame.primaryAxisAlignItems = 'SPACE_BETWEEN'; break;
                case 'flex-end': frame.primaryAxisAlignItems = 'MAX'; break;
                default: frame.primaryAxisAlignItems = 'MIN';
            }
        } else {
            // Block layout -> Vertical AutoLayout
            frame.layoutMode = 'VERTICAL';
        }
    }

    // --- 4. RECURSION ---
    if (data.children) {
        for (const childData of data.children) {
            const childNode = await buildNode(childData, node, data);

            // --- 4.5. FLEX ITEM PROPERTIES ---
            // Apply flex-grow/shrink/alignSelf to children of flex containers
            if (childNode && (s.display === 'flex' || s.display === 'inline-flex') && 'layoutGrow' in childNode) {
                const childStyles = childData.styles || childData;

                // flex-grow: 1 means child should fill available space
                if (childStyles.flexGrow && childStyles.flexGrow > 0) {
                    try {
                        (childNode as FrameNode).layoutGrow = childStyles.flexGrow;
                    } catch (e) {
                        // Some nodes don't support layoutGrow
                    }
                }

                // align-self overrides the parent's align-items for this child
                if (childStyles.alignSelf && childStyles.alignSelf !== 'auto') {
                    try {
                        const alignMap: Record<string, 'MIN' | 'CENTER' | 'MAX' | 'STRETCH'> = {
                            'flex-start': 'MIN',
                            'start': 'MIN',
                            'center': 'CENTER',
                            'flex-end': 'MAX',
                            'end': 'MAX',
                            'stretch': 'STRETCH',
                        };
                        const layoutAlign = alignMap[childStyles.alignSelf];
                        if (layoutAlign) {
                            (childNode as FrameNode).layoutAlign = layoutAlign;
                        }
                    } catch (e) {
                        // Some nodes don't support layoutAlign
                    }
                }
            }

            // --- 5. GRID ITEM SIZING ---
            // If parent is a grid, apply grid-specific sizing to this child
            if (childNode && s.display === 'grid' && (data as any)._gridInfo) {
                const gridInfo = (data as any)._gridInfo;
                const childStyles = childData.styles || {};
                
                // Parse grid-column span
                const colSpan = parseGridSpan(childStyles.gridColumn || childStyles.gridColumnStart);
                const actualSpan = Math.min(colSpan.span, gridInfo.columns);
                
                // Calculate width based on track sizes and span
                if (gridInfo.tracks.length > 0 && childNode.type === 'FRAME') {
                    const totalFr = gridInfo.tracks.reduce((sum: number, t: any) => 
                        t.unit === 'fr' ? sum + t.value : sum, 0);
                    const totalPx = gridInfo.tracks.reduce((sum: number, t: any) => 
                        t.unit === 'px' ? sum + t.value : sum, 0);
                    const totalGaps = (gridInfo.columns - 1) * gridInfo.columnGap;
                    const availableForFr = gridInfo.containerWidth - totalPx - totalGaps;
                    
                    // Calculate width for this item
                    let itemWidth = 0;
                    // Use explicit grid-column-start if provided (CSS is 1-indexed, convert to 0-indexed)
                    const startIdx = colSpan.start > 0 ? colSpan.start - 1 : 0;
                    
                    for (let i = 0; i < actualSpan && i < gridInfo.tracks.length; i++) {
                        const track = gridInfo.tracks[startIdx + i];
                        if (!track) continue;
                        
                        if (track.unit === 'fr') {
                            itemWidth += (track.value / totalFr) * availableForFr;
                        } else if (track.unit === 'px') {
                            itemWidth += track.value;
                        } else if (track.unit === 'minmax') {
                            // Use min value as approximation
                            itemWidth += track.value || (availableForFr / gridInfo.columns);
                        } else {
                            // Auto: divide available space equally
                            itemWidth += availableForFr / gridInfo.columns;
                        }
                        
                        // Add gap between spanned columns
                        if (i > 0) {
                            itemWidth += gridInfo.columnGap;
                        }
                    }
                    
                    // Apply calculated width if reasonable
                    if (itemWidth > 0) {
                        try {
                            const currentHeight = childNode.height || 100;
                            childNode.resize(Math.max(1, itemWidth), Math.max(1, currentHeight));
                        } catch (e) {
                            // Resize might fail for certain node types, ignore
                        }
                    }
                }
            }
        }
    }

    // Apply CSS transforms (rotation, translation) after sizing
    if (s.transform) {
        applyTransform(node, s.transform);
    }

    return node;
}
