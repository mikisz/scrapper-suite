/**
 * This function is designed to be injected into a browser context (Puppeteer or Chrome Extension).
 * It traverses the DOM and returns a JSON representation of the visual tree for Figma.
 * 
 * IMPORTANT: This file must be pure JavaScript (no Typescript syntax) because it will be evaluated
 * directly in the browser console/context where TS processing isn't available at runtime without bundling.
 */

window.FigmaSerializer = {};

window.FigmaSerializer.serialize = function (rootNode = document.body) {
    function getRgb(color) {
        if (!color) return null;
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            return {
                r: parseInt(match[1]) / 255,
                g: parseInt(match[2]) / 255,
                b: parseInt(match[3]) / 255,
            };
        }
        return null;
    }

    function parseUnit(val) {
        return parseFloat(val) || 0;
    }

    function isVisible(el) {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function analyzeNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const textContent = node.textContent?.trim();
            if (!textContent) return null;
            return {
                type: 'TEXT',
                content: textContent,
            };
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node;
            if (!isVisible(el)) return null;

            const computed = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();

            // Skip tiny elements or empty containers that aren't strictly explicit spacing
            if (rect.width === 0 || rect.height === 0) return null;

            const styles = {
                width: rect.width,
                height: rect.height,
                display: computed.display,
                flexDirection: computed.flexDirection,
                justifyContent: computed.justifyContent,
                alignItems: computed.alignItems,
                gap: parseUnit(computed.gap),
                padding: {
                    top: parseUnit(computed.paddingTop),
                    right: parseUnit(computed.paddingRight),
                    bottom: parseUnit(computed.paddingBottom),
                    left: parseUnit(computed.paddingLeft),
                },
                backgroundColor: getRgb(computed.backgroundColor),
                borderRadius: {
                    topLeft: parseUnit(computed.borderTopLeftRadius),
                    topRight: parseUnit(computed.borderTopRightRadius),
                    bottomRight: parseUnit(computed.borderBottomRightRadius),
                    bottomLeft: parseUnit(computed.borderBottomLeftRadius),
                },
                color: getRgb(computed.color),
                fontSize: parseUnit(computed.fontSize),
                fontWeight: computed.fontWeight,
                fontFamily: computed.fontFamily,
                lineHeight: computed.lineHeight,
                textAlign: computed.textAlign,
            };

            const children = [];
            node.childNodes.forEach(child => {
                const result = analyzeNode(child);
                if (result) children.push(result);
            });

            // Special handling for leaf nodes that act as text containers
            if (children.length === 1 && children[0].type === 'TEXT') {
                return {
                    type: 'TEXT_NODE',
                    ...styles,
                    content: children[0].content
                };
            }

            return {
                type: 'FRAME',
                tag: el.tagName.toLowerCase(),
                styles,
                children,
            };
        }
        return null;
    }

    return analyzeNode(rootNode);
};
