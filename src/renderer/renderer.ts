console.log('[Renderer] Script loaded');
console.log('[Renderer] window.watcher exists:', typeof (window as any).watcher !== 'undefined');
console.log('[Renderer] window.watcher:', (window as any).watcher);

// Global click handler for debugging
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  console.log('[Renderer] Click detected on:', target.tagName, target.id, target.className);
});

// Expose start function globally for inline onclick
(window as any).startEngine = async () => {
  console.log('[Renderer] startEngine called via global');
  if ((window as any).watcher) {
    await (window as any).watcher.start();
  }
};

if (typeof (window as any).watcher === 'undefined') {
  console.error('[Renderer] ERROR: window.watcher is undefined! Preload script may not have loaded.');
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = 'color: red; padding: 20px; position: fixed; top: 0; left: 0; right: 0; background: #1a1a1a; z-index: 9999;';
  errorDiv.innerHTML = '<h1>Error: Preload Failed</h1><p>window.watcher API is not available.</p>';
  document.body.prepend(errorDiv);
}

interface Window {
  watcher: any;
}

class WatcherUI {
  private statusState: HTMLElement;
  private statusConnection: HTMLElement;
  private statusStreams: HTMLElement;
  private statusUptime: HTMLElement;
  
  private btnStart: HTMLButtonElement;
  private btnStop: HTMLButtonElement;
  private btnPause: HTMLButtonElement;
  
  private statFrames: HTMLElement;
  private statObservations: HTMLElement;
  private statEvents: HTMLElement;
  private statFps: HTMLElement;
  
  private logsContainer: HTMLElement;
  
  private videoTitle: HTMLElement;
  private videoStatus: HTMLElement;
  private videoTime: HTMLElement;
  private videoId: HTMLElement;
  
  private uptimeInterval: number | null = null;
  private startTime: number | null = null;

  constructor() {
    this.statusState = document.getElementById('status-state')!;
    this.statusConnection = document.getElementById('status-connection')!;
    this.statusStreams = document.getElementById('status-streams')!;
    this.statusUptime = document.getElementById('status-uptime')!;
    
    this.btnStart = document.getElementById('btn-start') as HTMLButtonElement;
    this.btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
    this.btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
    
    this.statFrames = document.getElementById('stat-frames')!;
    this.statObservations = document.getElementById('stat-observations')!;
    this.statEvents = document.getElementById('stat-events')!;
    this.statFps = document.getElementById('stat-fps')!;
    
    this.logsContainer = document.getElementById('logs-container')!;
    
    this.videoTitle = document.getElementById('video-title')!;
    this.videoStatus = document.getElementById('video-status')!;
    this.videoTime = document.getElementById('video-time')!;
    this.videoId = document.getElementById('video-id')!;
    
    this.setupEventListeners();
    this.setupIPCListeners();
    this.loadInitialState();
  }

  private setupEventListeners(): void {
    console.log('[Renderer] Setting up event listeners');
    console.log('[Renderer] btnStart element:', this.btnStart);
    
    document.getElementById('btn-minimize')?.addEventListener('click', () => {
      window.watcher.minimize();
    });
    
    document.getElementById('btn-close')?.addEventListener('click', () => {
      window.watcher.close();
    });
    
    if (!this.btnStart) {
      console.error('[Renderer] btnStart is null!');
      return;
    }
    
    this.btnStart.addEventListener('click', async () => {
      console.log('[Renderer] Start button clicked');
      this.addLog('info', 'Starting engine...');
      this.btnStart.disabled = true;
      try {
        await window.watcher.start();
        console.log('[Renderer] Start completed');
      } catch (error) {
        console.error('[Renderer] Start error:', error);
        this.addLog('error', `Failed to start: ${error}`);
        this.btnStart.disabled = false;
      }
    });
    
    this.btnStop.addEventListener('click', async () => {
      this.btnStop.disabled = true;
      try {
        await window.watcher.stop();
      } catch (error) {
        this.addLog('error', `Failed to stop: ${error}`);
        this.btnStop.disabled = false;
      }
    });
    
    this.btnPause.addEventListener('click', async () => {
      const isPaused = this.btnPause.textContent?.includes('Resume');
      try {
        if (isPaused) {
          await window.watcher.resume();
        } else {
          await window.watcher.pause();
        }
      } catch (error) {
        this.addLog('error', `Failed to ${isPaused ? 'resume' : 'pause'}: ${error}`);
      }
    });
  }

  private setupIPCListeners(): void {
    window.watcher.onStatusChange((status: any) => {
      this.updateStatus(status);
    });
    
    window.watcher.onStreamUpdate((streams: any[]) => {
      this.updateStreams(streams);
    });
    
    window.watcher.onError((error: { message: string; code: string }) => {
      this.addLog('error', `[${error.code}] ${error.message}`);
    });
    
    window.watcher.onLog((log: any) => {
      this.addLog(log.level, log.message, log.context);
    });
    
    window.watcher.onStatsUpdate((stats: any) => {
      this.updateStats(stats);
    });
  }

  private async loadInitialState(): Promise<void> {
    try {
      const status = await window.watcher.getStatus();
      this.updateStatus(status);
      
      const stats = await window.watcher.getStats();
      this.updateStats(stats);
    } catch (error) {
      this.addLog('warn', 'Failed to load initial state');
    }
  }

  private updateStatus(status: any): void {
    if (!status) return;
    
    this.statusState.textContent = status.state?.charAt(0).toUpperCase() + status.state?.slice(1) || 'Unknown';
    this.statusState.className = `value state-${status.state || 'idle'}`;
    
    this.statusConnection.textContent = status.connected ? 'Connected' : 'Disconnected';
    this.statusConnection.style.color = status.connected ? 'var(--success)' : 'var(--error)';
    
    this.statusStreams.textContent = (status.activeStreams || 0).toString();
    
    switch (status.state) {
      case 'idle':
      case 'stopped':
        this.btnStart.disabled = false;
        this.btnStop.disabled = true;
        this.btnPause.disabled = true;
        this.btnPause.textContent = '⏸ Pause';
        this.stopUptimeTimer();
        break;
      case 'running':
      case 'starting':
        this.btnStart.disabled = true;
        this.btnStop.disabled = false;
        this.btnPause.disabled = false;
        this.btnPause.textContent = '⏸ Pause';
        this.startUptimeTimer();
        break;
      case 'paused':
        this.btnStart.disabled = true;
        this.btnStop.disabled = false;
        this.btnPause.disabled = false;
        this.btnPause.textContent = '▶ Resume';
        break;
      case 'error':
        this.btnStart.disabled = false;
        this.btnStop.disabled = true;
        this.btnPause.disabled = true;
        this.stopUptimeTimer();
        break;
    }
  }

  private updateStats(stats: any): void {
    if (!stats) return;
    this.statFrames.textContent = this.formatNumber(stats.framesCaptures || 0);
    this.statObservations.textContent = this.formatNumber(stats.observationsSent || 0);
    this.statEvents.textContent = this.formatNumber(stats.eventsDetected || 0);
    this.statFps.textContent = (stats.avgFps || 0).toFixed(1);
  }

  private updateStreams(streams: any[]): void {
    if (!streams || streams.length === 0) {
      this.videoTitle.textContent = 'No Stream Active';
      this.videoStatus.textContent = 'Waiting...';
      this.videoStatus.className = 'video-status';
      this.videoTime.textContent = '0:00 / 0:00';
      this.videoId.textContent = '';
      return;
    }
    
    const stream = streams[0];
    this.videoTitle.textContent = stream.videoId || 'Loading...';
    this.videoStatus.textContent = stream.status || 'unknown';
    this.videoStatus.className = `video-status ${stream.status}`;
    this.videoTime.textContent = `${this.formatTime(stream.currentTime || 0)} / ${this.formatTime(stream.duration || 0)}`;
    this.videoId.textContent = stream.videoId ? `ID: ${stream.videoId}` : '';
  }

  private addLog(level: string, message: string, context?: string): void {
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const contextStr = context ? `[${context}] ` : '';
    
    entry.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-message">${contextStr}${this.escapeHtml(message)}</span>
    `;
    
    this.logsContainer.appendChild(entry);
    this.logsContainer.scrollTop = this.logsContainer.scrollHeight;
    
    while (this.logsContainer.children.length > 100) {
      this.logsContainer.removeChild(this.logsContainer.firstChild!);
    }
  }

  private startUptimeTimer(): void {
    if (this.uptimeInterval) return;
    this.startTime = Date.now();
    
    this.uptimeInterval = window.setInterval(() => {
      if (this.startTime) {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        this.statusUptime.textContent = this.formatDuration(elapsed);
      }
    }, 1000);
  }

  private stopUptimeTimer(): void {
    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
      this.uptimeInterval = null;
    }
    this.startTime = null;
    this.statusUptime.textContent = '--:--:--';
  }

  private formatNumber(num: number): string {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  private formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private formatDuration(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize immediately if DOM is ready, otherwise wait
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Renderer] DOMContentLoaded fired');
    new WatcherUI();
  });
} else {
  console.log('[Renderer] DOM already ready, initializing now');
  new WatcherUI();
}
