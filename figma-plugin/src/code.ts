/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 300, height: 400 });

figma.ui.onmessage = async (msg) => {
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

    if (data.type === 'FRAME') {
        const node = figma.createFrame();
        node.name = data.tag || 'Frame';

        // Visuals
        if (data.styles) {
            const s = data.styles;
            if (s.backgroundColor) {
                node.fills = [{ type: 'SOLID', color: s.backgroundColor }];
            } else {
                node.fills = []; // Transparent by default
            }

            // Radius
            if (s.borderRadius) {
                node.topLeftRadius = s.borderRadius.topLeft || 0;
                node.topRightRadius = s.borderRadius.topRight || 0;
                node.bottomRightRadius = s.borderRadius.bottomRight || 0;
                node.bottomLeftRadius = s.borderRadius.bottomLeft || 0;
            }

            // AutoLayout
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
                // Fallback or Block layout
                // For now, simpler to just use AutoLayout VERTICAL for blocks
                node.layoutMode = 'VERTICAL';
            }

            // Resize
            // Note: In AutoLayout, width/height can be fixed or hug.
            // For this raw import, let's try fixed first if we have dimensions.
            if (s.width && s.height) {
                node.resize(s.width, s.height);
            }
        }

        // Children
        if (data.children) {
            for (const childData of data.children) {
                const childNode = await buildNode(childData);
                if (childNode) {
                    node.appendChild(childNode);
                }
            }
        }

        return node;
    }

    return null;
}
