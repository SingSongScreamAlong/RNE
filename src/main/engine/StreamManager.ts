import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { WatcherConfig, Source } from '../../shared/types/config';
import { StreamStatus } from '../../shared/types/observations';
import { EmbeddedBrowser } from '../browser/EmbeddedBrowser';
import { UplinkManager } from '../uplink/UplinkManager';
import { Logger } from '../utils/Logger';

const logger = new Logger('StreamManager');

interface Stream {
  id: string;
  source: Source;
  browser: EmbeddedBrowser;
  status: StreamStatus;
}

export class StreamManager extends EventEmitter {
  private config: WatcherConfig;
  private uplink: UplinkManager;
  private parentWindow: BrowserWindow | null = null;
  private streams: Map<string, Stream> = new Map();
  private sourceQueue: Source[] = [];
  private currentSourceIndex = 0;
  private isPaused = false;

  constructor(config: WatcherConfig, uplink: UplinkManager) {
    super();
    this.config = config;
    this.uplink = uplink;
    this.initSourceQueue();
  }

  setParentWindow(window: BrowserWindow): void {
    this.parentWindow = window;
  }

  private initSourceQueue(): void {
    const sources = [...this.config.streams.sources];
    
    if (this.config.streams.rotation.mode === 'random') {
      this.shuffleArray(sources);
    } else if (this.config.streams.rotation.mode === 'priority') {
      sources.sort((a, b) => a.priority - b.priority);
    }
    
    this.sourceQueue = sources;
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  async start(): Promise<void> {
    logger.info(`Starting StreamManager with ${this.config.streams.max_concurrent} streams`);

    for (let i = 0; i < this.config.streams.max_concurrent; i++) {
      const source = this.getNextSource();
      await this.startStream(source);
    }
  }

  private getNextSource(): Source {
    const source = this.sourceQueue[this.currentSourceIndex];
    this.currentSourceIndex = (this.currentSourceIndex + 1) % this.sourceQueue.length;
    return source;
  }

  private async startStream(source: Source): Promise<void> {
    if (!this.parentWindow) {
      throw new Error('Parent window not set - call setParentWindow first');
    }

    const streamId = uuidv4();
    logger.info(`Starting stream ${streamId} for source: ${source.name}`);

    try {
      const browser = new EmbeddedBrowser(this.config.browser);
      await browser.launch(this.parentWindow);

      const stream: Stream = {
        id: streamId,
        source,
        browser,
        status: {
          stream_id: streamId,
          video_id: '',
          video_title: source.name,
          state: 'starting',
          current_time: 0,
          duration: 0,
          frames_captured: 0,
          detections_count: 0,
          started_at: new Date().toISOString(),
          last_activity: new Date().toISOString(),
        },
      };

      this.streams.set(streamId, stream);

      await browser.navigateToSource(source);
      stream.status.state = 'playing';

      this.startCaptureLoop(stream);

      logger.info(`Stream ${streamId} started successfully`);
    } catch (error) {
      logger.error(`Failed to start stream ${streamId}:`, error);
      throw error;
    }
  }

  private async startCaptureLoop(stream: Stream): Promise<void> {
    const intervalMs = 1000 / this.config.capture.fps;

    const captureFrame = async () => {
      if (this.isPaused || stream.status.state === 'stopped') return;

      try {
        const frameBuffer = await stream.browser.captureScreenshot();
        if (!frameBuffer) {
          logger.debug('No frame captured');
        } else {
          stream.status.frames_captured++;
          stream.status.last_activity = new Date().toISOString();

          await this.uplink.sendObservation({
            stream_id: stream.id,
            frame_id: stream.status.frames_captured,
            captured_at: new Date().toISOString(),
            frame_width: this.config.capture.resolution.width,
            frame_height: this.config.capture.resolution.height,
            detections: [],
          });
        }

        const playbackState = await stream.browser.getPlaybackState();
        stream.status.current_time = playbackState.currentTime;
        stream.status.duration = playbackState.duration;
        stream.status.video_id = playbackState.videoId;
        
        if (playbackState.isPlaying) {
          stream.status.state = 'playing';
        } else if (playbackState.isBuffering) {
          stream.status.state = 'buffering';
        }

      } catch (error) {
        logger.error(`Capture error in stream ${stream.id}:`, error);
      }

      if (!this.streams.has(stream.id)) return;
      if (stream.status.state !== 'error' && stream.status.state !== 'stopped') {
        setTimeout(captureFrame, intervalMs);
      }
    };

    captureFrame();
  }

  pause(): void {
    this.isPaused = true;
    for (const stream of this.streams.values()) {
      stream.browser.pause();
    }
  }

  resume(): void {
    this.isPaused = false;
    for (const stream of this.streams.values()) {
      stream.browser.resume();
    }
  }

  async stop(): Promise<void> {
    for (const stream of this.streams.values()) {
      stream.status.state = 'stopped';
      await stream.browser.close();
    }
    this.streams.clear();
    logger.info('StreamManager stopped');
  }

  getStreamStatuses(): StreamStatus[] {
    return Array.from(this.streams.values()).map(s => s.status);
  }

  updateConfig(config: WatcherConfig): void {
    this.config = config;
  }
}
