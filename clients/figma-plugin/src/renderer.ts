/// <reference types="@figma/plugin-typings" />

import type { VisualNode, GridInfo } from './types';
import { imageCache } from './images';
import { tryLoadFont, parseFontFamily, FALLBACK_FONT } from './fonts';
import {
    toRGB,
    parseBoxShadow,
    parseTextShadow,
    getTextCase,
    getTextDecoration,
    getTextAlignHorizontal,
    parseLineHeight,
    applyTransform,
    parseGradient
} from './styles';
import { parseGridTemplate, parseGridSpan } from './grid';

/**
 * Renderer module for the Website-to-Figma plugin
 * Contains the main buildNode function that creates Figma nodes from visual tree data
 */

// Progress tracking (exposed for main module to update)
export let totalNodes = 0;
export let processedNodes = 0;

export function setTotalNodes(count: number): void {
    totalNodes = count;
}

export function resetProcessedNodes(): void {
    processedNodes = 0;
}

// Progress callback type
type ProgressCallback = (stage: string, percent: number, detail: string) => void;

// Warning callback type
type WarningCallback = (message: string) => void;

let progressCallback: ProgressCallback | null = null;
let warningCallback: WarningCallback | null = null;

export function setProgressCallback(cb: ProgressCallback | null): void {
    progressCallback = cb;
}

export function setWarningCallback(cb: WarningCallback | null): void {
    warningCallback = cb;
}

function sendProgress(stage: string, percent: number, detail: string): void {
    if (progressCallback) {
        progressCallback(stage, percent, detail);
    }
}

function sendWarning(message: string): void {
    if (warningCallback) {
        warningCallback(message);
    }
    console.warn('Import Warning:', message);
}

/**
 * Count total nodes in a visual tree
 */
export function countNodes(data: VisualNode): number {
    if (!data) return 0;
    let count = 1;
    if (data.children) {
        for (const child of data.children) {
            count += countNodes(child);
        }
    }
    return count;
}

/**
 * Main build function - creates Figma nodes from visual tree data
 */
export async function buildNode(
    data: VisualNode,
    parent: SceneNode | PageNode,
    parentData?: VisualNode
): Promise<SceneNode | undefined> {
    if (!data) return;

    // Update progress
    processedNodes++;
    if (processedNodes % 10 === 0 || processedNodes === totalNodes) {
        const percent = 30 + Math.round((processedNodes / totalNodes) * 65);
        sendProgress('Building layout', percent, `${processedNodes}/${totalNodes} nodes`);
    }

    let node!: SceneNode;
    // Handle both nested styles (FRAME) and flattened styles (TEXT_NODE from serializer)
    const s = (data.styles || data) as any;

    // --- 1. CREATE NODE BASED ON TYPE ---
    try {
        if (data.type === 'VECTOR') {
            node = await createVectorNode(data, s);
        }
        else if (data.type === 'IMAGE') {
            node = createImageNode(data, s);
        }
        else if (data.type === 'PSEUDO_ELEMENT') {
            node = await createPseudoElementNode(data, s);
        }
        else if (data.type === 'TEXT_NODE' || (data.type === 'TEXT' && data.content)) {
            node = await createTextNode(data, s);
        }
        else if (data.type === 'FRAME') {
            node = createFrameNode(data, s);
        }
        else {
            // Unknown type
            return;
        }
    } catch (createErr) {
        console.warn('Failed to create node:', createErr, 'Type:', data.type, 'Tag:', data.tag);
        sendWarning(`Failed to create ${data.type}: ${data.tag || 'unknown'}`);
        // Create a placeholder frame so we can still process children
        if (data.children && data.children.length > 0) {
            node = figma.createFrame();
            node.name = `${data.tag || data.type} (error)`;
        } else {
            return;
        }
    }

    // --- 2. COMMON SIZE & POSITION ---
    if (s.width && s.height && 'resize' in node) {
        try {
            (node as FrameNode).resize(s.width, s.height);
        } catch {
            // Some nodes may fail resize in certain contexts
        }
    }

    // Append to parent
    if (parent.type !== 'PAGE') {
        (parent as FrameNode | GroupNode | ComponentNode).appendChild(node);
    } else {
        (parent as PageNode).appendChild(node);
    }

    // Positioning
    const isAbsolute = s.position === 'absolute' || s.position === 'fixed';

    if (isAbsolute) {
        if (parent.type !== 'PAGE' && 'layoutPositioning' in node) {
            try {
                node.layoutPositioning = 'ABSOLUTE';
            } catch {
                // Some nodes don't support layoutPositioning
            }
        }

        // Calculate coordinates
        if (data.globalBounds && parentData && parentData.globalBounds) {
            node.x = data.globalBounds.x - parentData.globalBounds.x;
            node.y = data.globalBounds.y - parentData.globalBounds.y;
        } else {
            const marginLeft = s.margin?.left || 0;
            const marginTop = s.margin?.top || 0;
            node.x = (s.left || 0) + marginLeft;
            node.y = (s.top || 0) + marginTop;
        }
    }

    // --- 3. FRAME SPECIFIC: AUTO LAYOUT CONFIG ---
    if (data.type === 'FRAME' && node.type === 'FRAME') {
        configureFrameLayout(node, data, s);
    }

    // --- 4. RECURSION ---
    if (data.children) {
        for (const childData of data.children) {
            try {
                const childNode = await buildNode(childData, node, data);

                // Apply flex item properties
                if (childNode && (s.display === 'flex' || s.display === 'inline-flex') && 'layoutGrow' in childNode) {
                    applyFlexItemProperties(childNode as FrameNode, childData, s);
                }

                // Apply grid item sizing
                if (childNode && s.display === 'grid' && (data as any)._gridInfo) {
                    applyGridItemSizing(childNode, childData, (data as any)._gridInfo);
                }
            } catch (childErr) {
                // Log but continue - don't let one child failure break the entire build
                console.warn('Failed to build child node:', childErr, 'Tag:', childData.tag || childData.type);
                sendWarning(`Skipped element: ${childData.tag || childData.type}`);
            }
        }
    }

    // Apply CSS transforms
    if (s.transform) {
        applyTransform(node, s.transform);
    }

    return node;
}

// =====================
// Node Creation Helpers
// =====================

async function createVectorNode(data: VisualNode, s: any): Promise<SceneNode> {
    let svgParsed = false;
    let node: SceneNode;

    try {
        // Clean up SVG string for better Figma compatibility
        let cleanedSvg = data.svgString || '';

        cleanedSvg = cleanedSvg.replace(/\s*xmlns:xlink="[^"]*"/g, '');
        cleanedSvg = cleanedSvg.replace(/\s*class="[^"]*"/g, '');
        cleanedSvg = cleanedSvg.replace(/\s*data-[a-z-]+="[^"]*"/g, '');

        if (!cleanedSvg.includes('xmlns="')) {
            cleanedSvg = cleanedSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
        }

        cleanedSvg = cleanedSvg.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

        const svgNode = figma.createNodeFromSvg(cleanedSvg);
        svgNode.name = 'SVG';
        node = svgNode;
        svgParsed = true;

        // Apply size
        if (s.width && s.height && s.width > 0 && s.height > 0) {
            if (data.viewBox) {
                const viewBoxParts = data.viewBox.split(/\s+/).map(Number);
                if (viewBoxParts.length === 4) {
                    const vbWidth = viewBoxParts[2];
                    const vbHeight = viewBoxParts[3];
                    const aspectRatio = vbWidth / vbHeight;

                    if (s.width / s.height > aspectRatio) {
                        svgNode.resize(s.height * aspectRatio, s.height);
                    } else {
                        svgNode.resize(s.width, s.width / aspectRatio);
                    }
                } else {
                    svgNode.resize(s.width, s.height);
                }
            } else {
                svgNode.resize(s.width, s.height);
            }
        }

        // Apply shadows
        if (s.boxShadow) {
            svgNode.effects = parseBoxShadow(s.boxShadow);
        }

        // Apply fill color override for simple icons
        if (data.svgFill && svgNode.children && svgNode.children.length <= 5) {
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
    } catch {
        svgParsed = false;
    }

    if (!svgParsed) {
        // Fallback: try simplified SVG
        try {
            const pathMatch = (data.svgString || '').match(/<path[^>]*d="([^"]+)"[^>]*>/);
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
            // Ultimate fallback: placeholder
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

    return node!;
}

function createImageNode(data: VisualNode, s: any): SceneNode {
    const rect = figma.createRectangle();
    rect.name = 'Image';

    let imageLoaded = false;
    if (data.src) {
        const imageBytes = imageCache.get(data.src);
        if (imageBytes) {
            try {
                const imageHash = figma.createImage(imageBytes).hash;
                let scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' = 'FILL';
                if (data.objectFit === 'contain') {
                    scaleMode = 'FIT';
                } else if (data.objectFit === 'none' || data.objectFit === 'scale-down') {
                    scaleMode = 'CROP';
                }
                rect.fills = [{ type: 'IMAGE', scaleMode, imageHash }];
                imageLoaded = true;
            } catch (e) {
                console.warn('Image format unsupported:', data.src?.substring(0, 80), e);
            }
        } else {
            console.warn('Image not in cache:', data.src?.substring(0, 80));
        }
    }

    if (!imageLoaded) {
        rect.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
    }

    if (s.boxShadow) {
        rect.effects = parseBoxShadow(s.boxShadow);
    }

    return rect;
}

async function createPseudoElementNode(data: VisualNode, s: any): Promise<SceneNode> {
    const pseudoName = data.pseudo === '::before' ? 'Before' : 'After';

    if (data.contentType === 'TEXT' && data.content) {
        const text = figma.createText();
        text.name = `::${pseudoName.toLowerCase()}`;

        try {
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

            if (s.letterSpacing) {
                text.letterSpacing = { value: s.letterSpacing, unit: 'PIXELS' };
            }

            if (s.textTransform) {
                text.textCase = getTextCase(s.textTransform);
            }

            if (s.textShadow) {
                text.effects = parseTextShadow(s.textShadow);
            } else if (s.boxShadow) {
                text.effects = parseBoxShadow(s.boxShadow);
            }
        } catch (e) {
            console.warn('Pseudo-element text creation failed:', e);
            try {
                await figma.loadFontAsync(FALLBACK_FONT);
                text.fontName = FALLBACK_FONT;
                text.characters = data.content?.replace(/[^\x00-\x7F]/g, '?') || '?';
            } catch (fallbackErr) {
                console.warn('Fallback font load also failed:', fallbackErr);
            }
        }

        return text;
    } else {
        // Decorative, gradient, or image pseudo-element - reuse createFrameNode for base styling
        const pseudoData: VisualNode = { ...data, tag: `::${pseudoName.toLowerCase()}` };
        const frame = createFrameNode(pseudoData, s);

        // Handle content: url() images (pseudo-element specific)
        if (data.imageUrl) {
            const imgBytes = imageCache.get(data.imageUrl);
            if (imgBytes) {
                try {
                    const imgHash = figma.createImage(imgBytes).hash;
                    const currentFills = frame.fills as Paint[];
                    frame.fills = [...currentFills, { type: 'IMAGE', scaleMode: 'FILL', imageHash: imgHash }];
                } catch {
                    const currentFills = frame.fills as Paint[];
                    frame.fills = [...currentFills, { type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
                }
            }
        }

        // Set default size for pseudo-elements without explicit dimensions
        if (s.width === 'auto' || !s.width || s.width === 0) {
            if (data.contentType === 'IMAGE' || data.contentType === 'GRADIENT') {
                frame.resize(24, 24);
            }
        }

        return frame;
    }
}

async function createTextNode(data: VisualNode, s: any): Promise<TextNode> {
    const text = figma.createText();

    try {
        const fontFamily = parseFontFamily(s.fontFamily);
        const fontWeight = s.fontWeight || '400';
        const isItalic = s.fontStyle === 'italic' || s.fontStyle === 'oblique';
        const loadedFont = await tryLoadFont(fontFamily, fontWeight, undefined, isItalic);
        text.fontName = loadedFont;

        const content = data.content || "";
        text.characters = content;

        if (s.fontSize) text.fontSize = s.fontSize;
        if (s.color) {
            const rgb = toRGB(s.color);
            if (rgb) text.fills = [{ type: 'SOLID', color: rgb, opacity: s.color.a ?? 1 }];
        }

        if (s.letterSpacing) {
            text.letterSpacing = { value: s.letterSpacing, unit: 'PIXELS' };
        }
        if (s.textTransform) {
            text.textCase = getTextCase(s.textTransform);
        }
        if (s.textDecoration) {
            text.textDecoration = getTextDecoration(s.textDecoration);
        }

        if (s.textAlign) {
            text.textAlignHorizontal = getTextAlignHorizontal(s.textAlign);
        }

        if (s.lineHeight && s.fontSize) {
            const lineHeightPx = parseLineHeight(s.lineHeight, s.fontSize);
            if (lineHeightPx) {
                text.lineHeight = { value: lineHeightPx, unit: 'PIXELS' };
            }
        }

        if (s.textShadow) {
            text.effects = parseTextShadow(s.textShadow);
        } else if (s.boxShadow) {
            text.effects = parseBoxShadow(s.boxShadow);
        }
    } catch (e) {
        console.warn('Text node creation failed:', e, 'Content:', data.content?.substring(0, 50));
        try {
            await figma.loadFontAsync(FALLBACK_FONT);
            text.fontName = FALLBACK_FONT;
            text.characters = data.content?.replace(/[^\x00-\x7F]/g, '?') || "?";
        } catch (fallbackErr) {
            console.warn('Fallback font load also failed:', fallbackErr);
        }
    }

    return text;
}

function createFrameNode(data: VisualNode, s: any): FrameNode {
    const frame = figma.createFrame();
    frame.name = data.tag || 'Frame';

    // Backgrounds
    const fills: Paint[] = [];
    if (s.backgroundColor) {
        const bgAlpha = s.backgroundColor.a !== undefined ? s.backgroundColor.a : 1;
        const finalOpacity = bgAlpha * (s.opacity ?? 1);
        fills.push({
            type: 'SOLID',
            color: { r: s.backgroundColor.r, g: s.backgroundColor.g, b: s.backgroundColor.b },
            opacity: finalOpacity
        });
    }

    if (s.backgroundImage && s.backgroundImage.type === 'IMAGE') {
        const bgBytes = imageCache.get(s.backgroundImage.url);
        if (bgBytes) {
            try {
                const bgHash = figma.createImage(bgBytes).hash;
                let scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' = 'FILL';
                const bgRepeat = s.backgroundRepeat || 'no-repeat';

                if (bgRepeat === 'repeat' || bgRepeat === 'repeat-x' || bgRepeat === 'repeat-y') {
                    scaleMode = 'TILE';
                } else if (s.backgroundImage.size === 'contain') {
                    scaleMode = 'FIT';
                }
                fills.push({ type: 'IMAGE', scaleMode, imageHash: bgHash });
            } catch {
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

    // Borders
    if (s.border && s.border.width > 0 && s.border.color) {
        const borderRgb = toRGB(s.border.color);
        if (borderRgb) {
            frame.strokes = [{ type: 'SOLID', color: borderRgb, opacity: s.border.color.a ?? 1 }];
            frame.strokeWeight = s.border.width;
            frame.strokeAlign = 'INSIDE';
        }
    }

    // Clipping
    frame.clipsContent = s.overflowX === 'hidden' || s.overflowY === 'hidden';

    // Radius
    if (s.borderRadius) {
        frame.topLeftRadius = s.borderRadius.topLeft || 0;
        frame.topRightRadius = s.borderRadius.topRight || 0;
        frame.bottomRightRadius = s.borderRadius.bottomRight || 0;
        frame.bottomLeftRadius = s.borderRadius.bottomLeft || 0;
    }

    return frame;
}

// =====================
// Layout Configuration
// =====================

function configureFrameLayout(frame: FrameNode, data: VisualNode, s: any): void {
    // Apply padding for all layout types
    const applyPadding = () => {
        frame.paddingTop = s.padding?.top || 0;
        frame.paddingRight = s.padding?.right || 0;
        frame.paddingBottom = s.padding?.bottom || 0;
        frame.paddingLeft = s.padding?.left || 0;
    };

    if (s.display === 'grid') {
        const containerWidth = s.width || 0;
        const gridInfo = parseGridTemplate(s.gridTemplateColumns, containerWidth);
        const columns = gridInfo.count || 1;

        const paddingH = (s.padding?.left || 0) + (s.padding?.right || 0);
        const columnGap = s.columnGap || s.gap || 0;
        const availableWidth = containerWidth - paddingH;

        // Store grid info for children
        (data as any)._gridInfo = {
            columns,
            tracks: gridInfo.tracks,
            containerWidth: availableWidth,
            columnGap,
            rowGap: s.rowGap || s.gap || 0,
        };

        if (columns > 1) {
            frame.layoutMode = 'HORIZONTAL';
            frame.layoutWrap = 'WRAP';
        } else {
            frame.layoutMode = 'VERTICAL';
        }

        frame.itemSpacing = columnGap;
        frame.counterAxisSpacing = s.rowGap || s.gap || 0;
        applyPadding();

        // Alignment
        const alignItems = s.alignItems || 'stretch';
        switch (alignItems) {
            case 'center': frame.counterAxisAlignItems = 'CENTER'; break;
            case 'end': case 'flex-end': frame.counterAxisAlignItems = 'MAX'; break;
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
    } else if (s.display === 'flex' || s.display === 'inline-flex') {
        // Handle both flex and inline-flex
        const isRow = s.flexDirection === 'row' || s.flexDirection === 'row-reverse' || !s.flexDirection;
        frame.layoutMode = isRow ? 'HORIZONTAL' : 'VERTICAL';

        if (s.flexWrap === 'wrap' || s.flexWrap === 'wrap-reverse') {
            frame.layoutWrap = 'WRAP';
            frame.counterAxisSpacing = s.rowGap || s.gap || 0;
        }

        // For flex, use the appropriate gap based on direction
        const mainAxisGap = isRow ? (s.columnGap || s.gap || 0) : (s.rowGap || s.gap || 0);
        frame.itemSpacing = mainAxisGap;
        applyPadding();

        switch (s.alignItems) {
            case 'center': frame.counterAxisAlignItems = 'CENTER'; break;
            case 'flex-end': case 'end': frame.counterAxisAlignItems = 'MAX'; break;
            case 'stretch': frame.counterAxisAlignItems = 'MIN'; break; // Figma doesn't have stretch, MIN is closest
            default: frame.counterAxisAlignItems = 'MIN';
        }
        switch (s.justifyContent) {
            case 'center': frame.primaryAxisAlignItems = 'CENTER'; break;
            case 'space-between': frame.primaryAxisAlignItems = 'SPACE_BETWEEN'; break;
            case 'space-around': case 'space-evenly': frame.primaryAxisAlignItems = 'SPACE_BETWEEN'; break;
            case 'flex-end': case 'end': frame.primaryAxisAlignItems = 'MAX'; break;
            default: frame.primaryAxisAlignItems = 'MIN';
        }
    } else {
        // Block/inline-block layout -> Vertical AutoLayout (stacking)
        frame.layoutMode = 'VERTICAL';
        applyPadding();

        // For block elements, children stack vertically with no gap by default
        frame.itemSpacing = 0;
        frame.counterAxisAlignItems = 'MIN';
        frame.primaryAxisAlignItems = 'MIN';
    }

    // Set sizing mode based on the element's width/height behavior
    // This is critical for proper auto-layout behavior
    try {
        // Check if width is set explicitly vs auto/100%
        const hasExplicitWidth = s.width && s.width > 0;
        const hasExplicitHeight = s.height && s.height > 0;

        // For the primary axis (direction of layout)
        // If we have a fixed size, use FIXED; otherwise HUG contents
        if (frame.layoutMode === 'HORIZONTAL') {
            frame.primaryAxisSizingMode = hasExplicitWidth ? 'FIXED' : 'AUTO';
            // Counter axis (vertical) - use FIXED if height is set
            frame.counterAxisSizingMode = hasExplicitHeight ? 'FIXED' : 'AUTO';
        } else {
            // VERTICAL layout
            frame.primaryAxisSizingMode = hasExplicitHeight ? 'FIXED' : 'AUTO';
            // Counter axis (horizontal) - use FIXED if width is set
            frame.counterAxisSizingMode = hasExplicitWidth ? 'FIXED' : 'AUTO';
        }
    } catch {
        // Some older Figma API versions may not support these properties
    }
}

function applyFlexItemProperties(childNode: FrameNode, childData: VisualNode, parentStyles: any): void {
    const childStyles = (childData.styles || childData) as any;

    // Determine parent flex direction to apply sizing correctly
    const isParentRow = parentStyles.flexDirection === 'row' ||
                        parentStyles.flexDirection === 'row-reverse' ||
                        !parentStyles.flexDirection;

    try {
        // Handle flex-grow - if > 0, the element should fill available space
        if (childStyles.flexGrow && childStyles.flexGrow > 0) {
            childNode.layoutGrow = childStyles.flexGrow;
        }

        // Handle alignSelf
        if (childStyles.alignSelf && childStyles.alignSelf !== 'auto') {
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
                childNode.layoutAlign = layoutAlign;
            }
        }

        // Set proper sizing mode for flex children based on parent direction
        // This helps maintain the correct fill/hug behavior
        if ('layoutSizingHorizontal' in childNode) {
            if (isParentRow && childStyles.flexGrow && childStyles.flexGrow > 0) {
                // flex-grow in row direction fills horizontal
                childNode.layoutSizingHorizontal = 'FILL';
            } else if (childStyles.width && childStyles.width > 0) {
                childNode.layoutSizingHorizontal = 'FIXED';
            } else {
                childNode.layoutSizingHorizontal = 'HUG';
            }
        }

        if ('layoutSizingVertical' in childNode) {
            if (!isParentRow && childStyles.flexGrow && childStyles.flexGrow > 0) {
                // flex-grow in column direction fills vertical
                childNode.layoutSizingVertical = 'FILL';
            } else if (childStyles.alignSelf === 'stretch') {
                childNode.layoutSizingVertical = 'FILL';
            } else if (childStyles.height && childStyles.height > 0) {
                childNode.layoutSizingVertical = 'FIXED';
            } else {
                childNode.layoutSizingVertical = 'HUG';
            }
        }
    } catch {
        // Some nodes don't support these layout properties
    }
}

function applyGridItemSizing(childNode: SceneNode, childData: VisualNode, gridInfo: GridInfo): void {
    const childStyles = (childData.styles || {}) as any;

    const colSpan = parseGridSpan(childStyles.gridColumn || childStyles.gridColumnStart);
    const actualSpan = Math.min(colSpan.span, gridInfo.columns);

    if (gridInfo.tracks.length > 0 && childNode.type === 'FRAME') {
        const totalFr = gridInfo.tracks.reduce((sum, t) =>
            t.unit === 'fr' ? sum + t.value : sum, 0);
        const totalPx = gridInfo.tracks.reduce((sum, t) =>
            t.unit === 'px' ? sum + t.value : sum, 0);
        const totalGaps = (gridInfo.columns - 1) * gridInfo.columnGap;
        const availableForFr = gridInfo.containerWidth - totalPx - totalGaps;

        let itemWidth = 0;
        const startIdx = colSpan.start > 0 ? colSpan.start - 1 : 0;

        for (let i = 0; i < actualSpan && i < gridInfo.tracks.length; i++) {
            const track = gridInfo.tracks[startIdx + i];
            if (!track) continue;

            if (track.unit === 'fr') {
                itemWidth += (track.value / totalFr) * availableForFr;
            } else if (track.unit === 'px') {
                itemWidth += track.value;
            } else if (track.unit === 'minmax') {
                itemWidth += track.value || (availableForFr / gridInfo.columns);
            } else {
                itemWidth += availableForFr / gridInfo.columns;
            }

            if (i > 0) {
                itemWidth += gridInfo.columnGap;
            }
        }

        if (itemWidth > 0) {
            try {
                const currentHeight = childNode.height || 100;
                childNode.resize(Math.max(1, itemWidth), Math.max(1, currentHeight));
            } catch {
                // Resize might fail for certain node types
            }
        }
    }
}
