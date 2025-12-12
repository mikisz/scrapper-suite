import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { browserPool } from '../../lib/browser-pool';
import { validateScrapingUrl } from '@/app/lib/validation';
import fs from 'fs';
import path from 'path';

export async function POST(request: Request) {
    let browser = null;
    
    try {
        const { url } = await request.json();

        // Validate URL format and security
        const validation = validateScrapingUrl(url);
        if (!validation.valid) {
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        browser = await browserPool.acquire();
        const page = await browser.newPage();
        
        try {
            await page.setViewport({ width: 1440, height: 900 });
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

            // Inject the shared serializer
            const serializerPath = path.join(process.cwd(), 'app/lib/dom-serializer.js');
            const serializerCode = fs.readFileSync(serializerPath, 'utf8');

            // Execute the library code to define window.FigmaSerializer
            await page.evaluate(serializerCode);

            // Run the serialization
            const figmaTree = await page.evaluate(() => {
                // @ts-ignore
                return window.FigmaSerializer.serialize(document.body);
            });

            await page.close();
            await browserPool.release(browser);

            return NextResponse.json({
                message: 'Scraping successful',
                data: figmaTree,
            });

        } catch (error) {
            await page.close().catch(() => {});
            throw error;
        }

    } catch (error: any) {
        console.error('Scraping failed:', error);
        if (browser) await browserPool.release(browser);
        return NextResponse.json(
            { error: 'Failed to scrape website', details: error.message },
            { status: 500 }
        );
    }
}
