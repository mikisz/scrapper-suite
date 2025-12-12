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

    // Helper to extract pseudo-element (::before/::after)
    function getPseudoElement(el, pseudo) {
        // Note: Some environments (like JSDOM) don't support getComputedStyle with pseudo-elements
        let computed;
        try {
            computed = window.getComputedStyle(el, pseudo);
        } catch (e) {
            return null; // Environment doesn't support pseudo-element styles
        }
        
        // Check if getComputedStyle returned null or is missing content property
        if (!computed || !computed.content) {
            return null;
        }
        
        const content = computed.content;
        
        // Skip if no content or 'none'
        if (!content || content === 'none' || content === 'normal' || content === '""' || content === "''") {
            return null;
        }

        // Check if the pseudo-element is visible
        if (computed.display === 'none' || computed.visibility === 'hidden' || computed.opacity === '0') {
            return null;
        }

        // Extract the actual text content (removing quotes)
        let textContent = content;
        if (content.startsWith('"') && content.endsWith('"')) {
            textContent = content.slice(1, -1);
        } else if (content.startsWith("'") && content.endsWith("'")) {
            textContent = content.slice(1, -1);
        }

        // Get dimensions - pseudo-elements don't have getBoundingClientRect, 
        // so we estimate from computed styles
        const width = parseUnit(computed.width) || 0;
        const height = parseUnit(computed.height) || 0;

        // Check for background image (common for icon pseudo-elements)
        const bgImage = getBackground(computed);
        
        // If there's a background image but empty text, it's likely an icon pseudo-element
        const hasBackgroundContent = bgImage && bgImage.type === 'IMAGE';
        
        // Skip if no visual content at all
        if (!textContent && !hasBackgroundContent && width === 0 && height === 0) {
            return null;
        }

        const pseudoStyles = {
            width: width || parseUnit(computed.inlineSize) || 'auto',
            height: height || parseUnit(computed.blockSize) || 'auto',
            display: computed.display,
            position: computed.position,
            top: parseUnit(computed.top),
            left: parseUnit(computed.left),
            right: parseUnit(computed.right),
            bottom: parseUnit(computed.bottom),
            zIndex: computed.zIndex === 'auto' ? 0 : parseInt(computed.zIndex),
            backgroundColor: getRgb(computed.backgroundColor),
            backgroundImage: bgImage,
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
            opacity: parseFloat(computed.opacity) || 1,
            border: {
                width: parseUnit(computed.borderWidth),
                color: getRgb(computed.borderColor),
                style: computed.borderStyle
            },
            boxShadow: computed.boxShadow !== 'none' ? computed.boxShadow : null,
        };

        // Determine the type based on content
        if (textContent && textContent.trim()) {
            return {
                type: 'PSEUDO_ELEMENT',
                pseudo: pseudo,
                contentType: 'TEXT',
                content: textContent,
                styles: pseudoStyles,
            };
        } else if (hasBackgroundContent) {
            return {
                type: 'PSEUDO_ELEMENT',
                pseudo: pseudo,
                contentType: 'IMAGE',
                styles: pseudoStyles,
            };
        } else if (width > 0 && height > 0) {
            // Decorative element (colored box, shape, etc.)
            return {
                type: 'PSEUDO_ELEMENT',
                pseudo: pseudo,
                contentType: 'DECORATIVE',
                styles: pseudoStyles,
            };
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
                position: computed.position,
                top: parseUnit(computed.top),
                left: parseUnit(computed.left),
                right: parseUnit(computed.right),
                bottom: parseUnit(computed.bottom),
                zIndex: computed.zIndex === 'auto' ? 0 : parseInt(computed.zIndex),

                // Flexbox
                flexDirection: computed.flexDirection,
                flexWrap: computed.flexWrap,
                justifyContent: computed.justifyContent,
                alignItems: computed.alignItems,
                gap: parseUnit(computed.gap),

                // CSS Grid
                gridTemplateColumns: computed.gridTemplateColumns,
                gridTemplateRows: computed.gridTemplateRows,
                gridColumn: computed.gridColumn,
                gridRow: computed.gridRow,
                columnGap: parseUnit(computed.columnGap),
                rowGap: parseUnit(computed.rowGap),
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
                opacity: parseFloat(computed.opacity) || 1,

                // Borders
                border: {
                    width: parseUnit(computed.borderWidth),
                    color: getRgb(computed.borderColor),
                    style: computed.borderStyle
                },

                // Advanced Visuals
                boxShadow: computed.boxShadow !== 'none' ? computed.boxShadow : null,
                letterSpacing: parseUnit(computed.letterSpacing),
                textTransform: computed.textTransform,
                textDecoration: computed.textDecorationLine, // computed style often splits decoration

                overflowX: computed.overflowX,
                overflowY: computed.overflowY,
            };

            // Handling Images
            if (isImage) {
                return {
                    type: 'IMAGE',
                    src: el.src,
                    boxShadow: computed.boxShadow !== 'none' ? computed.boxShadow : null, // Support shadow on img
                    styles,
                    tag: 'img'
                };
            }

            // Handling SVGs: Extract as editable vector data
            // Note: tagName can be uppercase or lowercase depending on the document type
            if (el.tagName.toUpperCase() === 'SVG') {
                const s = new XMLSerializer();
                const svgString = s.serializeToString(el);
                
                // Return as VECTOR type with raw SVG string for Figma's createNodeFromSvg
                return {
                    type: 'VECTOR',
                    svgString: svgString,
                    styles,
                    tag: 'svg'
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

            // 3. Pseudo-element Support (::before)
            // Extract ::before pseudo-element if present - it renders BEFORE child content
            const beforePseudo = getPseudoElement(el, '::before');
            if (beforePseudo) {
                children.push(beforePseudo);
            }

            // Regular children
            childNodesArray.forEach(child => {
                const result = analyzeNode(child);
                if (result) children.push(result);
            });

            // 4. Pseudo-element Support (::after)
            // Extract ::after pseudo-element if present - it renders AFTER child content
            const afterPseudo = getPseudoElement(el, '::after');
            if (afterPseudo) {
                children.push(afterPseudo);
            }

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
                globalBounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, // New: used for absolute positioning calculation
                styles,
                children,
            };
        }
        return null;
    }

    return analyzeNode(rootNode);
};
