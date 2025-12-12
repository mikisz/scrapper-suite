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
  figma.ui.onmessage = (msg) => __async(this, null, function* () {
    if (msg.type === "build") {
      const rootData = msg.data;
      yield loadFonts();
      const frame = yield buildNode(rootData);
      if (frame) {
        figma.currentPage.appendChild(frame);
        figma.viewport.scrollAndZoomIntoView([frame]);
      }
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
  function buildNode(data) {
    return __async(this, null, function* () {
      var _a, _b, _c, _d;
      if (!data) return null;
      if (data.type === "TEXT_NODE" || data.type === "TEXT" && data.content) {
        const node = figma.createText();
        yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
        node.characters = data.content || "";
        if (data.fontSize) node.fontSize = data.fontSize;
        if (data.color) {
          node.fills = [{ type: "SOLID", color: data.color }];
        }
        if (data.width) node.resize(data.width, data.height || data.fontSize * 1.5);
        return node;
      }
      if (data.type === "FRAME") {
        const node = figma.createFrame();
        node.name = data.tag || "Frame";
        if (data.styles) {
          const s = data.styles;
          if (s.backgroundColor) {
            node.fills = [{ type: "SOLID", color: s.backgroundColor }];
          } else {
            node.fills = [];
          }
          if (s.borderRadius) {
            node.topLeftRadius = s.borderRadius.topLeft || 0;
            node.topRightRadius = s.borderRadius.topRight || 0;
            node.bottomRightRadius = s.borderRadius.bottomRight || 0;
            node.bottomLeftRadius = s.borderRadius.bottomLeft || 0;
          }
          if (s.display === "flex") {
            node.layoutMode = s.flexDirection === "row" ? "HORIZONTAL" : "VERTICAL";
            node.itemSpacing = s.gap || 0;
            node.paddingTop = ((_a = s.padding) == null ? void 0 : _a.top) || 0;
            node.paddingRight = ((_b = s.padding) == null ? void 0 : _b.right) || 0;
            node.paddingBottom = ((_c = s.padding) == null ? void 0 : _c.bottom) || 0;
            node.paddingLeft = ((_d = s.padding) == null ? void 0 : _d.left) || 0;
            switch (s.alignItems) {
              case "center":
                node.counterAxisAlignItems = "CENTER";
                break;
              case "flex-end":
                node.counterAxisAlignItems = "MAX";
                break;
              default:
                node.counterAxisAlignItems = "MIN";
            }
            switch (s.justifyContent) {
              case "center":
                node.primaryAxisAlignItems = "CENTER";
                break;
              case "space-between":
                node.primaryAxisAlignItems = "SPACE_BETWEEN";
                break;
              case "flex-end":
                node.primaryAxisAlignItems = "MAX";
                break;
              default:
                node.primaryAxisAlignItems = "MIN";
            }
          } else {
            node.layoutMode = "VERTICAL";
          }
          if (s.width && s.height) {
            node.resize(s.width, s.height);
          }
        }
        if (data.children) {
          for (const childData of data.children) {
            const childNode = yield buildNode(childData);
            if (childNode) {
              node.appendChild(childNode);
            }
          }
        }
        return node;
      }
      return null;
    });
  }
})();
