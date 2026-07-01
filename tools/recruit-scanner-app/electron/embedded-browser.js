import { BrowserWindow, session, WebContentsView } from 'electron';
import { logMessage } from '../../recruit-scanner/logger.js';
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
} from '../../recruit-scanner/iracing-urls.js';
import {
  BROWSER_ZOOM_DEFAULT,
  clampBrowserZoomFactor,
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

export function createEmbeddedBrowserManager(mainWindow) {
  let browserView = null;
  let separateWindow = null;
  let currentBounds = { x: 0, y: 0, width: 0, height: 0 };
  let embeddedVisible = false;
  let isAttached = false;
  let currentZoomFactor = BROWSER_ZOOM_DEFAULT;

  function applyZoomToWebContents(webContents, factor) {
    if (!webContents || webContents.isDestroyed()) {
      return;
    }

    webContents.setZoomFactor(factor);
  }

  function applyZoomToAllActive(factor) {
    currentZoomFactor = clampBrowserZoomFactor(factor);
    applyZoomToWebContents(getEmbeddedWebContents(), currentZoomFactor);
    if (isSeparateWindowOpen()) {
      applyZoomToWebContents(separateWindow.webContents, currentZoomFactor);
    }
  }

  function setZoomFactor(factor) {
    applyZoomToAllActive(factor);
    return currentZoomFactor;
  }

  function getZoomFactor() {
    return currentZoomFactor;
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

  async function fitZoomWidth() {
    const panelWidth = currentBounds.width;
    if (panelWidth <= 0) {
      return currentZoomFactor;
    }

    const { width: contentWidth } = await estimatePageContentSize();
    applyZoomToAllActive(clampBrowserZoomFactor(panelWidth / contentWidth));
    return currentZoomFactor;
  }

  async function fitZoomHeight() {
    const panelHeight = currentBounds.height;
    if (panelHeight <= 0) {
      return currentZoomFactor;
    }

    const { height: contentHeight } = await estimatePageContentSize();
    applyZoomToAllActive(clampBrowserZoomFactor(panelHeight / contentHeight));
    return currentZoomFactor;
  }

  async function fitZoomToPanel() {
    const panelWidth = currentBounds.width;
    const panelHeight = currentBounds.height;
    if (panelWidth <= 0 || panelHeight <= 0) {
      return currentZoomFactor;
    }

    const { width: contentWidth, height: contentHeight } = await estimatePageContentSize();
    const widthFit = panelWidth / contentWidth;
    const heightFit = panelHeight / contentHeight;
    applyZoomToAllActive(clampBrowserZoomFactor(Math.min(widthFit, heightFit)));
    return currentZoomFactor;
  }

  function setActualSizeZoom() {
    return setZoomFactor(1);
  }

  function adjustZoom(delta) {
    return setZoomFactor(currentZoomFactor + delta);
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

    applyZoomToWebContents(browserView.webContents, currentZoomFactor);

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
      width: Math.max(0, Math.round(bounds.width ?? 0)),
      height: Math.max(0, Math.round(bounds.height ?? 0)),
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
    applyZoomToWebContents(separateWindow.webContents, currentZoomFactor);
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

    const webContents = getActiveWebContents() ?? ensureView().webContents;
    await waitForLoad(webContents, url);
    await sleep(PAGE_SETTLE_MS);

    if (isSeparateWindowOpen()) {
      hide();
    } else {
      applyEmbeddedBounds();
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
  };
}

export function createElectronBrowserAdapter(manager) {
  return {
    mode: 'electron',

    async init() {
      manager.show();
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
