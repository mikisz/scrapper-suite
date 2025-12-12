/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 300, height: 450 });

// Progress tracking
let totalNodes = 0;
let processedNodes = 0;
let warnings: string[] = [];
let errors: string[] = [];

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
    const styles = node.styles || {};
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
        
        try {
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
            sendError(
                'Failed to build layout',
                error.message || 'An unexpected error occurred during import.'
            );
        }
    }
};

// Font loading with dynamic fallback
const loadedFonts = new Set<string>();
const FALLBACK_FONT = { family: "Inter", style: "Regular" };
const FALLBACK_FONT_BOLD = { family: "Inter", style: "Bold" };

/**
 * Parse CSS font-family string and return the primary font name
 * e.g., '"Helvetica Neue", Helvetica, Arial, sans-serif' => 'Helvetica Neue'
 */
function parseFontFamily(fontFamily: string): string {
    if (!fontFamily) return FALLBACK_FONT.family;
    
    // Split by comma and get the first font
    const fonts = fontFamily.split(',').map(f => f.trim());
    let primary = fonts[0] || FALLBACK_FONT.family;
    
    // Remove quotes
    primary = primary.replace(/^["']|["']$/g, '');
    
    // Skip generic font families
    const generics = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', '-apple-system', 'BlinkMacSystemFont'];
    if (generics.includes(primary.toLowerCase())) {
        return FALLBACK_FONT.family;
    }
    
    return primary;
}

/**
 * Map CSS font-weight to Figma style name
 */
function getFontStyle(weight: string | number): string {
    const w = typeof weight === 'string' ? parseInt(weight) || 400 : weight;
    
    if (w <= 100) return 'Thin';
    if (w <= 200) return 'ExtraLight';
    if (w <= 300) return 'Light';
    if (w <= 400) return 'Regular';
    if (w <= 500) return 'Medium';
    if (w <= 600) return 'SemiBold';
    if (w <= 700) return 'Bold';
    if (w <= 800) return 'ExtraBold';
    return 'Black';
}

/**
 * Try to load a font, with fallback to Inter
 * Returns the font that was successfully loaded
 */
async function tryLoadFont(family: string, weight: string | number): Promise<FontName> {
    const style = getFontStyle(weight);
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
        const styleVariations = ['Regular', 'Medium', 'Normal', 'Book'];
        if (parseInt(String(weight)) >= 600) {
            styleVariations.unshift('Bold', 'SemiBold', 'DemiBold');
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
    }
    
    // Fall back to Inter
    const fallback = parseInt(String(weight)) >= 600 ? FALLBACK_FONT_BOLD : FALLBACK_FONT;
    const fallbackKey = `${fallback.family}:${fallback.style}`;
    if (!loadedFonts.has(fallbackKey)) {
        await figma.loadFontAsync(fallback);
        loadedFonts.add(fallbackKey);
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
    // Always load fallback fonts
    await figma.loadFontAsync(FALLBACK_FONT);
    await figma.loadFontAsync(FALLBACK_FONT_BOLD);
    loadedFonts.add(`${FALLBACK_FONT.family}:${FALLBACK_FONT.style}`);
    loadedFonts.add(`${FALLBACK_FONT_BOLD.family}:${FALLBACK_FONT_BOLD.style}`);
    
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
        const s = shadow.trim();
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
        // Figma: DropShadowEffect
        if (parts.length >= 2) {
            effects.push({
                type: 'DROP_SHADOW',
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
function extractGradientStops(gradientStr: string): ColorStop[] {
    const colorStopRegex = /(rgba?\([^)]+\)|#[a-fA-F0-9]{3,8})(?:\s+(\d+(?:\.\d+)?%?))?/g;
    let match;
    const rawStops: { color: RGBA; position?: number }[] = [];
    while ((match = colorStopRegex.exec(gradientStr)) !== null) {
        const color = parseColorString(match[1]);
        if (!color) continue;
        rawStops.push({ color, position: match[2] ? parseFloat(match[2])/100 : undefined });
    }
    if (rawStops.length < 2) return [];
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
    return rawStops.map(s => ({ position: s.position || 0, color: s.color }));
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

// --- HELPER: Parse Radial Gradient ---
function parseRadialGradient(gradientStr: string): GradientPaint | null {
    if (!gradientStr?.includes('radial-gradient')) return null;
    const { x, y } = parseRadialGradientPosition(gradientStr);
    const scaleX = gradientStr.includes('closest-side') ? 0.5 : 1;
    const scaleY = scaleX;
    const transform: Transform = [[scaleX, 0, x - scaleX/2], [0, scaleY, y - scaleY/2]];
    const stops = extractGradientStops(gradientStr);
    if (stops.length < 2) return null;
    return { type: 'GRADIENT_RADIAL', gradientStops: stops, gradientTransform: transform };
}

// --- HELPER: Parse Linear Gradient ---
function parseLinearGradient(gradientStr: string): GradientPaint | null {
    if (!gradientStr?.includes('linear-gradient')) return null;
    const angle = parseGradientAngle(gradientStr);
    const transform = angleToGradientTransform(angle);
    const stops = extractGradientStops(gradientStr);
    if (stops.length < 2) return null;
    return { type: 'GRADIENT_LINEAR', gradientStops: stops, gradientTransform: transform };
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

    let node: SceneNode;
    const s = data.styles || {};

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
                    for (const child of svgNode.findAll()) {
                        if ('fills' in child && (child as GeometryMixin).fills) {
                            const fills = (child as GeometryMixin).fills as readonly Paint[];
                            if (fills.length > 0 && fills[0].type === 'SOLID') {
                                (child as GeometryMixin).fills = [{
                                    type: 'SOLID',
                                    color: data.svgFill
                                }];
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
        if (data.src) {
            const imageBytes = imageCache.get(data.src);
            if (imageBytes) {
                const imageHash = figma.createImage(imageBytes).hash;
                rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash }];
            }
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
            
            // Load font with fallback
            const fontFamily = parseFontFamily(s.fontFamily);
            const fontWeight = s.fontWeight || '400';
            const loadedFont = await tryLoadFont(fontFamily, fontWeight);
            text.fontName = loadedFont;
            
            text.characters = data.content;
            
            if (s.fontSize) text.fontSize = s.fontSize;
            if (s.color) {
                text.fills = [{ type: 'SOLID', color: s.color }];
            }
            
            // Apply letter spacing
            if (s.letterSpacing) {
                text.letterSpacing = { value: s.letterSpacing, unit: 'PIXELS' };
            }
            
            // Apply text transform
            if (s.textTransform) {
                text.textCase = getTextCase(s.textTransform);
            }
            
            if (s.boxShadow) {
                text.effects = parseBoxShadow(s.boxShadow);
            }
        } else {
            // Decorative, gradient, or image pseudo-element - create a frame
            const frame = figma.createFrame();
            frame.name = `::${pseudoName.toLowerCase()}`;
            node = frame;
            
            // Apply background
            const fills: Paint[] = [];
            if (s.backgroundColor) {
                fills.push({ type: 'SOLID', color: s.backgroundColor, opacity: s.opacity });
            }
            
            // Handle content: url() images
            if (data.imageUrl) {
                const imgBytes = imageCache.get(data.imageUrl);
                if (imgBytes) {
                    const imgHash = figma.createImage(imgBytes).hash;
                    fills.push({ type: 'IMAGE', scaleMode: 'FILL', imageHash: imgHash });
                }
            }
            // Handle background-image
            else if (s.backgroundImage && s.backgroundImage.type === 'IMAGE') {
                const bgBytes = imageCache.get(s.backgroundImage.url);
                if (bgBytes) {
                    const bgHash = figma.createImage(bgBytes).hash;
                    fills.push({ type: 'IMAGE', scaleMode: 'FILL', imageHash: bgHash });
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
                frame.strokes = [{ type: 'SOLID', color: s.border.color }];
                frame.strokeWeight = s.border.width;
                frame.strokeAlign = 'INSIDE';
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
        
        // Load the appropriate font (with fallback)
        const fontFamily = parseFontFamily(s.fontFamily);
        const fontWeight = s.fontWeight || '400';
        const loadedFont = await tryLoadFont(fontFamily, fontWeight);
        text.fontName = loadedFont;

        // Character Content
        text.characters = data.content || "";

        // Basic Color/Size
        if (s.fontSize) text.fontSize = s.fontSize;
        if (s.color) {
            text.fills = [{ type: 'SOLID', color: s.color }];
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

        // Shadows on text? CSS supports text-shadow (not box-shadow usually), 
        // but sometimes we get box-shadow on span. Let's try.
        if (s.boxShadow) {
            node.effects = parseBoxShadow(s.boxShadow);
        }
    }
    else if (data.type === 'FRAME') {
        const frame = figma.createFrame();
        node = frame;
        frame.name = data.tag || 'Frame';

        // Backgrounds
        const fills: Paint[] = [];
        if (s.backgroundColor) {
            fills.push({ type: 'SOLID', color: s.backgroundColor, opacity: s.opacity });
        }
        if (s.backgroundImage && s.backgroundImage.type === 'IMAGE') {
            // Use cached image (already downloaded in parallel)
            const bgBytes = imageCache.get(s.backgroundImage.url);
            if (bgBytes) {
                const bgHash = figma.createImage(bgBytes).hash;
                fills.push({ type: 'IMAGE', scaleMode: 'FILL', imageHash: bgHash });
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
            frame.strokes = [{ type: 'SOLID', color: s.border.color }];
            frame.strokeWeight = s.border.width;
            // Align strokes to inside usually for web box-sizing: border-box
            frame.strokeAlign = 'INSIDE';
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
    // Size
    if (s.width && s.height) {
        node.resize(s.width, s.height);
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
        if (parent.type !== 'PAGE') {
            node.layoutPositioning = 'ABSOLUTE';
        }

        // Calculate Coordinates
        // If we have globalBounds for both, use the difference
        if (data.globalBounds && parentData && parentData.globalBounds) {
            node.x = data.globalBounds.x - parentData.globalBounds.x;
            node.y = data.globalBounds.y - parentData.globalBounds.y;
        } else {
            // Fallback to CSS top/left
            node.x = s.left || 0;
            node.y = s.top || 0;
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
                    const startIdx = 0; // Simplified: assume sequential placement
                    
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

    return node;
}
