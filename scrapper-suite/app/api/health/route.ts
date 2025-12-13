/**
 * Health Check API Endpoint
 *
 * Returns service health status including browser pool metrics.
 * Used for monitoring and container orchestration health probes.
 */

import { NextResponse } from 'next/server';
import { browserPool } from '../../lib/browser-pool';

export const dynamic = 'force-dynamic';

interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    uptime: number;
    version: string;
    services: {
        browserPool: {
            status: 'healthy' | 'unhealthy';
            total: number;
            inUse: number;
            available: number;
        };
    };
}

const startTime = Date.now();

export async function GET(): Promise<NextResponse<HealthStatus>> {
    const poolStats = browserPool.getStats();

    // Determine browser pool health
    const poolHealthy = poolStats.available > 0 || poolStats.total < 3;

    const status: HealthStatus = {
        status: poolHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        version: process.env.npm_package_version || '1.0.0',
        services: {
            browserPool: {
                status: poolHealthy ? 'healthy' : 'unhealthy',
                total: poolStats.total,
                inUse: poolStats.inUse,
                available: poolStats.available,
            },
        },
    };

    const httpStatus = status.status === 'healthy' ? 200 : 503;

    return NextResponse.json(status, { status: httpStatus });
}
