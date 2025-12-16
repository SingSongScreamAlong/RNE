// =====================================================================
// RNE Headless Service - Watcher Engine (Orchestrates multiple streams)
// =====================================================================

import { Config, Source } from './config.js';
import { UplinkManager } from './uplink.js';
import { StreamWatcher, StreamStats } from './stream-watcher.js';
import { createLogger } from './logger.js';

const logger = createLogger('Engine');

export class WatcherEngine {
    private config: Config;
    private uplink: UplinkManager;
    private streams: Map<string, StreamWatcher> = new Map();
    private sourceQueue: Source[] = [];
    private currentSourceIndex = 0;
    private rotationTimer: NodeJS.Timeout | null = null;
    private statusTimer: NodeJS.Timeout | null = null;
    private running = false;
    private totalFramesCaptured = 0;

    constructor(config: Config) {
        this.config = config;
        this.uplink = new UplinkManager(config);
        this.initSourceQueue();
    }

    private initSourceQueue(): void {
        // Sort by priority (lower = higher priority)
        this.sourceQueue = [...this.config.streams.sources].sort((a, b) => a.priority - b.priority);
        logger.info(`Initialized queue with ${this.sourceQueue.length} sources`);
    }

    async start(): Promise<void> {
        logger.info('🚀 Starting Watcher Engine...');
        this.running = true;

        // Connect to ControlBox
        await this.uplink.connect();

        // Start initial streams
        for (let i = 0; i < this.config.streams.maxConcurrent; i++) {
            const source = this.getNextSource();
            await this.startStream(source);
        }

        // Setup rotation timer
        const rotationMs = this.config.streams.rotationIntervalMinutes * 60 * 1000;
        this.rotationTimer = setInterval(() => this.rotateStreams(), rotationMs);
        logger.info(`Rotation every ${this.config.streams.rotationIntervalMinutes} minutes`);

        // Setup status reporting
        this.statusTimer = setInterval(() => this.reportStatus(), 30000);

        logger.info(`✅ Engine started with ${this.streams.size} streams`);
    }

    private getNextSource(): Source {
        const source = this.sourceQueue[this.currentSourceIndex];
        this.currentSourceIndex = (this.currentSourceIndex + 1) % this.sourceQueue.length;
        return source;
    }

    private async startStream(source: Source): Promise<void> {
        try {
            const watcher = new StreamWatcher(this.config, this.uplink, source);
            await watcher.start();
            this.streams.set(watcher.getStats().streamId, watcher);
            logger.info(`Started stream for: ${source.name} (${source.category})`);
        } catch (error) {
            logger.error(`Failed to start stream for ${source.name}: ${error}`);
        }
    }

    private async rotateStreams(): Promise<void> {
        if (!this.running) return;
        logger.info('🔄 Rotating streams...');

        // Get oldest stream
        const streamIds = Array.from(this.streams.keys());
        if (streamIds.length === 0) return;

        const oldestId = streamIds[0];
        const oldestStream = this.streams.get(oldestId);

        if (oldestStream) {
            const stats = oldestStream.getStats();
            this.totalFramesCaptured += stats.framesCaptured;

            await oldestStream.stop();
            this.streams.delete(oldestId);

            // Start new stream with next source
            const nextSource = this.getNextSource();
            await this.startStream(nextSource);

            logger.info(`Rotated: ${stats.source.name} → ${nextSource.name}`);
        }
    }

    private reportStatus(): void {
        if (!this.uplink.isConnected()) return;

        let totalFrames = this.totalFramesCaptured;
        for (const stream of this.streams.values()) {
            totalFrames += stream.getStats().framesCaptured;
        }

        this.uplink.sendStatus({
            state: 'running',
            activeStreams: this.streams.size,
            totalFramesCaptured: totalFrames,
            totalObservationsSent: totalFrames,
        });
    }

    async stop(): Promise<void> {
        logger.info('🛑 Stopping Watcher Engine...');
        this.running = false;

        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
            this.rotationTimer = null;
        }

        if (this.statusTimer) {
            clearInterval(this.statusTimer);
            this.statusTimer = null;
        }

        // Stop all streams
        const stopPromises = Array.from(this.streams.values()).map(s => s.stop());
        await Promise.all(stopPromises);
        this.streams.clear();

        // Disconnect uplink
        await this.uplink.disconnect();

        logger.info('✅ Engine stopped');
    }

    getStats(): { streams: StreamStats[]; totalFrames: number } {
        return {
            streams: Array.from(this.streams.values()).map(s => s.getStats()),
            totalFrames: this.totalFramesCaptured,
        };
    }
}
