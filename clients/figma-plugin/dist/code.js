var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
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
  const imageCache = /* @__PURE__ */ new Map();
  function extractImageUrls(node, urls) {
    if (!node) return;
    if (node.type === "IMAGE" && node.src) {
      urls.add(node.src);
    }
    const styles = node.styles || {};
    if (styles.backgroundImage && styles.backgroundImage.type === "IMAGE" && styles.backgroundImage.url) {
      urls.add(styles.backgroundImage.url);
    }
    if (node.children) {
      for (const child of node.children) {
        extractImageUrls(child, urls);
      }
    }
  }
  function preloadImages(rootData) {
    return __async(this, null, function* () {
      const urls = /* @__PURE__ */ new Set();
      extractImageUrls(rootData, urls);
      if (urls.size === 0) return;
      console.log(`Preloading ${urls.size} images in parallel...`);
      const downloadPromises = Array.from(urls).map((url) => __async(this, null, function* () {
        const imageData = yield downloadImage(url);
        imageCache.set(url, imageData);
      }));
      yield Promise.all(downloadPromises);
      console.log(`Preloaded ${urls.size} images successfully`);
    });
  }
  figma.ui.onmessage = (msg) => __async(this, null, function* () {
    if (msg.type === "image-data") {
      const resolver = pendingImages[msg.id];
      if (resolver) resolver(msg.data ? msg.data : null);
      return;
    }
    if (msg.type === "build") {
      const rootData = msg.data;
      imageCache.clear();
      yield loadFonts(rootData);
      yield preloadImages(rootData);
      yield buildNode(rootData, figma.currentPage, void 0);
      figma.ui.postMessage({ type: "done" });
    }
  });
  const loadedFonts = /* @__PURE__ */ new Set();
  const FALLBACK_FONT = { family: "Inter", style: "Regular" };
  const FALLBACK_FONT_BOLD = { family: "Inter", style: "Bold" };
  function parseFontFamily(fontFamily) {
    if (!fontFamily) return FALLBACK_FONT.family;
    const fonts = fontFamily.split(",").map((f) => f.trim());
    let primary = fonts[0] || FALLBACK_FONT.family;
    primary = primary.replace(/^["']|["']$/g, "");
    const generics = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "-apple-system", "BlinkMacSystemFont"];
    if (generics.includes(primary.toLowerCase())) {
      return FALLBACK_FONT.family;
    }
    return primary;
  }
  function getFontStyle(weight) {
    const w = typeof weight === "string" ? parseInt(weight) || 400 : weight;
    if (w <= 100) return "Thin";
    if (w <= 200) return "ExtraLight";
    if (w <= 300) return "Light";
    if (w <= 400) return "Regular";
    if (w <= 500) return "Medium";
    if (w <= 600) return "SemiBold";
    if (w <= 700) return "Bold";
    if (w <= 800) return "ExtraBold";
    return "Black";
  }
  function tryLoadFont(family, weight) {
    return __async(this, null, function* () {
      const style = getFontStyle(weight);
      const fontKey = `${family}:${style}`;
      if (loadedFonts.has(fontKey)) {
        return { family, style };
      }
      try {
        yield figma.loadFontAsync({ family, style });
        loadedFonts.add(fontKey);
        return { family, style };
      } catch (e) {
        const styleVariations = ["Regular", "Medium", "Normal", "Book"];
        if (parseInt(String(weight)) >= 600) {
          styleVariations.unshift("Bold", "SemiBold", "DemiBold");
        }
        for (const altStyle of styleVariations) {
          const altKey = `${family}:${altStyle}`;
          if (loadedFonts.has(altKey)) {
            return { family, style: altStyle };
          }
          try {
            yield figma.loadFontAsync({ family, style: altStyle });
            loadedFonts.add(altKey);
            return { family, style: altStyle };
          } catch (e2) {
          }
        }
      }
      const fallback = parseInt(String(weight)) >= 600 ? FALLBACK_FONT_BOLD : FALLBACK_FONT;
      const fallbackKey = `${fallback.family}:${fallback.style}`;
      if (!loadedFonts.has(fallbackKey)) {
        yield figma.loadFontAsync(fallback);
        loadedFonts.add(fallbackKey);
      }
      return fallback;
    });
  }
  function extractFonts(node, fonts) {
    if (!node) return;
    const styles = node.styles || node;
    if (styles.fontFamily) {
      const family = parseFontFamily(styles.fontFamily);
      const weight = styles.fontWeight || "400";
      fonts.add(`${family}:${weight}`);
    }
    if (node.children) {
      for (const child of node.children) {
        extractFonts(child, fonts);
      }
    }
  }
  function loadFonts(rootData) {
    return __async(this, null, function* () {
      yield figma.loadFontAsync(FALLBACK_FONT);
      yield figma.loadFontAsync(FALLBACK_FONT_BOLD);
      loadedFonts.add(`${FALLBACK_FONT.family}:${FALLBACK_FONT.style}`);
      loadedFonts.add(`${FALLBACK_FONT_BOLD.family}:${FALLBACK_FONT_BOLD.style}`);
      if (rootData) {
        const fonts = /* @__PURE__ */ new Set();
        extractFonts(rootData, fonts);
        for (const fontKey of fonts) {
          const [family, weight] = fontKey.split(":");
          yield tryLoadFont(family, weight).catch(() => {
          });
        }
      }
    });
  }
  function parseBoxShadow(shadowStr) {
    var _a, _b, _c;
    if (!shadowStr || shadowStr === "none") return [];
    const effects = [];
    const shadows = shadowStr.split(/,(?![^()]*\))/);
    for (const shadow of shadows) {
      const s = shadow.trim();
      let color = { r: 0, g: 0, b: 0, a: 0.2 };
      let remaining = s;
      const colorMatch = s.match(/rgba?\(.*?\)/) || s.match(/#[a-fA-F0-9]{3,6}/);
      if (colorMatch) {
        remaining = s.replace(colorMatch[0], "").trim();
        if (colorMatch[0].startsWith("rgba")) {
          const numbers = (_a = colorMatch[0].match(/[\d.]+/g)) == null ? void 0 : _a.map(Number);
          if (numbers && numbers.length >= 3) {
            color = { r: numbers[0] / 255, g: numbers[1] / 255, b: numbers[2] / 255, a: (_b = numbers[3]) != null ? _b : 1 };
          }
        } else if (colorMatch[0].startsWith("rgb")) {
          const numbers = (_c = colorMatch[0].match(/[\d.]+/g)) == null ? void 0 : _c.map(Number);
          if (numbers && numbers.length >= 3) {
            color = { r: numbers[0] / 255, g: numbers[1] / 255, b: numbers[2] / 255, a: 1 };
          }
        }
      }
      const parts = remaining.split(/\s+/).map((p) => parseFloat(p));
      if (parts.length >= 2) {
        effects.push({
          type: "DROP_SHADOW",
          color,
          offset: { x: parts[0] || 0, y: parts[1] || 0 },
          radius: parts[2] || 0,
          spread: parts[3] || 0,
          visible: true,
          blendMode: "NORMAL"
        });
      }
    }
    return effects;
  }
  function getTextCase(transform) {
    if (transform === "uppercase") return "UPPER";
    if (transform === "lowercase") return "LOWER";
    if (transform === "capitalize") return "TITLE";
    return "ORIGINAL";
  }
  function getTextDecoration(decoration) {
    if (decoration && decoration.includes("underline")) return "UNDERLINE";
    if (decoration && decoration.includes("line-through")) return "STRIKETHROUGH";
    return "NONE";
  }
  function parseGradient(gradientStr) {
    if (!gradientStr || !gradientStr.includes("linear-gradient")) return null;
    const colors = [];
    const colorMatches = gradientStr.match(/rgba?\(.*?\)|#[a-fA-F0-9]{3,6}/g);
    if (colorMatches && colorMatches.length >= 2) {
      colorMatches.slice(0, 3).forEach((c) => {
        var _a, _b, _c;
        let r = 0, g = 0, b = 0;
        if (c.startsWith("rgba")) {
          const nums = (_a = c.match(/[\d.]+/g)) == null ? void 0 : _a.map(Number);
          if (nums && nums.length >= 3) {
            r = nums[0] / 255;
            g = nums[1] / 255;
            b = nums[2] / 255;
            (_b = nums[3]) != null ? _b : 1;
          }
        } else if (c.startsWith("rgb")) {
          const nums = (_c = c.match(/[\d.]+/g)) == null ? void 0 : _c.map(Number);
          if (nums && nums.length >= 3) {
            r = nums[0] / 255;
            g = nums[1] / 255;
            b = nums[2] / 255;
          }
        } else if (c.startsWith("#")) {
          if (c.length === 7) {
            r = parseInt(c.slice(1, 3), 16) / 255;
            g = parseInt(c.slice(3, 5), 16) / 255;
            b = parseInt(c.slice(5, 7), 16) / 255;
          }
        }
        colors.push({ r, g, b });
      });
    }
    if (colors.length < 2) return null;
    const stops = colors.map((c, i) => ({
      position: i / (colors.length - 1),
      color: __spreadProps(__spreadValues({}, c), { a: 1 })
      // Figma alpha usually 1 for gradient stops unless transparent gradient
    }));
    return {
      type: "GRADIENT_LINEAR",
      gradientStops: stops,
      gradientTransform: [[0, 1, 0], [-1, 0, 1]]
      // 90deg rotation approximately
    };
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
          const imageBytes = imageCache.get(data.src);
          if (imageBytes) {
            const imageHash = figma.createImage(imageBytes).hash;
            rect.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash }];
          }
        }
        if (s.boxShadow) {
          node.effects = parseBoxShadow(s.boxShadow);
        }
      } else if (data.type === "TEXT_NODE" || data.type === "TEXT" && data.content) {
        const text = figma.createText();
        node = text;
        const fontFamily = parseFontFamily(s.fontFamily);
        const fontWeight = s.fontWeight || "400";
        const loadedFont = yield tryLoadFont(fontFamily, fontWeight);
        text.fontName = loadedFont;
        text.characters = data.content || "";
        if (s.fontSize) text.fontSize = s.fontSize;
        if (s.color) {
          text.fills = [{ type: "SOLID", color: s.color }];
        }
        if (s.letterSpacing) {
          text.letterSpacing = { value: s.letterSpacing, unit: "PIXELS" };
        }
        if (s.textTransform) {
          text.textCase = getTextCase(s.textTransform);
        }
        if (s.textDecoration) {
          text.textDecoration = getTextDecoration(s.textDecoration);
        }
        if (s.boxShadow) {
          node.effects = parseBoxShadow(s.boxShadow);
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
          const bgBytes = imageCache.get(s.backgroundImage.url);
          if (bgBytes) {
            const bgHash = figma.createImage(bgBytes).hash;
            fills.push({ type: "IMAGE", scaleMode: "FILL", imageHash: bgHash });
          }
        } else if (s.backgroundImage && s.backgroundImage.type === "GRADIENT") {
          const gradient = parseGradient(s.backgroundImage.raw);
          if (gradient) fills.push(gradient);
        }
        frame.fills = fills.length > 0 ? fills : [];
        if (s.boxShadow) {
          frame.effects = parseBoxShadow(s.boxShadow);
        }
        if (s.border && s.border.width > 0 && s.border.color) {
          frame.strokes = [{ type: "SOLID", color: s.border.color }];
          frame.strokeWeight = s.border.width;
          frame.strokeAlign = "INSIDE";
        }
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
      if (parent.type !== "PAGE") {
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
