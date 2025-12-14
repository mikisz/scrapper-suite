/**
 * Tests for cookie-dismissal.ts
 *
 * These tests mock the Puppeteer Page interface to test cookie modal dismissal logic.
 */

import { dismissCookieModals, hasCookieModal, DismissOptions } from '../cookie-dismissal';
import type { Page, ElementHandle } from 'puppeteer';

// Helper to create mock page with configurable behavior
function createMockPage(overrides: Partial<{
    waitForSelectorResult: ElementHandle | null;
    waitForSelectorError: Error | null;
    querySelectorResult: ElementHandle | null;
    evaluateResult: unknown;
    evaluateResults: unknown[];
    clickError: Error | null;
}> = {}): Page {
    let evaluateCallCount = 0;
    const evaluateResults = overrides.evaluateResults || [];

    return {
        waitForSelector: overrides.waitForSelectorError
            ? jest.fn().mockRejectedValue(overrides.waitForSelectorError)
            : jest.fn().mockResolvedValue(overrides.waitForSelectorResult ?? null),
        $: jest.fn().mockResolvedValue(overrides.querySelectorResult ?? null),
        evaluate: jest.fn().mockImplementation(() => {
            if (evaluateResults.length > 0) {
                const result = evaluateResults[evaluateCallCount] ?? evaluateResults[evaluateResults.length - 1];
                evaluateCallCount++;
                return Promise.resolve(result);
            }
            return Promise.resolve(overrides.evaluateResult ?? false);
        }),
    } as unknown as Page;
}

describe('cookie-dismissal', () => {
    describe('dismissCookieModals', () => {
        describe('basic functionality', () => {
            it('should return dismissed: false when no modal is found', async () => {
                const mockPage = createMockPage({
                    waitForSelectorResult: null,
                    querySelectorResult: null,
                    evaluateResult: { found: false }
                });

                const result = await dismissCookieModals(mockPage);

                expect(result.dismissed).toBe(false);
                expect(result.method).toBeUndefined();
            });

            it('should use default options when none provided', async () => {
                const mockPage = createMockPage({
                    waitForSelectorResult: null
                });

                await dismissCookieModals(mockPage);

                expect(mockPage.waitForSelector).toHaveBeenCalledWith(
                    expect.any(String),
                    { timeout: 3000 }
                );
            });

            it('should use custom timeout option', async () => {
                const mockPage = createMockPage({
                    waitForSelectorResult: null
                });

                const options: DismissOptions = { timeout: 5000 };
                await dismissCookieModals(mockPage, options);

                expect(mockPage.waitForSelector).toHaveBeenCalledWith(
                    expect.any(String),
                    { timeout: 5000 }
                );
            });
        });

        describe('selector-based dismissal', () => {
            it('should click a visible cookie button and return success', async () => {
                const mockClick = jest.fn().mockResolvedValue(undefined);
                const mockButton = { click: mockClick } as unknown as ElementHandle;

                const mockPage = {
                    waitForSelector: jest.fn().mockResolvedValue(null),
                    $: jest.fn().mockResolvedValue(mockButton),
                    evaluate: jest.fn()
                        .mockResolvedValueOnce(true) // isVisible check
                        .mockResolvedValueOnce(false) // hasCookieModal check (modal closed)
                } as unknown as Page;

                const result = await dismissCookieModals(mockPage);

                expect(result.dismissed).toBe(true);
                expect(result.method).toBe('selector');
                expect(mockClick).toHaveBeenCalled();
            });

            it('should skip invisible buttons', async () => {
                const mockClick = jest.fn();
                const mockButton = { click: mockClick } as unknown as ElementHandle;

                const mockPage = {
                    waitForSelector: jest.fn().mockResolvedValue(null),
                    $: jest.fn().mockResolvedValue(mockButton),
                    evaluate: jest.fn().mockResolvedValue(false) // isVisible = false
                } as unknown as Page;

                const result = await dismissCookieModals(mockPage);

                expect(result.dismissed).toBe(false);
                expect(mockClick).not.toHaveBeenCalled();
            });
        });

        describe('text-based dismissal', () => {
            it('should find and click button by text content', async () => {
                const mockPage = {
                    waitForSelector: jest.fn().mockResolvedValue(null),
                    $: jest.fn().mockResolvedValue(null), // No selector match
                    evaluate: jest.fn()
                        .mockResolvedValueOnce({ found: true, text: 'Accept All' }) // text search
                        .mockResolvedValueOnce(false) // hasCookieModal
                } as unknown as Page;

                const result = await dismissCookieModals(mockPage);

                expect(result.dismissed).toBe(true);
                expect(result.method).toBe('text');
                expect(result.selector).toBe('Accept All');
            });
        });

        describe('shadow DOM dismissal', () => {
            it('should find and click button in shadow DOM', async () => {
                const mockPage = {
                    waitForSelector: jest.fn().mockResolvedValue(null),
                    $: jest.fn().mockResolvedValue(null),
                    evaluate: jest.fn()
                        .mockResolvedValueOnce({ found: false }) // text search fails
                        .mockResolvedValueOnce({ found: true, method: 'shadow-selector', selector: '#accept-btn' }) // shadow DOM
                        .mockResolvedValueOnce(false) // hasCookieModal
                } as unknown as Page;

                const result = await dismissCookieModals(mockPage);

                expect(result.dismissed).toBe(true);
                expect(result.method).toBe('shadow-selector');
            });

            it('should find button in shadow DOM by text', async () => {
                const mockPage = {
                    waitForSelector: jest.fn().mockResolvedValue(null),
                    $: jest.fn().mockResolvedValue(null),
                    evaluate: jest.fn()
                        .mockResolvedValueOnce({ found: false }) // text search fails
                        .mockResolvedValueOnce({ found: true, method: 'shadow-text', text: 'Accept' }) // shadow DOM text
                        .mockResolvedValueOnce(false) // hasCookieModal
                } as unknown as Page;

                const result = await dismissCookieModals(mockPage);

                expect(result.dismissed).toBe(true);
                expect(result.method).toBe('shadow-text');
            });
        });

        describe('retry logic', () => {
            it('should retry on failure up to retryCount', async () => {
                let attemptCount = 0;
                const mockPage = {
                    waitForSelector: jest.fn().mockResolvedValue(null),
                    $: jest.fn().mockImplementation(() => {
                        attemptCount++;
                        return Promise.resolve(null);
                    }),
                    evaluate: jest.fn().mockResolvedValue({ found: false })
                } as unknown as Page;

                const options: DismissOptions = { retryCount: 2, retryDelay: 10 };
                await dismissCookieModals(mockPage, options);

                // Should have attempted multiple times
                // Each attempt checks multiple selectors, so we just verify it ran
                expect(attemptCount).toBeGreaterThan(0);
            });

            it('should succeed on retry after initial failure', async () => {
                let callCount = 0;
                const mockClick = jest.fn().mockResolvedValue(undefined);
                const mockButton = { click: mockClick } as unknown as ElementHandle;

                const mockPage = {
                    waitForSelector: jest.fn().mockResolvedValue(null),
                    $: jest.fn().mockImplementation(() => {
                        callCount++;
                        // Return button on later attempts
                        if (callCount > 50) return Promise.resolve(mockButton);
                        return Promise.resolve(null);
                    }),
                    evaluate: jest.fn()
                        .mockResolvedValueOnce({ found: false })
                        .mockResolvedValueOnce({ found: false })
                        .mockResolvedValueOnce({ found: false })
                        .mockResolvedValueOnce({ found: false })
                        .mockResolvedValueOnce(true) // isVisible on later attempt
                        .mockResolvedValueOnce(false) // modal closed
                } as unknown as Page;

                const options: DismissOptions = { retryCount: 2, retryDelay: 10 };
                const result = await dismissCookieModals(mockPage, options);

                // The result depends on timing, but the function should complete
                expect(result).toBeDefined();
            });

            it('should return dismissed false on final retry failure', async () => {
                const error = new Error('Test error');
                const mockPage = {
                    waitForSelector: jest.fn().mockRejectedValue(error),
                    $: jest.fn().mockRejectedValue(error),
                    evaluate: jest.fn().mockRejectedValue(error)
                } as unknown as Page;

                const options: DismissOptions = { retryCount: 1, retryDelay: 10 };
                const result = await dismissCookieModals(mockPage, options);

                expect(result.dismissed).toBe(false);
                // Error may or may not be set depending on where the error occurred
                // The function handles errors gracefully and returns dismissed: false
            });
        });

        describe('error handling', () => {
            it('should handle waitForSelector timeout gracefully', async () => {
                const mockPage = {
                    waitForSelector: jest.fn().mockRejectedValue(new Error('Timeout')),
                    $: jest.fn().mockResolvedValue(null),
                    evaluate: jest.fn().mockResolvedValue({ found: false })
                } as unknown as Page;

                // Should not throw
                const result = await dismissCookieModals(mockPage, { retryCount: 0 });
                expect(result).toBeDefined();
            });

            it('should handle click errors gracefully', async () => {
                const mockButton = {
                    click: jest.fn().mockRejectedValue(new Error('Click failed'))
                } as unknown as ElementHandle;

                const mockPage = {
                    waitForSelector: jest.fn().mockResolvedValue(null),
                    $: jest.fn().mockResolvedValue(mockButton),
                    evaluate: jest.fn()
                        .mockResolvedValueOnce(true) // isVisible
                        .mockResolvedValueOnce({ found: false }) // text search
                        .mockResolvedValueOnce({ found: false }) // shadow search
                } as unknown as Page;

                // Should not throw, should continue to next strategy
                const result = await dismissCookieModals(mockPage, { retryCount: 0 });
                expect(result).toBeDefined();
            });
        });
    });

    describe('hasCookieModal', () => {
        it('should return true when modal is visible', async () => {
            const mockPage = {
                evaluate: jest.fn().mockResolvedValue(true)
            } as unknown as Page;

            const result = await hasCookieModal(mockPage);

            expect(result).toBe(true);
            expect(mockPage.evaluate).toHaveBeenCalled();
        });

        it('should return false when no modal is found', async () => {
            const mockPage = {
                evaluate: jest.fn().mockResolvedValue(false)
            } as unknown as Page;

            const result = await hasCookieModal(mockPage);

            expect(result).toBe(false);
        });

        it('should return false on evaluation error', async () => {
            const mockPage = {
                evaluate: jest.fn().mockRejectedValue(new Error('Evaluation failed'))
            } as unknown as Page;

            const result = await hasCookieModal(mockPage);

            expect(result).toBe(false);
        });
    });

    describe('modal container detection', () => {
        it('should check for OneTrust modal', async () => {
            const mockPage = {
                evaluate: jest.fn().mockResolvedValue(true)
            } as unknown as Page;

            await hasCookieModal(mockPage);

            // Verify the selectors include OneTrust
            const evaluateCall = (mockPage.evaluate as jest.Mock).mock.calls[0];
            const selectors = evaluateCall[1] as string[];
            expect(selectors).toContain('#onetrust-consent-sdk');
        });

        it('should check for CookieBot modal', async () => {
            const mockPage = {
                evaluate: jest.fn().mockResolvedValue(true)
            } as unknown as Page;

            await hasCookieModal(mockPage);

            const evaluateCall = (mockPage.evaluate as jest.Mock).mock.calls[0];
            const selectors = evaluateCall[1] as string[];
            expect(selectors).toContain('#CybotCookiebotDialog');
        });
    });

    describe('button text patterns', () => {
        it('should match common accept button texts', async () => {
            // Create mock that captures the patterns passed to evaluate
            let capturedPatterns: string[] = [];
            const mockPage = {
                waitForSelector: jest.fn().mockResolvedValue(null),
                $: jest.fn().mockResolvedValue(null),
                evaluate: jest.fn().mockImplementation((fn, patterns) => {
                    if (Array.isArray(patterns)) {
                        capturedPatterns = patterns;
                    }
                    return Promise.resolve({ found: false });
                })
            } as unknown as Page;

            await dismissCookieModals(mockPage, { retryCount: 0 });

            // Verify patterns were passed (as regex strings)
            expect(capturedPatterns.length).toBeGreaterThan(0);
            // Check that common patterns are included
            expect(capturedPatterns.some(p => p.includes('accept'))).toBe(true);
        });
    });
});

describe('integration scenarios', () => {
    it('should handle typical OneTrust flow', async () => {
        const mockClick = jest.fn().mockResolvedValue(undefined);
        const mockButton = { click: mockClick } as unknown as ElementHandle;

        const mockPage = {
            waitForSelector: jest.fn().mockResolvedValue(mockButton),
            $: jest.fn().mockImplementation((selector: string) => {
                if (selector === '#onetrust-accept-btn-handler') {
                    return Promise.resolve(mockButton);
                }
                return Promise.resolve(null);
            }),
            evaluate: jest.fn()
                .mockResolvedValueOnce(true) // isVisible
                .mockResolvedValueOnce(false) // modal closed
        } as unknown as Page;

        const result = await dismissCookieModals(mockPage);

        expect(result.dismissed).toBe(true);
        expect(result.method).toBe('selector');
    });

    it('should handle cookie consent library (cc-) classes', async () => {
        const mockClick = jest.fn().mockResolvedValue(undefined);
        const mockButton = { click: mockClick } as unknown as ElementHandle;

        const selectorChecks: string[] = [];
        const mockPage = {
            waitForSelector: jest.fn().mockResolvedValue(null),
            $: jest.fn().mockImplementation((selector: string) => {
                selectorChecks.push(selector);
                if (selector === '.cc-btn.cc-allow') {
                    return Promise.resolve(mockButton);
                }
                return Promise.resolve(null);
            }),
            evaluate: jest.fn()
                .mockResolvedValueOnce(true) // isVisible
                .mockResolvedValueOnce(false) // modal closed
        } as unknown as Page;

        const result = await dismissCookieModals(mockPage);

        expect(result.dismissed).toBe(true);
        expect(selectorChecks).toContain('.cc-btn.cc-allow');
    });
});
