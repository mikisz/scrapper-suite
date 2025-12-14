/**
 * Archive utilities for Scrapper Suite
 *
 * Provides shared zip functionality used across multiple API endpoints.
 */

import archiver from 'archiver';
import fs from 'fs-extra';

/**
 * Creates a zip archive from a source directory
 *
 * @param sourceDir - Directory to archive
 * @param outPath - Output path for the zip file
 * @param options - Optional archiver options
 * @returns Promise that resolves when zip is complete
 * @throws Error if source directory does not exist
 */
export async function zipDirectory(
    sourceDir: string,
    outPath: string,
    options: { compressionLevel?: number } = {}
): Promise<void> {
    // Validate source directory exists
    const exists = await fs.pathExists(sourceDir);
    if (!exists) {
        throw new Error(`Source directory does not exist: ${sourceDir}`);
    }

    const { compressionLevel = 9 } = options;

    const archive = archiver('zip', { zlib: { level: compressionLevel } });
    const stream = fs.createWriteStream(outPath);

    return new Promise<void>((resolve, reject) => {
        archive
            .directory(sourceDir, false)
            .on('error', (err: Error) => reject(err))
            .pipe(stream);

        stream.on('close', () => resolve());
        archive.finalize();
    });
}
