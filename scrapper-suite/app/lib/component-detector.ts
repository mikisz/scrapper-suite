/**
 * Component Detector for React Documentation Pages
 *
 * Auto-detects component examples/demos on documentation pages
 * by analyzing DOM structure, classes, and attributes.
 */

export interface DetectedComponent {
  selector: string;          // CSS selector to find this element
  name: string;              // Derived component name
  variant?: string;          // Variant name if part of a group
  confidence: number;        // Detection confidence (0-1)
  libraryHint?: string;      // Detected library type
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface DetectionResult {
  components: DetectedComponent[];
  libraryDetected: string | null;
  totalFound: number;
}

// Demo container selectors (priority order - most specific first)
const DEMO_SELECTORS = [
  // Explicit demo containers
  '[class*="preview"]:not([class*="code"])',
  '[class*="demo"]:not([class*="code"])',
  '[class*="example"]:not([class*="code"])',
  '[class*="showcase"]',
  '[class*="playground"]:not([class*="code"])',
  '[data-preview]',
  '[data-example]',
  '[data-demo]',

  // Library-specific patterns
  '[data-radix-popper-content-wrapper]',
  '[class*="react-aria"]',
  '[data-slot]',

  // Common doc site patterns
  '.live-preview',
  '.component-preview',
  '.story-container',
  '.preview-container',
  '.example-container',
  '.demo-container',

  // Storybook patterns
  '[id^="story--"]',
  '.sb-story',
  '.docs-story',
];

// Selectors to exclude (code blocks, navigation, etc.)
const EXCLUDE_SELECTORS = [
  'pre',
  'code',
  '.code-block',
  '.syntax-highlighter',
  '[class*="prism"]',
  '[class*="hljs"]',
  '[class*="highlight"]',
  'nav',
  'header:not([class*="component"])',
  'footer',
  '.sidebar',
  '.toc',
  '.table-of-contents',
  '[class*="source"]',
  '[class*="editor"]',
  '.copy-button',
  '[class*="copy"]',
];

// Library detection patterns
const LIBRARY_PATTERNS: Record<string, RegExp[]> = {
  'react-aria': [/react-aria/i, /\.react-aria-/],
  'radix': [/data-radix/i, /radix-ui/i],
  'shadcn': [/data-slot/i, /shadcn/i],
  'chakra': [/chakra/i, /\.chakra-/],
  'mui': [/MuiButton/i, /\.Mui/],
  'antd': [/ant-/i, /antd/i],
  'headless-ui': [/headlessui/i],
};

/**
 * Browser-context script to detect components on a page
 * Returns serializable detection results
 */
export function getComponentDetectorScript(): string {
  return `
(function() {
  const DEMO_SELECTORS = ${JSON.stringify(DEMO_SELECTORS)};
  const EXCLUDE_SELECTORS = ${JSON.stringify(EXCLUDE_SELECTORS)};
  const LIBRARY_PATTERNS = {
    'react-aria': [/react-aria/i, /\\.react-aria-/],
    'radix': [/data-radix/i, /radix-ui/i],
    'shadcn': [/data-slot/i, /shadcn/i],
    'chakra': [/chakra/i, /\\.chakra-/],
    'mui': [/MuiButton/i, /\\.Mui/],
    'antd': [/ant-/i, /antd/i],
    'headless-ui': [/headlessui/i],
  };

  // Detect which library is being used
  function detectLibrary() {
    const html = document.documentElement.outerHTML;
    for (const [library, patterns] of Object.entries(LIBRARY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(html)) {
          return library;
        }
      }
    }
    return null;
  }

  // Check if element is inside an excluded container
  function isExcluded(element) {
    for (const selector of EXCLUDE_SELECTORS) {
      if (element.closest(selector)) {
        return true;
      }
    }
    return false;
  }

  // Check if element is visible
  function isVisible(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 10 &&
      rect.height > 10
    );
  }

  // Generate a unique selector for an element
  function getSelector(element) {
    if (element.id) {
      return '#' + CSS.escape(element.id);
    }

    const path = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = '#' + CSS.escape(current.id);
        path.unshift(selector);
        break;
      } else if (current.className && typeof current.className === 'string') {
        const classes = current.className.split(/\\s+/).filter(c => c && !c.match(/^[0-9]/));
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
        }
      }

      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-child(' + index + ')';
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  // Extract component name from context
  function extractName(element) {
    // Try to find a nearby heading
    let current = element;
    for (let i = 0; i < 5; i++) {
      if (!current) break;

      // Check previous sibling headings
      let prev = current.previousElementSibling;
      while (prev) {
        if (/^H[1-6]$/.test(prev.tagName)) {
          return prev.textContent.trim().substring(0, 50);
        }
        prev = prev.previousElementSibling;
      }

      current = current.parentElement;
    }

    // Try class name patterns
    const className = element.className;
    if (typeof className === 'string') {
      const match = className.match(/(?:example|demo|preview|component)[_-]?(\\w+)/i);
      if (match) {
        return match[1].replace(/[-_]/g, ' ').trim();
      }
    }

    // Try data attributes
    const dataName = element.dataset?.name || element.dataset?.component;
    if (dataName) return dataName;

    // Fallback to tag-based name
    const interactiveElement = element.querySelector('button, input, select, [role="button"]');
    if (interactiveElement) {
      const text = interactiveElement.textContent?.trim();
      if (text && text.length < 30) return text;
    }

    return null;
  }

  // Detect components using selector patterns
  function detectBySelectors() {
    const found = new Set();
    const components = [];

    for (const selector of DEMO_SELECTORS) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          // Skip if already found or excluded
          if (found.has(element) || isExcluded(element) || !isVisible(element)) {
            continue;
          }

          // Skip if a parent is already detected
          let isChildOfDetected = false;
          for (const existing of found) {
            if (existing.contains(element) && existing !== element) {
              isChildOfDetected = true;
              break;
            }
          }
          if (isChildOfDetected) continue;

          // Skip if this element contains other detected elements (we want the innermost)
          let containsDetected = false;
          for (const existing of found) {
            if (element.contains(existing) && element !== existing) {
              containsDetected = true;
              break;
            }
          }
          if (containsDetected) continue;

          found.add(element);
          const rect = element.getBoundingClientRect();

          components.push({
            selector: getSelector(element),
            name: extractName(element) || 'Component ' + (components.length + 1),
            confidence: 0.8,
            bounds: {
              x: rect.x + window.scrollX,
              y: rect.y + window.scrollY,
              width: rect.width,
              height: rect.height,
            }
          });
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }

    return components;
  }

  // Detect components by interactive element clustering
  function detectByInteractiveElements() {
    const interactiveSelectors = [
      'button:not([class*="copy"])',
      'input:not([type="hidden"])',
      'select',
      '[role="button"]',
      '[role="menu"]',
      '[role="listbox"]',
      '[role="combobox"]',
      '[role="dialog"]',
    ];

    const components = [];
    const interactiveElements = document.querySelectorAll(interactiveSelectors.join(','));
    const processed = new Set();

    for (const element of interactiveElements) {
      if (isExcluded(element) || !isVisible(element)) continue;

      // Find the nearest container that looks like a component demo
      let container = element.parentElement;
      while (container && container !== document.body) {
        const style = window.getComputedStyle(container);
        const hasBackground = style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                             style.backgroundColor !== 'transparent';
        const hasBorder = parseFloat(style.borderWidth) > 0;
        const hasPadding = parseFloat(style.padding) > 8;
        const hasRoundedCorners = parseFloat(style.borderRadius) > 0;

        // Container looks like a demo box
        if ((hasBackground || hasBorder || hasRoundedCorners) && hasPadding) {
          if (!processed.has(container) && !isExcluded(container)) {
            processed.add(container);
            const rect = container.getBoundingClientRect();

            // Skip very large containers (probably not individual components)
            if (rect.width < window.innerWidth * 0.8 && rect.height < window.innerHeight * 0.8) {
              components.push({
                selector: getSelector(container),
                name: extractName(container) || 'Interactive Component ' + (components.length + 1),
                confidence: 0.6,
                bounds: {
                  x: rect.x + window.scrollX,
                  y: rect.y + window.scrollY,
                  width: rect.width,
                  height: rect.height,
                }
              });
            }
          }
          break;
        }

        container = container.parentElement;
      }
    }

    return components;
  }

  // Merge and deduplicate detected components
  function mergeComponents(selectorBased, interactiveBased) {
    const merged = [...selectorBased];
    const existingSelectors = new Set(selectorBased.map(c => c.selector));

    for (const component of interactiveBased) {
      // Check if this component overlaps significantly with existing ones
      const overlaps = selectorBased.some(existing => {
        const overlapX = Math.max(0,
          Math.min(existing.bounds.x + existing.bounds.width, component.bounds.x + component.bounds.width) -
          Math.max(existing.bounds.x, component.bounds.x)
        );
        const overlapY = Math.max(0,
          Math.min(existing.bounds.y + existing.bounds.height, component.bounds.y + component.bounds.height) -
          Math.max(existing.bounds.y, component.bounds.y)
        );
        const overlapArea = overlapX * overlapY;
        const componentArea = component.bounds.width * component.bounds.height;
        return overlapArea > componentArea * 0.5;
      });

      if (!overlaps && !existingSelectors.has(component.selector)) {
        merged.push(component);
      }
    }

    return merged;
  }

  // Main detection function
  function detectComponents() {
    const library = detectLibrary();
    const selectorBased = detectBySelectors();
    const interactiveBased = detectByInteractiveElements();
    const components = mergeComponents(selectorBased, interactiveBased);

    // Assign variant names to similar components
    const nameCount = {};
    for (const component of components) {
      const baseName = component.name;
      nameCount[baseName] = (nameCount[baseName] || 0) + 1;
    }

    const nameIndex = {};
    for (const component of components) {
      const baseName = component.name;
      if (nameCount[baseName] > 1) {
        nameIndex[baseName] = (nameIndex[baseName] || 0) + 1;
        component.variant = 'Variant ' + nameIndex[baseName];
      }
    }

    return {
      components,
      libraryDetected: library,
      totalFound: components.length,
    };
  }

  return detectComponents();
})();
`;
}

export { DEMO_SELECTORS, EXCLUDE_SELECTORS, LIBRARY_PATTERNS };
