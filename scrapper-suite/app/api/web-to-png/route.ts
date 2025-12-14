import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { browserPool } from '../../lib/browser-pool';
import { zipDirectory } from '../../lib/archive';
import { sanitizeScreenshotFilename } from '../../lib/sanitize';
import fs from 'fs-extra';
import path from 'path';
import { URL } from 'url';

const MAX_PAGES_RECURSIVE = 20;

async function captureAndSave(page: import('puppeteer').Page, url: string, downloadDir: string, index: number) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const cleanUrl = url.split('?')[0]; // simple cleanup
        const filename = sanitizeScreenshotFilename(cleanUrl, index);
        await page.screenshot({ path: path.join(downloadDir, filename), fullPage: true });
        return true;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`Failed to capture ${url}: ${message}`);
        return false;
    }
}

// Extract internal links from the current page
async function getInternalLinks(page: import('puppeteer').Page, baseUrl: string): Promise<string[]> {
    return await page.evaluate((baseUrl: string) => {
        const links = Array.from(document.querySelectorAll('a'));
        return links
            .map(link => link.href)
            .filter(href => href.startsWith(baseUrl))
            .filter(href => !href.includes('#')) // ignore anchors
            .filter(href => !href.match(/\.(png|jpg|jpeg|gif|pdf|zip)$/i)); // ignore assets
    }, baseUrl);
}

export async function POST(request: Request) {
    let browser = null;
    const downloadId = Date.now().toString();
    const downloadDir = path.join(process.cwd(), 'downloads', `web_${downloadId}`);
    const zipPath = path.join(process.cwd(), 'downloads', `web_${downloadId}.zip`);

    try {
        const body = await request.json();
        const { mode, url, urls } = body; // mode: 'recursive' | 'bulk'

        await fs.ensureDir(downloadDir);

        browser = await browserPool.acquire();
        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });

        if (mode === 'recursive') {
            if (!url) throw new Error('URL is required for recursive mode');

            const visited = new Set<string>();
            const queue: string[] = [url];
            const baseUrl = new URL(url).origin;
            let count = 0;

            while (queue.length > 0 && count < MAX_PAGES_RECURSIVE) {
                const currentUrl = queue.shift()!;
                if (visited.has(currentUrl)) continue;

                visited.add(currentUrl);
                console.log(`Processing [${count + 1}/${MAX_PAGES_RECURSIVE}]: ${currentUrl}`);

                const success = await captureAndSave(page, currentUrl, downloadDir, count + 1);
                if (success) {
                    // Only find new links if we successfully loaded the page
                    const links = await getInternalLinks(page, baseUrl);
                    for (const link of links) {
                        if (!visited.has(link)) {
                            queue.push(link);
                        }
                    }
                }
                count++;
            }
        } else if (mode === 'bulk') {
            if (!urls || !Array.isArray(urls)) throw new Error('URLs array is required for bulk mode');

            for (let i = 0; i < urls.length; i++) {
                const currentUrl = urls[i];
                console.log(`Processing [${i + 1}/${urls.length}]: ${currentUrl}`);
                await captureAndSave(page, currentUrl, downloadDir, i + 1);
            }
        } else {
            throw new Error('Invalid mode');
        }

        await page.close();
        await browserPool.release(browser);
        browser = null;

        await zipDirectory(downloadDir, zipPath);
        await fs.remove(downloadDir);

        const fileBuffer = await fs.readFile(zipPath);
        await fs.remove(zipPath);

        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="screenshots.zip"`,
            },
        });

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Scraping error:', error);
        if (browser) await browserPool.release(browser);
        return NextResponse.json({ error: message || 'Scraping failed' }, { status: 500 });
    }
}
