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

            // Run code inside the browser to extract the visual tree
            const figmaTree = await page.evaluate(() => {
                function getRgb(color: string) {
                    if (!color) return null;
                    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                    if (match) {
                        return {
                            r: parseInt(match[1]) / 255,
                            g: parseInt(match[2]) / 255,
                            b: parseInt(match[3]) / 255,
                        };
                    }
                    return null;
                }

                function parseUnit(val: string) {
                    return parseFloat(val) || 0;
                }

                function isVisible(el: HTMLElement) {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                }

                function analyzeNode(node: Node): any {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const textContent = node.textContent?.trim();
                        if (!textContent) return null;
                        return {
                            type: 'TEXT',
                            content: textContent,
                        };
                    }

                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as HTMLElement;
                        if (!isVisible(el)) return null;

                        const computed = window.getComputedStyle(el);
                        const rect = el.getBoundingClientRect();

                        // Skip tiny elements or empty containers that aren't strictly explicit spacing
                        if (rect.width === 0 || rect.height === 0) return null;

                        const styles = {
                            width: rect.width,
                            height: rect.height,
                            display: computed.display,
                            flexDirection: computed.flexDirection,
                            justifyContent: computed.justifyContent,
                            alignItems: computed.alignItems,
                            gap: parseUnit(computed.gap),
                            padding: {
                                top: parseUnit(computed.paddingTop),
                                right: parseUnit(computed.paddingRight),
                                bottom: parseUnit(computed.paddingBottom),
                                left: parseUnit(computed.paddingLeft),
                            },
                            backgroundColor: getRgb(computed.backgroundColor),
                            borderRadius: {
                                topLeft: parseUnit(computed.borderTopLeftRadius),
                                topRight: parseUnit(computed.borderTopRightRadius),
                                bottomRight: parseUnit(computed.borderBottomRightRadius),
                                bottomLeft: parseUnit(computed.borderBottomLeftRadius),
                            },
                            color: getRgb(computed.color),
                            fontSize: parseUnit(computed.fontSize),
                            fontWeight: computed.fontWeight,
                            fontFamily: computed.fontFamily,
                            lineHeight: computed.lineHeight,
                            textAlign: computed.textAlign,
                        };

                        const children: any[] = [];
                        node.childNodes.forEach(child => {
                            const result = analyzeNode(child);
                            if (result) children.push(result);
                        });

                        // Special handling for leaf nodes that act as text containers
                        if (children.length === 1 && children[0].type === 'TEXT') {
                            // Merge text properties into this node
                            return {
                                type: 'TEXT_NODE',
                                ...styles,
                                content: children[0].content
                            };
                        }

                        return {
                            type: 'FRAME',
                            tag: el.tagName.toLowerCase(),
                            styles,
                            children,
                        };
                    }
                    return null;
                }

                return analyzeNode(document.body);
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
