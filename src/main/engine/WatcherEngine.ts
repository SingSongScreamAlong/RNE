import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { WatcherConfig } from '../../shared/types/config';
import { WatcherStatus, WatcherStats } from '../../shared/types/observations';
import { StreamManager } from './StreamManager';
import { UplinkManager } from '../uplink/UplinkManager';
import { Logger } from '../utils/Logger';

const logger = new Logger('WatcherEngine');

export class WatcherEngine extends EventEmitter {
  private config: WatcherConfig;
  private parentWindow: BrowserWindow | null = null;
  private streamManager: StreamManager | null = null;
  private uplinkManager: UplinkManager | null = null;
  private state: WatcherStatus['state'] = 'idle';
  private pausedReason?: string;
  private stats: WatcherStats;

  constructor(config: WatcherConfig) {
    super();
    this.config = config;
    this.stats = this.initStats();
  }

  setParentWindow(window: BrowserWindow): void {
    this.parentWindow = window;
  }

  private initStats(): WatcherStats {
    return {
      session_started_at: new Date().toISOString(),
      total_watch_time_seconds: 0,
      total_frames_captured: 0,
      total_detections: 0,
      total_observations_sent: 0,
      videos_watched: 0,
      errors_count: 0,
      uplink_reconnects: 0,
    };
  }

  async start(): Promise<void> {
    if (this.state === 'running') {
      logger.warn('Watcher already running');
      return;
    }

    logger.info('Starting Watcher Engine...');
    this.state = 'starting';
    this.stats = this.initStats();

    try {
      this.uplinkManager = new UplinkManager(this.config);
      await this.uplinkManager.connect();

      this.streamManager = new StreamManager(this.config, this.uplinkManager);
      
      if (this.parentWindow) {
        this.streamManager.setParentWindow(this.parentWindow);
      }
      
      await this.streamManager.start();

      this.state = 'running';
      logger.info('Watcher Engine started successfully');
      this.emit('started');
    } catch (error) {
      this.state = 'error';
      logger.error('Failed to start Watcher Engine:', error);
      this.emit('error', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    logger.info('Stopping Watcher Engine...');
    
    await this.streamManager?.stop();
    await this.uplinkManager?.disconnect();
    
    this.state = 'idle';
    this.emit('stopped');
    logger.info('Watcher Engine stopped');
  }

  pause(reason?: string): void {
    if (this.state !== 'running') return;

    logger.info(`Pausing Watcher: ${reason || 'User requested'}`);
    this.state = 'paused';
    this.pausedReason = reason;
    this.streamManager?.pause();
    this.emit('paused', reason);
  }

  resume(): void {
    if (this.state !== 'paused') return;

    logger.info('Resuming Watcher');
    this.state = 'running';
    this.pausedReason = undefined;
    this.streamManager?.resume();
    this.emit('resumed');
  }

  getStatus(): WatcherStatus {
    return {
      state: this.state,
      streams: this.streamManager?.getStreamStatuses() ?? [],
      uplink_connected: this.uplinkManager?.isConnected() ?? false,
      schedule_active: true,
      paused_reason: this.pausedReason,
    };
  }

  getStats(): WatcherStats {
    // Aggregate stats from stream manager
    if (this.streamManager) {
      const streamStatuses = this.streamManager.getStreamStatuses();
      let totalFrames = 0;
      
      for (const status of streamStatuses) {
        totalFrames += status.frames_captured || 0;
      }
      
      this.stats.total_frames_captured = totalFrames;
      this.stats.total_observations_sent = totalFrames;
    }
    
    return { ...this.stats };
  }

  updateConfig(config: WatcherConfig): void {
    this.config = config;
    this.streamManager?.updateConfig(config);
  }
}
