/**
 * Style Injector for React Component Documentation
 *
 * Injects Tailwind CSS and default styles for unstyled headless components
 * to make them visually meaningful when captured.
 */

export type ThemeType = 'tailwind' | 'none';

/**
 * Tailwind CDN script that can be injected into pages
 * Using Play CDN for instant styling without build step
 */
const TAILWIND_CDN = `
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {}
    }
  }
</script>
`;

/**
 * Default styles for common headless component patterns
 * Applied when components appear unstyled
 */
const DEFAULT_COMPONENT_STYLES = `
<style id="scrapper-suite-defaults">
  /* Base styles for unstyled interactive elements */
  button:not([class*="bg-"]):not([style*="background"]) {
    padding: 8px 16px;
    background-color: #3b82f6;
    color: white;
    border-radius: 6px;
    border: none;
    font-weight: 500;
    cursor: pointer;
  }

  button:not([class*="bg-"]):not([style*="background"]):hover {
    background-color: #2563eb;
  }

  button:not([class*="bg-"]):not([style*="background"]):disabled {
    background-color: #9ca3af;
    cursor: not-allowed;
  }

  /* Input and select styles */
  input:not([type="hidden"]):not([class*="border"]):not([style*="border"]),
  select:not([class*="border"]):not([style*="border"]) {
    padding: 8px 12px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background-color: white;
    min-width: 200px;
  }

  input:not([type="hidden"]):not([class*="border"]):focus,
  select:not([class*="border"]):focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  /* Checkbox and radio */
  input[type="checkbox"]:not([class*="w-"]),
  input[type="radio"]:not([class*="w-"]) {
    width: 16px;
    height: 16px;
    accent-color: #3b82f6;
  }

  /* Menu/dropdown styles */
  [role="menu"]:not([class*="bg-"]):not([style*="background"]),
  [role="listbox"]:not([class*="bg-"]):not([style*="background"]) {
    background-color: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    padding: 4px;
    min-width: 160px;
  }

  [role="menuitem"]:not([class*="px-"]),
  [role="option"]:not([class*="px-"]) {
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
  }

  [role="menuitem"]:hover,
  [role="option"]:hover,
  [role="menuitem"][data-highlighted],
  [role="option"][data-highlighted] {
    background-color: #f3f4f6;
  }

  [role="menuitem"][data-disabled],
  [role="option"][data-disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Dialog/modal styles */
  [role="dialog"]:not([class*="bg-"]):not([style*="background"]) {
    background-color: white;
    border-radius: 12px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    padding: 24px;
    max-width: 500px;
  }

  /* Tabs styles */
  [role="tablist"]:not([class*="border"]) {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 4px;
  }

  [role="tab"]:not([class*="px-"]) {
    padding: 8px 16px;
    border-radius: 6px 6px 0 0;
    cursor: pointer;
    border: none;
    background: transparent;
  }

  [role="tab"][aria-selected="true"] {
    background-color: #3b82f6;
    color: white;
  }

  [role="tabpanel"]:not([class*="p-"]) {
    padding: 16px;
  }

  /* Tooltip styles */
  [role="tooltip"]:not([class*="bg-"]):not([style*="background"]) {
    background-color: #1f2937;
    color: white;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 14px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  /* Popover styles */
  [data-radix-popper-content-wrapper] > *:not([class*="bg-"]):not([style*="background"]) {
    background-color: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    padding: 12px;
  }

  /* Switch/toggle styles */
  [role="switch"]:not([class*="bg-"]) {
    width: 44px;
    height: 24px;
    background-color: #d1d5db;
    border-radius: 12px;
    position: relative;
    cursor: pointer;
  }

  [role="switch"][aria-checked="true"]:not([class*="bg-"]) {
    background-color: #3b82f6;
  }

  /* Slider styles */
  [role="slider"]:not([class*="bg-"]) {
    width: 200px;
    height: 4px;
    background-color: #e5e7eb;
    border-radius: 2px;
  }

  /* React Aria specific styles */
  .react-aria-Button:not([class*="bg-"]):not([style*="background"]) {
    padding: 8px 16px;
    background-color: #3b82f6;
    color: white;
    border-radius: 6px;
    border: none;
    font-weight: 500;
    cursor: pointer;
  }

  .react-aria-Menu:not([class*="bg-"]) {
    background-color: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    padding: 4px;
  }

  .react-aria-MenuItem:not([class*="px-"]) {
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    outline: none;
  }

  .react-aria-MenuItem[data-focused] {
    background-color: #3b82f6;
    color: white;
  }

  .react-aria-TextField:not([class*="border"]) input {
    padding: 8px 12px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
  }

  .react-aria-Select:not([class*="border"]) button {
    padding: 8px 12px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background-color: white;
    min-width: 150px;
    text-align: left;
  }

  .react-aria-ListBox:not([class*="bg-"]) {
    background-color: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    padding: 4px;
  }

  .react-aria-ListBoxItem:not([class*="px-"]) {
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    outline: none;
  }

  .react-aria-ListBoxItem[data-focused] {
    background-color: #3b82f6;
    color: white;
  }
</style>
`;

/**
 * Returns the script to inject Tailwind CDN
 */
export function getTailwindCDNScript(): string {
  return TAILWIND_CDN;
}

/**
 * Returns default component styles for headless libraries
 */
export function getDefaultComponentStyles(): string {
  return DEFAULT_COMPONENT_STYLES;
}

/**
 * Browser-context script to inject styles into the page head
 */
export function getStyleInjectorScript(theme: ThemeType): string {
  const styles = theme === 'tailwind'
    ? `${TAILWIND_CDN}\n${DEFAULT_COMPONENT_STYLES}`
    : DEFAULT_COMPONENT_STYLES;

  // Escape backticks and backslashes for string embedding
  const escapedStyles = styles.replace(/\\/g, '\\\\').replace(/`/g, '\\`');

  return `
(function() {
  // Check if styles already injected
  if (document.getElementById('scrapper-suite-defaults')) {
    return;
  }

  const stylesHtml = \`${escapedStyles}\`;

  // Parse and inject
  const temp = document.createElement('div');
  temp.innerHTML = stylesHtml;

  // Inject all elements (scripts and styles)
  while (temp.firstChild) {
    if (temp.firstChild.nodeName === 'SCRIPT') {
      const script = document.createElement('script');
      if (temp.firstChild.src) {
        script.src = temp.firstChild.src;
      } else {
        script.textContent = temp.firstChild.textContent;
      }
      document.head.appendChild(script);
      temp.removeChild(temp.firstChild);
    } else {
      document.head.appendChild(temp.firstChild);
    }
  }

  // Wait for Tailwind to initialize (if using CDN)
  return new Promise((resolve) => {
    if (typeof tailwind !== 'undefined') {
      // Give Tailwind a moment to process
      setTimeout(resolve, 500);
    } else {
      resolve();
    }
  });
})();
`;
}

/**
 * Browser-context script to detect if an element is unstyled
 */
export function getUnstyledDetectorScript(): string {
  return `
(function(element) {
  const style = window.getComputedStyle(element);

  // Check for default/unstyled indicators
  const isDefaultBg = style.backgroundColor === 'rgba(0, 0, 0, 0)' ||
                       style.backgroundColor === 'transparent';
  const isDefaultBorder = style.borderWidth === '0px' ||
                           style.borderStyle === 'none';
  const isDefaultFont = style.fontFamily.includes('serif') &&
                         !style.fontFamily.includes('sans-serif');

  // Element is considered unstyled if it has default appearance
  return isDefaultBg && isDefaultBorder;
})(arguments[0]);
`;
}
