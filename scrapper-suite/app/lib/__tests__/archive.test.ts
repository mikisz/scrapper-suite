import { zipDirectory } from '../archive';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { createReadStream } from 'fs';
import unzipper from 'unzipper';

describe('zipDirectory', () => {
    let tempDir: string;
    let sourceDir: string;
    let outPath: string;

    beforeEach(async () => {
        // Create a unique temp directory for each test
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-test-'));
        sourceDir = path.join(tempDir, 'source');
        outPath = path.join(tempDir, 'output.zip');
        await fs.mkdir(sourceDir);
    });

    afterEach(async () => {
        // Clean up temp directory
        await fs.remove(tempDir);
    });

    it('should create a zip file from a directory', async () => {
        // Create test files
        await fs.writeFile(path.join(sourceDir, 'test.txt'), 'Hello World');

        await zipDirectory(sourceDir, outPath);

        expect(await fs.pathExists(outPath)).toBe(true);
        const stats = await fs.stat(outPath);
        expect(stats.size).toBeGreaterThan(0);
    });

    it('should include all files from the source directory', async () => {
        // Create multiple test files
        await fs.writeFile(path.join(sourceDir, 'file1.txt'), 'Content 1');
        await fs.writeFile(path.join(sourceDir, 'file2.txt'), 'Content 2');
        await fs.writeFile(path.join(sourceDir, 'file3.json'), '{"key": "value"}');

        await zipDirectory(sourceDir, outPath);

        // Extract and verify contents
        const extractDir = path.join(tempDir, 'extracted');
        await fs.mkdir(extractDir);

        await new Promise<void>((resolve, reject) => {
            createReadStream(outPath)
                .pipe(unzipper.Extract({ path: extractDir }))
                .on('close', resolve)
                .on('error', reject);
        });

        expect(await fs.pathExists(path.join(extractDir, 'file1.txt'))).toBe(true);
        expect(await fs.pathExists(path.join(extractDir, 'file2.txt'))).toBe(true);
        expect(await fs.pathExists(path.join(extractDir, 'file3.json'))).toBe(true);

        // Verify content integrity
        expect(await fs.readFile(path.join(extractDir, 'file1.txt'), 'utf-8')).toBe('Content 1');
        expect(await fs.readFile(path.join(extractDir, 'file2.txt'), 'utf-8')).toBe('Content 2');
    });

    it('should include nested directories', async () => {
        // Create nested structure
        await fs.mkdir(path.join(sourceDir, 'subdir'));
        await fs.writeFile(path.join(sourceDir, 'root.txt'), 'Root file');
        await fs.writeFile(path.join(sourceDir, 'subdir', 'nested.txt'), 'Nested file');

        await zipDirectory(sourceDir, outPath);

        // Extract and verify
        const extractDir = path.join(tempDir, 'extracted');
        await fs.mkdir(extractDir);

        await new Promise<void>((resolve, reject) => {
            createReadStream(outPath)
                .pipe(unzipper.Extract({ path: extractDir }))
                .on('close', resolve)
                .on('error', reject);
        });

        expect(await fs.pathExists(path.join(extractDir, 'root.txt'))).toBe(true);
        expect(await fs.pathExists(path.join(extractDir, 'subdir', 'nested.txt'))).toBe(true);
    });

    it('should handle empty directories', async () => {
        // Source directory is already empty
        await zipDirectory(sourceDir, outPath);

        expect(await fs.pathExists(outPath)).toBe(true);
    });

    it('should accept custom compression level', async () => {
        await fs.writeFile(path.join(sourceDir, 'test.txt'), 'Hello World'.repeat(1000));

        // Create with no compression
        const noCompressionPath = path.join(tempDir, 'no-compression.zip');
        await zipDirectory(sourceDir, noCompressionPath, { compressionLevel: 0 });

        // Create with max compression
        const maxCompressionPath = path.join(tempDir, 'max-compression.zip');
        await zipDirectory(sourceDir, maxCompressionPath, { compressionLevel: 9 });

        const noCompressionStats = await fs.stat(noCompressionPath);
        const maxCompressionStats = await fs.stat(maxCompressionPath);

        // Max compression should be smaller
        expect(maxCompressionStats.size).toBeLessThan(noCompressionStats.size);
    });

    it('should handle binary files', async () => {
        // Create a binary file (PNG header bytes)
        const binaryData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        await fs.writeFile(path.join(sourceDir, 'image.png'), binaryData);

        await zipDirectory(sourceDir, outPath);

        // Extract and verify binary integrity
        const extractDir = path.join(tempDir, 'extracted');
        await fs.mkdir(extractDir);

        await new Promise<void>((resolve, reject) => {
            createReadStream(outPath)
                .pipe(unzipper.Extract({ path: extractDir }))
                .on('close', resolve)
                .on('error', reject);
        });

        const extractedData = await fs.readFile(path.join(extractDir, 'image.png'));
        expect(extractedData).toEqual(binaryData);
    });

    it('should throw error when source directory does not exist', async () => {
        const nonExistentDir = path.join(tempDir, 'non-existent');

        await expect(zipDirectory(nonExistentDir, outPath)).rejects.toThrow(
            'Source directory does not exist'
        );
    });

    it('should handle files with special characters in names', async () => {
        // Create file with spaces and special chars (filesystem-safe ones)
        await fs.writeFile(path.join(sourceDir, 'file with spaces.txt'), 'Content');
        await fs.writeFile(path.join(sourceDir, 'file-with-dashes.txt'), 'Content');
        await fs.writeFile(path.join(sourceDir, 'file_with_underscores.txt'), 'Content');

        await zipDirectory(sourceDir, outPath);

        // Extract and verify
        const extractDir = path.join(tempDir, 'extracted');
        await fs.mkdir(extractDir);

        await new Promise<void>((resolve, reject) => {
            createReadStream(outPath)
                .pipe(unzipper.Extract({ path: extractDir }))
                .on('close', resolve)
                .on('error', reject);
        });

        expect(await fs.pathExists(path.join(extractDir, 'file with spaces.txt'))).toBe(true);
        expect(await fs.pathExists(path.join(extractDir, 'file-with-dashes.txt'))).toBe(true);
        expect(await fs.pathExists(path.join(extractDir, 'file_with_underscores.txt'))).toBe(true);
    });

    it('should handle large files', async () => {
        // Create a 1MB file
        const largeContent = Buffer.alloc(1024 * 1024, 'x');
        await fs.writeFile(path.join(sourceDir, 'large.txt'), largeContent);

        await zipDirectory(sourceDir, outPath);

        expect(await fs.pathExists(outPath)).toBe(true);

        // Verify the zip is smaller than the original (due to compression)
        const zipStats = await fs.stat(outPath);
        expect(zipStats.size).toBeLessThan(largeContent.length);
    });
});
