import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { browserPool } from '../../lib/browser-pool';
import { validateScrapingUrl } from '@/app/lib/validation';
import { getComponentDetectorScript, DetectionResult } from '@/app/lib/component-detector';
import { getStyleInjectorScript, ThemeType } from '@/app/lib/style-injector';
import { getVariantExtractorScript } from '@/app/lib/variant-extractor';
import fs from 'fs';
import path from 'path';

// Types for component-docs mode
type Mode = 'full-page' | 'component-docs';

interface ComponentDocsOptions {
    theme?: ThemeType;
    excludeSelectors?: string[];
}

// Figma tree node structure returned by the DOM serializer
interface FigmaTreeNode {
    type: string;
    name?: string;
    children?: FigmaTreeNode[];
    globalBounds?: { x: number; y: number; width: number; height: number };
    componentName?: string | null;
    componentVariant?: string | null;
    componentBounds?: { x: number; y: number; width: number; height: number };
    [key: string]: unknown;
}

interface ExtractedComponent {
    name: string;
    variant?: string;
    tree: FigmaTreeNode;
    bounds: { x: number; y: number; width: number; height: number };
}

interface ComponentDocsResponse {
    components: ExtractedComponent[];
    metadata: {
        pageTitle: string;
        libraryDetected: string | null;
        totalComponentsFound: number;
        themeApplied: string;
    };
}

// User-friendly error messages mapping
const ERROR_MESSAGES: Record<string, { message: string; suggestion: string }> = {
    'net::ERR_NAME_NOT_RESOLVED': {
        message: 'Could not find this website',
        suggestion: 'Please check the URL is spelled correctly and the website exists.'
    },
    'net::ERR_CONNECTION_REFUSED': {
        message: 'Connection refused by the website',
        suggestion: 'The website may be down or blocking automated access. Try again later.'
    },
    'net::ERR_CONNECTION_TIMED_OUT': {
        message: 'Connection timed out',
        suggestion: 'The website took too long to respond. It may be slow or experiencing issues.'
    },
    'net::ERR_SSL_PROTOCOL_ERROR': {
        message: 'SSL/Security error',
        suggestion: 'The website has security configuration issues. Try using http:// instead of https://'
    },
    'net::ERR_CERT_AUTHORITY_INVALID': {
        message: 'Invalid security certificate',
        suggestion: 'The website\'s security certificate is not trusted. The site may be unsafe.'
    },
    'Timeout': {
        message: 'Page load timeout',
        suggestion: 'The page took too long to load. Try a simpler page or check if the site is slow.'
    },
    'Navigation timeout': {
        message: 'Navigation timeout',
        suggestion: 'The page took too long to load. Try a simpler page or check your internet connection.'
    },
};

function getUserFriendlyError(error: Error): { error: string; suggestion?: string; details?: string } {
    const errorMessage = error.message || '';
    
    // Check for known error patterns
    for (const [pattern, friendly] of Object.entries(ERROR_MESSAGES)) {
        if (errorMessage.includes(pattern)) {
            return {
                error: friendly.message,
                suggestion: friendly.suggestion,
                details: errorMessage
            };
        }
    }
    
    // Check for specific error types
    if (errorMessage.includes('net::ERR_')) {
        return {
            error: 'Network error while accessing the website',
            suggestion: 'Please check your URL and try again. The website may be blocking automated access.',
            details: errorMessage
        };
    }
    
    if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        return {
            error: 'Access forbidden',
            suggestion: 'This website blocks automated scraping. Try using the Chrome Extension instead.',
            details: errorMessage
        };
    }
    
    if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
        return {
            error: 'Page not found',
            suggestion: 'The page doesn\'t exist. Please check the URL is correct.',
            details: errorMessage
        };
    }
    
    if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
        return {
            error: 'Rate limited',
            suggestion: 'Too many requests. Please wait a minute and try again.',
            details: errorMessage
        };
    }
    
    // Generic fallback
    return {
        error: 'Failed to scrape website',
        suggestion: 'An unexpected error occurred. Try a different URL or use the Chrome Extension for protected pages.',
        details: errorMessage
    };
}

export async function POST(request: Request) {
    let browser = null;
    
    try {
        let body;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json(
                { 
                    error: 'Invalid request format',
                    suggestion: 'Please send a valid JSON body with a "url" field.'
                }, 
                { status: 400 }
            );
        }
        
        const { url, mode = 'full-page', options = {} } = body as {
            url: string;
            mode?: Mode;
            options?: ComponentDocsOptions;
        };

        // Validate URL format and security
        const validation = validateScrapingUrl(url);
        if (!validation.valid) {
            return NextResponse.json(
                { 
                    error: validation.error,
                    suggestion: 'Please provide a valid public URL starting with http:// or https://'
                }, 
                { status: 400 }
            );
        }

        browser = await browserPool.acquire();
        const page = await browser.newPage();
        
        try {
            await page.setViewport({ width: 1440, height: 900 });
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

            // Scroll page to trigger lazy-loaded images
            await page.evaluate(async () => {
                const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                const scrollHeight = document.body.scrollHeight;
                const viewportHeight = window.innerHeight;

                // Scroll down in steps to trigger lazy loading
                for (let y = 0; y < scrollHeight; y += viewportHeight) {
                    window.scrollTo(0, y);
                    await delay(100); // Wait for lazy images to start loading
                }

                // Scroll back to top
                window.scrollTo(0, 0);
                await delay(200);
            });

            // Wait for images to load (with timeout)
            await page.evaluate(async () => {
                const images = Array.from(document.querySelectorAll('img'));
                const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

                // Wait up to 3 seconds for images to load
                const timeout = Date.now() + 3000;
                while (Date.now() < timeout) {
                    const unloaded = images.filter(img => !img.complete || img.naturalHeight === 0);
                    if (unloaded.length === 0) break;
                    await delay(100);
                }
            });

            // Inject the shared serializer
            const serializerPath = path.join(process.cwd(), 'app/lib/dom-serializer.js');
            const serializerCode = fs.readFileSync(serializerPath, 'utf8');

            // Execute the library code to define window.FigmaSerializer
            await page.evaluate(serializerCode);

            // COMPONENT-DOCS MODE
            if (mode === 'component-docs') {
                const theme = options.theme || 'tailwind';

                // 1. Inject styles for unstyled components
                if (theme === 'tailwind') {
                    const styleInjectorScript = getStyleInjectorScript(theme);
                    await page.evaluate(styleInjectorScript);
                    // Wait for Tailwind CDN to load and process
                    await page.waitForFunction(() => typeof (window as unknown as { tailwind?: unknown }).tailwind !== 'undefined', { timeout: 5000 }).catch(() => {
                        console.log('Tailwind CDN did not load, continuing without it');
                    });
                    // Additional wait for styles to apply
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                // 2. Detect components on the page
                const detectorScript = getComponentDetectorScript();
                const detectionResult = await page.evaluate(detectorScript) as DetectionResult;

                if (detectionResult.totalFound === 0) {
                    await page.close();
                    await browserPool.release(browser);
                    return NextResponse.json({
                        error: 'No components detected',
                        suggestion: 'The page may not have recognizable component demos. Try a different documentation page.',
                    }, { status: 404 });
                }

                // 3. Extract variant information
                const variantScript = getVariantExtractorScript();
                const selectors = detectionResult.components.map(c => c.selector);
                const variantInfo = await page.evaluate(variantScript, selectors) as Array<{
                    name: string | null;
                    variant: string | null;
                    structureHash: string;
                    tagStructure: string;
                } | null>;

                // 4. Serialize each detected component
                const extractedComponents: ExtractedComponent[] = [];

                for (let i = 0; i < detectionResult.components.length; i++) {
                    const detected = detectionResult.components[i];
                    const variant = variantInfo[i];

                    try {
                        const componentTree = await page.evaluate(
                            (selector: string, name: string, variantName: string | null) => {
                                const element = document.querySelector(selector);
                                if (!element) return null;
                                // @ts-expect-error FigmaSerializer is injected at runtime
                                return window.FigmaSerializer.serializeElement(element, {
                                    name,
                                    variant: variantName
                                });
                            },
                            detected.selector,
                            variant?.name || detected.name,
                            variant?.variant || detected.variant || null
                        );

                        if (componentTree) {
                            extractedComponents.push({
                                name: variant?.name || detected.name,
                                variant: variant?.variant || detected.variant,
                                tree: componentTree,
                                bounds: detected.bounds,
                            });
                        }
                    } catch (e) {
                        console.warn(`Failed to serialize component: ${detected.selector}`, e);
                    }
                }

                // Get page title
                const pageTitle = await page.title();

                await page.close();
                await browserPool.release(browser);

                if (extractedComponents.length === 0) {
                    return NextResponse.json({
                        error: 'Failed to extract components',
                        suggestion: 'Components were detected but could not be serialized. The page structure may be unsupported.',
                    }, { status: 500 });
                }

                const response: ComponentDocsResponse = {
                    components: extractedComponents,
                    metadata: {
                        pageTitle,
                        libraryDetected: detectionResult.libraryDetected,
                        totalComponentsFound: extractedComponents.length,
                        themeApplied: theme,
                    },
                };

                return NextResponse.json({
                    message: `Extracted ${extractedComponents.length} component(s)`,
                    mode: 'component-docs',
                    ...response,
                });
            }

            // FULL-PAGE MODE (default)
            const figmaTree = await page.evaluate(() => {
                // @ts-expect-error FigmaSerializer is injected at runtime
                return window.FigmaSerializer.serialize(document.body);
            });

            await page.close();
            await browserPool.release(browser);

            // Check if we got valid data
            if (!figmaTree || (figmaTree.type === 'FRAME' && (!figmaTree.children || figmaTree.children.length === 0))) {
                return NextResponse.json({
                    message: 'Scraping completed but page appears empty',
                    warning: 'The page may use client-side rendering. Try the Chrome Extension for better results.',
                    data: figmaTree,
                });
            }

            return NextResponse.json({
                message: 'Scraping successful',
                data: figmaTree,
            });

        } catch (error) {
            await page.close().catch(() => {});
            throw error;
        }

    } catch (error) {
        const errorInstance = error instanceof Error ? error : new Error(String(error));
        console.error('Scraping failed:', errorInstance);
        if (browser) await browserPool.release(browser);

        const friendlyError = getUserFriendlyError(errorInstance);
        return NextResponse.json(friendlyError, { status: 500 });
    }
}
