import { NextRequest, NextResponse } from 'next/server';
import { validateImageUrl } from '@/app/lib/validation';
import { logger } from '@/app/lib/logger';
import { applyRateLimit, RATE_LIMITS } from '@/app/lib/rate-limiter';
import sharp from 'sharp';

export const dynamic = 'force-dynamic'; // Prevent static caching

// Formats that Figma doesn't support natively or may have issues with
// Note: While Figma technically supports JPG/JPEG, some JPGs (progressive, CMYK, etc.)
// can fail, so we convert everything to PNG for maximum compatibility
const UNSUPPORTED_FORMATS = ['image/webp', 'image/avif', 'image/heic', 'image/heif'];

// All image formats that should be converted to PNG for reliability
// This ensures maximum compatibility with Figma's createImage API
const SHOULD_CONVERT_TO_PNG = [
    'image/webp', 'image/avif', 'image/heic', 'image/heif',
    'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/tiff'
];

// Safety limits
const FETCH_TIMEOUT_MS = 20000; // 20 seconds (increased for large hero images)
const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB (increased for hero images)

export async function GET(request: NextRequest) {
    // Apply rate limiting (higher limit for proxy endpoint)
    const rateLimitResponse = applyRateLimit(request, 'proxy-image', RATE_LIMITS.proxy);
    if (rateLimitResponse) return rateLimitResponse;

    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get('url');

    // Validate URL format and security
    const validation = validateImageUrl(url || '');
    if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // URL is guaranteed to be valid after validation
    const validatedUrl = url as string;

    // Set up abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(validatedUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return NextResponse.json({ error: `Failed to fetch image: ${response.statusText}` }, { status: response.status });
        }

        // Check content-length if available to reject oversized images early
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        if (contentLength > MAX_IMAGE_SIZE_BYTES) {
            return NextResponse.json({ error: 'Image too large (max 10MB)' }, { status: 413 });
        }

        let contentType = response.headers.get('content-type') || 'application/octet-stream';
        // Normalize content-type (remove charset and parameters like "image/webp; charset=utf-8")
        const normalizedContentType = contentType.split(';')[0].trim().toLowerCase();

        const arrayBuffer = await response.arrayBuffer();

        // Double-check size after download (content-length isn't always accurate)
        if (arrayBuffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
            return NextResponse.json({ error: 'Image too large (max 10MB)' }, { status: 413 });
        }

        let buffer: Buffer | Uint8Array = Buffer.from(arrayBuffer);

        // Check if URL contains format hint or if content-type suggests conversion is needed
        // We convert ALL non-PNG images to PNG for maximum Figma compatibility
        const urlLower = validatedUrl.toLowerCase();
        const isPng = normalizedContentType === 'image/png' || urlLower.endsWith('.png');

        // Convert everything except PNG to ensure maximum compatibility
        // This handles: JPG issues (progressive, CMYK), WebP, AVIF, GIF, etc.
        const needsConversion = !isPng && (
            SHOULD_CONVERT_TO_PNG.includes(normalizedContentType) ||
            urlLower.includes('format=webp') ||
            urlLower.includes('format=avif') ||
            urlLower.endsWith('.webp') ||
            urlLower.endsWith('.avif') ||
            urlLower.endsWith('.heic') ||
            urlLower.endsWith('.heif') ||
            urlLower.endsWith('.jpg') ||
            urlLower.endsWith('.jpeg') ||
            urlLower.endsWith('.gif') ||
            urlLower.endsWith('.bmp') ||
            // Also convert if content-type is generic or unknown (octet-stream often means image)
            normalizedContentType === 'application/octet-stream' ||
            normalizedContentType.startsWith('image/')
        );

        if (needsConversion) {
            try {
                // Convert to PNG for Figma compatibility
                const convertedBuffer = await sharp(buffer)
                    .png({ quality: 90 })
                    .toBuffer();
                // Only update buffer and contentType after successful conversion
                buffer = convertedBuffer;
                contentType = 'image/png';
            } catch (conversionError) {
                logger.warn('Image conversion failed, returning original', conversionError);
                // If conversion fails, return original with original contentType
                // contentType remains unchanged (normalizedContentType or original)
            }
        }

        // Convert to Uint8Array for NextResponse compatibility
        const responseBody = new Uint8Array(buffer);
        return new NextResponse(responseBody, {
            headers: {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*', // Critical for Figma Plugin
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
    } catch (error) {
        clearTimeout(timeoutId);

        // Handle timeout/abort errors specifically
        if (error instanceof Error && error.name === 'AbortError') {
            return NextResponse.json({ error: 'Image fetch timed out' }, { status: 504 });
        }

        logger.error('Image Proxy Error', error);
        return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
    }
}
