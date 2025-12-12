// Jest setup file
// Add any global test configuration here

// Increase timeout for async operations
jest.setTimeout(30000);

// Suppress console.log during tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    // Keep warn and error for debugging
    warn: console.warn,
    error: console.error,
  };
}
