import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut } from 'electron';
import * as path from 'path';
import { ConfigManager } from './config/ConfigManager';
import { WatcherEngine } from './engine/WatcherEngine';
import { Logger } from './utils/Logger';

const logger = new Logger('Main');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let watcherEngine: WatcherEngine | null = null;

async function createWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, '../preload/index.js');
  const fs = require('fs');
  
  console.log('[Main] Preload path:', preloadPath);
  console.log('[Main] Preload exists:', fs.existsSync(preloadPath));
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: true,
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin') {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Page finished loading');
    // DevTools disabled to test if it's blocking clicks
    // mainWindow?.webContents.openDevTools();
  });

  // Log any console messages from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message}`);
  });

  // Log preload errors
  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error(`[Main] Preload error in ${preloadPath}:`, error);
  });
}

function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { label: 'Quit', click: () => app.quit() },
  ]);
  
  tray.setContextMenu(contextMenu);
  tray.setToolTip('RNE Watcher Agent');
}

async function initializeEngine(): Promise<void> {
  const configManager = ConfigManager.getInstance();
  const config = configManager.load();
  
  watcherEngine = new WatcherEngine(config);
  logger.info('Engine initialized - ready for manual start via UI');
}

function setupIPC(): void {
  ipcMain.handle('engine:start', async () => {
    logger.info('engine:start IPC handler called');
    try {
      await watcherEngine?.start();
      logger.info('engine:start completed successfully');
    } catch (error) {
      logger.error('engine:start error:', error);
      throw error;
    }
  });

  ipcMain.handle('engine:stop', async () => {
    await watcherEngine?.stop();
  });

  ipcMain.handle('engine:pause', async () => {
    await watcherEngine?.pause();
  });

  ipcMain.handle('engine:resume', async () => {
    await watcherEngine?.resume();
  });

  ipcMain.handle('engine:status', () => {
    return watcherEngine?.getStatus();
  });

  ipcMain.handle('engine:stats', () => {
    return watcherEngine?.getStats();
  });

  ipcMain.handle('config:get', () => {
    return ConfigManager.getInstance().get();
  });

  ipcMain.handle('config:update', (_, updates) => {
    ConfigManager.getInstance().update(updates);
  });

  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  // Forward engine events to renderer
  const sendStatusUpdate = () => {
    if (watcherEngine && mainWindow) {
      const engineStatus = watcherEngine.getStatus();
      const engineStats = watcherEngine.getStats();
      
      const status = {
        state: engineStatus.state,
        connected: engineStatus.uplink_connected,
        activeStreams: engineStatus.streams?.length ?? 0,
        totalObservations: engineStats.total_observations_sent,
        uptime: 0,
      };
      mainWindow.webContents.send('status:change', status);
    }
  };

  watcherEngine?.on('started', () => {
    sendStatusUpdate();
    mainWindow?.webContents.send('log', { level: 'info', message: 'Engine started' });
  });

  watcherEngine?.on('stopped', () => {
    sendStatusUpdate();
    mainWindow?.webContents.send('log', { level: 'info', message: 'Engine stopped' });
  });

  watcherEngine?.on('paused', (reason: string) => {
    sendStatusUpdate();
    mainWindow?.webContents.send('log', { level: 'info', message: `Engine paused: ${reason}` });
  });

  watcherEngine?.on('resumed', () => {
    sendStatusUpdate();
    mainWindow?.webContents.send('log', { level: 'info', message: 'Engine resumed' });
  });

  watcherEngine?.on('error', (error: Error) => {
    sendStatusUpdate();
    mainWindow?.webContents.send('error', { message: String(error), code: 'ENGINE_ERROR' });
    mainWindow?.webContents.send('log', { level: 'error', message: String(error) });
  });

  // Periodic status updates
  setInterval(() => {
    if (watcherEngine && mainWindow) {
      const engineStatus = watcherEngine.getStatus();
      const engineStats = watcherEngine.getStats();
      
      if (engineStatus.state === 'running' || engineStatus.state === 'starting' || engineStatus.state === 'paused') {
        const status = {
          state: engineStatus.state,
          connected: engineStatus.uplink_connected,
          activeStreams: engineStatus.streams?.length ?? 0,
          totalObservations: engineStats.total_observations_sent,
          uptime: 0,
        };
        mainWindow.webContents.send('status:change', status);
        
        const streams = (engineStatus.streams || []).map(s => ({
          streamId: s.stream_id,
          videoId: s.video_id || s.video_title,
          status: s.state,
          currentTime: s.current_time,
          duration: s.duration,
          detectionsThisSession: s.detections_count,
        }));
        mainWindow.webContents.send('streams:update', streams);
        
        const stats = {
          sessionStart: engineStats.session_started_at,
          framesCaptures: engineStats.total_frames_captured,
          observationsSent: engineStats.total_observations_sent,
          eventsDetected: engineStats.total_detections,
          errorsCount: engineStats.errors_count,
          avgFps: 0,
        };
        mainWindow.webContents.send('stats:update', stats);
      }
    }
  }, 1000);
}

app.whenReady().then(async () => {
  logger.info('Application starting...');

  await initializeEngine();
  setupIPC();
  await createWindow();
  createTray();
  
  if (mainWindow && watcherEngine) {
    watcherEngine.setParentWindow(mainWindow);
  }

  // Auto-start engine after 3 seconds for testing
  setTimeout(async () => {
    logger.info('Auto-starting engine for testing...');
    try {
      await watcherEngine?.start();
      logger.info('Engine auto-started successfully');
    } catch (error) {
      logger.error('Failed to auto-start engine:', error);
    }
  }, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  logger.info('Application shutting down...');
  await watcherEngine?.stop();
});
