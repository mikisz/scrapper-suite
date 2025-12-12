import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { browserPool } from '../../lib/browser-pool';
import fs from 'fs-extra';
import path from 'path';
import archiver from 'archiver';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { URL } from 'url';
import { validateScrapingUrl } from '@/app/lib/validation';

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

async function zipDirectory(sourceDir: string, outPath: string) {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(outPath);

    return new Promise<void>((resolve, reject) => {
        archive
            .directory(sourceDir, false)
            .on('error', (err: any) => reject(err))
            .pipe(stream);

        stream.on('close', () => resolve());
        archive.finalize();
    });
}

function sanitizeFilename(url: string): string {
    try {
        const u = new URL(url);
        const basename = path.basename(u.pathname) || 'image';
        // Remove query params and weird chars
        const cleanName = basename.split('?')[0].replace(/[^a-z0-9\._-]/gi, '_');
        // Ensure extension
        if (!cleanName.includes('.')) return `${cleanName}.png`;
        return cleanName;
    } catch {
        return `image_${Date.now()}.png`;
    }
}

export async function POST(request: Request) {
    let browser = null;
    const jobId = Date.now().toString();
    const jobDir = path.join(process.cwd(), 'downloads', `llm_${jobId}`);
    const imagesDir = path.join(jobDir, 'images');
    const zipPath = path.join(process.cwd(), 'downloads', `llm_${jobId}.zip`);

    try {
        const body = await request.json();
        const { url, format, cleanup, includePdf } = body;
        // format: 'markdown' | 'html'
        // cleanup: 'article' | 'full'

        // Validate URL format and security
        const validation = validateScrapingUrl(url);
        if (!validation.valid) {
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        await fs.ensureDir(jobDir);
        await fs.ensureDir(imagesDir);

        browser = await browserPool.acquire();
        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });

        console.log(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Optional PDF
        if (includePdf) {
            await page.pdf({
                path: path.join(jobDir, 'page.pdf'),
                format: 'A4',
                printBackground: true
            });
        }

        // Get HTML content
        let contentHtml = await page.content();
        const docUrl = new URL(url);

        await page.close();
        await browserPool.release(browser);
        browser = null;

        // Process with JSDOM
        const dom = new JSDOM(contentHtml, { url });
        let document = dom.window.document;

        // Cleanup if requested
        if (cleanup === 'article') {
            const reader = new Readability(document);
            const article = reader.parse();
            if (article && article.content) {
                // Create a new clean DOM from article content
                const cleanDom = new JSDOM(article.content, { url });
                document = cleanDom.window.document;

                // Construct Rich Metadata Header
                const header = document.createElement('div');
                const siteName = article.siteName || new URL(url).hostname;
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
        for (let i = 0; i < imgs.length; i++) {
            const img = imgs[i];
            const src = img.src; // JSDOM handles absolute paths if URL is provided

            if (src && !src.startsWith('data:')) {
                const filename = `${i}_${sanitizeFilename(src)}`;
                const localPath = path.join(imagesDir, filename);

                try {
                    await downloadImage(src, localPath);
                    // Update SRC to relative path for Zip
                    img.src = `images/${filename}`;
                    img.removeAttribute('srcset'); // Remove srcset to avoid confusion
                } catch (e) {
                    console.error(`Failed to download ${src}:`, e);
                    // Keep original src if download fails, or mark broken?
                }
            }
        }

        let finalContent = '';
        if (format === 'markdown') {
            const turndownService = new TurndownService({
                headingStyle: 'atx',
                codeBlockStyle: 'fenced'
            });
            finalContent = turndownService.turndown(document.body.innerHTML);
            await fs.writeFile(path.join(jobDir, 'content.md'), finalContent);
        } else {
            // Raw HTML
            finalContent = document.body.innerHTML;
            await fs.writeFile(path.join(jobDir, 'content.html'), finalContent);
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
        return NextResponse.json({ error: error.message || 'Processing failed' }, { status: 500 });
    }
}
