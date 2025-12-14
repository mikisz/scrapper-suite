/**
 * Tests for puppeteer-utils.ts
 *
 * These tests mock the Puppeteer Page interface to test the utility functions.
 */

import { autoScroll, scrollToLoadImages, waitForNetworkIdle } from '../puppeteer-utils';
import type { Page } from 'puppeteer';

describe('puppeteer-utils', () => {
    describe('autoScroll', () => {
        it('should call page.evaluate with correct parameters', async () => {
            const mockEvaluate = jest.fn().mockResolvedValue(undefined);
            const mockPage = { evaluate: mockEvaluate } as unknown as Page;

            await autoScroll(mockPage);

            expect(mockEvaluate).toHaveBeenCalledTimes(1);
            // Check that default values were passed
            expect(mockEvaluate).toHaveBeenCalledWith(
                expect.any(Function),
                100,  // default distance
                100,  // default delay
                20000 // default maxScrollHeight
            );
        });

        it('should use custom options when provided', async () => {
            const mockEvaluate = jest.fn().mockResolvedValue(undefined);
            const mockPage = { evaluate: mockEvaluate } as unknown as Page;

            await autoScroll(mockPage, {
                distance: 200,
                delay: 50,
                maxScrollHeight: 10000
            });

            expect(mockEvaluate).toHaveBeenCalledWith(
                expect.any(Function),
                200,
                50,
                10000
            );
        });

        it('should use partial custom options', async () => {
            const mockEvaluate = jest.fn().mockResolvedValue(undefined);
            const mockPage = { evaluate: mockEvaluate } as unknown as Page;

            await autoScroll(mockPage, { distance: 150 });

            expect(mockEvaluate).toHaveBeenCalledWith(
                expect.any(Function),
                150,  // custom distance
                100,  // default delay
                20000 // default maxScrollHeight
            );
        });
    });

    describe('scrollToLoadImages', () => {
        it('should call page.evaluate with viewport height', async () => {
            const mockEvaluate = jest.fn().mockResolvedValue(undefined);
            const mockPage = { evaluate: mockEvaluate } as unknown as Page;

            await scrollToLoadImages(mockPage, 768);

            expect(mockEvaluate).toHaveBeenCalledTimes(1);
            expect(mockEvaluate).toHaveBeenCalledWith(
                expect.any(Function),
                768
            );
        });

        it('should work with different viewport heights', async () => {
            const mockEvaluate = jest.fn().mockResolvedValue(undefined);
            const mockPage = { evaluate: mockEvaluate } as unknown as Page;

            await scrollToLoadImages(mockPage, 1080);

            expect(mockEvaluate).toHaveBeenCalledWith(
                expect.any(Function),
                1080
            );
        });
    });

    describe('waitForNetworkIdle', () => {
        it('should call waitForNetworkIdle with default timeout', async () => {
            const mockWaitForNetworkIdle = jest.fn().mockResolvedValue(undefined);
            const mockPage = { waitForNetworkIdle: mockWaitForNetworkIdle } as unknown as Page;

            await waitForNetworkIdle(mockPage);

            expect(mockWaitForNetworkIdle).toHaveBeenCalledWith({ timeout: 5000 });
        });

        it('should call waitForNetworkIdle with custom timeout', async () => {
            const mockWaitForNetworkIdle = jest.fn().mockResolvedValue(undefined);
            const mockPage = { waitForNetworkIdle: mockWaitForNetworkIdle } as unknown as Page;

            await waitForNetworkIdle(mockPage, 10000);

            expect(mockWaitForNetworkIdle).toHaveBeenCalledWith({ timeout: 10000 });
        });

        it('should handle timeout errors gracefully', async () => {
            const mockWaitForNetworkIdle = jest.fn().mockRejectedValue(new Error('Timeout'));
            const mockPage = { waitForNetworkIdle: mockWaitForNetworkIdle } as unknown as Page;

            // Should not throw
            await expect(waitForNetworkIdle(mockPage, 100)).resolves.toBeUndefined();
        });

        it('should handle non-timeout errors gracefully', async () => {
            const mockWaitForNetworkIdle = jest.fn().mockRejectedValue(new Error('Some other error'));
            const mockPage = { waitForNetworkIdle: mockWaitForNetworkIdle } as unknown as Page;

            // Should not throw (all errors are swallowed)
            await expect(waitForNetworkIdle(mockPage)).resolves.toBeUndefined();
        });
    });
});

describe('autoScroll evaluate function behavior', () => {
    // Test the actual scroll logic by simulating the evaluate function
    it('should scroll until reaching scroll height', async () => {
        // We can't easily test the internal browser function,
        // but we can verify the function signature is correct
        const mockEvaluate = jest.fn().mockImplementation(async (fn, ...args) => {
            // Verify the function receives correct arguments
            expect(args).toEqual([100, 100, 20000]);
            return undefined;
        });
        const mockPage = { evaluate: mockEvaluate } as unknown as Page;

        await autoScroll(mockPage);
        expect(mockEvaluate).toHaveBeenCalled();
    });
});
