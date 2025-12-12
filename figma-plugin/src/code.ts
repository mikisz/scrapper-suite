/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 300, height: 400 });


// Helper to request image from UI and wait for response
function downloadImage(url: string): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
        const id = Math.random().toString(36).substring(7);

        // Handler for the response
        const handler = (msg: any) => {
            if (msg.type === 'image-data' && msg.id === id) {
                // Remove listener
                // Note: In strict Figma environment, we might need a more robust listener management, 
                // but for this plugin scope, simple onmessage checking in the main loop is tricky.
                // Actually, figma.ui.onmessage is a global listener. We need to hook into it.
                // Ideally we'd have a global event bus.
                // For simplicity, let's assume we modify the main onmessage to dispatch here.
                // BUT, redefining onmessage inside a function is bad.

                // REFACTOR: We'll attach the resolver to a global map.
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
const originalOnMessage = figma.ui.onmessage;
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
        await loadFonts();
        const frame = await buildNode(rootData);
        if (frame) {
            figma.currentPage.appendChild(frame);
            figma.viewport.scrollAndZoomIntoView([frame]);
        }
        figma.ui.postMessage({ type: 'done' });
    }
};

async function loadFonts() {
    // Load common fonts just in case
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
}

async function buildNode(data: any): Promise<SceneNode | null> {
    if (!data) return null;

    // --- 1. HANDLING IMAGES (Tag <img />) ---
    if (data.type === 'IMAGE') {
        const node = figma.createRectangle();
        node.name = 'Image';
        if (data.styles) {
            const s = data.styles;
            if (s.width && s.height) node.resize(s.width, s.height);

            // Download Image
            if (data.src) {
                const imageBytes = await downloadImage(data.src);
                if (imageBytes) {
                    const imageHash = figma.createImage(imageBytes).hash;
                    node.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash }];
                }
            }
        }
        return node;
    }


    // --- 2. HANDLING TEXT ---
    if (data.type === 'TEXT_NODE' || (data.type === 'TEXT' && data.content)) {
        const node = figma.createText();
        await figma.loadFontAsync({ family: "Inter", style: "Regular" }); // Fallback
        node.characters = data.content || "";

        // Apply text styles if available (simplified)
        if (data.fontSize) node.fontSize = data.fontSize;
        if (data.color) {
            node.fills = [{ type: 'SOLID', color: data.color }];
        }

        // Position/Size if available (though AutoLayout usually handles this)
        if (data.width) node.resize(data.width, data.height || data.fontSize * 1.5);

        return node;
    }

    // --- 3. HANDLING FRAMES (Divs, sections, etc) ---
    if (data.type === 'FRAME') {
        const node = figma.createFrame();
        node.name = data.tag || 'Frame';

        const s = data.styles || {};

        // BACKGROUNDS (Solid & Image)
        const fills: Paint[] = [];
        if (s.backgroundColor) {
            fills.push({ type: 'SOLID', color: s.backgroundColor, opacity: s.opacity });
        }
        if (s.backgroundImage && s.backgroundImage.type === 'IMAGE') {
            // We can try to download background images too!
            const bgBytes = await downloadImage(s.backgroundImage.url);
            if (bgBytes) {
                const bgHash = figma.createImage(bgBytes).hash;
                fills.push({ type: 'IMAGE', scaleMode: 'FILL', imageHash: bgHash });
            }
        }
        node.fills = fills.length > 0 ? fills : []; // Transparent if empty


        // Radius
        if (s.borderRadius) {
            node.topLeftRadius = s.borderRadius.topLeft || 0;
            node.topRightRadius = s.borderRadius.topRight || 0;
            node.bottomRightRadius = s.borderRadius.bottomRight || 0;
            node.bottomLeftRadius = s.borderRadius.bottomLeft || 0;
        }

        // --- POSITIONING: Absolute vs AutoLayout ---
        const isAbsolute = s.position === 'absolute' || s.position === 'fixed';

        if (isAbsolute) {
            // For absolute nodes, we don't set AutoLayout on the node itself usually, 
            // OR we set it but it will be placed absolutely inside its parent.
            // Note: In Figma, layoutPositioning is set on the CHILD, not the parent.
            // But we are creating the node here. 
            // When we append this node to its parent later, we must set layoutPositioning.
            // We'll store a meta property or just handle it after creation?
            // Actually, we can set layoutPositioning 'ABSOLUTE' immediately if it has a parent? 
            // No, it needs a parent first to be valid in some contexts, but let's try.
            // Wait, we return the node here. The caller (parent recursion) appends it.
            // So the PARENT loop needs to handle this?
            // NO! We can set `node.layoutPositioning = "ABSOLUTE"` *after* it's appended.
            // But we are inside the recursive buildNode.

            // Strategy: We will proceed with AutoLayout config for the frame's *internal* children,
            // but return a specific flag or just rely on the parent checking style data?
            // Actually, `layoutPositioning` is a property of the node. We can set it.
            // But it only applies if parent is AutoLayout.

            // Let's set the frame size explicitly for absolute nodes
            if (s.width && s.height) node.resize(s.width, s.height);

            // We also need to Apply X/Y coordinates if absolute
            node.x = s.left || 0;
            node.y = s.top || 0;
        }

        // AutoLayout (If not absolute, or even if absolute, it can have auto-layout children)
        if (s.display === 'flex') {
            node.layoutMode = s.flexDirection === 'row' ? 'HORIZONTAL' : 'VERTICAL';
            node.itemSpacing = s.gap || 0;
            node.paddingTop = s.padding?.top || 0;
            node.paddingRight = s.padding?.right || 0;
            node.paddingBottom = s.padding?.bottom || 0;
            node.paddingLeft = s.padding?.left || 0;

            // Alignment
            switch (s.alignItems) {
                case 'center': node.counterAxisAlignItems = 'CENTER'; break;
                case 'flex-end': node.counterAxisAlignItems = 'MAX'; break;
                default: node.counterAxisAlignItems = 'MIN';
            }
            switch (s.justifyContent) {
                case 'center': node.primaryAxisAlignItems = 'CENTER'; break;
                case 'space-between': node.primaryAxisAlignItems = 'SPACE_BETWEEN'; break;
                case 'flex-end': node.primaryAxisAlignItems = 'MAX'; break;
                default: node.primaryAxisAlignItems = 'MIN';
            }
        } else {
            // Block Layout default
            node.layoutMode = 'VERTICAL';
        }


        // Children
        if (data.children) {
            for (const childData of data.children) {
                const childNode = await buildNode(childData);
                if (childNode) {
                    node.appendChild(childNode);

                    // Check if child should be absolute
                    // We need to look at childData.styles.position
                    if (childData.styles && (childData.styles.position === 'absolute' || childData.styles.position === 'fixed')) {
                        if ('layoutPositioning' in childNode) {
                            (childNode as any).layoutPositioning = 'ABSOLUTE';
                        }
                        childNode.x = childData.styles.left || 0;
                        childNode.y = childData.styles.top || 0;

                        // Fix constraints?
                        // childNode.constraints = { horizontal: 'MIN', vertical: 'MIN' };
                    }
                }
            }
        }

        return node;
    }

    return null;
}
