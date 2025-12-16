import Store from 'electron-store';
import { WatcherConfig } from '../../shared/types/config';
import { Logger } from '../utils/Logger';

const logger = new Logger('ConfigManager');

const defaultConfig: WatcherConfig = {
  brain: {
    // Socket.IO endpoint (no /ws path needed - Socket.IO handles it)
    endpoint: process.env.BRAIN_ENDPOINT || 'https://coral-app-x988a.ondigitalocean.app',
    api_key: process.env.BRAIN_API_KEY || 'dev-watcher-key',
    reconnect_interval_ms: 5000,
    max_reconnect_attempts: 10,
    batch_interval_ms: 1000,
    batch_max_size: 50,
  },
  browser: {
    headless: false,
    muted: true,
    viewport: { width: 1280, height: 720 },
    proxy: null,
  },
  streams: {
    sources: [
      // === Formula 1 ===
      {
        name: 'F1 Official Channel',
        url: 'https://www.youtube.com/@Formula1/videos',
        type: 'channel',
        priority: 1,
      },
      {
        name: 'F1 Race Highlights',
        url: 'https://www.youtube.com/playlist?list=PLfoNZDHitwjUv0pjTwlV1vzaE0r7UDVDR',
        type: 'playlist',
        priority: 1,
      },
      // === IMSA / SportsCar Racing ===
      {
        name: 'IMSA Official',
        url: 'https://www.youtube.com/@ABORAD/videos',
        type: 'channel',
        priority: 2,
      },
      // === WEC / Endurance ===
      {
        name: 'FIA WEC',
        url: 'https://www.youtube.com/@FIAWEC/videos',
        type: 'channel',
        priority: 2,
      },
      {
        name: '24 Hours of Le Mans',
        url: 'https://www.youtube.com/@24hoursoflemans/videos',
        type: 'channel',
        priority: 2,
      },
      // === NASCAR / Oval ===
      {
        name: 'NASCAR Official',
        url: 'https://www.youtube.com/@NASCAR/videos',
        type: 'channel',
        priority: 3,
      },
      // === IndyCar ===
      {
        name: 'IndyCar Official',
        url: 'https://www.youtube.com/@INDYCAR/videos',
        type: 'channel',
        priority: 3,
      },
      // === Simracing ===
      {
        name: 'iRacing Official',
        url: 'https://www.youtube.com/@iRacing/videos',
        type: 'channel',
        priority: 4,
      },
      {
        name: 'ACC Esports',
        url: 'https://www.youtube.com/@ACCompetizione/videos',
        type: 'channel',
        priority: 4,
      },
      {
        name: 'SimRacing Highlights',
        url: 'https://www.youtube.com/@TheSimGrid/videos',
        type: 'channel',
        priority: 4,
      },
      // === GT / Touring Cars ===
      {
        name: 'GT World Challenge',
        url: 'https://www.youtube.com/@GTWorld/videos',
        type: 'channel',
        priority: 3,
      },
      // === Rally / Dirt ===
      {
        name: 'WRC Official',
        url: 'https://www.youtube.com/@WRC/videos',
        type: 'channel',
        priority: 3,
      },
      // === Formula E ===
      {
        name: 'Formula E',
        url: 'https://www.youtube.com/@FIAFormulaE/videos',
        type: 'channel',
        priority: 3,
      },
    ],
    max_concurrent: 1,
    rotation: {
      enabled: true,
      interval_minutes: 20, // Rotate every 20 minutes
      mode: 'priority', // Watch higher priority sources more often
    },
  },
  capture: {
    fps: 1,
    resolution: { width: 1280, height: 720 },
    format: 'jpeg',
    quality: 80,
  },
  detection: {
    enabled: false,
    model: 'yolov8n',
    confidence_threshold: 0.5,
    nms_threshold: 0.4,
    max_detections_per_frame: 100,
  },
  resources: {
    cpu_limit_percent: 80,
    memory_limit_mb: 2048,
    pause_on_user_active: false,
    user_idle_threshold_seconds: 300,
    require_power_connected: false,
    min_battery_percent: 10,
    pause_on_battery_saver: false,
  },
  schedule: {
    enabled: false,
    active_hours: { start: '00:00', end: '23:59' },
    active_days: [0, 1, 2, 3, 4, 5, 6],
  },
  autonomous: {
    enabled: true,
    start_on_launch: false,
  },
};

export class ConfigManager {
  private static instance: ConfigManager;
  private store: Store<WatcherConfig>;
  private config: WatcherConfig;

  private constructor() {
    this.store = new Store<WatcherConfig>({
      name: 'config',
      defaults: defaultConfig,
    });
    this.config = defaultConfig;
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  load(): WatcherConfig {
    try {
      this.config = { ...defaultConfig, ...this.store.store };

      // Always prefer environment variables for brain connection at runtime
      if (process.env.BRAIN_ENDPOINT) {
        this.config.brain.endpoint = process.env.BRAIN_ENDPOINT;
        logger.info(`Using BRAIN_ENDPOINT from environment: ${this.config.brain.endpoint}`);
      }
      if (process.env.BRAIN_API_KEY) {
        this.config.brain.api_key = process.env.BRAIN_API_KEY;
      }

      // Ensure API key is never empty (fallback to default if stored value is empty)
      if (!this.config.brain.api_key) {
        this.config.brain.api_key = 'dev-watcher-key';
        logger.info('Using default API key');
      }

      logger.info('Configuration loaded successfully');
      logger.info(`Brain endpoint: ${this.config.brain.endpoint}`);
      logger.info(`Sources configured: ${this.config.streams.sources.length}`);
      logger.info(`Schedule enabled: ${this.config.schedule.enabled}`);
      return this.config;
    } catch (error) {
      logger.error('Failed to load config, using defaults:', error);
      return defaultConfig;
    }
  }

  get(): WatcherConfig {
    return this.config;
  }

  update(updates: Partial<WatcherConfig>): void {
    this.config = { ...this.config, ...updates };
    this.store.set(this.config);
    logger.info('Configuration updated');
  }

  reset(): void {
    this.store.clear();
    this.config = defaultConfig;
    logger.info('Configuration reset to defaults');
  }
}
