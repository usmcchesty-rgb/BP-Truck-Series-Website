import path from 'path';
import { fileURLToPath } from 'url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { setBrowserAdapter, resetBrowserAdapter } from '../../recruit-scanner/browser-adapter.js';
import { createPlaywrightBrowserAdapter } from '../../recruit-scanner/iracing-browser-playwright.js';
import { createScannerService } from '../../recruit-scanner/scanner-service.js';
import { readEnvFile, writeEnvFile, SCANNER_ENV_PATH } from '../../recruit-scanner/env-file.js';
import {
  readAppSettings,
  writeAppSettings,
  getAppSettingsPath,
  BROWSER_ZOOM_STEP,
  clampBrowserZoomFactor,
  normalizeBrowserFitMode,
} from './app-settings.js';
import {
  createEmbeddedBrowserManager,
  createElectronBrowserAdapter,
} from './embedded-browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

let mainWindow = null;
let scanner = null;
let embeddedBrowser = null;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function requestBrowserBoundsUpdate() {
  sendToRenderer('request-browser-bounds');
}

function notifyBrowserZoomUpdated(factor) {
  sendToRenderer('browser-zoom-updated', {
    browserZoomFactor: clampBrowserZoomFactor(factor),
  });
}

function createEmbeddedBrowserInstance() {
  return createEmbeddedBrowserManager(mainWindow, {
    readSettings: readAppSettings,
    onZoomApplied: notifyBrowserZoomUpdated,
  });
}

async function persistAppSettings(partial) {
  const current = readAppSettings();
  const next = writeAppSettings({
    ...current,
    ...partial,
  });
  return next;
}

async function persistBrowserZoom(factor) {
  const next = await persistAppSettings({
    browserZoomFactor: clampBrowserZoomFactor(factor),
  });
  notifyBrowserZoomUpdated(next.browserZoomFactor);
  return next.browserZoomFactor;
}

async function persistBrowserFitMode(mode) {
  const next = await persistAppSettings({
    browserFitMode: normalizeBrowserFitMode(mode),
  });
  return next.browserFitMode;
}

function applyBrowserMode(useEmbeddedBrowser) {
  if (useEmbeddedBrowser) {
    if (!embeddedBrowser && mainWindow) {
      embeddedBrowser = createEmbeddedBrowserInstance();
    }
    setBrowserAdapter(createElectronBrowserAdapter(embeddedBrowser));
    embeddedBrowser?.initializeZoomFromSettings();
  } else {
    resetBrowserAdapter();
    embeddedBrowser?.hide();
  }
}

function getScanner() {
  if (!scanner) {
    scanner = createScannerService({
      onLog: (message) => sendToRenderer('scanner-log', message),
      onError: (message) => sendToRenderer('scanner-error', message),
    });
  }
  return scanner;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 1080,
    minHeight: 760,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'BP Recruit Scanner',
  });

  embeddedBrowser = createEmbeddedBrowserInstance();
  applyBrowserMode(readAppSettings().useEmbeddedBrowser);
  embeddedBrowser.initializeZoomFromSettings();

  mainWindow.loadFile(path.join(RENDERER_DIR, 'index.html'));

  mainWindow.on('resize', requestBrowserBoundsUpdate);
  mainWindow.on('move', requestBrowserBoundsUpdate);
  mainWindow.on('maximize', requestBrowserBoundsUpdate);
  mainWindow.on('unmaximize', requestBrowserBoundsUpdate);

  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(requestBrowserBoundsUpdate, 50);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    embeddedBrowser = null;
  });
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  if (scanner) {
    await scanner.shutdown();
    scanner = null;
  }
  if (embeddedBrowser) {
    await embeddedBrowser.destroy();
    embeddedBrowser = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-settings', async () => {
  return {
    ...readEnvFile(),
    ...readAppSettings(),
    appSettingsPath: getAppSettingsPath(),
    sessionStoragePath: embeddedBrowser?.getSessionStoragePath(app.getPath('userData')),
  };
});

ipcMain.handle('save-settings', async (_event, settings) => {
  writeEnvFile({
    SUPABASE_URL: String(settings?.SUPABASE_URL ?? '').trim(),
    SUPABASE_SERVICE_ROLE_KEY: String(settings?.SUPABASE_SERVICE_ROLE_KEY ?? '').trim(),
    CHROME_EXECUTABLE_PATH: String(settings?.CHROME_EXECUTABLE_PATH ?? '').trim(),
  });

  const appSettings = writeAppSettings({
    useEmbeddedBrowser: settings?.useEmbeddedBrowser !== false,
    browserZoomFactor: clampBrowserZoomFactor(
      settings?.browserZoomFactor ?? readAppSettings().browserZoomFactor
    ),
    browserFitMode: normalizeBrowserFitMode(
      settings?.browserFitMode ?? readAppSettings().browserFitMode
    ),
  });

  if (embeddedBrowser) {
    embeddedBrowser.initializeZoomFromSettings();
  }

  applyBrowserMode(appSettings.useEmbeddedBrowser);
  requestBrowserBoundsUpdate();
  notifyBrowserZoomUpdated(appSettings.browserZoomFactor);

  return {
    ok: true,
    envPath: SCANNER_ENV_PATH,
    appSettingsPath: getAppSettingsPath(),
    useEmbeddedBrowser: appSettings.useEmbeddedBrowser,
    browserZoomFactor: appSettings.browserZoomFactor,
    browserFitMode: appSettings.browserFitMode,
  };
});

ipcMain.handle('set-browser-zoom', async (_event, factor) => {
  if (!embeddedBrowser || !readAppSettings().useEmbeddedBrowser) {
    return { ok: false };
  }

  await persistBrowserFitMode('manual');
  const browserZoomFactor = embeddedBrowser.setZoomFactor(factor);
  await persistBrowserZoom(browserZoomFactor);
  return { ok: true, browserZoomFactor, browserFitMode: 'manual' };
});

ipcMain.handle('adjust-browser-zoom', async (_event, delta) => {
  if (!embeddedBrowser || !readAppSettings().useEmbeddedBrowser) {
    return { ok: false };
  }

  await persistBrowserFitMode('manual');
  const browserZoomFactor = embeddedBrowser.adjustZoom(Number(delta) || 0);
  await persistBrowserZoom(browserZoomFactor);
  return { ok: true, browserZoomFactor, browserFitMode: 'manual' };
});

ipcMain.handle('fit-browser-width', async () => {
  if (!embeddedBrowser || !readAppSettings().useEmbeddedBrowser) {
    return { ok: false };
  }

  requestBrowserBoundsUpdate();
  await new Promise((resolve) => setTimeout(resolve, 80));
  await persistBrowserFitMode('fit-width');
  const browserZoomFactor = await embeddedBrowser.fitZoomWidth();
  await persistBrowserZoom(browserZoomFactor);
  return { ok: true, browserZoomFactor, browserFitMode: 'fit-width' };
});

ipcMain.handle('fit-browser-height', async () => {
  if (!embeddedBrowser || !readAppSettings().useEmbeddedBrowser) {
    return { ok: false };
  }

  requestBrowserBoundsUpdate();
  await new Promise((resolve) => setTimeout(resolve, 80));
  await persistBrowserFitMode('fit-height');
  const browserZoomFactor = await embeddedBrowser.fitZoomHeight();
  await persistBrowserZoom(browserZoomFactor);
  return { ok: true, browserZoomFactor, browserFitMode: 'fit-height' };
});

ipcMain.handle('fit-browser-to-panel', async () => {
  if (!embeddedBrowser || !readAppSettings().useEmbeddedBrowser) {
    return { ok: false };
  }

  requestBrowserBoundsUpdate();
  await new Promise((resolve) => setTimeout(resolve, 80));
  await persistBrowserFitMode('fit-panel');
  const browserZoomFactor = await embeddedBrowser.fitZoomToPanel();
  await persistBrowserZoom(browserZoomFactor);
  return { ok: true, browserZoomFactor, browserFitMode: 'fit-panel' };
});

ipcMain.handle('set-browser-actual-size', async () => {
  if (!embeddedBrowser || !readAppSettings().useEmbeddedBrowser) {
    return { ok: false };
  }

  await persistBrowserFitMode('manual');
  const browserZoomFactor = embeddedBrowser.setActualSizeZoom();
  await persistBrowserZoom(browserZoomFactor);
  return { ok: true, browserZoomFactor, browserFitMode: 'manual' };
});

ipcMain.handle('get-browser-zoom', async () => {
  const appSettings = readAppSettings();
  return {
    ok: true,
    browserZoomFactor: embeddedBrowser?.getZoomFactor?.() ?? appSettings.browserZoomFactor,
    browserFitMode: appSettings.browserFitMode,
    step: BROWSER_ZOOM_STEP,
  };
});

ipcMain.handle('set-browser-bounds', async (_event, bounds) => {
  if (!embeddedBrowser || !readAppSettings().useEmbeddedBrowser) {
    embeddedBrowser?.hide();
    return { ok: false };
  }

  embeddedBrowser.setBounds(bounds);
  return { ok: true };
});

ipcMain.handle('open-browser-separate-window', async () => {
  if (!embeddedBrowser || !readAppSettings().useEmbeddedBrowser) {
    throw new Error('Embedded browser mode is disabled.');
  }

  embeddedBrowser.openSeparateWindow();
  return { ok: true };
});

ipcMain.handle('focus-iracing-browser', async () => {
  if (!embeddedBrowser || !readAppSettings().useEmbeddedBrowser) {
    throw new Error('Embedded browser mode is disabled.');
  }

  embeddedBrowser.focusEmbeddedPanel();
  return { ok: true };
});

ipcMain.handle('start-scanner', async () => {
  const service = getScanner();
  await service.start({ prepareSession: false, blockingLogin: false });
  requestBrowserBoundsUpdate();
  return { ok: true, running: service.running };
});

ipcMain.handle('stop-scanner', async () => {
  const service = getScanner();
  await service.stop();
  return { ok: true, running: service.running };
});

ipcMain.handle('open-login', async () => {
  const service = getScanner();
  await service.openLogin();
  requestBrowserBoundsUpdate();
  return { ok: true };
});

ipcMain.handle('test-customer-id', async (_event, customerId) => {
  const service = getScanner();
  const result = await service.testCustomerId(customerId, { saveSnapshot: true });
  requestBrowserBoundsUpdate();
  if (embeddedBrowser) {
    notifyBrowserZoomUpdated(embeddedBrowser.getZoomFactor());
  }
  return result;
});

ipcMain.handle('refresh-customer-id', async (_event, customerId) => {
  const service = getScanner();
  const result = await service.refreshApplicationByCustomerId(customerId, 'manual_refresh');
  requestBrowserBoundsUpdate();
  return result;
});

ipcMain.handle('process-queued-jobs', async () => {
  const service = getScanner();
  await service.processQueuedJobs();
  requestBrowserBoundsUpdate();
  return { ok: true };
});

ipcMain.handle('clear-session', async () => {
  const service = getScanner();
  await service.clearSession();
  requestBrowserBoundsUpdate();
  return { ok: true };
});

ipcMain.handle('open-supabase', async () => {
  const service = getScanner();
  const env = service.loadEnvironment();
  const url = env.SUPABASE_URL;
  if (!url) {
    throw new Error('SUPABASE_URL is not configured.');
  }
  await shell.openExternal(url);
  return { ok: true, url };
});

ipcMain.handle('get-status', async () => {
  const service = getScanner();
  const appSettings = readAppSettings();
  return {
    running: service.running,
    envPath: SCANNER_ENV_PATH,
    useEmbeddedBrowser: appSettings.useEmbeddedBrowser,
    browserZoomFactor: embeddedBrowser?.getZoomFactor?.() ?? appSettings.browserZoomFactor,
    browserFitMode: appSettings.browserFitMode,
    sessionStoragePath: embeddedBrowser?.getSessionStoragePath(app.getPath('userData')),
    separateWindowOpen: embeddedBrowser?.isSeparateWindowOpen?.() ?? false,
  };
});
