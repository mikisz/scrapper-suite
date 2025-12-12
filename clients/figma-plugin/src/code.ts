/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 300, height: 400 });


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
        await loadFonts(rootData);
        // Create a temporary frame or just append to page?
        // Let's create the root node directly on page
        await buildNode(rootData, figma.currentPage, undefined);
        figma.ui.postMessage({ type: 'done' });
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

// --- HELPER: Parse Gradient ---
function parseGradient(gradientStr: string): GradientPaint | null {
    if (!gradientStr || !gradientStr.includes('linear-gradient')) return null;

    // Simplified Gradient Parsing
    // CSS: linear-gradient(deg, color stop, color stop)
    // Figma: GradientPaint... 

    // 1. Extract Colors
    // Regex matches rgba?(...) or #...
    const colors: RGB[] = [];
    const colorMatches = gradientStr.match(/rgba?\(.*?\)|#[a-fA-F0-9]{3,6}/g);

    if (colorMatches && colorMatches.length >= 2) {
        colorMatches.slice(0, 3).forEach(c => { // Limit to 3 stops for simplicity
            // Parse Color
            let r = 0, g = 0, b = 0, a = 1;
            if (c.startsWith('rgba')) {
                const nums = c.match(/[\d.]+/g)?.map(Number);
                if (nums && nums.length >= 3) {
                    r = nums[0] / 255; g = nums[1] / 255; b = nums[2] / 255; a = nums[3] ?? 1;
                }
            } else if (c.startsWith('rgb')) {
                const nums = c.match(/[\d.]+/g)?.map(Number);
                if (nums && nums.length >= 3) {
                    r = nums[0] / 255; g = nums[1] / 255; b = nums[2] / 255; a = 1;
                }
            } else if (c.startsWith('#')) {
                // hex parsing placeholder, default to mid-grey if fail
                // actually lets support hex roughly
                if (c.length === 7) {
                    r = parseInt(c.slice(1, 3), 16) / 255;
                    g = parseInt(c.slice(3, 5), 16) / 255;
                    b = parseInt(c.slice(5, 7), 16) / 255;
                }
            }
            colors.push({ r, g, b });
        });
    }

    if (colors.length < 2) return null;

    // Construct Gradient Stops
    const stops: ColorStop[] = colors.map((c, i) => ({
        position: i / (colors.length - 1),
        color: { ...c, a: 1 } // Figma alpha usually 1 for gradient stops unless transparent gradient
    }));

    // TODO: Parse angle to set handle positions. Defaulting to Top-Bottom.
    return {
        type: 'GRADIENT_LINEAR',
        gradientStops: stops,
        gradientTransform: [[0, 1, 0], [-1, 0, 1]] // 90deg rotation approximately
    };
}


// Main Build Function
async function buildNode(data: any, parent: SceneNode | PageNode, parentData?: any) {
    if (!data) return;

    // ... (Image logic)

    let node: SceneNode;
    const s = data.styles || {};

    // --- 1. CREATE NODE BASED ON TYPE ---
    if (data.type === 'IMAGE') {
        const rect = figma.createRectangle();
        rect.name = 'Image';
        node = rect;

        // Download Image
        if (data.src) {
            const imageBytes = await downloadImage(data.src);
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
            const bgBytes = await downloadImage(s.backgroundImage.url);
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
        if (s.display === 'flex') {
            frame.layoutMode = s.flexDirection === 'row' ? 'HORIZONTAL' : 'VERTICAL';
            frame.itemSpacing = s.gap || 0;
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
            await buildNode(childData, node, data);
        }
    }

    return node;
}
