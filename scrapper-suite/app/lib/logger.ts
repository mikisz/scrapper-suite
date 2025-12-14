/**
 * Simple logger utility
 *
 * In development: logs all messages
 * In production: only logs errors and warnings
 *
 * Usage:
 *   import { logger } from '@/app/lib/logger';
 *   logger.info('Processing page', { url });
 *   logger.error('Failed to process', error);
 */

const isDev = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: string;
    data?: unknown;
}

function formatLog(level: LogLevel, message: string, data?: unknown): LogEntry {
    return {
        level,
        message,
        timestamp: new Date().toISOString(),
        data
    };
}

function shouldLog(level: LogLevel): boolean {
    // In test mode, suppress all logging unless DEBUG is set
    if (isTest && !process.env.DEBUG) {
        return false;
    }

    // In production, only log warnings and errors
    if (!isDev && level === 'debug') {
        return false;
    }

    if (!isDev && level === 'info') {
        return false;
    }

    return true;
}

export const logger = {
    debug(message: string, data?: unknown): void {
        if (shouldLog('debug')) {
            console.debug(JSON.stringify(formatLog('debug', message, data)));
        }
    },

    info(message: string, data?: unknown): void {
        if (shouldLog('info')) {
            console.log(JSON.stringify(formatLog('info', message, data)));
        }
    },

    warn(message: string, data?: unknown): void {
        if (shouldLog('warn')) {
            console.warn(JSON.stringify(formatLog('warn', message, data)));
        }
    },

    error(message: string, error?: unknown): void {
        if (shouldLog('error')) {
            const errorData = error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : error;
            console.error(JSON.stringify(formatLog('error', message, errorData)));
        }
    }
};

export default logger;
