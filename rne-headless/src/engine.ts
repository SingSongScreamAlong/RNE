// =====================================================================
// RNE Headless Service - Watcher Engine (Orchestrates multiple streams)
// =====================================================================

import { Config, Source } from './config.js';
import { UplinkManager } from './uplink.js';
import { StreamWatcher, StreamStats } from './stream-watcher.js';
import { AIAnalyzer, VisionConfig } from './ai-analyzer.js';
import { KnowledgeStore } from './knowledge-store.js';
import { ReasoningEngine } from './reasoning-engine.js';
import { ReportScheduler } from './report-scheduler.js';
import { createLogger } from './logger.js';

const logger = createLogger('Engine');

export class WatcherEngine {
    private config: Config;
    private uplink: UplinkManager;
    private visionEngine: AIAnalyzer | null = null;
    private reasoningEngine: ReasoningEngine | null = null;
    private knowledgeStore: KnowledgeStore | null = null;
    private reportScheduler: ReportScheduler | null = null;
    private streams: Map<string, StreamWatcher> = new Map();
    private sourceQueue: Source[] = [];
    private currentSourceIndex = 0;
    private rotationTimer: NodeJS.Timeout | null = null;
    private statusTimer: NodeJS.Timeout | null = null;
    private running = false;
    private totalFramesCaptured = 0;
    private totalFramesAnalyzed = 0;

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

    private async initAI(): Promise<void> {
        // Initialize knowledge store (shared by both engines)
        this.knowledgeStore = new KnowledgeStore('/app/data');
        await this.knowledgeStore.initialize();

        // Initialize Vision Engine (Gemini - high volume perception)
        if (this.config.vision.enabled) {
            logger.info('👁️ Initializing Vision Engine (Gemini)...');

            const visionConfig: VisionConfig = {
                googleApiKey: this.config.vision.googleApiKey,
                model: this.config.vision.model,
                analyzeEveryNthFrame: this.config.vision.analyzeEveryNthFrame,
            };

            this.visionEngine = new AIAnalyzer(visionConfig, this.knowledgeStore);
            logger.info(`👁️ Vision: ${this.config.vision.model}, every ${this.config.vision.analyzeEveryNthFrame} frames`);
        } else {
            logger.info('👁️ Vision Engine disabled (no GOOGLE_API_KEY)');
        }

        // Initialize Reasoning Engine (GPT-5 - low volume deep thinking)
        if (this.config.reasoning.enabled) {
            logger.info('🧠 Initializing Reasoning Engine (GPT-5)...');

            this.reasoningEngine = new ReasoningEngine(
                {
                    openaiApiKey: this.config.reasoning.openaiApiKey,
                    model: this.config.reasoning.model,
                    maxTokens: this.config.reasoning.maxTokens,
                },
                this.knowledgeStore
            );
            logger.info(`🧠 Reasoning: ${this.config.reasoning.model}`);

            // Initialize Report Scheduler if enabled
            if (this.config.reporting.enabled) {
                this.reportScheduler = new ReportScheduler(
                    {
                        reportTimes: this.config.reporting.times,
                        timezone: this.config.reporting.timezone,
                        discordWebhook: this.config.reporting.discordWebhook,
                        email: this.config.reporting.email,
                    },
                    this.reasoningEngine,
                    this.knowledgeStore
                );
                this.reportScheduler.start();
                logger.info(`📊 Reports: ${this.config.reporting.times.join(', ')} ${this.config.reporting.timezone}`);
                if (this.config.reporting.email) {
                    logger.info(`📧 Email: ${this.config.reporting.email.from} → ${this.config.reporting.email.to}`);
                }
            }
        } else {
            logger.info('🧠 Reasoning Engine disabled (no OPENAI_API_KEY)');
        }
    }

    async start(): Promise<void> {
        logger.info('🚀 Starting Watcher Engine...');
        this.running = true;

        // Initialize AI engines
        await this.initAI();

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

        // Log AI status
        if (this.visionEngine) {
            logger.info(`👁️ Vision: ACTIVE (Gemini ${this.config.vision.model})`);
        }
        if (this.reasoningEngine) {
            logger.info(`🧠 Reasoning: ACTIVE (GPT ${this.config.reasoning.model})`);
        }
    }

    private getNextSource(): Source {
        const source = this.sourceQueue[this.currentSourceIndex];
        this.currentSourceIndex = (this.currentSourceIndex + 1) % this.sourceQueue.length;
        return source;
    }

    private async startStream(source: Source): Promise<void> {
        try {
            const watcher = new StreamWatcher(this.config, this.uplink, source, this.visionEngine);
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
            this.totalFramesAnalyzed += stats.framesAnalyzed;

            // Update watch time in knowledge store
            if (this.knowledgeStore) {
                const hoursWatched = stats.currentTime / 3600;
                this.knowledgeStore.updateWatchTime(stats.source.category, hoursWatched);
            }

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
        let aiFrames = this.totalFramesAnalyzed;
        for (const stream of this.streams.values()) {
            const stats = stream.getStats();
            totalFrames += stats.framesCaptured;
            aiFrames += stats.framesAnalyzed;
        }

        this.uplink.sendStatus({
            state: 'running',
            activeStreams: this.streams.size,
            totalFramesCaptured: totalFrames,
            totalObservationsSent: totalFrames,
        });

        // Log AI stats periodically
        if (this.visionEngine) {
            const visionStats = this.visionEngine.getStats();
            logger.info(`👁️ Vision: ${aiFrames} frames, ~$${visionStats.estimatedCost}`);
        }
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

        // Stop report scheduler
        if (this.reportScheduler) {
            this.reportScheduler.stop();
        }

        // Stop all streams
        const stopPromises = Array.from(this.streams.values()).map(s => s.stop());
        await Promise.all(stopPromises);
        this.streams.clear();

        // Save knowledge base
        if (this.knowledgeStore) {
            await this.knowledgeStore.shutdown();
        }

        // Disconnect uplink
        await this.uplink.disconnect();

        logger.info('✅ Engine stopped');
    }

    getStats(): { streams: StreamStats[]; totalFrames: number; totalAnalyzed: number; knowledge: object | null } {
        return {
            streams: Array.from(this.streams.values()).map(s => s.getStats()),
            totalFrames: this.totalFramesCaptured,
            totalAnalyzed: this.totalFramesAnalyzed,
            knowledge: this.knowledgeStore?.getStats() || null,
        };
    }
}
