// =====================================================================
// RNE Headless Service - Uplink Manager (Socket.IO to ControlBox)
// =====================================================================

import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';
import { Config, Source } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('Uplink');

export interface Observation {
    streamId: string;
    frameId: number;
    capturedAt: string;
    videoId: string;
    videoTitle: string;
    currentTime: number;
    duration: number;
    category: string;
    detections: unknown[];
}

interface ObservationBatch {
    agentId: string;
    batchId: string;
    observations: Observation[];
    streamInfo: {
        streamId: string;
        videoId: string;
        videoTitle: string;
        sourceType: string;
        sourceUrl: string;
        category: string;
    };
}

export class UplinkManager extends EventEmitter {
    private config: Config;
    private socket: Socket | null = null;
    private connected = false;
    private authenticated = false;
    private agentId = '';
    private observationQueue: Observation[] = [];
    private batchTimeout: NodeJS.Timeout | null = null;
    private currentSource: Source | null = null;

    constructor(config: Config) {
        super();
        this.config = config;
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            logger.info(`Connecting to Brain: ${this.config.brain.endpoint}`);

            this.socket = io(this.config.brain.endpoint, {
                transports: ['websocket'],
                reconnection: true,
                reconnectionAttempts: this.config.brain.maxReconnectAttempts,
                reconnectionDelay: this.config.brain.reconnectIntervalMs,
            });

            this.socket.on('connect', () => {
                logger.info('Socket.IO connected');
                this.connected = true;
                this.authenticate();
            });

            this.socket.on('watcher:auth_success', (data: { agentId: string }) => {
                logger.info(`✅ Authenticated as ${data.agentId}`);
                this.authenticated = true;
                this.agentId = data.agentId;
                this.emit('authenticated');
                resolve();
            });

            this.socket.on('watcher:auth_error', (error: { error: string }) => {
                logger.error(`❌ Auth failed: ${error.error}`);
                reject(new Error(error.error));
            });

            this.socket.on('watcher:observations_ack', (ack: { batchId: string; received: number }) => {
                logger.debug(`Batch ${ack.batchId}: ${ack.received} acknowledged`);
            });

            this.socket.on('disconnect', (reason) => {
                logger.warn(`Disconnected: ${reason}`);
                this.connected = false;
                this.authenticated = false;
            });

            this.socket.on('connect_error', (error) => {
                logger.error(`Connection error: ${error.message}`);
            });

            // Timeout
            setTimeout(() => {
                if (!this.authenticated) {
                    logger.warn('Auth timeout, continuing anyway');
                    this.authenticated = true;
                    this.agentId = `headless-${Date.now()}`;
                    resolve();
                }
            }, 10000);
        });
    }

    private authenticate(): void {
        if (!this.socket) return;
        logger.info('Authenticating...');
        this.socket.emit('watcher:auth', {
            agentType: 'watcher',
            apiKey: this.config.brain.apiKey,
            agentId: `headless-${process.pid}`,
            version: '2.0.0-headless',
        });
    }

    setCurrentSource(source: Source): void {
        this.currentSource = source;
    }

    sendObservation(observation: Observation): void {
        this.observationQueue.push(observation);

        if (!this.batchTimeout) {
            this.batchTimeout = setTimeout(() => {
                this.flushObservations();
            }, this.config.brain.batchIntervalMs);
        }

        if (this.observationQueue.length >= this.config.brain.batchMaxSize) {
            this.flushObservations();
        }
    }

    private flushObservations(): void {
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }

        if (this.observationQueue.length === 0) return;
        if (!this.socket || !this.connected) {
            logger.warn('Not connected, queuing observations');
            return;
        }

        const batch = this.observationQueue.splice(0, this.config.brain.batchMaxSize);
        const firstObs = batch[0];

        const message: ObservationBatch = {
            agentId: this.agentId,
            batchId: `batch-${Date.now()}`,
            observations: batch,
            streamInfo: {
                streamId: firstObs?.streamId || 'unknown',
                videoId: firstObs?.videoId || '',
                videoTitle: firstObs?.videoTitle || 'Unknown',
                sourceType: this.currentSource?.type || 'channel',
                sourceUrl: this.currentSource?.url || '',
                category: this.currentSource?.category || 'unknown',
            },
        };

        this.socket.emit('watcher:observations', message);
        logger.debug(`Sent batch with ${batch.length} observations`);
    }

    sendStatus(status: {
        state: string;
        activeStreams: number;
        totalFramesCaptured: number;
        totalObservationsSent: number;
    }): void {
        if (!this.socket || !this.connected) return;
        this.socket.emit('watcher:status', { agentId: this.agentId, ...status });
    }

    async disconnect(): Promise<void> {
        this.flushObservations();
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.connected = false;
        logger.info('Disconnected');
    }

    isConnected(): boolean {
        return this.connected && this.authenticated;
    }
}
