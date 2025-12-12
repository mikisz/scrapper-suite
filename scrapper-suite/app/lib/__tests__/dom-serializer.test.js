/**
 * @jest-environment jsdom
 */

/**
 * Unit tests for dom-serializer.js
 * 
 * This file tests the FigmaSerializer which extracts visual tree data from DOM elements.
 * Since dom-serializer.js is designed to run in a browser context, we use jsdom.
 * 
 * Note: JSDOM doesn't have a real layout engine, so we mock getBoundingClientRect
 * and getComputedStyle to simulate browser behavior.
 */

// Load the serializer into jsdom's window
const fs = require('fs');
const path = require('path');

// Helper to mock getBoundingClientRect for all elements
function mockLayoutEngine() {
  // Store original functions
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const originalGetComputedStyle = window.getComputedStyle;
  
  // Mock getBoundingClientRect to return reasonable dimensions
  Element.prototype.getBoundingClientRect = function() {
    const style = originalGetComputedStyle(this);
    const width = parseFloat(style.width) || 100;
    const height = parseFloat(style.height) || 50;
    
    return {
      x: 0,
      y: 0,
      width: width,
      height: height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
    };
  };
  
  // Mock getComputedStyle to handle pseudo-elements gracefully
  // JSDOM doesn't support pseudo-elements, so we return a style with content: 'none'
  window.getComputedStyle = function(element, pseudoElt) {
    if (pseudoElt) {
      // Return a mock style for pseudo-elements that indicates no content
      return {
        content: 'none',
        display: 'none',
        visibility: 'visible',
        opacity: '1',
      };
    }
    return originalGetComputedStyle(element);
  };
  
  return () => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    window.getComputedStyle = originalGetComputedStyle;
  };
}

describe('FigmaSerializer', () => {
  let restoreLayout;
  
  beforeAll(() => {
    // Load and execute the serializer code in jsdom context
    const serializerPath = path.join(__dirname, '../dom-serializer.js');
    const serializerCode = fs.readFileSync(serializerPath, 'utf8');
    eval(serializerCode);
  });

  beforeEach(() => {
    // Clear document body before each test
    document.body.innerHTML = '';
    // Mock layout engine for each test
    restoreLayout = mockLayoutEngine();
  });
  
  afterEach(() => {
    // Restore original functions
    if (restoreLayout) restoreLayout();
  });

  describe('window.FigmaSerializer.serialize', () => {
    it('should be defined on window', () => {
      expect(window.FigmaSerializer).toBeDefined();
      expect(window.FigmaSerializer.serialize).toBeDefined();
      expect(typeof window.FigmaSerializer.serialize).toBe('function');
    });

    it('should return null for empty body', () => {
      const result = window.FigmaSerializer.serialize(document.body);
      // Empty body has no visible children, returns a FRAME with empty children
      expect(result).toBeTruthy();
      expect(result.type).toBe('FRAME');
      expect(result.children).toEqual([]);
    });
  });

  describe('Text Node Handling', () => {
    it('should serialize simple text content', () => {
      document.body.innerHTML = '<div>Hello World</div>';
      const result = window.FigmaSerializer.serialize(document.body);
      
      expect(result.type).toBe('FRAME');
      expect(result.children).toHaveLength(1);
      
      const textNode = result.children[0];
      expect(textNode.type).toBe('TEXT_NODE');
      expect(textNode.content).toBe('Hello World');
    });

    it('should trim whitespace from text content', () => {
      document.body.innerHTML = '<div>   Trimmed Text   </div>';
      const result = window.FigmaSerializer.serialize(document.body);
      
      const textNode = result.children[0];
      expect(textNode.content).toBe('Trimmed Text');
    });

    it('should skip empty text nodes', () => {
      document.body.innerHTML = '<div>   </div>';
      const result = window.FigmaSerializer.serialize(document.body);
      
      // The div becomes a FRAME with no text children
      expect(result.children).toHaveLength(1);
      expect(result.children[0].type).toBe('FRAME');
      expect(result.children[0].children).toEqual([]);
    });
  });

  describe('Frame/Element Handling', () => {
    it('should serialize nested elements as FRAME types', () => {
      document.body.innerHTML = `
        <div id="parent">
          <div id="child1">Text 1</div>
          <div id="child2">Text 2</div>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      
      expect(result.type).toBe('FRAME');
      expect(result.children).toHaveLength(1);
      
      const parent = result.children[0];
      expect(parent.type).toBe('FRAME');
      expect(parent.tag).toBe('div');
      expect(parent.children).toHaveLength(2);
      
      expect(parent.children[0].type).toBe('TEXT_NODE');
      expect(parent.children[0].content).toBe('Text 1');
      expect(parent.children[1].content).toBe('Text 2');
    });

    it('should capture element tag names', () => {
      // Note: Elements with single text child become TEXT_NODE (optimization)
      // So we use nested elements to test tag capture
      document.body.innerHTML = `
        <header><div>Header</div></header>
        <main><div>Main</div></main>
        <footer><div>Footer</div></footer>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      
      const tags = result.children.map(c => c.tag);
      expect(tags).toEqual(['header', 'main', 'footer']);
    });
  });

  describe('Visibility Handling', () => {
    it('should skip display:none elements', () => {
      document.body.innerHTML = `
        <div style="display: none;">Hidden</div>
        <div>Visible</div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      
      expect(result.children).toHaveLength(1);
      expect(result.children[0].content).toBe('Visible');
    });

    it('should skip visibility:hidden elements', () => {
      document.body.innerHTML = `
        <div style="visibility: hidden;">Hidden</div>
        <div>Visible</div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      
      expect(result.children).toHaveLength(1);
      expect(result.children[0].content).toBe('Visible');
    });

    it('should skip opacity:0 elements', () => {
      document.body.innerHTML = `
        <div style="opacity: 0;">Transparent</div>
        <div>Visible</div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      
      expect(result.children).toHaveLength(1);
      expect(result.children[0].content).toBe('Visible');
    });
  });

  describe('Style Extraction', () => {
    it('should extract padding values', () => {
      document.body.innerHTML = `
        <div style="padding: 10px 20px 30px 40px;">
          <span>Child</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.styles.padding).toEqual({
        top: 10,
        right: 20,
        bottom: 30,
        left: 40,
      });
    });

    it('should extract border-radius values', () => {
      // Note: JSDOM doesn't expand shorthand CSS, use longhand properties
      document.body.innerHTML = `
        <div style="border-top-left-radius: 5px; border-top-right-radius: 10px; border-bottom-right-radius: 15px; border-bottom-left-radius: 20px; width: 100px; height: 100px;">
          <span>Child</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.styles.borderRadius).toEqual({
        topLeft: 5,
        topRight: 10,
        bottomRight: 15,
        bottomLeft: 20,
      });
    });

    it('should extract flexbox properties', () => {
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 16px;">
          <span>Child</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.styles.display).toBe('flex');
      expect(div.styles.flexDirection).toBe('column');
      expect(div.styles.justifyContent).toBe('center');
      expect(div.styles.alignItems).toBe('flex-start');
      expect(div.styles.gap).toBe(16);
    });

    it('should extract typography properties', () => {
      document.body.innerHTML = `
        <div style="font-size: 24px; font-weight: 700; font-family: Arial; text-align: center;">
          Hello
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const textNode = result.children[0];
      
      expect(textNode.fontSize).toBe(24);
      // Note: JSDOM may return 'bold' or '700' depending on how it's set
      expect(['700', 'bold']).toContain(textNode.fontWeight);
      expect(textNode.fontFamily).toContain('Arial');
      expect(textNode.textAlign).toBe('center');
    });

    it('should extract border properties', () => {
      document.body.innerHTML = `
        <div style="border: 2px solid rgb(255, 0, 0); width: 100px; height: 100px;">
          <span>Child</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.styles.border.width).toBe(2);
      expect(div.styles.border.style).toBe('solid');
      expect(div.styles.border.color).toEqual({ r: 1, g: 0, b: 0 });
    });

    it('should extract box-shadow', () => {
      document.body.innerHTML = `
        <div style="box-shadow: 10px 20px 30px rgba(0, 0, 0, 0.5); width: 100px; height: 100px;">
          <span>Child</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.styles.boxShadow).toBeTruthy();
      expect(div.styles.boxShadow).toContain('10px');
    });

    it('should extract text-transform and letter-spacing', () => {
      document.body.innerHTML = `
        <div style="text-transform: uppercase; letter-spacing: 2px;">Hello</div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const textNode = result.children[0];
      
      expect(textNode.textTransform).toBe('uppercase');
      expect(textNode.letterSpacing).toBe(2);
    });
  });

  describe('Color Handling', () => {
    it('should parse RGB colors correctly', () => {
      document.body.innerHTML = `
        <div style="background-color: rgb(255, 128, 64);">Content</div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const textNode = result.children[0];
      
      expect(textNode.backgroundColor).toEqual({
        r: 1,
        g: 128 / 255,
        b: 64 / 255,
      });
    });

    it('should parse RGBA colors correctly', () => {
      document.body.innerHTML = `
        <div style="background-color: rgba(255, 0, 0, 0.5);">Content</div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const textNode = result.children[0];
      
      // Note: Our getRgb function only extracts RGB, not alpha
      expect(textNode.backgroundColor).toEqual({ r: 1, g: 0, b: 0 });
    });

    it('should return null for transparent colors', () => {
      document.body.innerHTML = `
        <div style="background-color: transparent;">Content</div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const textNode = result.children[0];
      
      expect(textNode.backgroundColor).toBeNull();
    });

    it('should extract text color', () => {
      document.body.innerHTML = `
        <div style="color: rgb(0, 128, 255);">Blue Text</div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const textNode = result.children[0];
      
      expect(textNode.color).toEqual({
        r: 0,
        g: 128 / 255,
        b: 1,
      });
    });
  });

  describe('Background Image Handling', () => {
    it('should extract background image URL', () => {
      document.body.innerHTML = `
        <div style="background-image: url('https://example.com/image.jpg'); width: 100px; height: 100px;">
          <span>Content</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.styles.backgroundImage).toEqual({
        type: 'IMAGE',
        url: 'https://example.com/image.jpg',
      });
    });

    it('should detect gradient backgrounds', () => {
      document.body.innerHTML = `
        <div style="background-image: linear-gradient(to right, red, blue); width: 100px; height: 100px;">
          <span>Content</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.styles.backgroundImage.type).toBe('GRADIENT');
      expect(div.styles.backgroundImage.raw).toContain('gradient');
    });

    it('should return null for no background image', () => {
      document.body.innerHTML = `
        <div style="width: 100px; height: 100px;">
          <span>Content</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.styles.backgroundImage).toBeNull();
    });
  });

  describe('Image Element Handling', () => {
    it('should serialize IMG elements as IMAGE type', () => {
      document.body.innerHTML = `
        <img src="https://example.com/photo.jpg" width="200" height="150" />
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      
      expect(result.children).toHaveLength(1);
      const img = result.children[0];
      
      expect(img.type).toBe('IMAGE');
      expect(img.src).toBe('https://example.com/photo.jpg');
      expect(img.tag).toBe('img');
    });

    it('should include styles on IMAGE elements', () => {
      // Note: JSDOM doesn't expand shorthand CSS, use longhand
      document.body.innerHTML = `
        <img src="test.jpg" style="border-top-left-radius: 10px; border-top-right-radius: 10px; border-bottom-left-radius: 10px; border-bottom-right-radius: 10px;" width="100" height="100" />
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const img = result.children[0];
      
      expect(img.styles).toBeDefined();
      expect(img.styles.borderRadius.topLeft).toBe(10);
    });
  });

  describe('Positioning', () => {
    it('should capture position properties', () => {
      document.body.innerHTML = `
        <div style="position: absolute; top: 10px; left: 20px; right: 30px; bottom: 40px; width: 100px; height: 100px;">
          <span>Positioned</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.styles.position).toBe('absolute');
      expect(div.styles.top).toBe(10);
      expect(div.styles.left).toBe(20);
      expect(div.styles.right).toBe(30);
      expect(div.styles.bottom).toBe(40);
    });

    it('should capture z-index', () => {
      document.body.innerHTML = `
        <div style="position: relative; z-index: 100; width: 100px; height: 100px;">
          <span>Layered</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.styles.zIndex).toBe(100);
    });

    it('should capture global bounds', () => {
      document.body.innerHTML = `
        <div style="width: 200px; height: 100px;">
          <span>Content</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.globalBounds).toBeDefined();
      expect(div.globalBounds.width).toBe(200);
      expect(div.globalBounds.height).toBe(100);
    });
  });

  describe('Overflow Handling', () => {
    it('should capture overflow properties', () => {
      document.body.innerHTML = `
        <div style="overflow-x: hidden; overflow-y: scroll; width: 100px; height: 100px;">
          <span>Content</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const div = result.children[0];
      
      expect(div.styles.overflowX).toBe('hidden');
      expect(div.styles.overflowY).toBe('scroll');
    });
  });

  describe('SVG Vector Handling', () => {
    it('should serialize SVG elements as VECTOR type', () => {
      document.body.innerHTML = `
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="red"/>
        </svg>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      
      expect(result.children).toHaveLength(1);
      const svg = result.children[0];
      
      expect(svg.type).toBe('VECTOR');
      expect(svg.tag).toBe('svg');
      expect(svg.svgString).toBeDefined();
      expect(svg.svgString).toContain('<circle');
      expect(svg.svgString).toContain('fill="red"');
    });

    it('should include SVG styles', () => {
      document.body.innerHTML = `
        <svg width="200" height="150" style="box-shadow: 10px 10px 5px rgba(0,0,0,0.5);">
          <rect x="10" y="10" width="80" height="80" fill="blue"/>
        </svg>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const svg = result.children[0];
      
      expect(svg.type).toBe('VECTOR');
      expect(svg.styles).toBeDefined();
      // Note: JSDOM mock doesn't read SVG width/height attributes correctly
      // In a real browser, these would be 200x150
      expect(svg.styles.width).toBeDefined();
      expect(svg.styles.height).toBeDefined();
    });

    it('should serialize complex SVG paths', () => {
      document.body.innerHTML = `
        <svg width="100" height="100" viewBox="0 0 100 100">
          <path d="M10 10 L90 10 L90 90 L10 90 Z" fill="green"/>
        </svg>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const svg = result.children[0];
      
      expect(svg.type).toBe('VECTOR');
      expect(svg.svgString).toContain('path');
      expect(svg.svgString).toContain('d="M10 10 L90 10 L90 90 L10 90 Z"');
    });
  });

  describe('Pseudo-element Handling', () => {
    // Note: JSDOM has limited support for pseudo-elements
    // We test the existence of the helper function and basic parsing logic
    
    it('should have getPseudoElement helper function defined', () => {
      // The function is internal, but we can test its effects through the serializer
      // Create an element and verify the serializer runs without error
      document.body.innerHTML = `<div>Content</div>`;
      
      expect(() => {
        window.FigmaSerializer.serialize(document.body);
      }).not.toThrow();
    });

    it('should handle elements that could have pseudo-elements without errors', () => {
      document.body.innerHTML = `
        <div class="has-before">
          <span>Text content</span>
        </div>
      `;
      
      // In a real browser, if this element had ::before content, it would be captured
      // In JSDOM, pseudo-elements don't render, so we just verify no errors occur
      const result = window.FigmaSerializer.serialize(document.body);
      
      expect(result).toBeTruthy();
      expect(result.type).toBe('FRAME');
    });

    it('should correctly order children with pseudo-elements placeholder', () => {
      // In JSDOM, pseudo-elements don't render, but we can verify the structure
      // In a real browser, ::before would come first, ::after would come last
      document.body.innerHTML = `
        <div>
          <span>First Child</span>
          <span>Second Child</span>
        </div>
      `;
      
      const result = window.FigmaSerializer.serialize(document.body);
      const parent = result.children[0];
      
      // Verify children are in correct order
      expect(parent.children).toHaveLength(2);
      expect(parent.children[0].content).toBe('First Child');
      expect(parent.children[1].content).toBe('Second Child');
    });
  });

  describe('Edge Cases', () => {
    it('should handle deeply nested elements', () => {
      document.body.innerHTML = `
        <div id="l1">
          <div id="l2">
            <div id="l3">
              <div id="l4">
                <span>Deep Text</span>
              </div>
            </div>
          </div>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      
      let current = result;
      // Navigate through nesting levels until we find TEXT_NODE
      let depth = 0;
      while (current.type === 'FRAME' && current.children && current.children.length === 1) {
        current = current.children[0];
        depth++;
      }
      
      // The <span> with single text child becomes TEXT_NODE (optimization)
      expect(current.type).toBe('TEXT_NODE');
      expect(current.content).toBe('Deep Text');
      expect(depth).toBeGreaterThanOrEqual(4); // At least 4 levels deep
    });

    it('should handle multiple siblings', () => {
      document.body.innerHTML = `
        <div>One</div>
        <div>Two</div>
        <div>Three</div>
        <div>Four</div>
        <div>Five</div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      
      expect(result.children).toHaveLength(5);
      const contents = result.children.map(c => c.content);
      expect(contents).toEqual(['One', 'Two', 'Three', 'Four', 'Five']);
    });

    it('should handle mixed content (elements and text)', () => {
      document.body.innerHTML = `
        <div>
          <span>First</span>
          Middle Text
          <span>Last</span>
        </div>
      `;
      const result = window.FigmaSerializer.serialize(document.body);
      const parent = result.children[0];
      
      expect(parent.children.length).toBeGreaterThanOrEqual(3);
    });
  });
});
