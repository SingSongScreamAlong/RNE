export interface Source {
  name: string;
  url: string;
  type: 'video' | 'playlist' | 'channel';
  priority: number;
}

export interface WatcherConfig {
  brain: {
    endpoint: string;
    api_key: string;
    reconnect_interval_ms: number;
    max_reconnect_attempts: number;
    batch_interval_ms: number;
    batch_max_size: number;
  };
  browser: {
    headless: boolean;
    muted: boolean;
    viewport: { width: number; height: number };
    proxy: string | null;
    user_agent?: string;
  };
  streams: {
    sources: Source[];
    max_concurrent: number;
    rotation: {
      enabled: boolean;
      interval_minutes: number;
      mode: 'sequential' | 'random' | 'priority';
    };
  };
  capture: {
    fps: number;
    resolution: { width: number; height: number };
    format: 'jpeg' | 'png';
    quality: number;
  };
  detection: {
    enabled: boolean;
    model: string;
    confidence_threshold: number;
    nms_threshold: number;
    max_detections_per_frame: number;
  };
  resources: {
    cpu_limit_percent: number;
    memory_limit_mb: number;
    pause_on_user_active: boolean;
    user_idle_threshold_seconds: number;
    require_power_connected: boolean;
    min_battery_percent: number;
    pause_on_battery_saver: boolean;
  };
  schedule: {
    enabled: boolean;
    active_hours: { start: string; end: string };
    active_days: number[];
  };
  autonomous: {
    enabled: boolean;
    start_on_launch: boolean;
  };
}
