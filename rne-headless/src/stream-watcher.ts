// =====================================================================
// RNE Headless Service - Stream Watcher (Puppeteer-based)
// =====================================================================

import puppeteer, { Browser, Page } from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';
import { Config, Source } from './config.js';
import { UplinkManager, Observation } from './uplink.js';
import { AIAnalyzer } from './ai-analyzer.js';
import { createLogger } from './logger.js';

const logger = createLogger('StreamWatcher');

export interface StreamStats {
    streamId: string;
    source: Source;
    videoId: string;
    videoTitle: string;
    currentTime: number;
    duration: number;
    framesCaptured: number;
    framesAnalyzed: number;
    startedAt: Date;
    state: 'starting' | 'playing' | 'buffering' | 'error' | 'stopped';
}

export class StreamWatcher {
    private config: Config;
    private uplink: UplinkManager;
    private aiAnalyzer: AIAnalyzer | null;
    private source: Source;
    private browser: Browser | null = null;
    private page: Page | null = null;
    private streamId: string;
    private stats: StreamStats;
    private captureInterval: NodeJS.Timeout | null = null;
    private popupInterval: NodeJS.Timeout | null = null;
    private running = false;

    constructor(config: Config, uplink: UplinkManager, source: Source, aiAnalyzer: AIAnalyzer | null = null) {
        this.config = config;
        this.uplink = uplink;
        this.source = source;
        this.aiAnalyzer = aiAnalyzer;
        this.streamId = uuidv4();
        this.stats = {
            streamId: this.streamId,
            source,
            videoId: '',
            videoTitle: source.name,
            currentTime: 0,
            duration: 0,
            framesCaptured: 0,
            framesAnalyzed: 0,
            startedAt: new Date(),
            state: 'starting',
        };
    }

    async start(): Promise<void> {
        logger.info(`Starting stream ${this.streamId} for: ${this.source.name}`);
        this.running = true;

        try {
            this.browser = await puppeteer.launch({
                headless: this.config.browser.headless ? 'new' : false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--mute-audio',
                    `--window-size=${this.config.browser.viewport.width},${this.config.browser.viewport.height}`,
                ],
            });

            this.page = await this.browser.newPage();
            await this.page.setViewport(this.config.browser.viewport);
            await this.page.setUserAgent(this.config.browser.userAgent);

            // Navigate to source
            await this.page.goto(this.source.url, { waitUntil: 'networkidle2', timeout: 30000 });

            // If playlist or channel, click first video
            if (this.source.type === 'playlist' || this.source.type === 'channel') {
                await this.clickFirstVideo();
            }

            // Wait for video player
            await this.waitForVideo();

            // Start playback
            await this.startPlayback();

            this.stats.state = 'playing';

            // Start popup dismissal loop
            this.popupInterval = setInterval(() => this.dismissPopups(), 3000);

            // Start capture loop
            this.startCaptureLoop();

            logger.info(`Stream ${this.streamId} started successfully`);
        } catch (error) {
            logger.error(`Failed to start stream: ${error}`);
            this.stats.state = 'error';
            throw error;
        }
    }

    private async clickFirstVideo(): Promise<void> {
        if (!this.page) return;
        logger.info('Looking for first video...');

        await this.page.waitForTimeout(2000);

        const clicked = await this.page.evaluate(() => {
            const selectors = [
                'ytd-playlist-video-renderer a#thumbnail',
                'ytd-rich-item-renderer a#thumbnail',
                'ytd-video-renderer a#thumbnail',
                'a#video-title',
                'a[href*="/watch?v="]',
            ];

            for (const selector of selectors) {
                const link = document.querySelector(selector) as HTMLAnchorElement;
                if (link?.href?.includes('/watch?v=')) {
                    link.click();
                    return true;
                }
            }
            return false;
        });

        if (clicked) {
            await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => { });
        }
    }

    private async waitForVideo(): Promise<void> {
        if (!this.page) return;
        await this.page.waitForSelector('video', { timeout: 30000 });
    }

    private async startPlayback(): Promise<void> {
        if (!this.page) return;

        await this.page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) {
                video.muted = true;
                video.play().catch(() => { });
            }
        });

        logger.info('Playback started');
    }

    private async dismissPopups(): Promise<void> {
        if (!this.page || !this.running) return;

        try {
            await this.page.evaluate(() => {
                // Skip ads
                const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern') as HTMLElement;
                skipBtn?.click();

                // Dismiss popups
                const dismissBtns = ['tp-yt-paper-button', 'button'].flatMap(tag =>
                    Array.from(document.querySelectorAll(tag)).filter(el =>
                        /no thanks|dismiss|not now|skip trial/i.test(el.textContent || '')
                    )
                ) as HTMLElement[];
                dismissBtns.forEach(btn => btn.click());

                // Close modals
                const closeBtn = document.querySelector('button[aria-label="Close"], #dismiss-button') as HTMLElement;
                closeBtn?.click();

                // "Still watching?" prompt
                const stillWatching = document.querySelector('.ytp-pause-overlay-button') as HTMLElement;
                stillWatching?.click();

                // Ensure video playing
                const video = document.querySelector('video');
                if (video?.paused && !video.ended) {
                    video.play().catch(() => { });
                }
                if (video) video.muted = true;
            });
        } catch {
            // Ignore popup dismissal errors
        }
    }

    private startCaptureLoop(): void {
        const intervalMs = 1000 / this.config.capture.fps;

        this.captureInterval = setInterval(async () => {
            if (!this.running || !this.page) return;

            try {
                // Get playback state
                const state = await this.page.evaluate(() => {
                    const video = document.querySelector('video');
                    const url = window.location.href;
                    const videoIdMatch = url.match(/[?&]v=([^&]+)/);

                    return {
                        currentTime: video?.currentTime || 0,
                        duration: video?.duration || 0,
                        isPlaying: video ? !video.paused && !video.ended : false,
                        videoId: videoIdMatch?.[1] || '',
                        title: document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim() ||
                            document.querySelector('yt-formatted-string.ytd-video-primary-info-renderer')?.textContent?.trim() ||
                            document.title.replace(' - YouTube', ''),
                    };
                });

                this.stats.currentTime = state.currentTime;
                this.stats.duration = state.duration;
                this.stats.videoId = state.videoId;
                this.stats.videoTitle = state.title;
                this.stats.framesCaptured++;

                // Create observation
                const observation: Observation = {
                    streamId: this.streamId,
                    frameId: this.stats.framesCaptured,
                    capturedAt: new Date().toISOString(),
                    videoId: state.videoId,
                    videoTitle: state.title,
                    currentTime: state.currentTime,
                    duration: state.duration,
                    category: this.source.category,
                    detections: [],
                };

                this.uplink.setCurrentSource(this.source);
                this.uplink.sendObservation(observation);

                // AI Analysis - capture screenshot and analyze
                if (this.aiAnalyzer && this.config.ai.enabled) {
                    try {
                        // Capture screenshot as base64
                        const screenshot = await this.page.screenshot({
                            encoding: 'base64',
                            type: 'jpeg',
                            quality: this.config.capture.quality,
                        });

                        // Send to AI for analysis
                        const analysis = await this.aiAnalyzer.analyzeFrame(
                            screenshot as string,
                            state.videoId,
                            state.title,
                            this.source.category,
                            state.currentTime
                        );

                        if (analysis) {
                            this.stats.framesAnalyzed++;
                            logger.debug(`🧠 AI: ${analysis.insights.length} insights from ${state.title}`);
                        }
                    } catch (aiError) {
                        logger.warn(`AI analysis error: ${aiError}`);
                    }
                }

            } catch (error) {
                logger.error(`Capture error: ${error}`);
            }
        }, intervalMs);
    }

    async stop(): Promise<void> {
        logger.info(`Stopping stream ${this.streamId}`);
        this.running = false;

        if (this.captureInterval) {
            clearInterval(this.captureInterval);
            this.captureInterval = null;
        }

        if (this.popupInterval) {
            clearInterval(this.popupInterval);
            this.popupInterval = null;
        }

        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }

        this.stats.state = 'stopped';
        logger.info(`Stream ${this.streamId} stopped`);
    }

    getStats(): StreamStats {
        return { ...this.stats };
    }
}
