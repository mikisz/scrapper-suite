/// <reference types="@figma/plugin-typings" />

import type { VisualNode } from './types';

/**
 * Font loading and mapping utilities for the Website-to-Figma plugin
 */

// Track loaded fonts to avoid redundant loads
export const loadedFonts = new Set<string>();

// Fallback fonts by category
export const FALLBACK_FONT: FontName = { family: "Inter", style: "Regular" };
export const FALLBACK_FONT_BOLD: FontName = { family: "Inter", style: "Bold" };
export const FALLBACK_SERIF: FontName = { family: "Georgia", style: "Regular" };
export const FALLBACK_MONO: FontName = { family: "Roboto Mono", style: "Regular" };

/**
 * Font matching database - maps common web fonts to Figma-available alternatives
 * Keys are lowercase for case-insensitive matching
 */
export const FONT_MAP: Record<string, string> = {
    // System fonts -> Figma equivalents
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
export function detectFontCategory(fontName: string): 'sans-serif' | 'serif' | 'monospace' | 'unknown' {
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
export function parseFontFamily(fontFamily: string): string {
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
export function getCategoryFallback(originalFont: string, weight: string | number): FontName {
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
export function getFontStyle(weight: string | number, isItalic: boolean = false): string {
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
export async function tryLoadFont(
    family: string,
    weight: string | number,
    originalFamily?: string,
    isItalic: boolean = false
): Promise<FontName> {
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
export function extractFonts(node: VisualNode, fonts: Set<string>): void {
    if (!node) return;

    const styles = node.styles || node;
    if ((styles as any).fontFamily) {
        const family = parseFontFamily((styles as any).fontFamily);
        const weight = (styles as any).fontWeight || '400';
        fonts.add(`${family}:${weight}`);
    }

    // Handle pseudo-elements with text content
    if (node.type === 'PSEUDO_ELEMENT' && node.contentType === 'TEXT' && (styles as any).fontFamily) {
        const family = parseFontFamily((styles as any).fontFamily);
        const weight = (styles as any).fontWeight || '400';
        fonts.add(`${family}:${weight}`);
    }

    if (node.children) {
        for (const child of node.children) {
            extractFonts(child, fonts);
        }
    }
}

/**
 * Load all fonts needed for the visual tree
 */
export async function loadFonts(rootData?: VisualNode): Promise<void> {
    // Always load fallback fonts for each category
    const fallbackFonts: FontName[] = [
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
