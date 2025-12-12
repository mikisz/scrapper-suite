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
        if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            return {
                r: parseInt(match[1]) / 255,
                g: parseInt(match[2]) / 255,
                b: parseInt(match[3]) / 255,
            };
        }
        return null; // Return null for transparent/invalid
    }

    function parseUnit(val) {
        return parseFloat(val) || 0;
    }

    function isVisible(el) {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    // Helper to get background image URL or Gradient
    function getBackground(computed) {
        const bgImage = computed.backgroundImage;
        if (!bgImage || bgImage === 'none') return null;

        // Check for URL
        const urlMatch = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
        if (urlMatch) {
            return { type: 'IMAGE', url: urlMatch[1] };
        }

        // Check for Gradient (simplified)
        if (bgImage.includes('gradient')) {
            // We'll pass the raw string for now, Figma plugin will have to try to parse or ignore
            return { type: 'GRADIENT', raw: bgImage };
        }
        return null;
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

            // Skip tiny elements... UNLESS they are images, have Shadow DOM, or display:contents
            const isImage = el.tagName === 'IMG';
            const hasShadow = !!el.shadowRoot;
            const isDisplayContents = computed.display === 'contents';

            if (!isImage && !hasShadow && !isDisplayContents && (rect.width === 0 || rect.height === 0)) return null;

            const styles = {
                width: rect.width,
                height: rect.height,
                display: computed.display,
                position: computed.position, // New
                top: parseUnit(computed.top), // New
                left: parseUnit(computed.left), // New
                right: parseUnit(computed.right), // New
                bottom: parseUnit(computed.bottom), // New
                zIndex: computed.zIndex === 'auto' ? 0 : parseInt(computed.zIndex), // New

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
                backgroundImage: getBackground(computed), // New
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
                opacity: parseFloat(computed.opacity) || 1, // New
                overflowX: computed.overflowX, // New
                overflowY: computed.overflowY, // New
            };

            // Handling Images
            if (isImage) {
                return {
                    type: 'IMAGE',
                    src: el.src,
                    styles,
                    tag: 'img'
                };
            }

            let childNodesArray = Array.from(node.childNodes);

            // 1. Shadow DOM Support
            // If the element has a shadow root, we MUST traverse that instead of the light DOM children
            // because the shadow root is what is actually rendered.
            if (el.shadowRoot) {
                childNodesArray = Array.from(el.shadowRoot.childNodes);
            }

            // 2. Slot Support
            // If we are currently at a <slot> element (inside a shadow root), 
            // its visual children are the "assigned nodes" from the light DOM.
            if (el.tagName === 'SLOT') {
                childNodesArray = el.assignedNodes ? el.assignedNodes({ flatten: true }) : [];
            }

            const children = [];
            childNodesArray.forEach(child => {
                const result = analyzeNode(child);
                if (result) children.push(result);
            });

            // Special optimization: Text Container leaf
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
