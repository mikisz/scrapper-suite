import { NextRequest, NextResponse } from 'next/server';
import { validateImageUrl } from '@/app/lib/validation';

export const dynamic = 'force-dynamic'; // Prevent static caching

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get('url');

    // Validate URL format and security
    const validation = validateImageUrl(url || '');
    if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // URL is guaranteed to be valid after validation
    const validatedUrl = url as string;

    try {
        const response = await fetch(validatedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            return NextResponse.json({ error: `Failed to fetch image: ${response.statusText}` }, { status: response.status });
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        return new NextResponse(buffer, {
            headers: {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*', // Critical for Figma Plugin
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
    } catch (error: any) {
        console.error('Image Proxy Error:', error);
        return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
    }
}
