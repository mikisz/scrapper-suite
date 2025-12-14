/**
 * CSS Grid parsing utilities for the Website-to-Figma plugin
 */

import type { GridTrackInfo, GridTrack, GridSpanInfo } from './types';

/**
 * Parse CSS grid-template-columns/rows value into structured data
 * Handles: repeat(n, value), fr units, px, auto, minmax()
 */
export function parseGridTemplate(template: string | undefined, containerSize: number = 0): GridTrackInfo {
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
export function splitGridTracks(template: string): string[] {
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
export function parseTrackValue(value: string): GridTrack {
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
export function parseGridSpan(value: string | undefined): GridSpanInfo {
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
