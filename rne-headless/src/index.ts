// =====================================================================
// RNE Headless Service - Main Entry Point
// =====================================================================

import http from 'http';
import { loadConfig } from './config.js';
import { WatcherEngine } from './engine.js';
import { createLogger } from './logger.js';

const logger = createLogger('Main');

async function main(): Promise<void> {
    logger.info('');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('  RNE Headless Service v2.0.0');
    logger.info('  24/7 Racing Content Ingestion for AI Learning');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('');

    const config = loadConfig();

    logger.info(`Brain endpoint: ${config.brain.endpoint}`);
    logger.info(`Max concurrent streams: ${config.streams.maxConcurrent}`);
    logger.info(`Rotation interval: ${config.streams.rotationIntervalMinutes} minutes`);
    logger.info(`Sources configured: ${config.streams.sources.length}`);
    logger.info(`Headless mode: ${config.browser.headless}`);
    logger.info('');

    // Create engine
    const engine = new WatcherEngine(config);

    // Setup graceful shutdown
    const shutdown = async () => {
        logger.info('');
        logger.info('Received shutdown signal...');
        await engine.stop();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start health check server
    const healthServer = http.createServer((req, res) => {
        if (req.url === '/health' || req.url === '/') {
            const stats = engine.getStats();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                uptime: process.uptime(),
                activeStreams: stats.streams.length,
                totalFrames: stats.totalFrames,
                streams: stats.streams.map(s => ({
                    source: s.source.name,
                    category: s.source.category,
                    videoTitle: s.videoTitle,
                    framesCaptured: s.framesCaptured,
                    state: s.state,
                })),
            }));
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    });

    healthServer.listen(config.server.healthPort, () => {
        logger.info(`Health check: http://localhost:${config.server.healthPort}/health`);
        logger.info('');
    });

    // Start the engine
    try {
        await engine.start();
        logger.info('');
        logger.info('🏎️  RNE is now watching racing content 24/7');
        logger.info('   Press Ctrl+C to stop');
        logger.info('');
    } catch (error) {
        logger.error(`Failed to start engine: ${error}`);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
