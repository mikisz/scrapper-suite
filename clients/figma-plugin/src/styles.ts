/// <reference types="@figma/plugin-typings" />

/**
 * Style parsing utilities for the Website-to-Figma plugin
 * Handles colors, gradients, shadows, text styles, and transforms
 */

/**
 * Strip alpha from color objects (Figma doesn't accept 'a' in color)
 */
export function toRGB(color: any): RGB | null {
    if (!color) return null;
    return { r: color.r, g: color.g, b: color.b };
}

/**
 * Parse CSS box-shadow string into Figma effects
 */
export function parseBoxShadow(shadowStr: string): Effect[] {
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

        let color = { r: 0, g: 0, b: 0, a: 0.2 }; // default
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
        // CSS: offset-x | offset-y | blur-radius | spread-radius
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

/**
 * Parse CSS text-shadow string into Figma effects
 * Similar to box-shadow but no spread or inset
 */
export function parseTextShadow(shadowStr: string): Effect[] {
    if (!shadowStr || shadowStr === 'none') return [];

    const effects: Effect[] = [];
    const shadows = shadowStr.split(/,(?![^()]*\))/);

    for (const shadow of shadows) {
        const s = shadow.trim();

        let color = { r: 0, g: 0, b: 0, a: 0.5 }; // default
        let remaining = s;

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

/**
 * Get Figma TextCase from CSS text-transform
 */
export function getTextCase(transform: string): TextCase {
    if (transform === 'uppercase') return 'UPPER';
    if (transform === 'lowercase') return 'LOWER';
    if (transform === 'capitalize') return 'TITLE';
    return 'ORIGINAL';
}

/**
 * Get Figma TextDecoration from CSS text-decoration
 */
export function getTextDecoration(decoration: string): TextDecoration {
    if (decoration && decoration.includes('underline')) return 'UNDERLINE';
    if (decoration && decoration.includes('line-through')) return 'STRIKETHROUGH';
    return 'NONE';
}

/**
 * Get Figma text alignment from CSS text-align
 */
export function getTextAlignHorizontal(align: string): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' {
    if (align === 'center') return 'CENTER';
    if (align === 'right' || align === 'end') return 'RIGHT';
    if (align === 'justify') return 'JUSTIFIED';
    return 'LEFT'; // default, includes 'left' and 'start'
}

/**
 * Parse CSS line-height value to pixels
 */
export function parseLineHeight(value: string | undefined, fontSize: number): number | null {
    if (!value || value === 'normal') return null; // Let Figma use default

    // Check for unitless multiplier (e.g., "1.5") - must be purely numeric
    if (/^[\d.]+$/.test(value)) {
        const unitless = parseFloat(value);
        if (!isNaN(unitless)) {
            return unitless * fontSize;
        }
    }

    // Check for px value
    if (value.endsWith('px')) {
        return parseFloat(value) || null;
    }
    // Check for em value
    if (value.endsWith('em')) {
        return (parseFloat(value) || 1) * fontSize;
    }
    // Check for percentage
    if (value.endsWith('%')) {
        return (parseFloat(value) / 100) * fontSize;
    }

    return null;
}

/**
 * Apply CSS transform to a Figma node
 */
export function applyTransform(node: SceneNode, transform: string | null | undefined): void {
    if (!transform || transform === 'none') return;

    const supportsRotation = 'rotation' in node;

    // Parse matrix(a, b, c, d, tx, ty)
    const matrixMatch = transform.match(/matrix\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (matrixMatch) {
        const [, a, b, , , tx, ty] = matrixMatch.map((v, i) => i === 0 ? v : parseFloat(v));
        const aNum = a as number, bNum = b as number;

        // Calculate rotation from matrix: atan2(b, a)
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
        return;
    }

    // Handle individual transform functions
    // rotate(Xdeg) or rotate(Xrad)
    const rotateMatch = transform.match(/rotate\(\s*(-?[\d.]+)(deg|rad|turn)?\s*\)/);
    if (rotateMatch && supportsRotation) {
        let degrees = parseFloat(rotateMatch[1]);
        const unit = rotateMatch[2] || 'deg';
        if (unit === 'rad') degrees = degrees * (180 / Math.PI);
        else if (unit === 'turn') degrees = degrees * 360;
        (node as FrameNode).rotation = -degrees;
    }

    // translate(X, Y)
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

// =====================
// Gradient Parsing
// =====================

/**
 * Parse gradient angle from CSS linear-gradient string
 */
export function parseGradientAngle(gradientStr: string): number {
    // Default: 180deg (top to bottom) - CSS default
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

/**
 * Convert CSS angle to Figma gradient transform matrix
 */
export function angleToGradientTransform(angleDeg: number): Transform {
    const angleRad = (angleDeg - 90) * (Math.PI / 180);
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    return [
        [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
        [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]
    ];
}

/**
 * Parse color string to RGBA object
 */
export function parseColorString(colorStr: string): RGBA | null {
    let r = 0, g = 0, b = 0, a = 1;
    if (colorStr.startsWith('rgba')) {
        const nums = colorStr.match(/[\d.]+/g)?.map(Number);
        if (nums && nums.length >= 3) {
            r = nums[0] / 255;
            g = nums[1] / 255;
            b = nums[2] / 255;
            a = nums[3] ?? 1;
        }
    } else if (colorStr.startsWith('rgb')) {
        const nums = colorStr.match(/[\d.]+/g)?.map(Number);
        if (nums && nums.length >= 3) {
            r = nums[0] / 255;
            g = nums[1] / 255;
            b = nums[2] / 255;
        }
    } else if (colorStr.startsWith('#')) {
        const hex = colorStr.slice(1);
        if (hex.length === 3) {
            r = parseInt(hex[0] + hex[0], 16) / 255;
            g = parseInt(hex[1] + hex[1], 16) / 255;
            b = parseInt(hex[2] + hex[2], 16) / 255;
        } else if (hex.length >= 6) {
            r = parseInt(hex.slice(0, 2), 16) / 255;
            g = parseInt(hex.slice(2, 4), 16) / 255;
            b = parseInt(hex.slice(4, 6), 16) / 255;
            if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
        }
    } else {
        return null;
    }
    return { r, g, b, a };
}

/**
 * Extract gradient color stops from CSS gradient string
 * Returns stops and average opacity
 */
export function extractGradientStops(gradientStr: string): { stops: ColorStop[]; opacity: number } {
    const colorStopRegex = /(rgba?\([^)]+\)|#[a-fA-F0-9]{3,8})(?:\s+(\d+(?:\.\d+)?%?))?/g;
    let match;
    const rawStops: { color: RGBA; position?: number }[] = [];

    while ((match = colorStopRegex.exec(gradientStr)) !== null) {
        const color = parseColorString(match[1]);
        if (!color) continue;
        rawStops.push({ color, position: match[2] ? parseFloat(match[2]) / 100 : undefined });
    }

    if (rawStops.length < 2) return { stops: [], opacity: 1 };

    // Fill in missing positions
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

    // Calculate average opacity
    const avgOpacity = rawStops.reduce((sum, s) => sum + (s.color.a ?? 1), 0) / rawStops.length;

    const stops: ColorStop[] = rawStops.map(s => ({
        position: s.position || 0,
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a ?? 1 }
    }));

    return { stops, opacity: avgOpacity };
}

/**
 * Parse radial gradient position from CSS string
 */
export function parseRadialGradientPosition(gradientStr: string): { x: number; y: number } {
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

        if (parts.length >= 2) {
            x = parsePos(parts[0]);
            y = parsePos(parts[1]);
        } else if (parts.length === 1) {
            const val = parts[0];
            if (val === 'left') x = 0;
            else if (val === 'right') x = 1;
            else if (val === 'top') y = 0;
            else if (val === 'bottom') y = 1;
            else x = parsePos(val);
        }
    }
    return { x, y };
}

interface RadialGradientShape {
    isCircle: boolean;
    scaleX: number;
    scaleY: number;
}

/**
 * Parse radial gradient shape and size from CSS string
 */
export function parseRadialGradientShape(gradientStr: string): RadialGradientShape {
    let isCircle = false;
    let scaleX = 1;
    let scaleY = 1;

    const shapeMatch = gradientStr.match(/radial-gradient\(\s*([^,]*?)(?:\s+at\s+|,)/i);
    const shapePart = shapeMatch ? shapeMatch[1].trim().toLowerCase() : '';

    if (shapePart.includes('circle')) {
        isCircle = true;
    }

    // Size keywords
    if (shapePart.includes('closest-side')) {
        scaleX = 0.5;
        scaleY = isCircle ? 0.5 : 0.5;
    } else if (shapePart.includes('closest-corner')) {
        scaleX = 0.707;
        scaleY = isCircle ? 0.707 : 0.707;
    } else if (shapePart.includes('farthest-side')) {
        scaleX = 1;
        scaleY = 1;
    } else if (shapePart.includes('farthest-corner')) {
        scaleX = 1.414;
        scaleY = isCircle ? 1.414 : 1.414;
    }

    // Explicit size
    const sizeMatch = shapePart.match(/(\d+(?:\.\d+)?)(px|%)\s*(\d+(?:\.\d+)?)?(px|%)?/);
    if (sizeMatch) {
        const size1 = parseFloat(sizeMatch[1]);
        const unit1 = sizeMatch[2];
        const size2 = sizeMatch[3] ? parseFloat(sizeMatch[3]) : size1;

        if (unit1 === '%') {
            scaleX = size1 / 100;
            scaleY = size2 / 100;
        } else {
            scaleX = size1 / 200;
            scaleY = size2 / 200;
        }

        if (!sizeMatch[3]) {
            isCircle = true;
            scaleY = scaleX;
        }
    }

    return { isCircle, scaleX, scaleY };
}

/**
 * Parse CSS radial-gradient to Figma GradientPaint
 */
export function parseRadialGradient(gradientStr: string): GradientPaint | null {
    if (!gradientStr?.includes('radial-gradient')) return null;

    const { x, y } = parseRadialGradientPosition(gradientStr);
    const { scaleX, scaleY } = parseRadialGradientShape(gradientStr);

    const transform: Transform = [
        [scaleX, 0, x - scaleX / 2],
        [0, scaleY, y - scaleY / 2]
    ];

    const { stops, opacity } = extractGradientStops(gradientStr);
    if (stops.length < 2) return null;

    return { type: 'GRADIENT_RADIAL', gradientStops: stops, gradientTransform: transform, opacity };
}

/**
 * Parse CSS linear-gradient to Figma GradientPaint
 */
export function parseLinearGradient(gradientStr: string): GradientPaint | null {
    if (!gradientStr?.includes('linear-gradient')) return null;

    const angle = parseGradientAngle(gradientStr);
    const transform = angleToGradientTransform(angle);
    const { stops, opacity } = extractGradientStops(gradientStr);

    if (stops.length < 2) return null;
    return { type: 'GRADIENT_LINEAR', gradientStops: stops, gradientTransform: transform, opacity };
}

/**
 * Parse any CSS gradient to Figma GradientPaint
 */
export function parseGradient(gradientStr: string): GradientPaint | null {
    if (!gradientStr) return null;
    if (gradientStr.includes('radial-gradient')) return parseRadialGradient(gradientStr);
    if (gradientStr.includes('linear-gradient')) return parseLinearGradient(gradientStr);
    return null;
}
