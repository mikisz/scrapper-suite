/**
 * Variant Extractor for React Component Documentation
 *
 * Groups detected components by similarity and extracts
 * meaningful names from context (headings, classes, data attributes).
 */

import { DetectedComponent } from './component-detector';

export interface ComponentGroup {
  baseName: string;
  variants: DetectedComponent[];
}

/**
 * Browser-context script to extract variant information from elements
 */
export function getVariantExtractorScript(): string {
  return `
(function(selectors) {
  const results = [];

  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (!element) {
        results.push(null);
        continue;
      }

      // Extract name from multiple sources
      const extractedName = extractComponentName(element);
      const variantInfo = extractVariantInfo(element);

      results.push({
        name: extractedName,
        variant: variantInfo.variant,
        structureHash: getStructureHash(element),
        tagStructure: getTagStructure(element),
      });
    } catch (e) {
      results.push(null);
    }
  }

  return results;

  // Helper: Extract component name from context
  function extractComponentName(element) {
    // 1. Check for preceding heading
    const heading = findPrecedingHeading(element);
    if (heading) return cleanName(heading);

    // 2. Check parent container labels
    const containerLabel = findContainerLabel(element);
    if (containerLabel) return cleanName(containerLabel);

    // 3. Check data attributes
    const dataName = element.dataset?.name ||
                     element.dataset?.component ||
                     element.dataset?.testid ||
                     element.getAttribute('aria-label');
    if (dataName) return cleanName(dataName);

    // 4. Check class name patterns
    const className = element.className;
    if (typeof className === 'string') {
      // Look for component-like class names
      const patterns = [
        /(?:component|example|demo|preview)[_-]?(\\w+)/i,
        /^(\\w+)(?:Example|Demo|Preview)/i,
        /(btn|button|card|modal|dialog|menu|tab|input|select)[_-]?(\\w+)?/i,
      ];

      for (const pattern of patterns) {
        const match = className.match(pattern);
        if (match && match[1]) {
          return cleanName(match[1]);
        }
      }
    }

    // 5. Infer from primary interactive element
    const interactive = element.querySelector('button, [role="button"], input, select');
    if (interactive) {
      const text = interactive.textContent?.trim();
      if (text && text.length < 30) {
        return text;
      }
    }

    return null;
  }

  // Helper: Find preceding heading
  function findPrecedingHeading(element) {
    // Look up the DOM tree for nearby headings
    let current = element;
    for (let i = 0; i < 5; i++) {
      if (!current) break;

      // Check previous siblings
      let prev = current.previousElementSibling;
      while (prev) {
        if (/^H[1-6]$/.test(prev.tagName)) {
          return prev.textContent.trim();
        }
        // Also check children of prev sibling
        const nestedHeading = prev.querySelector('h1, h2, h3, h4, h5, h6');
        if (nestedHeading) {
          return nestedHeading.textContent.trim();
        }
        prev = prev.previousElementSibling;
      }

      // Check parent's heading
      if (current.parentElement) {
        const parentHeading = current.parentElement.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4');
        if (parentHeading && !element.contains(parentHeading)) {
          return parentHeading.textContent.trim();
        }
      }

      current = current.parentElement;
    }

    return null;
  }

  // Helper: Find container label
  function findContainerLabel(element) {
    let current = element.parentElement;

    for (let i = 0; i < 3; i++) {
      if (!current) break;

      // Check for aria-label or title
      const label = current.getAttribute('aria-label') || current.title;
      if (label) return label;

      // Check for a label element
      const labelEl = current.querySelector(':scope > label, :scope > legend');
      if (labelEl) return labelEl.textContent.trim();

      current = current.parentElement;
    }

    return null;
  }

  // Helper: Extract variant info from element
  function extractVariantInfo(element) {
    const variant = {};

    // Check for variant indicators in classes
    const className = element.className;
    if (typeof className === 'string') {
      // Size variants
      if (/\\b(xs|sm|md|lg|xl|2xl|small|medium|large)\\b/i.test(className)) {
        variant.size = className.match(/\\b(xs|sm|md|lg|xl|2xl|small|medium|large)\\b/i)[1];
      }

      // State variants
      if (/\\b(primary|secondary|tertiary|success|warning|error|danger|info)\\b/i.test(className)) {
        variant.state = className.match(/\\b(primary|secondary|tertiary|success|warning|error|danger|info)\\b/i)[1];
      }

      // Style variants
      if (/\\b(outlined?|ghost|link|solid|soft|subtle)\\b/i.test(className)) {
        variant.style = className.match(/\\b(outlined?|ghost|link|solid|soft|subtle)\\b/i)[1];
      }
    }

    // Check data attributes for variants
    for (const [key, value] of Object.entries(element.dataset || {})) {
      if (['variant', 'size', 'state', 'color', 'type'].includes(key)) {
        variant[key] = value;
      }
    }

    // Build variant string
    const parts = [];
    if (variant.style) parts.push(capitalize(variant.style));
    if (variant.state) parts.push(capitalize(variant.state));
    if (variant.size) parts.push(capitalize(variant.size));

    return {
      variant: parts.length > 0 ? parts.join(' ') : null,
      raw: variant,
    };
  }

  // Helper: Get structure hash for similarity comparison
  function getStructureHash(element) {
    // Create a signature based on element structure
    const tags = [];
    const walk = (el, depth) => {
      if (depth > 3) return;
      if (el.nodeType !== 1) return;

      let sig = el.tagName.toLowerCase();
      if (el.getAttribute('role')) {
        sig += '[' + el.getAttribute('role') + ']';
      }
      tags.push(sig);

      for (const child of el.children) {
        walk(child, depth + 1);
      }
    };
    walk(element, 0);
    return tags.slice(0, 10).join(',');
  }

  // Helper: Get tag structure for grouping
  function getTagStructure(element) {
    const structure = {
      rootTag: element.tagName.toLowerCase(),
      hasButton: !!element.querySelector('button, [role="button"]'),
      hasInput: !!element.querySelector('input:not([type="hidden"]), select, textarea'),
      hasMenu: !!element.querySelector('[role="menu"], [role="listbox"]'),
      hasDialog: !!element.querySelector('[role="dialog"], [role="alertdialog"]'),
      hasTabs: !!element.querySelector('[role="tablist"]'),
      childCount: element.children.length,
    };
    return JSON.stringify(structure);
  }

  // Helper: Clean and normalize names
  function cleanName(name) {
    if (!name) return null;
    return name
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\\s+/g, ' ')
      .trim()
      .substring(0, 50);
  }

  // Helper: Capitalize first letter
  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }
})(arguments[0]);
`;
}

/**
 * Group components by structural similarity
 */
export function groupByStructure(
  components: DetectedComponent[],
  variantInfo: Array<{
    name: string | null;
    variant: string | null;
    structureHash: string;
    tagStructure: string;
  } | null>
): ComponentGroup[] {
  const groups: Map<string, ComponentGroup> = new Map();

  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    const info = variantInfo[i];

    if (!info) continue;

    // Use structure hash as grouping key
    const groupKey = info.tagStructure;
    let group = groups.get(groupKey);

    if (!group) {
      group = {
        baseName: info.name || component.name,
        variants: [],
      };
      groups.set(groupKey, group);
    }

    // Update component with extracted info
    const updatedComponent: DetectedComponent = {
      ...component,
      name: info.name || component.name,
      variant: info.variant || undefined,
    };

    group.variants.push(updatedComponent);
  }

  // Post-process groups to assign variant names if not present
  const result: ComponentGroup[] = [];
  for (const group of groups.values()) {
    if (group.variants.length > 1) {
      // Multiple variants - ensure each has a unique variant name
      const variantNames = new Set<string>();
      let variantIndex = 1;

      for (const variant of group.variants) {
        if (!variant.variant) {
          while (variantNames.has(`Variant ${variantIndex}`)) {
            variantIndex++;
          }
          variant.variant = `Variant ${variantIndex}`;
          variantIndex++;
        }
        variantNames.add(variant.variant);
      }
    }

    result.push(group);
  }

  return result;
}
