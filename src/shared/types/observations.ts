export interface WatcherStatus {
  state: 'idle' | 'starting' | 'running' | 'paused' | 'stopped' | 'error';
  streams: StreamStatus[];
  uplink_connected: boolean;
  schedule_active: boolean;
  paused_reason?: string;
}

export interface WatcherStats {
  session_started_at: string;
  total_watch_time_seconds: number;
  total_frames_captured: number;
  total_detections: number;
  total_observations_sent: number;
  videos_watched: number;
  errors_count: number;
  uplink_reconnects: number;
}

export interface StreamStatus {
  stream_id: string;
  video_id: string;
  video_title: string;
  state: 'starting' | 'playing' | 'buffering' | 'stalled' | 'error' | 'stopped';
  current_time: number;
  duration: number;
  frames_captured: number;
  detections_count: number;
  started_at: string;
  last_activity: string;
  error_message?: string;
}

export interface Detection {
  class_id: number;
  class_name: string;
  confidence: number;
  bbox: BoundingBox;
  track_id?: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Observation {
  stream_id: string;
  frame_id: number;
  captured_at: string;
  frame_width: number;
  frame_height: number;
  detections: Detection[];
}
