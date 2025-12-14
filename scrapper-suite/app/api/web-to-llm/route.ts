import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { browserPool } from '../../lib/browser-pool';
import { zipDirectory } from '../../lib/archive';
import { sanitizeImageFilename } from '../../lib/sanitize';
import fs from 'fs-extra';
import path from 'path';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { URL } from 'url';
import { validateScrapingUrl } from '@/app/lib/validation';
import { dismissCookieModals, hasCookieModal } from '@/app/lib/cookie-dismissal';
import { crawlWebsite, buildLinkGraph } from '@/app/lib/crawler';
import { normalizeUrl } from '@/app/lib/url-normalizer';

async function downloadImage(url: string, filepath: string) {
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScrapperSuite/1.0)' }
        });
        if (!response.ok) throw new Error(`Status ${response.status}`);

        const buffer = await response.arrayBuffer();
        await fs.writeFile(filepath, Buffer.from(buffer));
    } catch (error) {
        throw error;
    }
}

interface ProcessedPage {
    filePath: string;
    title: string;
    url: string;
    wordCount: number;
    imageCount: number;
}

/**
 * Process a single page's HTML content into markdown/html with images
 * @param relativeImagePath - relative path from the page file to images dir (e.g., "../images" for nested pages)
 */
async function processPageContent(
    html: string,
    pageUrl: string,
    format: 'markdown' | 'html',
    cleanup: 'article' | 'full',
    imagesDir: string,
    imagePrefix: string,
    relativeImagePath: string = 'images'
): Promise<{ content: string; imageCount: number; textContent: string }> {
    // Process with JSDOM
    const dom = new JSDOM(html, { url: pageUrl });
    let document = dom.window.document;

    // Cleanup if requested
    if (cleanup === 'article') {
        const reader = new Readability(document);
        const article = reader.parse();
        if (article && article.content) {
            // Create a new clean DOM from article content
            const cleanDom = new JSDOM(article.content, { url: pageUrl });
            document = cleanDom.window.document;

            // Construct Rich Metadata Header
            const header = document.createElement('div');
            const siteName = article.siteName || new URL(pageUrl).hostname;
            const author = article.byline || 'Unknown Author';

            let headerHTML = `
                <h1>${article.title || 'Untitled'}</h1>
                <p><em>Source: ${siteName} | Author: ${author}</em></p>
                <hr/>
            `;

            if (article.excerpt) {
                headerHTML += `<blockquote>${article.excerpt}</blockquote><hr/>`;
            }

            header.innerHTML = headerHTML;
            document.body.prepend(header);
        }
    }

    // Process Images
    const imgs = Array.from(document.querySelectorAll('img'));
    let imageCount = 0;
    for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        const src = img.src;

        if (src && !src.startsWith('data:')) {
            const filename = `${imagePrefix}_${i}_${sanitizeImageFilename(src)}`;
            const localPath = path.join(imagesDir, filename);

            try {
                await downloadImage(src, localPath);
                // Use the relative path from page to images directory
                img.src = `${relativeImagePath}/${filename}`;
                img.removeAttribute('srcset');
                imageCount++;
            } catch (e) {
                console.error(`Failed to download ${src}:`, e);
            }
        }
    }

    // Extract text content for accurate word count (before converting to final format)
    const textContent = document.body.textContent || '';

    let finalContent = '';
    if (format === 'markdown') {
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        });
        finalContent = turndownService.turndown(document.body.innerHTML);
    } else {
        finalContent = document.body.innerHTML;
    }

    return { content: finalContent, imageCount, textContent };
}

/**
 * Generate sitemap markdown file
 */
function generateSitemap(
    pages: ProcessedPage[],
    baseUrl: string,
    format: 'markdown' | 'html',
    crawlDate: Date
): string {
    const ext = format === 'markdown' ? '.md' : '.html';
    const hostname = new URL(baseUrl).hostname;

    let sitemap = `# Site Map: ${hostname}\n\n`;
    sitemap += `Crawled on: ${crawlDate.toISOString()}\n`;
    sitemap += `Total pages: ${pages.length}\n`;
    sitemap += `Format: ${format === 'markdown' ? 'Markdown' : 'HTML'}\n\n`;
    sitemap += `## Pages\n\n`;

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        sitemap += `${i + 1}. [${page.title || 'Untitled'}](pages/${page.filePath}${ext}) - ${page.wordCount} words, ${page.imageCount} images\n`;
        sitemap += `   - URL: ${page.url}\n`;
    }

    return sitemap;
}

/**
 * Generate metadata JSON file
 */
function generateMetadata(
    pages: ProcessedPage[],
    baseUrl: string,
    crawlDate: Date,
    duration: number,
    linkGraph: Map<string, any>,
    format: 'markdown' | 'html'
): object {
    const ext = format === 'markdown' ? '.md' : '.html';
    return {
        crawlDate: crawlDate.toISOString(),
        startUrl: baseUrl,
        totalPages: pages.length,
        totalImages: pages.reduce((sum, p) => sum + p.imageCount, 0),
        totalWords: pages.reduce((sum, p) => sum + p.wordCount, 0),
        crawlDurationMs: duration,
        format,
        pages: pages.map(page => {
            const graphNode = linkGraph.get(normalizeUrl(page.url));
            return {
                url: page.url,
                file: `pages/${page.filePath}${ext}`,
                title: page.title,
                wordCount: page.wordCount,
                imageCount: page.imageCount,
                outgoingLinks: graphNode?.outgoingLinks?.length || 0,
                incomingLinks: graphNode?.incomingLinks?.length || 0
            };
        })
    };
}

export async function POST(request: Request) {
    let browser = null;
    const jobId = Date.now().toString();
    const jobDir = path.join(process.cwd(), 'downloads', `llm_${jobId}`);
    const imagesDir = path.join(jobDir, 'images');
    const pagesDir = path.join(jobDir, 'pages');
    const zipPath = path.join(process.cwd(), 'downloads', `llm_${jobId}.zip`);

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

        const {
            url,
            format: rawFormat = 'markdown',
            cleanup: rawCleanup = 'article',
            includePdf = false,
            // New options
            mode: rawMode = 'single',
            maxPages: rawMaxPages = 20,
            dismissCookies: rawDismissCookies = true
        } = body;

        // Validate and sanitize options
        const format = rawFormat === 'html' ? 'html' : 'markdown';
        const cleanup = rawCleanup === 'full' ? 'full' : 'article';
        const mode = rawMode === 'crawl' ? 'crawl' : 'single';
        const dismissCookies = Boolean(rawDismissCookies);

        // Validate and clamp maxPages (1-500 range, reasonable limit)
        const maxPages = Math.min(500, Math.max(1, Number(rawMaxPages) || 20));

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

        await fs.ensureDir(jobDir);
        await fs.ensureDir(imagesDir);

        browser = await browserPool.acquire();
        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });

        if (mode === 'crawl') {
            // ============== CRAWL MODE ==============
            await fs.ensureDir(pagesDir);

            console.log(`Starting crawl of ${url} (max ${maxPages} pages)`);

            const crawlResult = await crawlWebsite(page, {
                maxPages,
                baseUrl: url,
                dismissCookies,
                delayBetweenRequests: 500,
                timeout: 30000
            }, (progress) => {
                console.log(`Crawling [${progress.processed}/${progress.total}]: ${progress.currentUrl}`);
            });

            console.log(`Crawl complete: ${crawlResult.successfulPages} pages, ${crawlResult.failedPages} errors`);

            // Process each successful page
            const processedPages: ProcessedPage[] = [];
            const ext = format === 'markdown' ? '.md' : '.html';

            for (const result of crawlResult.results) {
                if (result.error) {
                    console.log(`Skipping failed page: ${result.url}`);
                    continue;
                }

                const filePath = result.filePath;
                const pageFileDir = path.join(pagesDir, path.dirname(filePath));
                await fs.ensureDir(pageFileDir);

                // Compute relative path from page file location to images directory
                // Pages are in pages/<path>/, images are in images/
                const fullPagePath = path.join(pagesDir, filePath);
                const relativeImagePath = path.relative(path.dirname(fullPagePath), imagesDir).replace(/\\/g, '/') || 'images';

                const { content, imageCount, textContent } = await processPageContent(
                    result.html,
                    result.url,
                    format,
                    cleanup,
                    imagesDir,
                    filePath.replace(/\//g, '_'),
                    relativeImagePath
                );

                const fullPath = path.join(pagesDir, `${filePath}${ext}`);
                await fs.writeFile(fullPath, content);

                // Use textContent for accurate word count (excludes HTML tags)
                const wordCount = textContent.split(/\s+/).filter(Boolean).length;

                processedPages.push({
                    filePath,
                    title: result.title,
                    url: result.url,
                    wordCount,
                    imageCount
                });
            }

            // Build link graph for metadata
            const linkGraph = buildLinkGraph(crawlResult.results);

            // Generate sitemap
            const crawlDate = new Date();
            const sitemap = generateSitemap(processedPages, url, format, crawlDate);
            await fs.writeFile(path.join(jobDir, 'sitemap.md'), sitemap);

            // Generate metadata JSON
            const metadata = generateMetadata(
                processedPages,
                url,
                crawlDate,
                crawlResult.crawlDuration,
                linkGraph,
                format
            );
            await fs.writeFile(
                path.join(jobDir, 'metadata.json'),
                JSON.stringify(metadata, null, 2)
            );

            // Close browser before zipping
            await page.close();
            await browserPool.release(browser);
            browser = null;

        } else {
            // ============== SINGLE PAGE MODE ==============
            console.log(`Navigating to ${url}`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // Dismiss cookie modals if enabled
            if (dismissCookies) {
                const dismissResult = await dismissCookieModals(page);
                if (dismissResult.dismissed) {
                    console.log(`Cookie modal dismissed via ${dismissResult.method}: ${dismissResult.selector}`);
                    // Wait for modal to close by polling for its absence
                    for (let i = 0; i < 10; i++) {
                        if (!(await hasCookieModal(page))) break;
                        await new Promise(r => setTimeout(r, 100));
                    }
                }
            }

            // Optional PDF
            if (includePdf) {
                await page.pdf({
                    path: path.join(jobDir, 'page.pdf'),
                    format: 'A4',
                    printBackground: true
                });
            }

            // Get HTML content
            const contentHtml = await page.content();

            await page.close();
            await browserPool.release(browser);
            browser = null;

            // Process the page
            const { content } = await processPageContent(
                contentHtml,
                url,
                format,
                cleanup,
                imagesDir,
                'page'
            );

            const ext = format === 'markdown' ? '.md' : '.html';
            await fs.writeFile(path.join(jobDir, `content${ext}`), content);
        }

        // Zip it
        await zipDirectory(jobDir, zipPath);
        await fs.remove(jobDir);

        const fileBuffer = await fs.readFile(zipPath);
        await fs.remove(zipPath);

        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="llm-export.zip"`,
            },
        });

    } catch (error: any) {
        console.error('LLM Scraper error:', error);
        if (browser) await browserPool.release(browser);

        // Clean up any partial files
        try {
            await fs.remove(jobDir).catch(() => {});
            await fs.remove(zipPath).catch(() => {});
        } catch {
            // Ignore cleanup errors
        }

        // User-friendly error messages
        const errorMessage = error.message || '';
        let userError = 'Processing failed';
        let suggestion = 'Please try again or use a different URL.';

        if (errorMessage.includes('net::ERR_NAME_NOT_RESOLVED')) {
            userError = 'Could not find this website';
            suggestion = 'Please check the URL is spelled correctly.';
        } else if (errorMessage.includes('net::ERR_CONNECTION')) {
            userError = 'Could not connect to the website';
            suggestion = 'The website may be down or blocking access.';
        } else if (errorMessage.includes('Timeout') || errorMessage.includes('timeout')) {
            userError = 'Page load timeout';
            suggestion = 'The page took too long to load. Try again or use a simpler page.';
        } else if (errorMessage.includes('net::ERR_')) {
            userError = 'Network error';
            suggestion = 'Could not access the website. It may be protected or unavailable.';
        }

        return NextResponse.json(
            {
                error: userError,
                suggestion,
                details: errorMessage
            },
            { status: 500 }
        );
    }
}
