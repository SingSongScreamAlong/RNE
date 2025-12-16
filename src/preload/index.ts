import { contextBridge, ipcRenderer } from 'electron';

console.log('[Preload] Script starting...');

export interface WatcherAPI {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  getStatus: () => Promise<any>;
  getStats: () => Promise<any>;
  getConfig: () => Promise<any>;
  updateConfig: (updates: Record<string, unknown>) => Promise<void>;
  onStatusChange: (callback: (status: any) => void) => void;
  onStreamUpdate: (callback: (streams: any[]) => void) => void;
  onError: (callback: (error: { message: string; code: string }) => void) => void;
  onLog: (callback: (log: any) => void) => void;
  onStatsUpdate: (callback: (stats: any) => void) => void;
  minimize: () => void;
  close: () => void;
}

const api: WatcherAPI = {
  start: () => ipcRenderer.invoke('engine:start'),
  stop: () => ipcRenderer.invoke('engine:stop'),
  pause: () => ipcRenderer.invoke('engine:pause'),
  resume: () => ipcRenderer.invoke('engine:resume'),
  getStatus: () => ipcRenderer.invoke('engine:status'),
  getStats: () => ipcRenderer.invoke('engine:stats'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateConfig: (updates) => ipcRenderer.invoke('config:update', updates),
  onStatusChange: (callback) => {
    ipcRenderer.on('status:change', (_, status) => callback(status));
  },
  onStreamUpdate: (callback) => {
    ipcRenderer.on('streams:update', (_, streams) => callback(streams));
  },
  onError: (callback) => {
    ipcRenderer.on('error', (_, error) => callback(error));
  },
  onLog: (callback) => {
    ipcRenderer.on('log', (_, log) => callback(log));
  },
  onStatsUpdate: (callback) => {
    ipcRenderer.on('stats:update', (_, stats) => callback(stats));
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
};

console.log('[Preload] Exposing watcher API...');
contextBridge.exposeInMainWorld('watcher', api);
console.log('[Preload] Watcher API exposed');

declare global {
  interface Window {
    watcher: WatcherAPI;
  }
}
