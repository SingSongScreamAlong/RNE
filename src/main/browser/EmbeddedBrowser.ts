import { BrowserView, BrowserWindow } from 'electron';
import { Source } from '../../shared/types/config';
import { Logger } from '../utils/Logger';

const logger = new Logger('EmbeddedBrowser');

interface BrowserConfig {
  headless: boolean;
  muted: boolean;
  user_agent?: string;
  viewport: { width: number; height: number };
  proxy: string | null;
}

export interface PlaybackState {
  isPlaying: boolean;
  isBuffering: boolean;
  isStalled: boolean;
  hasEnded: boolean;
  hasPrompt: boolean;
  currentTime: number;
  duration: number;
  videoId: string;
}

export class EmbeddedBrowser {
  private config: BrowserConfig;
  private browserView: BrowserView | null = null;
  private parentWindow: BrowserWindow | null = null;
  private lastPlaybackTime = 0;
  private stallCheckCount = 0;
  private bounds = { x: 320, y: 80, width: 800, height: 600 };
  private popupDismissInterval: NodeJS.Timeout | null = null;

  constructor(config: BrowserConfig) {
    this.config = config;
  }

  async launch(parentWindow: BrowserWindow): Promise<void> {
    logger.info('Creating embedded browser view');
    
    this.parentWindow = parentWindow;
    
    this.browserView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    parentWindow.addBrowserView(this.browserView);
    this.updateBounds();
    
    parentWindow.on('resize', () => this.updateBounds());

    const userAgent = this.config.user_agent || 
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.browserView.webContents.setUserAgent(userAgent);

    this.startPopupDismissal();

    logger.info('Embedded browser view created');
  }

  private startPopupDismissal(): void {
    this.popupDismissInterval = setInterval(() => {
      this.dismissAllPopups().catch(() => {});
    }, 2000);
  }

  private async dismissAllPopups(): Promise<void> {
    if (!this.browserView) return;

    await this.browserView.webContents.executeJavaScript(`
      (function() {
        const clickIfFound = (selectors) => {
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.offsetParent !== null) {
              el.click();
              return true;
            }
          }
          return false;
        };

        const clickByText = (texts, tagName = 'button') => {
          const elements = document.querySelectorAll(tagName);
          for (const el of elements) {
            const text = el.textContent?.toLowerCase() || '';
            for (const t of texts) {
              if (text.includes(t.toLowerCase())) {
                el.click();
                return true;
              }
            }
          }
          return false;
        };

        // Skip ads
        clickIfFound(['.ytp-ad-skip-button', '.ytp-ad-skip-button-modern', '.ytp-skip-ad-button']);

        // Dismiss YouTube Premium popup
        clickByText(['no thanks', 'no, thanks', 'dismiss', 'not now', 'skip trial'], 'button');
        clickByText(['no thanks', 'no, thanks', 'dismiss', 'not now', 'skip trial'], 'tp-yt-paper-button');

        // Close modal dialogs
        clickIfFound(['tp-yt-iron-overlay-backdrop', 'button[aria-label="Close"]', 'button[aria-label="Dismiss"]', '#dismiss-button']);

        // Accept/reject cookies
        clickByText(['accept all', 'reject all'], 'button');

        // Dismiss "Are you still watching?"
        clickIfFound(['.ytp-pause-overlay-button']);
        clickByText(['yes', 'continue watching'], 'button');

        // Ensure video is playing and muted
        const video = document.querySelector('video');
        if (video) {
          if (video.paused && !video.ended) {
            video.play().catch(() => {});
          }
          video.muted = true;
        }
      })();
    `).catch(() => {});
  }

  private updateBounds(): void {
    if (!this.browserView || !this.parentWindow) return;
    
    const [width, height] = this.parentWindow.getContentSize();
    const sidebarWidth = 320;
    const headerHeight = 40;
    const videoHeaderHeight = 45;
    const videoInfoHeight = 30;
    const footerHeight = 30;
    
    this.bounds = {
      x: sidebarWidth,
      y: headerHeight + videoHeaderHeight,
      width: width - sidebarWidth,
      height: height - headerHeight - videoHeaderHeight - videoInfoHeight - footerHeight,
    };
    
    this.browserView.setBounds(this.bounds);
  }

  async navigateToSource(source: Source): Promise<void> {
    if (!this.browserView) throw new Error('Browser not launched');

    logger.info(`Navigating to: ${source.url} (type: ${source.type})`);
    
    try {
      await this.browserView.webContents.loadURL(source.url);
    } catch (error: any) {
      if (error.message && !error.message.includes('ERR_ABORTED')) {
        throw error;
      }
      logger.info('Initial navigation interrupted, continuing...');
    }

    if (source.type === 'playlist' || source.type === 'channel') {
      await this.clickFirstVideo();
    }

    try {
      await this.waitForVideo();
      await this.startPlayback();
    } catch (error) {
      logger.warn('Video wait/playback error, continuing anyway:', error);
    }
  }

  private async waitForVideo(): Promise<void> {
    if (!this.browserView) return;

    await this.browserView.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Video timeout')), 30000);
        const check = () => {
          const video = document.querySelector('video');
          if (video) {
            clearTimeout(timeout);
            resolve(true);
          } else {
            setTimeout(check, 500);
          }
        };
        check();
      });
    `);
  }

  private async clickFirstVideo(): Promise<void> {
    if (!this.browserView) return;

    logger.info('Looking for first video to click...');

    await this.browserView.webContents.executeJavaScript(`
      new Promise((resolve) => {
        setTimeout(() => {
          const selectors = [
            'ytd-playlist-video-renderer a#thumbnail',
            'ytd-rich-item-renderer a#thumbnail',
            'ytd-video-renderer a#thumbnail',
            'a#video-title',
            'a[href*="/watch?v="]',
          ];
          
          for (const selector of selectors) {
            const link = document.querySelector(selector);
            if (link && link.href && link.href.includes('/watch?v=')) {
              link.click();
              resolve(true);
              return;
            }
          }
          resolve(false);
        }, 2000);
      });
    `);
  }

  private async startPlayback(): Promise<void> {
    if (!this.browserView) return;

    await this.browserView.webContents.executeJavaScript(`
      (function() {
        const video = document.querySelector('video');
        if (video && video.paused) {
          video.play().catch(() => {});
        }
        if (video) {
          video.muted = true;
        }
      })();
    `);

    logger.info('Playback started');
  }

  async getPlaybackState(): Promise<PlaybackState> {
    if (!this.browserView) {
      return {
        isPlaying: false,
        isBuffering: false,
        isStalled: false,
        hasEnded: false,
        hasPrompt: false,
        currentTime: 0,
        duration: 0,
        videoId: '',
      };
    }

    try {
      const state = await this.browserView.webContents.executeJavaScript(`
        (function() {
          const video = document.querySelector('video');
          if (!video) {
            return {
              isPlaying: false,
              isBuffering: false,
              currentTime: 0,
              duration: 0,
              hasEnded: false,
            };
          }
          return {
            isPlaying: !video.paused && !video.ended,
            isBuffering: video.readyState < 3,
            currentTime: video.currentTime,
            duration: video.duration || 0,
            hasEnded: video.ended,
          };
        })();
      `);

      const hasPrompt = await this.browserView.webContents.executeJavaScript(`
        !!document.querySelector('.ytp-pause-overlay, [aria-label*="still watching"]');
      `);

      const isStalled = this.detectStall(state.currentTime);

      const url = this.browserView.webContents.getURL();
      const videoIdMatch = url.match(/[?&]v=([^&]+)/);
      const videoId = videoIdMatch ? videoIdMatch[1] : '';

      return {
        ...state,
        isStalled,
        hasPrompt,
        videoId,
      };
    } catch (error) {
      return {
        isPlaying: false,
        isBuffering: false,
        isStalled: false,
        hasEnded: false,
        hasPrompt: false,
        currentTime: 0,
        duration: 0,
        videoId: '',
      };
    }
  }

  private detectStall(currentTime: number): boolean {
    if (currentTime === this.lastPlaybackTime) {
      this.stallCheckCount++;
    } else {
      this.stallCheckCount = 0;
      this.lastPlaybackTime = currentTime;
    }
    return this.stallCheckCount >= 3;
  }

  async captureScreenshot(): Promise<Buffer | null> {
    if (!this.browserView) return null;

    try {
      const image = await this.browserView.webContents.capturePage();
      return image.toJPEG(80);
    } catch (error) {
      logger.error('Screenshot capture failed:', error);
      return null;
    }
  }

  pause(): void {
    this.browserView?.webContents.executeJavaScript(`
      const video = document.querySelector('video');
      if (video) video.pause();
    `).catch(() => {});
  }

  resume(): void {
    this.browserView?.webContents.executeJavaScript(`
      const video = document.querySelector('video');
      if (video) video.play().catch(() => {});
    `).catch(() => {});
  }

  async close(): Promise<void> {
    if (this.popupDismissInterval) {
      clearInterval(this.popupDismissInterval);
      this.popupDismissInterval = null;
    }
    
    if (this.browserView && this.parentWindow) {
      this.parentWindow.removeBrowserView(this.browserView);
    }
    this.browserView = null;
    this.parentWindow = null;
    logger.info('Embedded browser closed');
  }
}
