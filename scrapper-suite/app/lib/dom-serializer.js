/**
 * This function is designed to be injected into a browser context (Puppeteer or Chrome Extension).
 * It traverses the DOM and returns a JSON representation of the visual tree for Figma.
 * 
 * IMPORTANT: This file must be pure JavaScript (no Typescript syntax) because it will be evaluated
 * directly in the browser console/context where TS processing isn't available at runtime without bundling.
 */

window.FigmaSerializer = {};

/**
 * Serialize a specific element (for component extraction)
 * This captures the element with proper bounds relative to itself
 */
window.FigmaSerializer.serializeElement = function (element, options = {}) {
    const { name, variant } = options;
    const result = window.FigmaSerializer.serialize(element);

    if (result) {
        // Add component metadata
        result.componentName = name || null;
        result.componentVariant = variant || null;

        // Recalculate bounds relative to the element itself
        const rect = element.getBoundingClientRect();
        result.componentBounds = {
            x: rect.x + window.scrollX,
            y: rect.y + window.scrollY,
            width: rect.width,
            height: rect.height,
        };

        // Reset globalBounds to be relative to component origin
        if (result.globalBounds) {
            result.globalBounds = {
                x: 0,
                y: 0,
                width: rect.width,
                height: rect.height,
            };
        }
    }

    return result;
};

window.FigmaSerializer.serialize = function (rootNode = document.body) {

    // Check if an element has width: 100% or similar full-width behavior
    function hasFullWidth(el, computed) {
        // Check inline style for explicit 100%
        if (el.style && el.style.width === '100%') return true;

        // Check if element stretches to container width
        // Block elements naturally take 100% width
        const display = computed.display;
        if (display === 'block' || display === 'flex' || display === 'grid') {
            // Check if width is not explicitly constrained
            const width = computed.width;
            const maxWidth = computed.maxWidth;

            // If width is auto and no max-width constraint, it's full width
            if (width === 'auto' && (maxWidth === 'none' || !maxWidth)) {
                return true;
            }

            // Check if element is nearly as wide as parent
            const rect = el.getBoundingClientRect();
            const parent = el.parentElement;
            if (parent) {
                const parentRect = parent.getBoundingClientRect();
                const parentPadding = parseFloat(computed.paddingLeft) + parseFloat(computed.paddingRight);
                const availableWidth = parentRect.width - parentPadding;
                // If element width is >= 95% of available width, consider it full-width
                if (availableWidth > 0 && rect.width / availableWidth >= 0.95) {
                    return true;
                }
            }
        }

        return false;
    }

    function getRgb(color) {
        if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;
        // Match rgba with optional alpha: rgba(r, g, b, a) or rgb(r, g, b)
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            return {
                r: parseInt(match[1]) / 255,
                g: parseInt(match[2]) / 255,
                b: parseInt(match[3]) / 255,
                a: match[4] !== undefined ? parseFloat(match[4]) : 1,
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

        // Check for Gradient first (before URL check, as gradients may contain url())
        if (bgImage.includes('gradient')) {
            return { type: 'GRADIENT', raw: bgImage };
        }

        // Check for URL
        const urlMatch = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
        if (urlMatch) {
            const url = urlMatch[1];
            if (!url) return null;

            // Skip tiny placeholder data URIs (1x1 gif, etc.)
            if (url.startsWith('data:')) {
                if (url.length < 200) return null; // Too small, likely placeholder
                if (!url.startsWith('data:image/')) return null; // Not an image data URI
                return { type: 'IMAGE', url, size: computed.backgroundSize };
            }

            // Skip URLs that are clearly not images
            const urlLower = url.toLowerCase();
            const isLikelyNotImage = (
                urlLower.endsWith('.html') ||
                urlLower.endsWith('.htm') ||
                urlLower.endsWith('.php') ||
                urlLower.endsWith('.asp') ||
                urlLower.endsWith('.aspx') ||
                urlLower.endsWith('.jsp') ||
                urlLower.endsWith('.js') ||
                urlLower.endsWith('.css') ||
                urlLower.endsWith('.json') ||
                urlLower.endsWith('.xml')
            );

            if (isLikelyNotImage) {
                return null;
            }

            // Accept all other URLs - they may be images served from query-string endpoints
            // or dynamically served without extensions
            return { type: 'IMAGE', url, size: computed.backgroundSize };
        }

        return null;
    }

    // Helper to resolve CSS content value (handles attr(), counter(), quotes, etc.)
    function resolveCssContent(el, content) {
        if (!content) return '';
        
        let resolved = content;
        
        // Remove outer quotes if present
        if ((resolved.startsWith('"') && resolved.endsWith('"')) ||
            (resolved.startsWith("'") && resolved.endsWith("'"))) {
            resolved = resolved.slice(1, -1);
        }
        
        // Handle attr() - extracts attribute value from element
        // Example: content: attr(data-count) -> "5"
        const attrMatch = content.match(/attr\(\s*([a-zA-Z0-9_-]+)\s*\)/);
        if (attrMatch) {
            const attrValue = el.getAttribute(attrMatch[1]) || '';
            resolved = content.replace(attrMatch[0], attrValue);
            // Clean up quotes around the replacement
            if (resolved.startsWith('"') && resolved.endsWith('"')) {
                resolved = resolved.slice(1, -1);
            }
        }
        
        // Handle counter() - CSS counters are complex, we can provide a placeholder
        // Example: content: counter(item) -> "[counter]"
        if (content.includes('counter(') || content.includes('counters(')) {
            // Try to get the counter value from the element's counter state
            // This is a best-effort approach since counters are layout-dependent
            resolved = resolved.replace(/counter\([^)]+\)/g, '[#]');
            resolved = resolved.replace(/counters\([^)]+\)/g, '[#]');
        }
        
        // Handle open-quote and close-quote
        // These depend on the quotes property, defaulting to language-appropriate quotes
        if (content === 'open-quote') {
            resolved = '"';
        } else if (content === 'close-quote') {
            resolved = '"';
        } else if (content === 'no-open-quote' || content === 'no-close-quote') {
            resolved = '';
        }
        
        // Handle url() in content (icon fonts, images)
        // content: url(icon.svg) - we flag this as image content
        const urlMatch = content.match(/url\(['"]?([^'")\s]+)['"]?\)/);
        if (urlMatch) {
            return { type: 'URL', url: urlMatch[1] };
        }
        
        // Handle concatenated strings: "(" attr(title) ")"
        // The browser computes these, so we should have the resolved value
        
        // Handle escaped characters
        resolved = resolved.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (match, hex) => {
            return String.fromCodePoint(parseInt(hex, 16));
        });
        
        return resolved;
    }
    
    // Helper to estimate pseudo-element dimensions when not explicitly set
    function estimatePseudoDimensions(el, computed, content) {
        let width = parseUnit(computed.width) || 0;
        let height = parseUnit(computed.height) || 0;
        
        // If dimensions are 'auto' or 0, try to estimate
        if (width === 0 || computed.width === 'auto') {
            // For text content, estimate based on text length and font size
            if (content && typeof content === 'string' && content.trim()) {
                const fontSize = parseUnit(computed.fontSize) || 16;
                // Rough estimate: ~0.6em per character for average fonts
                width = content.length * fontSize * 0.6;
            }
            
            // For background images, check if we have explicit sizing
            if (computed.backgroundSize && computed.backgroundSize !== 'auto') {
                const bgSizeParts = computed.backgroundSize.split(/\s+/);
                if (bgSizeParts[0] && bgSizeParts[0] !== 'auto') {
                    width = parseUnit(bgSizeParts[0]) || width;
                }
            }
            
            // Use inline-size as fallback
            if (width === 0) {
                width = parseUnit(computed.inlineSize) || 0;
            }
        }
        
        if (height === 0 || computed.height === 'auto') {
            // For text content, use line-height or font-size
            if (content && typeof content === 'string' && content.trim()) {
                const lineHeight = parseUnit(computed.lineHeight);
                const fontSize = parseUnit(computed.fontSize) || 16;
                height = lineHeight || fontSize * 1.2;
            }
            
            // For background images, check if we have explicit sizing
            if (computed.backgroundSize && computed.backgroundSize !== 'auto') {
                const bgSizeParts = computed.backgroundSize.split(/\s+/);
                if (bgSizeParts[1] && bgSizeParts[1] !== 'auto') {
                    height = parseUnit(bgSizeParts[1]) || height;
                } else if (bgSizeParts[0] && bgSizeParts[0] !== 'auto') {
                    // Square if only one value given
                    height = parseUnit(bgSizeParts[0]) || height;
                }
            }
            
            // Use block-size as fallback
            if (height === 0) {
                height = parseUnit(computed.blockSize) || 0;
            }
        }
        
        return { width, height };
    }

    // Helper to extract pseudo-element (::before/::after)
    function getPseudoElement(el, pseudo) {
        // Note: Some environments (like JSDOM) don't support getComputedStyle with pseudo-elements
        let computed;
        try {
            computed = window.getComputedStyle(el, pseudo);
        } catch {
            return null; // Environment doesn't support pseudo-element styles
        }
        
        // Check if getComputedStyle returned null or is missing content property
        if (!computed || !computed.content) {
            return null;
        }
        
        const rawContent = computed.content;
        
        // Skip if no content or 'none'
        if (!rawContent || rawContent === 'none' || rawContent === 'normal' || rawContent === '""' || rawContent === "''") {
            return null;
        }

        // Check if the pseudo-element is visible
        if (computed.display === 'none' || computed.visibility === 'hidden' || computed.opacity === '0') {
            return null;
        }

        // Resolve the content value (handles attr(), counter(), quotes, etc.)
        const resolvedContent = resolveCssContent(el, rawContent);
        
        // Check if content is a URL (for image pseudo-elements)
        const isUrlContent = typeof resolvedContent === 'object' && resolvedContent.type === 'URL';
        const textContent = isUrlContent ? '' : resolvedContent;

        // Get dimensions with better estimation
        const dimensions = estimatePseudoDimensions(el, computed, textContent);
        const width = dimensions.width;
        const height = dimensions.height;

        // Check for background image (common for icon pseudo-elements)
        const bgImage = getBackground(computed);
        
        // If there's a background image or URL content, it's likely an icon pseudo-element
        const hasBackgroundContent = bgImage && (bgImage.type === 'IMAGE' || bgImage.type === 'GRADIENT');
        const hasUrlContent = isUrlContent;
        
        // Check for gradient backgrounds (decorative pseudo-elements)
        const hasGradientBackground = bgImage && bgImage.type === 'GRADIENT';
        
        // Skip if no visual content at all
        if (!textContent && !hasBackgroundContent && !hasUrlContent && width === 0 && height === 0) {
            return null;
        }

        const pseudoStyles = {
            width: width || 'auto',
            height: height || 'auto',
            display: computed.display,
            position: computed.position,
            top: parseUnit(computed.top),
            left: parseUnit(computed.left),
            right: parseUnit(computed.right),
            bottom: parseUnit(computed.bottom),
            zIndex: computed.zIndex === 'auto' ? 0 : parseInt(computed.zIndex),
            backgroundColor: getRgb(computed.backgroundColor),
            backgroundImage: bgImage,
            backgroundSize: computed.backgroundSize,
            backgroundPosition: computed.backgroundPosition,
            backgroundRepeat: computed.backgroundRepeat,
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
            letterSpacing: parseUnit(computed.letterSpacing),
            textTransform: computed.textTransform,
            opacity: parseFloat(computed.opacity) || 1,
            border: {
                width: parseUnit(computed.borderWidth),
                color: getRgb(computed.borderColor),
                style: computed.borderStyle
            },
            boxShadow: computed.boxShadow !== 'none' ? computed.boxShadow : null,
            transform: computed.transform !== 'none' ? computed.transform : null,
        };

        // Determine the type based on content
        if (hasUrlContent) {
            return {
                type: 'PSEUDO_ELEMENT',
                pseudo: pseudo,
                contentType: 'IMAGE',
                imageUrl: resolvedContent.url,
                styles: pseudoStyles,
            };
        } else if (textContent && textContent.trim()) {
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
                contentType: hasGradientBackground ? 'GRADIENT' : 'IMAGE',
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

            // Detect scrollable containers and use their full scroll dimensions
            // This handles: root element, sidedrawers, modal content, etc.
            const isRootElement = el === rootNode || el === document.body || el === document.documentElement;

            // Check if element is a scrollable container
            const isScrollableY = (computed.overflowY === 'auto' || computed.overflowY === 'scroll') &&
                                  el.scrollHeight > el.clientHeight;
            const isScrollableX = (computed.overflowX === 'auto' || computed.overflowX === 'scroll') &&
                                  el.scrollWidth > el.clientWidth;

            let elementHeight = rect.height;
            let elementWidth = rect.width;

            if (isRootElement || isScrollableY) {
                // Use scrollHeight to get the full content height, not just viewport
                elementHeight = Math.max(
                    el.scrollHeight,
                    el.offsetHeight,
                    rect.height
                );
            }

            if (isRootElement || isScrollableX) {
                // For width, use the larger of scrollWidth or rect.width
                elementWidth = Math.max(
                    el.scrollWidth,
                    el.offsetWidth,
                    rect.width
                );
            }

            const styles = {
                width: elementWidth,
                height: elementHeight,
                isFullWidth: hasFullWidth(el, computed), // Track if element should fill container width
                isScrollable: isScrollableX || isScrollableY, // Track if element is a scrollable container
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

                // CSS Grid - Container properties
                gridTemplateColumns: computed.gridTemplateColumns,
                gridTemplateRows: computed.gridTemplateRows,
                gridAutoColumns: computed.gridAutoColumns,
                gridAutoRows: computed.gridAutoRows,
                gridAutoFlow: computed.gridAutoFlow,
                columnGap: parseUnit(computed.columnGap),
                rowGap: parseUnit(computed.rowGap),
                
                // CSS Grid - Item properties (for child elements placed in grid)
                gridColumn: computed.gridColumn,
                gridColumnStart: computed.gridColumnStart,
                gridColumnEnd: computed.gridColumnEnd,
                gridRow: computed.gridRow,
                gridRowStart: computed.gridRowStart,
                gridRowEnd: computed.gridRowEnd,
                padding: {
                    top: parseUnit(computed.paddingTop),
                    right: parseUnit(computed.paddingRight),
                    bottom: parseUnit(computed.paddingBottom),
                    left: parseUnit(computed.paddingLeft),
                },
                margin: {
                    top: parseUnit(computed.marginTop),
                    right: parseUnit(computed.marginRight),
                    bottom: parseUnit(computed.marginBottom),
                    left: parseUnit(computed.marginLeft),
                },
                // Flex item properties (for children in flex containers)
                flexGrow: parseFloat(computed.flexGrow) || 0,
                flexShrink: parseFloat(computed.flexShrink) || 1,
                flexBasis: computed.flexBasis,
                alignSelf: computed.alignSelf,
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
                fontStyle: computed.fontStyle, // italic, normal, oblique
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
                textShadow: computed.textShadow !== 'none' ? computed.textShadow : null,
                letterSpacing: parseUnit(computed.letterSpacing),
                textTransform: computed.textTransform,
                textDecoration: computed.textDecorationLine, // computed style often splits decoration

                // Text layout - important for proper text rendering
                whiteSpace: computed.whiteSpace,
                wordBreak: computed.wordBreak,
                overflowWrap: computed.overflowWrap,
                textOverflow: computed.textOverflow,

                // Visual effects
                mixBlendMode: computed.mixBlendMode !== 'normal' ? computed.mixBlendMode : null,
                filter: computed.filter !== 'none' ? computed.filter : null,
                backdropFilter: computed.backdropFilter !== 'none' ? computed.backdropFilter : null,

                // Object fit for background images
                objectPosition: computed.objectPosition,

                overflowX: computed.overflowX,
                overflowY: computed.overflowY,
            };

            // Handling Images
            if (isImage) {
                // Get the best available image source
                // Priority: currentSrc (resolved from srcset) > data-src (lazy-load) > src
                let imageSrc = el.currentSrc || el.src;

                // Check for lazy-loading attributes (common patterns)
                if (!imageSrc || imageSrc.startsWith('data:image/gif') || imageSrc.startsWith('data:image/svg')) {
                    // Try common lazy-load attribute patterns
                    imageSrc = el.getAttribute('data-src') ||
                               el.getAttribute('data-lazy-src') ||
                               el.getAttribute('data-original') ||
                               el.getAttribute('data-srcset')?.split(',')[0]?.trim().split(' ')[0] ||
                               el.srcset?.split(',')[0]?.trim().split(' ')[0] ||
                               imageSrc;
                }

                // Skip placeholder data URIs (1x1 transparent GIF, etc.)
                const isPlaceholder = !imageSrc || (
                    imageSrc.startsWith('data:image/gif;base64,R0lGOD') ||
                    imageSrc.startsWith('data:image/svg+xml') ||
                    (imageSrc.length < 200 && imageSrc.startsWith('data:'))
                );

                // Skip placeholder images entirely - they have no visual content
                if (isPlaceholder) {
                    return null;
                }

                return {
                    type: 'IMAGE',
                    src: imageSrc,
                    boxShadow: computed.boxShadow !== 'none' ? computed.boxShadow : null, // Support shadow on img
                    objectFit: computed.objectFit, // cover, contain, fill, etc.
                    aspectRatio: computed.aspectRatio, // e.g., "16 / 9" or "auto"
                    // Natural image dimensions if available
                    naturalWidth: el.naturalWidth || null,
                    naturalHeight: el.naturalHeight || null,
                    styles,
                    tag: 'img'
                };
            }

            // Handling SVGs: Extract as editable vector data
            // Note: tagName can be uppercase or lowercase depending on the document type
            if (el.tagName.toUpperCase() === 'SVG') {
                const s = new XMLSerializer();
                let svgString = s.serializeToString(el);
                
                // Clone SVG and resolve <use> elements for better Figma compatibility
                // <use> elements reference other elements and may not serialize properly
                try {
                    const svgClone = el.cloneNode(true);
                    const useElements = svgClone.querySelectorAll('use');
                    
                    useElements.forEach(useEl => {
                        const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href');
                        if (href && href.startsWith('#')) {
                            // Internal reference - try to find and inline
                            const refId = href.slice(1);
                            const refEl = el.ownerDocument.getElementById(refId);
                            if (refEl) {
                                // Clone the referenced element and replace <use>
                                const clonedRef = refEl.cloneNode(true);
                                // Apply any transforms from the use element
                                const useTransform = useEl.getAttribute('transform');
                                const useX = useEl.getAttribute('x');
                                const useY = useEl.getAttribute('y');
                                
                                if (useTransform || useX || useY) {
                                    let transform = useTransform || '';
                                    if (useX || useY) {
                                        transform = `translate(${useX || 0}, ${useY || 0}) ${transform}`.trim();
                                    }
                                    if (transform) {
                                        clonedRef.setAttribute('transform', transform);
                                    }
                                }
                                
                                useEl.parentNode?.replaceChild(clonedRef, useEl);
                            }
                        }
                    });
                    
                    // Re-serialize with resolved uses
                    if (useElements.length > 0) {
                        svgString = s.serializeToString(svgClone);
                    }
                } catch {
                    // Continue with original string if resolution fails
                }
                
                // Extract fill color if uniform across the SVG
                // Handle 'currentColor' by using the inherited text color
                let svgFill = null;
                if (computed.fill && computed.fill !== 'none') {
                    svgFill = getRgb(computed.fill);
                }
                // If fill is currentColor or not set, use the text color from styles
                if (!svgFill && styles.color) {
                    svgFill = styles.color;
                }

                const svgStroke = computed.stroke !== 'none' ? getRgb(computed.stroke) : null;

                // Also capture the inherited text color for currentColor support
                const inheritedColor = getRgb(computed.color);

                // Return as VECTOR type with raw SVG string for Figma's createNodeFromSvg
                return {
                    type: 'VECTOR',
                    svgString: svgString,
                    svgFill: svgFill,
                    svgStroke: svgStroke,
                    inheritedColor: inheritedColor, // For currentColor resolution
                    viewBox: el.getAttribute('viewBox'),
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
