import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs-extra';
import path from 'path';
import archiver from 'archiver';
import { URL } from 'url';

puppeteer.use(StealthPlugin());

const MAX_PAGES_RECURSIVE = 20;

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

function sanitizeFilename(url: string, index: number): string {
    try {
        const u = new URL(url);
        let name = u.hostname + u.pathname.replace(/\//g, '_');
        if (name.endsWith('_')) name = name.slice(0, -1);
        return `${index}_${name.replace(/[^a-z0-9]/gi, '_').substring(0, 100)}.png`;
    } catch {
        return `${index}_screenshot.png`;
    }
}

async function captureAndSave(page: any, url: string, downloadDir: string, index: number) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const cleanUrl = url.split('?')[0]; // simple cleanup
        const filename = sanitizeFilename(cleanUrl, index);
        await page.screenshot({ path: path.join(downloadDir, filename), fullPage: true });
        return true;
    } catch (e: any) {
        console.error(`Failed to capture ${url}: ${e.message}`);
        return false;
    }
}

// Extract internal links from the current page
async function getInternalLinks(page: any, baseUrl: string): Promise<string[]> {
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

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

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

        await browser.close();
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

    } catch (error: any) {
        console.error('Scraping error:', error);
        if (browser) await browser.close();
        return NextResponse.json({ error: error.message || 'Scraping failed' }, { status: 500 });
    }
}
