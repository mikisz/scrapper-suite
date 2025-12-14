import { NextResponse } from 'next/server';
import { browserPool } from '../../lib/browser-pool';
import { zipDirectory } from '../../lib/archive';
import { autoScroll } from '../../lib/puppeteer-utils';
import { logger } from '@/app/lib/logger';
import { applyRateLimit, RATE_LIMITS } from '@/app/lib/rate-limiter';
import fs from 'fs-extra';
import path from 'path';

// Safety limits
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT_MS = 10000; // 10 seconds

async function downloadImage(url: string, filepath: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScrapperSuite/1.0)' }
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Status ${response.status}`);

        // Check content-length early to reject oversized images
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        if (contentLength > MAX_IMAGE_SIZE_BYTES) {
            throw new Error('Image too large (max 10MB)');
        }

        const buffer = await response.arrayBuffer();

        // Double-check size after download
        if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
            throw new Error('Image too large (max 10MB)');
        }

        await fs.writeFile(filepath, Buffer.from(buffer));
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

export async function GET(request: Request) {
    // Apply rate limiting
    const rateLimitResponse = applyRateLimit(request, 'dribbble', RATE_LIMITS.scraping);
    if (rateLimitResponse) return rateLimitResponse;

    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
        return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    let browser = null;
    const downloadDir = path.join(process.cwd(), 'downloads', username);
    const zipPath = path.join(process.cwd(), 'downloads', `${username}.zip`);

    try {
        browser = await browserPool.acquire();

        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });

        logger.info('Navigating to Dribbble profile', { username });
        await page.goto(`https://dribbble.com/${username}`, { waitUntil: 'networkidle2', timeout: 60000 });

        // Check if user exists
        const isError = await page.evaluate(() => {
            const h1 = document.querySelector('h1');
            return !!document.querySelector('.error-container') || (h1 && (h1 as HTMLElement).innerText === 'Whoops, that page is gone.');
        });

        if (isError) {
            throw new Error('User not found');
        }

        await autoScroll(page);

        const shotLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a.shot-thumbnail-link'));
            return links.map((link) => (link as HTMLAnchorElement).href);
        });

        const linksToScrape = shotLinks.slice(0, 50); // Limit 50
        await fs.ensureDir(downloadDir);

        for (let i = 0; i < linksToScrape.length; i++) {
            const link = linksToScrape[i];
            try {
                // Delay
                await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));

                await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });

                const imageUrl = await page.evaluate(() => {
                    const highResLink = document.querySelector('a[href^="https://cdn.dribbble.com/userupload/"]');
                    if (highResLink) return (highResLink as HTMLAnchorElement).href;

                    const mediaImg = document.querySelector('.media-item img');
                    if (mediaImg) return (mediaImg as HTMLImageElement).src;

                    return null;
                });

                if (imageUrl) {
                    const cleanUrl = imageUrl.split('?')[0];
                    const ext = path.extname(cleanUrl) || '.jpg';
                    const filename = `${username}_shot_${i + 1}${ext}`;
                    await downloadImage(cleanUrl, path.join(downloadDir, filename));
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logger.error('Failed to scrape shot', { link, error: message });
            }
        }

        await browserPool.release(browser);
        browser = null;

        await zipDirectory(downloadDir, zipPath);
        await fs.remove(downloadDir);

        // Read zip file
        const fileBuffer = await fs.readFile(zipPath);

        // Clean up zip after reading
        await fs.remove(zipPath);

        // Return the file
        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${username}-shots.zip"`,
            },
        });

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Scraping error', error);
        if (browser) await browserPool.release(browser);
        return NextResponse.json({ error: message || 'Scraping failed' }, { status: 500 });
    }
}
