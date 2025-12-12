import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs-extra';
import path from 'path';
import https from 'https';
import archiver from 'archiver';

puppeteer.use(StealthPlugin());

// Helper functions (same as before)
async function autoScroll(page: any) {
    await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                // Scroll limit
                if (totalHeight >= scrollHeight || totalHeight > 20000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

function downloadImage(url: string, filepath: string) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(filepath);
            reject(err);
        });
    });
}

function zipDirectory(sourceDir: string, outPath: string) {
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

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
        return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    let browser = null;
    const downloadDir = path.join(process.cwd(), 'downloads', username);
    const zipPath = path.join(process.cwd(), 'downloads', `${username}.zip`);

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });

        console.log(`Navigating to https://dribbble.com/${username}`);
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
            } catch (err: any) {
                console.error(`Failed to scrape shot ${link}:`, err.message);
            }
        }

        await browser.close();
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

    } catch (error: any) {
        console.error('Scraping error:', error);
        if (browser) await browser.close();
        return NextResponse.json({ error: error.message || 'Scraping failed' }, { status: 500 });
    }
}
