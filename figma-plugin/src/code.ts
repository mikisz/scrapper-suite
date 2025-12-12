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
        await loadFonts();
        // Create a temporary frame or just append to page?
        // Let's create the root node directly on page
        await buildNode(rootData, figma.currentPage, undefined);
        figma.ui.postMessage({ type: 'done' });
    }
};

async function loadFonts() {
    // Load common fonts just in case
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
}

// Main Build Function
async function buildNode(data: any, parent: SceneNode | PageNode, parentData?: any) {
    if (!data) return;

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
        // Size will be set later via resize/resizeWithoutConstraints
    }
    else if (data.type === 'TEXT_NODE' || (data.type === 'TEXT' && data.content)) {
        const text = figma.createText();
        node = text;
        await figma.loadFontAsync({ family: "Inter", style: "Regular" }); // Fallback
        text.characters = data.content || "";

        // Apply text styles if available (simplified)
        if (s.fontSize) text.fontSize = s.fontSize;
        if (s.color) {
            text.fills = [{ type: 'SOLID', color: s.color }];
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
        }
        frame.fills = fills.length > 0 ? fills : [];

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
    if (parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {
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
