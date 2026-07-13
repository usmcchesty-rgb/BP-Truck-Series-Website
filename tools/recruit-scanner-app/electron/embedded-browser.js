import { BrowserWindow, session, WebContentsView } from 'electron';
import { logMessage } from '../recruit-scanner/logger.js';
import {
  CAPTURE_VISIBLE_TEXT_SCRIPT,
  DETECT_LOGIN_FORM_SCRIPT,
  EXTRACT_PROFILE_DOM_SCRIPT,
  EXTRACT_STATS_DOM_SCRIPT,
  IRACING_LOGIN_URL,
  MEMBERS_HOME_URL,
  NAVIGATION_TIMEOUT_MS,
  PAGE_SETTLE_MS,
  urlLooksLikeLogin,
} from '../recruit-scanner/iracing-urls.js';
import {
  BROWSER_ZOOM_DEFAULT,
  BROWSER_FIT_MODE_DEFAULT,
  clampBrowserZoomFactor,
  normalizeBrowserFitMode,
} from './app-settings.js';

export const IRACING_SESSION_PARTITION = 'persist:bp-recruit-scanner';

const ESTIMATE_PAGE_CONTENT_SIZE_SCRIPT = `
(() => {
  const modal = document.querySelector('#modal-as-screen') || document.querySelector('#modal-profile');
  if (modal) {
    const rect = modal.getBoundingClientRect();
    return {
      width: Math.max(modal.scrollWidth || 0, modal.clientWidth || 0, rect.width || 0),
      height: Math.max(modal.scrollHeight || 0, modal.clientHeight || 0, rect.height || 0),
    };
  }

  const root = document.documentElement;
  const body = document.body;
  return {
    width: Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0, 1100),
    height: Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0, 800),
  };
})()
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatZoomPercent(factor) {
  return `${Math.round(Number(factor) * 100)}%`;
}

export function createEmbeddedBrowserManager(mainWindow, options = {}) {
  const readSettings = options.readSettings ?? (() => ({}));
  const onZoomApplied = options.onZoomApplied ?? (() => {});

  let browserView = null;
  let separateWindow = null;
  let currentBounds = { x: 0, y: 0, width: 0, height: 0 };
  let embeddedVisible = false;
  let isAttached = false;
  let savedZoomFactor = BROWSER_ZOOM_DEFAULT;
  let navigatingProgrammatically = false;

  function getSavedZoomFactor() {
    const settings = readSettings();
    return clampBrowserZoomFactor(settings.browserZoomFactor ?? savedZoomFactor);
  }

  function getSavedFitMode() {
    const settings = readSettings();
    return normalizeBrowserFitMode(settings.browserFitMode ?? BROWSER_FIT_MODE_DEFAULT);
  }

  function readAppliedZoomFactor(webContents) {
    if (!webContents || webContents.isDestroyed()) {
      return savedZoomFactor;
    }

    try {
      const applied = webContents.getZoomFactor();
      if (Number.isFinite(applied) && applied > 0) {
        return clampBrowserZoomFactor(applied);
      }
    } catch {
      // Fall back to saved zoom.
    }

    return savedZoomFactor;
  }

  function applyZoomToWebContents(webContents, factor, { log = true } = {}) {
    if (!webContents || webContents.isDestroyed()) {
      return savedZoomFactor;
    }

    const next = clampBrowserZoomFactor(factor);
    webContents.setZoomFactor(next);
    savedZoomFactor = readAppliedZoomFactor(webContents);

    if (log) {
      logMessage(`Applied browser zoom: ${formatZoomPercent(savedZoomFactor)}`);
      onZoomApplied(savedZoomFactor);
    }

    return savedZoomFactor;
  }

  function applyZoomToAllActive(factor, options = {}) {
    const embedded = getEmbeddedWebContents();
    if (embedded) {
      applyZoomToWebContents(embedded, factor, options);
    }

    if (isSeparateWindowOpen()) {
      applyZoomToWebContents(separateWindow.webContents, factor, { log: false });
    }

    return savedZoomFactor;
  }

  function setZoomFactor(factor) {
    return applyZoomToAllActive(factor);
  }

  function getZoomFactor() {
    const webContents = getActiveWebContents();
    if (webContents) {
      savedZoomFactor = readAppliedZoomFactor(webContents);
    }
    return savedZoomFactor;
  }

  async function estimatePageContentSize() {
    const webContents = getActiveWebContents();
    if (!webContents || webContents.isDestroyed()) {
      return { width: 1100, height: 800 };
    }

    try {
      const size = await webContents.executeJavaScript(ESTIMATE_PAGE_CONTENT_SIZE_SCRIPT, true);
      const width = Number(size?.width);
      const height = Number(size?.height);
      return {
        width: Number.isFinite(width) && width > 0 ? width : 1100,
        height: Number.isFinite(height) && height > 0 ? height : 800,
      };
    } catch {
      return { width: 1100, height: 800 };
    }
  }

  function getHostDimensions() {
    return {
      width: currentBounds.width,
      height: currentBounds.height,
    };
  }

  async function fitZoomWidth() {
    const { width: hostWidth } = getHostDimensions();
    if (hostWidth <= 0) {
      return getZoomFactor();
    }

    const { width: contentWidth } = await estimatePageContentSize();
    if (contentWidth <= 0) {
      return getZoomFactor();
    }

    return applyZoomToAllActive(hostWidth / contentWidth);
  }

  async function fitZoomHeight() {
    const { height: hostHeight } = getHostDimensions();
    if (hostHeight <= 0) {
      return getZoomFactor();
    }

    const { height: contentHeight } = await estimatePageContentSize();
    if (contentHeight <= 0) {
      return getZoomFactor();
    }

    return applyZoomToAllActive(hostHeight / contentHeight);
  }

  async function fitZoomToPanel() {
    const { width: hostWidth, height: hostHeight } = getHostDimensions();
    if (hostWidth <= 0 || hostHeight <= 0) {
      return getZoomFactor();
    }

    const { width: contentWidth, height: contentHeight } = await estimatePageContentSize();
    if (contentWidth <= 0 || contentHeight <= 0) {
      return getZoomFactor();
    }

    const widthZoom = hostWidth / contentWidth;
    const heightZoom = hostHeight / contentHeight;
    return applyZoomToAllActive(Math.min(widthZoom, heightZoom));
  }

  async function applySavedFitMode() {
    const fitMode = getSavedFitMode();
    if (fitMode === 'manual') {
      return getZoomFactor();
    }

    if (fitMode === 'fit-width') {
      return fitZoomWidth();
    }

    if (fitMode === 'fit-height') {
      return fitZoomHeight();
    }

    return fitZoomToPanel();
  }

  async function syncZoomAfterNavigation() {
    const webContents = getActiveWebContents();
    if (!webContents || webContents.isDestroyed()) {
      return savedZoomFactor;
    }

    await sleep(PAGE_SETTLE_MS);

    const fitMode = getSavedFitMode();
    if (fitMode === 'manual') {
      return applyZoomToWebContents(webContents, getSavedZoomFactor());
    }

    return applySavedFitMode();
  }

  function attachNavigationHooks(webContents) {
    if (!webContents || webContents.isDestroyed()) {
      return;
    }

    webContents.on('did-start-loading', () => {
      applyEmbeddedBounds();
    });

    webContents.on('did-finish-load', () => {
      applyEmbeddedBounds();
      if (!navigatingProgrammatically) {
        void syncZoomAfterNavigation();
      }
    });

    webContents.on('did-navigate-in-page', () => {
      applyEmbeddedBounds();
      if (!navigatingProgrammatically) {
        void syncZoomAfterNavigation();
      }
    });
  }

  function setActualSizeZoom() {
    return setZoomFactor(1);
  }

  function adjustZoom(delta) {
    return setZoomFactor(savedZoomFactor + delta);
  }

  function getIracingSession() {
    return session.fromPartition(IRACING_SESSION_PARTITION);
  }

  function getEmbeddedWebContents() {
    return browserView?.webContents ?? null;
  }

  function getActiveWebContents() {
    if (separateWindow && !separateWindow.isDestroyed()) {
      return separateWindow.webContents;
    }
    return getEmbeddedWebContents();
  }

  function ensureView() {
    if (browserView && !browserView.webContents.isDestroyed()) {
      return browserView;
    }

    browserView = new WebContentsView({
      webPreferences: {
        partition: IRACING_SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    savedZoomFactor = getSavedZoomFactor();
    applyZoomToWebContents(browserView.webContents, savedZoomFactor);
    attachNavigationHooks(browserView.webContents);

    return browserView;
  }

  function attachEmbeddedView() {
    const view = ensureView();
    if (!isAttached) {
      mainWindow.contentView.addChildView(view);
      isAttached = true;
    }
    return view;
  }

  function detachEmbeddedView() {
    if (!browserView || !isAttached) {
      return;
    }

    try {
      mainWindow.contentView.removeChildView(browserView);
    } catch {
      // View may already be detached.
    }

    isAttached = false;
  }

  function applyEmbeddedBounds() {
    if (!browserView || browserView.webContents.isDestroyed()) {
      return;
    }

    if (!embeddedVisible || currentBounds.width <= 0 || currentBounds.height <= 0) {
      detachEmbeddedView();
      return;
    }

    attachEmbeddedView();
    browserView.setBounds({
      x: currentBounds.x,
      y: currentBounds.y,
      width: currentBounds.width,
      height: currentBounds.height,
    });
  }

  function setBounds(bounds) {
    currentBounds = {
      x: Math.max(0, Math.round(bounds.x ?? 0)),
      y: Math.max(0, Math.round(bounds.y ?? 0)),
      width: Math.max(0, Math.floor(bounds.width ?? 0)),
      height: Math.max(0, Math.floor(bounds.height ?? 0)),
    };

    embeddedVisible = bounds.visible !== false;
    applyEmbeddedBounds();
  }

  function show() {
    embeddedVisible = true;
    applyEmbeddedBounds();
  }

  function hide() {
    embeddedVisible = false;
    applyEmbeddedBounds();
  }

  function isSeparateWindowOpen() {
    return Boolean(separateWindow && !separateWindow.isDestroyed());
  }

  function openSeparateWindow(url = null) {
    const targetUrl = url || getActiveWebContents()?.getURL() || IRACING_LOGIN_URL;

    if (isSeparateWindowOpen()) {
      separateWindow.focus();
      if (targetUrl && separateWindow.webContents.getURL() !== targetUrl) {
        void separateWindow.loadURL(targetUrl);
      }
      hide();
      return separateWindow;
    }

    separateWindow = new BrowserWindow({
      width: 1120,
      height: 860,
      minWidth: 900,
      minHeight: 640,
      title: 'iRacing Browser — BP Recruit Scanner',
      autoHideMenuBar: true,
      backgroundColor: '#0a0a0a',
      webPreferences: {
        partition: IRACING_SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    hide();
    applyZoomToWebContents(separateWindow.webContents, savedZoomFactor);
    void separateWindow.loadURL(targetUrl);

    separateWindow.on('closed', () => {
      separateWindow = null;
      show();
      mainWindow?.webContents.send('request-browser-bounds');
    });

    logMessage('Opened iRacing browser in a separate window (same saved session).');
    return separateWindow;
  }

  function focusEmbeddedPanel() {
    show();
    mainWindow?.webContents.send('request-browser-bounds');
  }

  async function waitForLoad(webContents, url) {
    if (webContents.getURL() === url && !webContents.isLoading()) {
      await sleep(PAGE_SETTLE_MS);
      return;
    }

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Navigation timeout after ${NAVIGATION_TIMEOUT_MS}ms`));
      }, NAVIGATION_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        webContents.removeListener('did-finish-load', onLoad);
        webContents.removeListener('did-fail-load', onFail);
      };

      const onLoad = () => {
        cleanup();
        resolve();
      };

      const onFail = (_event, _code, description) => {
        cleanup();
        reject(new Error(description || 'Navigation failed'));
      };

      webContents.once('did-finish-load', onLoad);
      webContents.once('did-fail-load', onFail);
      webContents.loadURL(url).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  async function navigate(url) {
    show();

    navigatingProgrammatically = true;
    try {
      const webContents = getActiveWebContents() ?? ensureView().webContents;
      await waitForLoad(webContents, url);
      await syncZoomAfterNavigation();

      if (isSeparateWindowOpen()) {
        hide();
      } else {
        applyEmbeddedBounds();
      }
    } finally {
      navigatingProgrammatically = false;
    }
  }

  async function getCurrentUrl() {
    return getActiveWebContents()?.getURL() || '';
  }

  async function looksLikeLogin() {
    const webContents = getActiveWebContents();
    if (!webContents) {
      return false;
    }

    if (urlLooksLikeLogin(webContents.getURL())) {
      return true;
    }

    return webContents.executeJavaScript(DETECT_LOGIN_FORM_SCRIPT, true);
  }

  async function captureVisibleText() {
    const webContents = getActiveWebContents();
    if (!webContents) {
      return '';
    }

    return webContents.executeJavaScript(CAPTURE_VISIBLE_TEXT_SCRIPT, true);
  }

  async function extractProfileDom() {
    const webContents = getActiveWebContents();
    if (!webContents) {
      return null;
    }

    return webContents.executeJavaScript(EXTRACT_PROFILE_DOM_SCRIPT, true);
  }

  async function extractStatsDom() {
    const webContents = getActiveWebContents();
    if (!webContents) {
      return null;
    }

    return webContents.executeJavaScript(EXTRACT_STATS_DOM_SCRIPT, true);
  }

  async function hasStoredSession() {
    const cookies = await getIracingSession().cookies.get({});
    return cookies.length > 0;
  }

  async function clearSession() {
    const iracingSession = getIracingSession();
    await iracingSession.clearStorageData();
    await iracingSession.clearCache();
    await iracingSession.clearAuthCache();

    const embedded = getEmbeddedWebContents();
    if (embedded && !embedded.isDestroyed()) {
      await embedded.session.clearStorageData();
      await embedded.session.clearCache();
    }

    if (isSeparateWindowOpen()) {
      separateWindow.close();
      separateWindow = null;
    }
  }

  async function destroy() {
    hide();

    if (isSeparateWindowOpen()) {
      separateWindow.close();
      separateWindow = null;
    }

    if (browserView && !browserView.webContents.isDestroyed()) {
      browserView.webContents.close();
    }

    browserView = null;
  }

  function getSessionStoragePath(userDataPath) {
    return `${userDataPath}/Partitions/${IRACING_SESSION_PARTITION.replace(':', '_')}`;
  }

  function initializeZoomFromSettings() {
    savedZoomFactor = getSavedZoomFactor();
    const webContents = getEmbeddedWebContents();
    if (webContents) {
      applyZoomToWebContents(webContents, savedZoomFactor);
    }
    return savedZoomFactor;
  }

  return {
    ensureView,
    setBounds,
    show,
    hide,
    navigate,
    getCurrentUrl,
    looksLikeLogin,
    captureVisibleText,
    extractProfileDom,
    extractStatsDom,
    hasStoredSession,
    clearSession,
    destroy,
    getSessionStoragePath,
    getIracingSession,
    openSeparateWindow,
    focusEmbeddedPanel,
    isSeparateWindowOpen,
    setZoomFactor,
    getZoomFactor,
    adjustZoom,
    fitZoomToPanel,
    fitZoomWidth,
    fitZoomHeight,
    setActualSizeZoom,
    applySavedFitMode,
    syncZoomAfterNavigation,
    initializeZoomFromSettings,
  };
}

export function createElectronBrowserAdapter(manager) {
  return {
    mode: 'electron',

    async init() {
      manager.show();
      manager.initializeZoomFromSettings();
      logMessage('Browser started using embedded iRacing panel (persist:bp-recruit-scanner)');
    },

    async close() {
      manager.hide();
    },

    async clearSession() {
      await manager.clearSession();
      logMessage('Saved iRacing session cleared (embedded app session).');
    },

    async navigate(url) {
      await manager.navigate(url);
    },

    async getCurrentUrl() {
      return manager.getCurrentUrl();
    },

    async looksLikeLogin() {
      return manager.looksLikeLogin();
    },

    async waitForTabContent(_tabLabel) {
      await sleep(PAGE_SETTLE_MS);
    },

    async captureVisibleText() {
      return manager.captureVisibleText();
    },

    async extractProfileDom() {
      return manager.extractProfileDom();
    },

    async extractStatsDom() {
      return manager.extractStatsDom();
    },

    async hasStoredSession() {
      return manager.hasStoredSession();
    },

    getSessionLabel() {
      return 'embedded app session (persist:bp-recruit-scanner)';
    },

    async openLoginPage() {
      await manager.navigate(IRACING_LOGIN_URL);
    },

    async checkLoggedIn() {
      await manager.navigate(MEMBERS_HOME_URL);
      return !(await manager.looksLikeLogin());
    },

    async sleep(ms) {
      await sleep(ms);
    },
  };
}
