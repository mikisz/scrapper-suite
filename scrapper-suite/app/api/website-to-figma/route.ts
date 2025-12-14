import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { browserPool } from '../../lib/browser-pool';
import { validateScrapingUrl } from '@/app/lib/validation';
import fs from 'fs';
import path from 'path';

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
        
        const { url } = body;

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

            // Run the serialization
            const figmaTree = await page.evaluate(() => {
                // @ts-expect-error FigmaSerializer is injected by serializerCode
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
