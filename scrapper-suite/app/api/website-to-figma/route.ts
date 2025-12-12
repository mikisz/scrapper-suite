import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

export async function POST(request: Request) {
    try {
        const { url } = await request.json();

        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await browser.newPage();
        try {
            await page.setViewport({ width: 1440, height: 900 });
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

            // Inject the shared serializer
            // We read the file content and inject it into the page
            const fs = require('fs');
            const path = require('path');
            const serializerPath = path.join(process.cwd(), 'app/lib/dom-serializer.js');
            const serializerCode = fs.readFileSync(serializerPath, 'utf8');

            // Execute the library code to define window.FigmaSerializer
            await page.evaluate(serializerCode);

            // Run the serialization
            const figmaTree = await page.evaluate(() => {
                // @ts-ignore
                return window.FigmaSerializer.serialize(document.body);
            });

            await browser.close();

            return NextResponse.json({
                message: 'Scraping successful',
                data: figmaTree,
            });

        } catch (error) {
            await browser.close();
            throw error;
        }

    } catch (error: any) {
        console.error('Scraping failed:', error);
        return NextResponse.json(
            { error: 'Failed to scrape website', details: error.message },
            { status: 500 }
        );
    }
}
