var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
(function() {
  "use strict";
  figma.showUI(__html__, { width: 300, height: 400 });
  function downloadImage(url) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).substring(7);
      pendingImages[id] = resolve;
      figma.ui.postMessage({ type: "fetch-image", url, id });
      setTimeout(() => {
        if (pendingImages[id]) {
          delete pendingImages[id];
          resolve(null);
        }
      }, 5e3);
    });
  }
  const pendingImages = {};
  figma.ui.onmessage = (msg) => __async(this, null, function* () {
    if (msg.type === "image-data") {
      const resolver = pendingImages[msg.id];
      if (resolver) resolver(msg.data ? msg.data : null);
      return;
    }
    if (msg.type === "build") {
      const rootData = msg.data;
      yield loadFonts();
      yield buildNode(rootData, figma.currentPage, void 0);
      figma.ui.postMessage({ type: "done" });
    }
  });
  function loadFonts() {
    return __async(this, null, function* () {
      yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
      yield figma.loadFontAsync({ family: "Inter", style: "Bold" });
      yield figma.loadFontAsync({ family: "Roboto", style: "Regular" });
    });
  }
  function buildNode(data, parent, parentData) {
    return __async(this, null, function* () {
      var _a, _b, _c, _d;
      if (!data) return;
      let node;
      const s = data.styles || {};
      if (data.type === "IMAGE") {
        const rect = figma.createRectangle();
        rect.name = "Image";
        node = rect;
        if (data.src) {
          const imageBytes = yield downloadImage(data.src);
          if (imageBytes) {
            const imageHash = figma.createImage(imageBytes).hash;
            rect.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash }];
          }
        }
      } else if (data.type === "TEXT_NODE" || data.type === "TEXT" && data.content) {
        const text = figma.createText();
        node = text;
        yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
        text.characters = data.content || "";
        if (s.fontSize) text.fontSize = s.fontSize;
        if (s.color) {
          text.fills = [{ type: "SOLID", color: s.color }];
        }
      } else if (data.type === "FRAME") {
        const frame = figma.createFrame();
        node = frame;
        frame.name = data.tag || "Frame";
        const fills = [];
        if (s.backgroundColor) {
          fills.push({ type: "SOLID", color: s.backgroundColor, opacity: s.opacity });
        }
        if (s.backgroundImage && s.backgroundImage.type === "IMAGE") {
          const bgBytes = yield downloadImage(s.backgroundImage.url);
          if (bgBytes) {
            const bgHash = figma.createImage(bgBytes).hash;
            fills.push({ type: "IMAGE", scaleMode: "FILL", imageHash: bgHash });
          }
        }
        frame.fills = fills.length > 0 ? fills : [];
        if (s.overflowX === "hidden" || s.overflowY === "hidden") {
          frame.clipsContent = true;
        } else {
          frame.clipsContent = false;
        }
        if (s.borderRadius) {
          frame.topLeftRadius = s.borderRadius.topLeft || 0;
          frame.topRightRadius = s.borderRadius.topRight || 0;
          frame.bottomRightRadius = s.borderRadius.bottomRight || 0;
          frame.bottomLeftRadius = s.borderRadius.bottomLeft || 0;
        }
      } else {
        return;
      }
      if (s.width && s.height) {
        node.resize(s.width, s.height);
      }
      if (parent.type !== "PAGE" && parent.type !== "DOCUMENT") {
        parent.appendChild(node);
      } else {
        parent.appendChild(node);
      }
      const isAbsolute = s.position === "absolute" || s.position === "fixed";
      if (isAbsolute) {
        if (parent.type !== "PAGE") {
          node.layoutPositioning = "ABSOLUTE";
        }
        if (data.globalBounds && parentData && parentData.globalBounds) {
          node.x = data.globalBounds.x - parentData.globalBounds.x;
          node.y = data.globalBounds.y - parentData.globalBounds.y;
        } else {
          node.x = s.left || 0;
          node.y = s.top || 0;
        }
      }
      if (data.type === "FRAME" && node.type === "FRAME") {
        const frame = node;
        if (s.display === "flex") {
          frame.layoutMode = s.flexDirection === "row" ? "HORIZONTAL" : "VERTICAL";
          frame.itemSpacing = s.gap || 0;
          frame.paddingTop = ((_a = s.padding) == null ? void 0 : _a.top) || 0;
          frame.paddingRight = ((_b = s.padding) == null ? void 0 : _b.right) || 0;
          frame.paddingBottom = ((_c = s.padding) == null ? void 0 : _c.bottom) || 0;
          frame.paddingLeft = ((_d = s.padding) == null ? void 0 : _d.left) || 0;
          switch (s.alignItems) {
            case "center":
              frame.counterAxisAlignItems = "CENTER";
              break;
            case "flex-end":
              frame.counterAxisAlignItems = "MAX";
              break;
            default:
              frame.counterAxisAlignItems = "MIN";
          }
          switch (s.justifyContent) {
            case "center":
              frame.primaryAxisAlignItems = "CENTER";
              break;
            case "space-between":
              frame.primaryAxisAlignItems = "SPACE_BETWEEN";
              break;
            case "flex-end":
              frame.primaryAxisAlignItems = "MAX";
              break;
            default:
              frame.primaryAxisAlignItems = "MIN";
          }
        } else {
          frame.layoutMode = "VERTICAL";
        }
      }
      if (data.children) {
        for (const childData of data.children) {
          yield buildNode(childData, node, data);
        }
      }
      return node;
    });
  }
})();
