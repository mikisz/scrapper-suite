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
  figma.showUI(__html__, { width: 300, height: 450 });
  let totalNodes = 0;
  let processedNodes = 0;
  let warnings = [];
  let errors = [];
  let isImporting = false;
  function sendProgress(stage, percent = null, detail = "", status = "") {
    figma.ui.postMessage({ type: "progress", stage, percent, detail, status });
  }
  function sendError(message, details) {
    console.error("Import Error:", message, details);
    figma.ui.postMessage({
      type: "error",
      message,
      details,
      suggestion: getErrorSuggestion(message)
    });
  }
  function sendWarning(message) {
    console.warn("Import Warning:", message);
    warnings.push(message);
  }
  function getErrorSuggestion(error) {
    if (error.includes("font")) {
      return "The font is not available in Figma. Using Inter as fallback.";
    }
    if (error.includes("image")) {
      return "Some images could not be loaded. They may be protected or unavailable.";
    }
    if (error.includes("SVG")) {
      return "Some SVGs could not be parsed. They are shown as placeholders.";
    }
    if (error.includes("size") || error.includes("resize")) {
      return "Some elements have invalid sizes and were skipped.";
    }
    return "Try using the Chrome Extension for protected pages.";
  }
  function toRGB(color) {
    if (!color) return null;
    return { r: color.r, g: color.g, b: color.b };
  }
  function countNodes(data) {
    if (!data) return 0;
    let count = 1;
    if (data.children) {
      for (const child of data.children) {
        count += countNodes(child);
      }
    }
    return count;
  }
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
    const styles = node.styles || node;
    if (styles.backgroundImage && styles.backgroundImage.type === "IMAGE" && styles.backgroundImage.url) {
      urls.add(styles.backgroundImage.url);
    }
    if (node.type === "PSEUDO_ELEMENT") {
      if (node.imageUrl) {
        urls.add(node.imageUrl);
      }
      if (styles.backgroundImage && styles.backgroundImage.type === "IMAGE" && styles.backgroundImage.url) {
        urls.add(styles.backgroundImage.url);
      }
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
      if (isImporting) {
        sendError("Import in progress", "Please wait for the current import to complete.");
        return;
      }
      isImporting = true;
      try {
        const rootData = msg.data;
        warnings = [];
        errors = [];
        if (!rootData) {
          sendError("No data to import", "The data object is empty or undefined.");
          return;
        }
        if (!rootData.type) {
          sendError("Invalid data format", `Expected a visual tree with a "type" field. Make sure you're using the Chrome Extension output.`);
          return;
        }
        totalNodes = countNodes(rootData);
        processedNodes = 0;
        if (totalNodes === 0) {
          sendError("Empty page", "The scraped page has no visible content. Try a different page.");
          return;
        }
        imageCache.clear();
        sendProgress("Loading fonts", 10, "", "Preparing fonts...");
        yield loadFonts(rootData);
        sendProgress("Loading fonts", 25, "", "Fonts ready");
        const urls = /* @__PURE__ */ new Set();
        extractImageUrls(rootData, urls);
        if (urls.size > 0) {
          sendProgress("Loading images", 30, `0/${urls.size} images`, "Downloading images in parallel...");
          yield preloadImages(rootData);
          const loadedCount = Array.from(imageCache.values()).filter((v) => v !== null).length;
          if (loadedCount < urls.size) {
            sendWarning(`${urls.size - loadedCount} of ${urls.size} images could not be loaded`);
          }
          sendProgress("Loading images", 50, `${loadedCount}/${urls.size} loaded`, "Images ready");
        }
        sendProgress("Building layout", 55, `0/${totalNodes} nodes`, "Creating Figma layers...");
        const rootNode = yield buildNode(rootData, figma.currentPage, void 0);
        if (rootNode) {
          figma.currentPage.selection = [rootNode];
          figma.viewport.scrollAndZoomIntoView([rootNode]);
        }
        const summary = {
          type: "done",
          stats: {
            totalNodes: processedNodes,
            imagesLoaded: Array.from(imageCache.values()).filter((v) => v !== null).length,
            totalImages: imageCache.size
          }
        };
        if (warnings.length > 0) {
          summary.warnings = warnings;
        }
        figma.ui.postMessage(summary);
      } catch (error) {
        console.error("Build error:", error);
        console.error("Error stack:", error.stack);
        sendError(
          "Failed to build layout",
          error.message || error.toString() || "An unexpected error occurred during import."
        );
      } finally {
        isImporting = false;
      }
    }
  });
  const loadedFonts = /* @__PURE__ */ new Set();
  const FALLBACK_FONT = { family: "Inter", style: "Regular" };
  const FALLBACK_FONT_BOLD = { family: "Inter", style: "Bold" };
  const FALLBACK_SERIF = { family: "Georgia", style: "Regular" };
  const FALLBACK_MONO = { family: "Roboto Mono", style: "Regular" };
  const FONT_MAP = {
    // System fonts → Figma equivalents
    "-apple-system": "SF Pro Text",
    "blinkmacsystemfont": "SF Pro Text",
    "system-ui": "Inter",
    "segoe ui": "Inter",
    // Sans-serif mappings
    "arial": "Inter",
    "helvetica": "Helvetica Neue",
    "helvetica neue": "Helvetica Neue",
    "verdana": "Inter",
    "tahoma": "Inter",
    "trebuchet ms": "Inter",
    "gill sans": "Inter",
    "avenir": "Inter",
    "avenir next": "Inter",
    "futura": "Inter",
    "century gothic": "Inter",
    "calibri": "Inter",
    "candara": "Inter",
    "optima": "Inter",
    "lucida grande": "Inter",
    "lucida sans": "Inter",
    // Serif mappings
    "times": "Times New Roman",
    "times new roman": "Times New Roman",
    "georgia": "Georgia",
    "palatino": "Georgia",
    "palatino linotype": "Georgia",
    "book antiqua": "Georgia",
    "baskerville": "Georgia",
    "garamond": "Georgia",
    "cambria": "Georgia",
    "didot": "Georgia",
    "bodoni": "Georgia",
    // Monospace mappings
    "courier": "Courier New",
    "courier new": "Courier New",
    "consolas": "Roboto Mono",
    "monaco": "Roboto Mono",
    "menlo": "Roboto Mono",
    "lucida console": "Roboto Mono",
    "source code pro": "Roboto Mono",
    "fira code": "Roboto Mono",
    "jetbrains mono": "Roboto Mono",
    "sf mono": "Roboto Mono",
    "andale mono": "Roboto Mono",
    // Popular Google Fonts (often available in Figma)
    "roboto": "Roboto",
    "open sans": "Open Sans",
    "lato": "Lato",
    "montserrat": "Montserrat",
    "oswald": "Oswald",
    "raleway": "Raleway",
    "poppins": "Poppins",
    "nunito": "Nunito",
    "playfair display": "Playfair Display",
    "merriweather": "Merriweather",
    "source sans pro": "Source Sans Pro",
    "pt sans": "PT Sans",
    "ubuntu": "Ubuntu",
    "noto sans": "Noto Sans",
    "work sans": "Work Sans",
    "rubik": "Rubik",
    "quicksand": "Quicksand",
    "karla": "Karla",
    "manrope": "Manrope",
    "dm sans": "DM Sans",
    "ibm plex sans": "IBM Plex Sans",
    "ibm plex mono": "IBM Plex Mono",
    "space mono": "Space Mono",
    "space grotesk": "Space Grotesk",
    "plus jakarta sans": "Plus Jakarta Sans"
  };
  function detectFontCategory(fontName) {
    const lower = fontName.toLowerCase();
    if (lower.includes("mono") || lower.includes("code") || lower.includes("console") || lower.includes("courier") || lower.includes("terminal")) {
      return "monospace";
    }
    if (lower.includes("serif") || lower.includes("times") || lower.includes("georgia") || lower.includes("garamond") || lower.includes("baskerville") || lower.includes("bodoni") || lower.includes("palatino") || lower.includes("cambria") || lower.includes("antiqua") || lower.includes("merriweather") || lower.includes("playfair") || lower.includes("didot")) {
      return "serif";
    }
    return "sans-serif";
  }
  function parseFontFamily(fontFamily) {
    if (!fontFamily) return FALLBACK_FONT.family;
    const fonts = fontFamily.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
    for (const font of fonts) {
      const lowerFont = font.toLowerCase();
      const generics = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"];
      if (generics.includes(lowerFont)) continue;
      if (FONT_MAP[lowerFont]) {
        return FONT_MAP[lowerFont];
      }
      return font;
    }
    return FALLBACK_FONT.family;
  }
  function getCategoryFallback(originalFont, weight) {
    const category = detectFontCategory(originalFont);
    const isBold = parseInt(String(weight)) >= 600;
    switch (category) {
      case "serif":
        return { family: FALLBACK_SERIF.family, style: isBold ? "Bold" : "Regular" };
      case "monospace":
        return { family: FALLBACK_MONO.family, style: isBold ? "Bold" : "Regular" };
      default:
        return isBold ? FALLBACK_FONT_BOLD : FALLBACK_FONT;
    }
  }
  function getFontStyle(weight, isItalic = false) {
    const w = typeof weight === "string" ? parseInt(weight) || 400 : weight;
    let style;
    if (w <= 100) style = "Thin";
    else if (w <= 200) style = "ExtraLight";
    else if (w <= 300) style = "Light";
    else if (w <= 400) style = "Regular";
    else if (w <= 500) style = "Medium";
    else if (w <= 600) style = "SemiBold";
    else if (w <= 700) style = "Bold";
    else if (w <= 800) style = "ExtraBold";
    else style = "Black";
    if (isItalic) {
      return style === "Regular" ? "Italic" : `${style} Italic`;
    }
    return style;
  }
  function tryLoadFont(family, weight, originalFamily, isItalic = false) {
    return __async(this, null, function* () {
      const style = getFontStyle(weight, isItalic);
      const fontKey = `${family}:${style}`;
      if (loadedFonts.has(fontKey)) {
        return { family, style };
      }
      try {
        yield figma.loadFontAsync({ family, style });
        loadedFonts.add(fontKey);
        return { family, style };
      } catch (e) {
        let styleVariations;
        if (isItalic) {
          styleVariations = ["Italic", "Regular Italic", "Medium Italic", "Oblique"];
          if (parseInt(String(weight)) >= 600) {
            styleVariations.unshift("Bold Italic", "SemiBold Italic");
          }
        } else {
          styleVariations = ["Regular", "Medium", "Normal", "Book"];
          if (parseInt(String(weight)) >= 600) {
            styleVariations.unshift("Bold", "SemiBold", "DemiBold");
          }
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
        if (isItalic) {
          try {
            return yield tryLoadFont(family, weight, originalFamily, false);
          } catch (e2) {
          }
        }
      }
      const lowerFamily = family.toLowerCase();
      const mappedFont = FONT_MAP[lowerFamily];
      if (mappedFont && mappedFont !== family) {
        try {
          return yield tryLoadFont(mappedFont, weight, originalFamily || family, isItalic);
        } catch (e) {
        }
      }
      const fallback = getCategoryFallback(originalFamily || family, weight);
      const fallbackKey = `${fallback.family}:${fallback.style}`;
      if (!loadedFonts.has(fallbackKey)) {
        try {
          yield figma.loadFontAsync(fallback);
          loadedFonts.add(fallbackKey);
        } catch (e) {
          const ultimateFallback = parseInt(String(weight)) >= 600 ? FALLBACK_FONT_BOLD : FALLBACK_FONT;
          const ultimateKey = `${ultimateFallback.family}:${ultimateFallback.style}`;
          if (!loadedFonts.has(ultimateKey)) {
            yield figma.loadFontAsync(ultimateFallback);
            loadedFonts.add(ultimateKey);
          }
          return ultimateFallback;
        }
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
    if (node.type === "PSEUDO_ELEMENT" && node.contentType === "TEXT" && styles.fontFamily) {
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
      const fallbackFonts = [
        FALLBACK_FONT,
        FALLBACK_FONT_BOLD,
        FALLBACK_SERIF,
        { family: FALLBACK_SERIF.family, style: "Bold" },
        FALLBACK_MONO,
        { family: FALLBACK_MONO.family, style: "Bold" }
      ];
      for (const font of fallbackFonts) {
        try {
          yield figma.loadFontAsync(font);
          loadedFonts.add(`${font.family}:${font.style}`);
        } catch (e) {
        }
      }
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
      let s = shadow.trim();
      const isInset = /\binset\b/i.test(s);
      if (isInset) {
        s = s.replace(/\binset\b/gi, "").trim();
      }
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
          type: isInset ? "INNER_SHADOW" : "DROP_SHADOW",
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
  function parseTextShadow(shadowStr) {
    var _a, _b, _c;
    if (!shadowStr || shadowStr === "none") return [];
    const effects = [];
    const shadows = shadowStr.split(/,(?![^()]*\))/);
    for (const shadow of shadows) {
      const s = shadow.trim();
      let color = { r: 0, g: 0, b: 0, a: 0.5 };
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
          spread: 0,
          // text-shadow doesn't have spread
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
  function getTextAlignHorizontal(align) {
    if (align === "center") return "CENTER";
    if (align === "right" || align === "end") return "RIGHT";
    if (align === "justify") return "JUSTIFIED";
    return "LEFT";
  }
  function parseLineHeight(value, fontSize) {
    if (!value || value === "normal") return null;
    const unitless = parseFloat(value);
    if (!isNaN(unitless) && !value.includes("px") && !value.includes("em") && !value.includes("%")) {
      return unitless * fontSize;
    }
    if (value.includes("px")) {
      return parseFloat(value) || null;
    }
    if (value.includes("em")) {
      return (parseFloat(value) || 1) * fontSize;
    }
    if (value.includes("%")) {
      return parseFloat(value) / 100 * fontSize;
    }
    return null;
  }
  function applyTransform(node, transform) {
    if (!transform || transform === "none") return;
    const supportsRotation = "rotation" in node;
    const matrixMatch = transform.match(/matrix\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (matrixMatch) {
      const [, a, b, c, d, tx, ty] = matrixMatch.map((v, i) => i === 0 ? v : parseFloat(v));
      const aNum = a, bNum = b;
      const rotationRad = Math.atan2(bNum, aNum);
      const rotationDeg = rotationRad * (180 / Math.PI);
      if (supportsRotation && Math.abs(rotationDeg) > 0.1) {
        node.rotation = -rotationDeg;
      }
      const txNum = tx, tyNum = ty;
      if (Math.abs(txNum) > 0.1 || Math.abs(tyNum) > 0.1) {
        node.x += txNum;
        node.y += tyNum;
      }
      return;
    }
    const rotateMatch = transform.match(/rotate\(\s*(-?[\d.]+)(deg|rad|turn)?\s*\)/);
    if (rotateMatch && supportsRotation) {
      let degrees = parseFloat(rotateMatch[1]);
      const unit = rotateMatch[2] || "deg";
      if (unit === "rad") degrees = degrees * (180 / Math.PI);
      else if (unit === "turn") degrees = degrees * 360;
      node.rotation = -degrees;
    }
    const translateMatch = transform.match(/translate\(\s*(-?[\d.]+)(?:px)?\s*(?:,\s*(-?[\d.]+)(?:px)?)?\s*\)/);
    if (translateMatch) {
      const tx = parseFloat(translateMatch[1]) || 0;
      const ty = parseFloat(translateMatch[2]) || 0;
      node.x += tx;
      node.y += ty;
    }
    const translateXMatch = transform.match(/translateX\(\s*(-?[\d.]+)(?:px)?\s*\)/);
    if (translateXMatch) {
      node.x += parseFloat(translateXMatch[1]) || 0;
    }
    const translateYMatch = transform.match(/translateY\(\s*(-?[\d.]+)(?:px)?\s*\)/);
    if (translateYMatch) {
      node.y += parseFloat(translateYMatch[1]) || 0;
    }
  }
  function parseGradientAngle(gradientStr) {
    let angle = 180;
    const degMatch = gradientStr.match(/linear-gradient\(\s*(-?\d+(?:\.\d+)?)\s*deg/i);
    if (degMatch) {
      angle = parseFloat(degMatch[1]);
      return angle;
    }
    const dirMatch = gradientStr.match(/linear-gradient\(\s*to\s+([^,]+)/i);
    if (dirMatch) {
      const direction = dirMatch[1].trim().toLowerCase();
      if (direction === "top") return 0;
      if (direction === "right") return 90;
      if (direction === "bottom") return 180;
      if (direction === "left") return 270;
      if (direction === "top right" || direction === "right top") return 45;
      if (direction === "bottom right" || direction === "right bottom") return 135;
      if (direction === "bottom left" || direction === "left bottom") return 225;
      if (direction === "top left" || direction === "left top") return 315;
    }
    return angle;
  }
  function angleToGradientTransform(angleDeg) {
    const angleRad = (angleDeg - 90) * (Math.PI / 180);
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    return [
      [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
      [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]
    ];
  }
  function parseColorString(colorStr) {
    var _a, _b, _c;
    let r = 0, g = 0, b = 0, a = 1;
    if (colorStr.startsWith("rgba")) {
      const nums = (_a = colorStr.match(/[\d.]+/g)) == null ? void 0 : _a.map(Number);
      if (nums && nums.length >= 3) {
        r = nums[0] / 255;
        g = nums[1] / 255;
        b = nums[2] / 255;
        a = (_b = nums[3]) != null ? _b : 1;
      }
    } else if (colorStr.startsWith("rgb")) {
      const nums = (_c = colorStr.match(/[\d.]+/g)) == null ? void 0 : _c.map(Number);
      if (nums && nums.length >= 3) {
        r = nums[0] / 255;
        g = nums[1] / 255;
        b = nums[2] / 255;
      }
    } else if (colorStr.startsWith("#")) {
      const hex = colorStr.slice(1);
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16) / 255;
        g = parseInt(hex[1] + hex[1], 16) / 255;
        b = parseInt(hex[2] + hex[2], 16) / 255;
      } else if (hex.length >= 6) {
        r = parseInt(hex.slice(0, 2), 16) / 255;
        g = parseInt(hex.slice(2, 4), 16) / 255;
        b = parseInt(hex.slice(4, 6), 16) / 255;
        if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
      }
    } else {
      return null;
    }
    return { r, g, b, a };
  }
  function extractGradientStops(gradientStr) {
    const colorStopRegex = /(rgba?\([^)]+\)|#[a-fA-F0-9]{3,8})(?:\s+(\d+(?:\.\d+)?%?))?/g;
    let match;
    const rawStops = [];
    while ((match = colorStopRegex.exec(gradientStr)) !== null) {
      const color = parseColorString(match[1]);
      if (!color) continue;
      rawStops.push({ color, position: match[2] ? parseFloat(match[2]) / 100 : void 0 });
    }
    if (rawStops.length < 2) return { stops: [], opacity: 1 };
    for (let i = 0; i < rawStops.length; i++) {
      if (rawStops[i].position === void 0) {
        if (i === 0) rawStops[i].position = 0;
        else if (i === rawStops.length - 1) rawStops[i].position = 1;
        else {
          const prevIdx = i - 1;
          let nextIdx = i + 1;
          while (nextIdx < rawStops.length && rawStops[nextIdx].position === void 0) nextIdx++;
          const prevPos = rawStops[prevIdx].position || 0;
          const nextPos = rawStops[nextIdx].position || 1;
          rawStops[i].position = prevPos + (nextPos - prevPos) * ((i - prevIdx) / (nextIdx - prevIdx));
        }
      }
    }
    const avgOpacity = rawStops.reduce((sum, s) => {
      var _a;
      return sum + ((_a = s.color.a) != null ? _a : 1);
    }, 0) / rawStops.length;
    const stops = rawStops.map((s) => {
      var _a;
      return {
        position: s.position || 0,
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: (_a = s.color.a) != null ? _a : 1 }
      };
    });
    return { stops, opacity: avgOpacity };
  }
  function parseRadialGradientPosition(gradientStr) {
    let x = 0.5, y = 0.5;
    const atMatch = gradientStr.match(/at\s+([^,)]+)/i);
    if (atMatch) {
      const parts = atMatch[1].trim().split(/\s+/);
      const parsePos = (val) => {
        if (val === "center") return 0.5;
        if (val === "left" || val === "top") return 0;
        if (val === "right" || val === "bottom") return 1;
        if (val.endsWith("%")) return parseFloat(val) / 100;
        return 0.5;
      };
      if (parts.length >= 2) {
        x = parsePos(parts[0]);
        y = parsePos(parts[1]);
      } else if (parts.length === 1) {
        const val = parts[0];
        if (val === "left") {
          x = 0;
        } else if (val === "right") {
          x = 1;
        } else if (val === "top") {
          y = 0;
        } else if (val === "bottom") {
          y = 1;
        } else {
          x = parsePos(val);
        }
      }
    }
    return { x, y };
  }
  function parseRadialGradientShape(gradientStr) {
    let isCircle = false;
    let scaleX = 1;
    let scaleY = 1;
    const shapeMatch = gradientStr.match(/radial-gradient\(\s*([^,]*?)(?:\s+at\s+|,)/i);
    const shapePart = shapeMatch ? shapeMatch[1].trim().toLowerCase() : "";
    if (shapePart.includes("circle")) {
      isCircle = true;
    }
    if (shapePart.includes("closest-side")) {
      scaleX = 0.5;
      scaleY = isCircle ? 0.5 : 0.5;
    } else if (shapePart.includes("closest-corner")) {
      scaleX = 0.707;
      scaleY = isCircle ? 0.707 : 0.707;
    } else if (shapePart.includes("farthest-side")) {
      scaleX = 1;
      scaleY = 1;
    } else if (shapePart.includes("farthest-corner")) {
      scaleX = 1.414;
      scaleY = isCircle ? 1.414 : 1.414;
    }
    const sizeMatch = shapePart.match(/(\d+(?:\.\d+)?)(px|%)\s*(\d+(?:\.\d+)?)?(px|%)?/);
    if (sizeMatch) {
      const size1 = parseFloat(sizeMatch[1]);
      const unit1 = sizeMatch[2];
      const size2 = sizeMatch[3] ? parseFloat(sizeMatch[3]) : size1;
      if (unit1 === "%") {
        scaleX = size1 / 100;
        scaleY = size2 / 100;
      } else {
        scaleX = size1 / 200;
        scaleY = size2 / 200;
      }
      if (!sizeMatch[3]) {
        isCircle = true;
        scaleY = scaleX;
      }
    }
    return { isCircle, scaleX, scaleY };
  }
  function parseRadialGradient(gradientStr) {
    if (!(gradientStr == null ? void 0 : gradientStr.includes("radial-gradient"))) return null;
    const { x, y } = parseRadialGradientPosition(gradientStr);
    const { scaleX, scaleY } = parseRadialGradientShape(gradientStr);
    const transform = [
      [scaleX, 0, x - scaleX / 2],
      [0, scaleY, y - scaleY / 2]
    ];
    const { stops, opacity } = extractGradientStops(gradientStr);
    if (stops.length < 2) return null;
    return { type: "GRADIENT_RADIAL", gradientStops: stops, gradientTransform: transform, opacity };
  }
  function parseLinearGradient(gradientStr) {
    if (!(gradientStr == null ? void 0 : gradientStr.includes("linear-gradient"))) return null;
    const angle = parseGradientAngle(gradientStr);
    const transform = angleToGradientTransform(angle);
    const { stops, opacity } = extractGradientStops(gradientStr);
    if (stops.length < 2) return null;
    return { type: "GRADIENT_LINEAR", gradientStops: stops, gradientTransform: transform, opacity };
  }
  function parseGradient(gradientStr) {
    if (!gradientStr) return null;
    if (gradientStr.includes("radial-gradient")) return parseRadialGradient(gradientStr);
    if (gradientStr.includes("linear-gradient")) return parseLinearGradient(gradientStr);
    return null;
  }
  function parseGridTemplate(template, containerSize = 0) {
    const result = {
      count: 0,
      tracks: [],
      hasAutoFit: false,
      hasAutoFill: false
    };
    if (!template || template === "none") {
      return result;
    }
    const repeatMatch = template.match(/repeat\(\s*(auto-fill|auto-fit|\d+)\s*,\s*(.+?)\s*\)/i);
    if (repeatMatch) {
      const repeatCount = repeatMatch[1];
      const repeatValue = repeatMatch[2].trim();
      if (repeatCount === "auto-fit") {
        result.hasAutoFit = true;
        const minmaxMatch = repeatValue.match(/minmax\(\s*(\d+)(?:px)?\s*,/);
        if (minmaxMatch && containerSize > 0) {
          const minWidth = parseInt(minmaxMatch[1]);
          result.count = Math.max(1, Math.floor(containerSize / minWidth));
        } else {
          result.count = 3;
        }
      } else if (repeatCount === "auto-fill") {
        result.hasAutoFill = true;
        const minmaxMatch = repeatValue.match(/minmax\(\s*(\d+)(?:px)?\s*,/);
        if (minmaxMatch && containerSize > 0) {
          const minWidth = parseInt(minmaxMatch[1]);
          result.count = Math.max(1, Math.floor(containerSize / minWidth));
        } else {
          result.count = 3;
        }
      } else {
        result.count = parseInt(repeatCount) || 1;
      }
      const trackInfo = parseTrackValue(repeatValue);
      for (let i = 0; i < result.count; i++) {
        result.tracks.push(trackInfo);
      }
      return result;
    }
    const tracks = splitGridTracks(template);
    for (const track of tracks) {
      const trackInfo = parseTrackValue(track);
      result.tracks.push(trackInfo);
    }
    result.count = result.tracks.length;
    return result;
  }
  function splitGridTracks(template) {
    const tracks = [];
    let current = "";
    let parenDepth = 0;
    for (const char of template) {
      if (char === "(") {
        parenDepth++;
        current += char;
      } else if (char === ")") {
        parenDepth--;
        current += char;
      } else if (char === " " && parenDepth === 0) {
        if (current.trim()) {
          tracks.push(current.trim());
        }
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim()) {
      tracks.push(current.trim());
    }
    return tracks;
  }
  function parseTrackValue(value) {
    const trimmed = value.trim();
    if (trimmed === "auto") {
      return { value: 0, unit: "auto" };
    }
    if (trimmed.startsWith("minmax")) {
      const match = trimmed.match(/minmax\(\s*(\d+)(?:px)?\s*,/);
      if (match) {
        return { value: parseInt(match[1]), unit: "minmax" };
      }
      return { value: 0, unit: "minmax" };
    }
    if (trimmed.endsWith("fr")) {
      return { value: parseFloat(trimmed) || 1, unit: "fr" };
    }
    if (trimmed.endsWith("px")) {
      return { value: parseFloat(trimmed) || 0, unit: "px" };
    }
    if (trimmed.endsWith("%")) {
      return { value: parseFloat(trimmed) || 0, unit: "px" };
    }
    const num = parseFloat(trimmed);
    if (!isNaN(num)) {
      return { value: num, unit: "px" };
    }
    return { value: 0, unit: "auto" };
  }
  function parseGridSpan(value) {
    if (!value || value === "auto") {
      return { start: 0, span: 1 };
    }
    const spanMatch = value.match(/span\s+(\d+)/);
    if (spanMatch) {
      return { start: 0, span: parseInt(spanMatch[1]) || 1 };
    }
    const slashMatch = value.match(/(\d+)\s*\/\s*(\d+)/);
    if (slashMatch) {
      const start = parseInt(slashMatch[1]) || 1;
      const end = parseInt(slashMatch[2]) || start + 1;
      return { start, span: end - start };
    }
    const startSpanMatch = value.match(/(\d+)\s*\/\s*span\s+(\d+)/);
    if (startSpanMatch) {
      return { start: parseInt(startSpanMatch[1]) || 1, span: parseInt(startSpanMatch[2]) || 1 };
    }
    const num = parseInt(value);
    if (!isNaN(num)) {
      return { start: num, span: 1 };
    }
    return { start: 0, span: 1 };
  }
  function buildNode(data, parent, parentData) {
    return __async(this, null, function* () {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A;
      if (!data) return;
      processedNodes++;
      if (processedNodes % 10 === 0 || processedNodes === totalNodes) {
        const percent = 30 + Math.round(processedNodes / totalNodes * 65);
        sendProgress("Building layout", percent, `${processedNodes}/${totalNodes} nodes`);
      }
      let node;
      const s = data.styles || data;
      if (data.type === "VECTOR") {
        let svgParsed = false;
        try {
          let cleanedSvg = data.svgString;
          cleanedSvg = cleanedSvg.replace(/\s*xmlns:xlink="[^"]*"/g, "");
          cleanedSvg = cleanedSvg.replace(/\s*class="[^"]*"/g, "");
          cleanedSvg = cleanedSvg.replace(/\s*data-[a-z-]+="[^"]*"/g, "");
          if (!cleanedSvg.includes('xmlns="')) {
            cleanedSvg = cleanedSvg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
          }
          cleanedSvg = cleanedSvg.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
          const svgNode = figma.createNodeFromSvg(cleanedSvg);
          svgNode.name = "SVG";
          node = svgNode;
          svgParsed = true;
          if (s.width && s.height && s.width > 0 && s.height > 0) {
            if (data.viewBox) {
              const viewBoxParts = data.viewBox.split(/\s+/).map(Number);
              if (viewBoxParts.length === 4) {
                const vbWidth = viewBoxParts[2];
                const vbHeight = viewBoxParts[3];
                const aspectRatio = vbWidth / vbHeight;
                const targetWidth = s.width;
                const targetHeight = s.height;
                if (targetWidth / targetHeight > aspectRatio) {
                  svgNode.resize(targetHeight * aspectRatio, targetHeight);
                } else {
                  svgNode.resize(targetWidth, targetWidth / aspectRatio);
                }
              } else {
                svgNode.resize(s.width, s.height);
              }
            } else {
              svgNode.resize(s.width, s.height);
            }
          }
          if (s.boxShadow) {
            svgNode.effects = parseBoxShadow(s.boxShadow);
          }
          if (data.svgFill && svgNode.children && svgNode.children.length <= 5) {
            try {
              const fillRgb = toRGB(data.svgFill);
              if (fillRgb) {
                for (const child of svgNode.findAll()) {
                  if ("fills" in child && child.fills) {
                    const fills = child.fills;
                    if (fills.length > 0 && fills[0].type === "SOLID") {
                      child.fills = [{
                        type: "SOLID",
                        color: fillRgb,
                        opacity: (_a = data.svgFill.a) != null ? _a : 1
                      }];
                    }
                  }
                }
              }
            } catch (e) {
            }
          }
        } catch (e) {
          svgParsed = false;
        }
        if (!svgParsed) {
          try {
            const pathMatch = data.svgString.match(/<path[^>]*d="([^"]+)"[^>]*>/);
            if (pathMatch) {
              const simpleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.width || 24} ${s.height || 24}"><path d="${pathMatch[1]}" fill="currentColor"/></svg>`;
              const svgNode = figma.createNodeFromSvg(simpleSvg);
              svgNode.name = "SVG (simplified)";
              node = svgNode;
              svgParsed = true;
              if (s.width && s.height) {
                svgNode.resize(s.width, s.height);
              }
            }
          } catch (e) {
          }
          if (!svgParsed) {
            console.warn("Failed to parse SVG, creating placeholder");
            const rect = figma.createRectangle();
            rect.name = "SVG (parse failed)";
            rect.fills = [{ type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.95 } }];
            rect.strokes = [{ type: "SOLID", color: { r: 0.8, g: 0.8, b: 0.8 } }];
            rect.strokeWeight = 1;
            rect.strokeAlign = "INSIDE";
            node = rect;
          }
        }
      } else if (data.type === "IMAGE") {
        const rect = figma.createRectangle();
        rect.name = "Image";
        node = rect;
        let imageLoaded = false;
        if (data.src) {
          const imageBytes = imageCache.get(data.src);
          if (imageBytes) {
            try {
              const imageHash = figma.createImage(imageBytes).hash;
              let scaleMode = "FILL";
              if (data.objectFit === "contain") {
                scaleMode = "FIT";
              } else if (data.objectFit === "none" || data.objectFit === "scale-down") {
                scaleMode = "CROP";
              }
              rect.fills = [{ type: "IMAGE", scaleMode, imageHash }];
              imageLoaded = true;
            } catch (e) {
              console.warn("Image format unsupported:", (_b = data.src) == null ? void 0 : _b.substring(0, 80), e);
            }
          } else {
            console.warn("Image not in cache:", (_c = data.src) == null ? void 0 : _c.substring(0, 80));
          }
        }
        if (!imageLoaded) {
          rect.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } }];
        }
        if (s.boxShadow) {
          node.effects = parseBoxShadow(s.boxShadow);
        }
      } else if (data.type === "PSEUDO_ELEMENT") {
        const pseudoName = data.pseudo === "::before" ? "Before" : "After";
        if (data.contentType === "TEXT" && data.content) {
          const text = figma.createText();
          node = text;
          text.name = `::${pseudoName.toLowerCase()}`;
          try {
            const fontFamily = parseFontFamily(s.fontFamily);
            const fontWeight = s.fontWeight || "400";
            const isItalic = s.fontStyle === "italic" || s.fontStyle === "oblique";
            const loadedFont = yield tryLoadFont(fontFamily, fontWeight, void 0, isItalic);
            text.fontName = loadedFont;
            text.characters = data.content;
            if (s.fontSize) text.fontSize = s.fontSize;
            if (s.color) {
              const rgb = toRGB(s.color);
              if (rgb) text.fills = [{ type: "SOLID", color: rgb, opacity: (_d = s.color.a) != null ? _d : 1 }];
            }
            if (s.letterSpacing) {
              text.letterSpacing = { value: s.letterSpacing, unit: "PIXELS" };
            }
            if (s.textTransform) {
              text.textCase = getTextCase(s.textTransform);
            }
            if (s.textShadow) {
              text.effects = parseTextShadow(s.textShadow);
            } else if (s.boxShadow) {
              text.effects = parseBoxShadow(s.boxShadow);
            }
          } catch (e) {
            console.warn("Pseudo-element text creation failed:", e);
            try {
              yield figma.loadFontAsync(FALLBACK_FONT);
              text.fontName = FALLBACK_FONT;
              text.characters = ((_e = data.content) == null ? void 0 : _e.replace(/[^\x00-\x7F]/g, "?")) || "?";
            } catch (fallbackErr) {
              console.warn("Fallback font load also failed:", fallbackErr);
            }
          }
        } else {
          const frame = figma.createFrame();
          frame.name = `::${pseudoName.toLowerCase()}`;
          node = frame;
          const fills = [];
          if (s.backgroundColor) {
            const bgAlpha = s.backgroundColor.a !== void 0 ? s.backgroundColor.a : 1;
            const finalOpacity = bgAlpha * ((_f = s.opacity) != null ? _f : 1);
            fills.push({ type: "SOLID", color: { r: s.backgroundColor.r, g: s.backgroundColor.g, b: s.backgroundColor.b }, opacity: finalOpacity });
          }
          if (data.imageUrl) {
            const imgBytes = imageCache.get(data.imageUrl);
            if (imgBytes) {
              try {
                const imgHash = figma.createImage(imgBytes).hash;
                fills.push({ type: "IMAGE", scaleMode: "FILL", imageHash: imgHash });
              } catch (e) {
                console.warn("Pseudo-element image format unsupported:", (_g = data.imageUrl) == null ? void 0 : _g.substring(0, 80));
                fills.push({ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } });
              }
            }
          } else if (s.backgroundImage && s.backgroundImage.type === "IMAGE") {
            const bgBytes = imageCache.get(s.backgroundImage.url);
            if (bgBytes) {
              try {
                const bgHash = figma.createImage(bgBytes).hash;
                let scaleMode = "FILL";
                const bgSize = s.backgroundImage.size || "";
                const bgRepeat = s.backgroundRepeat || "no-repeat";
                if (bgRepeat === "repeat" || bgRepeat === "repeat-x" || bgRepeat === "repeat-y") {
                  scaleMode = "TILE";
                } else if (bgSize === "contain") {
                  scaleMode = "FIT";
                }
                fills.push({ type: "IMAGE", scaleMode, imageHash: bgHash });
              } catch (e) {
                console.warn("Pseudo-element bg image format unsupported:", (_h = s.backgroundImage.url) == null ? void 0 : _h.substring(0, 80));
                fills.push({ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } });
              }
            }
          } else if (s.backgroundImage && s.backgroundImage.type === "GRADIENT") {
            const gradient = parseGradient(s.backgroundImage.raw);
            if (gradient) fills.push(gradient);
          }
          frame.fills = fills.length > 0 ? fills : [];
          if (s.borderRadius) {
            frame.topLeftRadius = s.borderRadius.topLeft || 0;
            frame.topRightRadius = s.borderRadius.topRight || 0;
            frame.bottomRightRadius = s.borderRadius.bottomRight || 0;
            frame.bottomLeftRadius = s.borderRadius.bottomLeft || 0;
          }
          if (s.boxShadow) {
            frame.effects = parseBoxShadow(s.boxShadow);
          }
          if (s.border && s.border.width > 0 && s.border.color) {
            const borderRgb = toRGB(s.border.color);
            if (borderRgb) {
              frame.strokes = [{ type: "SOLID", color: borderRgb, opacity: (_i = s.border.color.a) != null ? _i : 1 }];
              frame.strokeWeight = s.border.width;
              frame.strokeAlign = "INSIDE";
            }
          }
          if (s.width === "auto" || !s.width || s.width === 0) {
            if (data.contentType === "IMAGE" || data.contentType === "GRADIENT") {
              frame.resize(24, 24);
            }
          }
        }
      } else if (data.type === "TEXT_NODE" || data.type === "TEXT" && data.content) {
        const text = figma.createText();
        node = text;
        try {
          const fontFamily = parseFontFamily(s.fontFamily);
          const fontWeight = s.fontWeight || "400";
          const isItalic = s.fontStyle === "italic" || s.fontStyle === "oblique";
          const loadedFont = yield tryLoadFont(fontFamily, fontWeight, void 0, isItalic);
          text.fontName = loadedFont;
          const content = data.content || "";
          text.characters = content;
          if (s.fontSize) text.fontSize = s.fontSize;
          if (s.color) {
            const rgb = toRGB(s.color);
            if (rgb) text.fills = [{ type: "SOLID", color: rgb, opacity: (_j = s.color.a) != null ? _j : 1 }];
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
          if (s.textAlign) {
            text.textAlignHorizontal = getTextAlignHorizontal(s.textAlign);
          }
          if (s.lineHeight && s.fontSize) {
            const lineHeightPx = parseLineHeight(s.lineHeight, s.fontSize);
            if (lineHeightPx) {
              text.lineHeight = { value: lineHeightPx, unit: "PIXELS" };
            }
          }
          if (s.textShadow) {
            text.effects = parseTextShadow(s.textShadow);
          } else if (s.boxShadow) {
            text.effects = parseBoxShadow(s.boxShadow);
          }
        } catch (e) {
          console.warn("Text node creation failed:", e, "Content:", (_k = data.content) == null ? void 0 : _k.substring(0, 50));
          try {
            yield figma.loadFontAsync(FALLBACK_FONT);
            text.fontName = FALLBACK_FONT;
            text.characters = ((_l = data.content) == null ? void 0 : _l.replace(/[^\x00-\x7F]/g, "?")) || "?";
          } catch (fallbackErr) {
            console.warn("Fallback font load also failed:", fallbackErr);
          }
        }
      } else if (data.type === "FRAME") {
        const frame = figma.createFrame();
        node = frame;
        frame.name = data.tag || "Frame";
        const fills = [];
        if (s.backgroundColor) {
          const bgAlpha = s.backgroundColor.a !== void 0 ? s.backgroundColor.a : 1;
          const finalOpacity = bgAlpha * ((_m = s.opacity) != null ? _m : 1);
          fills.push({ type: "SOLID", color: { r: s.backgroundColor.r, g: s.backgroundColor.g, b: s.backgroundColor.b }, opacity: finalOpacity });
        }
        if (s.backgroundImage && s.backgroundImage.type === "IMAGE") {
          const bgBytes = imageCache.get(s.backgroundImage.url);
          if (bgBytes) {
            try {
              const bgHash = figma.createImage(bgBytes).hash;
              let scaleMode = "FILL";
              const bgSize = s.backgroundImage.size || "";
              const bgRepeat = s.backgroundRepeat || "no-repeat";
              if (bgRepeat === "repeat" || bgRepeat === "repeat-x" || bgRepeat === "repeat-y") {
                scaleMode = "TILE";
              } else if (bgSize === "contain") {
                scaleMode = "FIT";
              }
              fills.push({ type: "IMAGE", scaleMode, imageHash: bgHash });
            } catch (e) {
              console.warn("Frame bg image format unsupported:", (_n = s.backgroundImage.url) == null ? void 0 : _n.substring(0, 80));
              fills.push({ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } });
            }
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
          const borderRgb = toRGB(s.border.color);
          if (borderRgb) {
            frame.strokes = [{ type: "SOLID", color: borderRgb, opacity: (_o = s.border.color.a) != null ? _o : 1 }];
            frame.strokeWeight = s.border.width;
            frame.strokeAlign = "INSIDE";
          }
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
      if (s.width && s.height && "resize" in node) {
        try {
          node.resize(s.width, s.height);
        } catch (e) {
        }
      }
      if (parent.type !== "PAGE") {
        parent.appendChild(node);
      } else {
        parent.appendChild(node);
      }
      const isAbsolute = s.position === "absolute" || s.position === "fixed";
      if (isAbsolute) {
        if (parent.type !== "PAGE" && "layoutPositioning" in node) {
          try {
            node.layoutPositioning = "ABSOLUTE";
          } catch (e) {
          }
        }
        if (data.globalBounds && parentData && parentData.globalBounds) {
          node.x = data.globalBounds.x - parentData.globalBounds.x;
          node.y = data.globalBounds.y - parentData.globalBounds.y;
        } else {
          const marginLeft = ((_p = s.margin) == null ? void 0 : _p.left) || 0;
          const marginTop = ((_q = s.margin) == null ? void 0 : _q.top) || 0;
          node.x = (s.left || 0) + marginLeft;
          node.y = (s.top || 0) + marginTop;
        }
      }
      if (data.type === "FRAME" && node.type === "FRAME") {
        const frame = node;
        if (s.display === "grid") {
          const containerWidth = s.width || 0;
          const gridInfo = parseGridTemplate(s.gridTemplateColumns, containerWidth);
          const columns = gridInfo.count || 1;
          const paddingH = (((_r = s.padding) == null ? void 0 : _r.left) || 0) + (((_s = s.padding) == null ? void 0 : _s.right) || 0);
          const columnGap = s.columnGap || s.gap || 0;
          const availableWidth = containerWidth - paddingH;
          data._gridInfo = {
            columns,
            tracks: gridInfo.tracks,
            containerWidth: availableWidth,
            columnGap,
            rowGap: s.rowGap || s.gap || 0
          };
          if (columns > 1) {
            frame.layoutMode = "HORIZONTAL";
            frame.layoutWrap = "WRAP";
            gridInfo.tracks.length > 0 && gridInfo.tracks.every((t) => t.unit === "fr");
            gridInfo.tracks.length > 0 && gridInfo.tracks.every((t) => t.unit === "px");
          } else {
            frame.layoutMode = "VERTICAL";
          }
          frame.itemSpacing = columnGap;
          frame.counterAxisSpacing = s.rowGap || s.gap || 0;
          frame.paddingTop = ((_t = s.padding) == null ? void 0 : _t.top) || 0;
          frame.paddingRight = ((_u = s.padding) == null ? void 0 : _u.right) || 0;
          frame.paddingBottom = ((_v = s.padding) == null ? void 0 : _v.bottom) || 0;
          frame.paddingLeft = ((_w = s.padding) == null ? void 0 : _w.left) || 0;
          const alignItems = s.alignItems || "stretch";
          switch (alignItems) {
            case "center":
              frame.counterAxisAlignItems = "CENTER";
              break;
            case "end":
            case "flex-end":
              frame.counterAxisAlignItems = "MAX";
              break;
            case "start":
            case "flex-start":
              frame.counterAxisAlignItems = "MIN";
              break;
            default:
              frame.counterAxisAlignItems = "MIN";
          }
          const justifyContent = s.justifyContent || "start";
          switch (justifyContent) {
            case "center":
              frame.primaryAxisAlignItems = "CENTER";
              break;
            case "space-between":
              frame.primaryAxisAlignItems = "SPACE_BETWEEN";
              break;
            case "space-around":
            case "space-evenly":
              frame.primaryAxisAlignItems = "SPACE_BETWEEN";
              break;
            case "end":
            case "flex-end":
              frame.primaryAxisAlignItems = "MAX";
              break;
            default:
              frame.primaryAxisAlignItems = "MIN";
          }
        } else if (s.display === "flex") {
          frame.layoutMode = s.flexDirection === "row" ? "HORIZONTAL" : "VERTICAL";
          if (s.flexWrap === "wrap" || s.flexWrap === "wrap-reverse") {
            frame.layoutWrap = "WRAP";
            frame.counterAxisSpacing = s.rowGap || s.gap || 0;
          }
          frame.itemSpacing = s.columnGap || s.gap || 0;
          frame.paddingTop = ((_x = s.padding) == null ? void 0 : _x.top) || 0;
          frame.paddingRight = ((_y = s.padding) == null ? void 0 : _y.right) || 0;
          frame.paddingBottom = ((_z = s.padding) == null ? void 0 : _z.bottom) || 0;
          frame.paddingLeft = ((_A = s.padding) == null ? void 0 : _A.left) || 0;
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
          const childNode = yield buildNode(childData, node, data);
          if (childNode && (s.display === "flex" || s.display === "inline-flex") && "layoutGrow" in childNode) {
            const childStyles = childData.styles || childData;
            if (childStyles.flexGrow && childStyles.flexGrow > 0) {
              try {
                childNode.layoutGrow = childStyles.flexGrow;
              } catch (e) {
              }
            }
            if (childStyles.alignSelf && childStyles.alignSelf !== "auto") {
              try {
                const alignMap = {
                  "flex-start": "MIN",
                  "start": "MIN",
                  "center": "CENTER",
                  "flex-end": "MAX",
                  "end": "MAX",
                  "stretch": "STRETCH"
                };
                const layoutAlign = alignMap[childStyles.alignSelf];
                if (layoutAlign) {
                  childNode.layoutAlign = layoutAlign;
                }
              } catch (e) {
              }
            }
          }
          if (childNode && s.display === "grid" && data._gridInfo) {
            const gridInfo = data._gridInfo;
            const childStyles = childData.styles || {};
            const colSpan = parseGridSpan(childStyles.gridColumn || childStyles.gridColumnStart);
            const actualSpan = Math.min(colSpan.span, gridInfo.columns);
            if (gridInfo.tracks.length > 0 && childNode.type === "FRAME") {
              const totalFr = gridInfo.tracks.reduce((sum, t) => t.unit === "fr" ? sum + t.value : sum, 0);
              const totalPx = gridInfo.tracks.reduce((sum, t) => t.unit === "px" ? sum + t.value : sum, 0);
              const totalGaps = (gridInfo.columns - 1) * gridInfo.columnGap;
              const availableForFr = gridInfo.containerWidth - totalPx - totalGaps;
              let itemWidth = 0;
              const startIdx = colSpan.start > 0 ? colSpan.start - 1 : 0;
              for (let i = 0; i < actualSpan && i < gridInfo.tracks.length; i++) {
                const track = gridInfo.tracks[startIdx + i];
                if (!track) continue;
                if (track.unit === "fr") {
                  itemWidth += track.value / totalFr * availableForFr;
                } else if (track.unit === "px") {
                  itemWidth += track.value;
                } else if (track.unit === "minmax") {
                  itemWidth += track.value || availableForFr / gridInfo.columns;
                } else {
                  itemWidth += availableForFr / gridInfo.columns;
                }
                if (i > 0) {
                  itemWidth += gridInfo.columnGap;
                }
              }
              if (itemWidth > 0) {
                try {
                  const currentHeight = childNode.height || 100;
                  childNode.resize(Math.max(1, itemWidth), Math.max(1, currentHeight));
                } catch (e) {
                }
              }
            }
          }
        }
      }
      if (s.transform) {
        applyTransform(node, s.transform);
      }
      return node;
    });
  }
})();
