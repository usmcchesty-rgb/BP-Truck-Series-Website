const logOutput = document.getElementById('logOutput');
const testPreview = document.getElementById('testPreview');
const scannerStatus = document.getElementById('scannerStatus');
const settingsMsg = document.getElementById('settingsMsg');
const browserHost = document.getElementById('iracingBrowserHost');
const browserBlock = document.getElementById('browserBlock');

const supabaseUrl = document.getElementById('supabaseUrl');
const supabaseKey = document.getElementById('supabaseKey');
const chromePath = document.getElementById('chromePath');
const customerIdInput = document.getElementById('customerIdInput');
const useEmbeddedBrowser = document.getElementById('useEmbeddedBrowser');
const zoomPercent = document.getElementById('zoomPercent');

const ZOOM_STEP = 0.1;

let boundsFrame = null;
let currentZoomFactor = 1.25;

function appendLog(message, isError = false) {
  const line = document.createElement('div');
  line.className = isError ? 'log-line error' : 'log-line';
  line.textContent = message;
  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;
  scheduleBoundsUpdate();
}

function setScannerStatus(running) {
  scannerStatus.textContent = running ? 'Running' : 'Stopped';
  scannerStatus.classList.toggle('running', running);
}

function setSettingsMessage(text, type = '') {
  settingsMsg.textContent = text;
  settingsMsg.className = `inline-msg ${type}`.trim();
}

function getHeaderBottom() {
  const header = document.querySelector('.app-header');
  return header?.getBoundingClientRect().bottom ?? 0;
}

function computeClippedBounds(rect) {
  const headerBottom = getHeaderBottom();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const left = Math.max(0, rect.left);
  const top = Math.max(headerBottom, rect.top);
  const right = Math.min(viewportWidth, rect.right);
  const bottom = Math.min(viewportHeight, rect.bottom);

  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);

  return {
    x: left,
    y: top,
    width,
    height,
    visible: width >= 8 && height >= 8,
  };
}

async function updateBrowserBounds() {
  if (!browserHost) {
    return;
  }

  if (!useEmbeddedBrowser.checked) {
    await window.scannerApp.setBrowserBounds({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      visible: false,
    });
    return;
  }

  const rect = browserHost.getBoundingClientRect();
  const bounds = computeClippedBounds(rect);
  await window.scannerApp.setBrowserBounds(bounds);
}

function scheduleBoundsUpdate() {
  if (boundsFrame !== null) {
    cancelAnimationFrame(boundsFrame);
  }

  boundsFrame = requestAnimationFrame(() => {
    boundsFrame = null;
    void updateBrowserBounds();
  });
}

function setupBrowserBoundsTracking() {
  scheduleBoundsUpdate();

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => scheduleBoundsUpdate());
    observer.observe(browserHost);
    observer.observe(browserBlock);
    observer.observe(document.querySelector('.layout'));
    observer.observe(document.querySelector('.right-column'));
  }

  window.addEventListener('resize', scheduleBoundsUpdate);
  window.addEventListener('scroll', scheduleBoundsUpdate, true);
  window.scannerApp.onRequestBrowserBounds(scheduleBoundsUpdate);

  if (typeof IntersectionObserver !== 'undefined') {
    const intersectionObserver = new IntersectionObserver(
      () => scheduleBoundsUpdate(),
      { threshold: [0, 0.01, 0.25, 0.5, 0.75, 1] }
    );
    intersectionObserver.observe(browserHost);
  }
}

async function focusBrowserPanel() {
  browserBlock?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  scheduleBoundsUpdate();
  await window.scannerApp.focusIracingBrowser();
}

async function loadSettings() {
  const settings = await window.scannerApp.getSettings();
  supabaseUrl.value = settings.SUPABASE_URL || '';
  supabaseKey.value = settings.SUPABASE_SERVICE_ROLE_KEY || '';
  chromePath.value = settings.CHROME_EXECUTABLE_PATH || '';
  useEmbeddedBrowser.checked = settings.useEmbeddedBrowser !== false;
  updateZoomDisplay(settings.browserZoomFactor ?? 1.25);
}

async function refreshStatus() {
  const status = await window.scannerApp.getStatus();
  setScannerStatus(status.running);
}

function formatZoomPercent(factor) {
  return `${Math.round(Number(factor) * 100)}%`;
}

function updateZoomDisplay(factor) {
  currentZoomFactor = Number(factor) || currentZoomFactor;
  if (zoomPercent) {
    zoomPercent.textContent = formatZoomPercent(currentZoomFactor);
  }
}

async function refreshBrowserZoom() {
  if (!useEmbeddedBrowser.checked) {
    return;
  }

  try {
    const result = await window.scannerApp.getBrowserZoom();
    if (result?.browserZoomFactor != null) {
      updateZoomDisplay(result.browserZoomFactor);
    }
  } catch {
    // Ignore zoom read errors during startup.
  }
}

async function adjustBrowserZoom(delta) {
  if (!useEmbeddedBrowser.checked) {
    return;
  }

  const result = await window.scannerApp.adjustBrowserZoom(delta);
  if (result?.browserZoomFactor != null) {
    updateZoomDisplay(result.browserZoomFactor);
  }
}

function formatStatsPreview(statsParsed, stats) {
  if (!statsParsed) {
    if (stats?.outcome === 'scraped') {
      return ['Stats need manual review', stats.excerpt || '(none)'].join('\n');
    }
    return `Stats: ${stats?.outcome || 'skipped'}`;
  }

  const lines = [
    statsParsed.scrape_status === 'completed' ? 'Stats Complete ✔' : 'Stats need manual review',
    `  Category: ${statsParsed.category ?? '(missing)'}`,
    `  Starts: ${statsParsed.starts ?? '(missing)'}`,
    `  Wins: ${statsParsed.wins ?? '(missing)'}`,
    `  Top 5: ${statsParsed.top5 ?? '(missing)'}`,
    `  Poles: ${statsParsed.poles ?? '(missing)'}`,
    `  Avg Start: ${statsParsed.avg_start ?? '(missing)'}`,
    `  Avg Finish: ${statsParsed.avg_finish ?? '(missing)'}`,
    `  Total Laps: ${statsParsed.total_laps ?? '(missing)'}`,
    `  Laps Led: ${statsParsed.laps_led ?? '(missing)'}`,
    `  Inc/Race: ${statsParsed.incidents_per_race ?? '(missing)'}`,
    `  Pts/Race: ${statsParsed.points_per_race ?? '(missing)'}`,
    `  Win %: ${statsParsed.win_percentage ?? '(missing)'}`,
    `  Top 5 %: ${statsParsed.top5_percentage ?? '(missing)'}`,
  ];

  if (statsParsed.scrape_status !== 'completed') {
    lines.push('', 'Stats excerpt:', stats?.excerpt || '(none)');
  }

  return lines.join('\n');
}

function formatPreview(result) {
  if (!result?.preview) {
    return result?.message || 'Test failed.';
  }

  const { preview } = result;
  const lines = [
    `Customer ID: ${preview.customerId}`,
    '',
    '--- License Page ---',
    `Outcome: ${preview.license.outcome}`,
    `URL: ${preview.license.finalUrl || 'n/a'}`,
    preview.parsed
      ? [
          '',
          'Parsed values:',
          `  Display Name: ${preview.parsed.display_name ?? '(missing)'}`,
          `  Country: ${preview.parsed.profileJson?.country ?? '(missing)'}`,
          `  Member Since: ${preview.parsed.profileJson?.memberSince ?? '(missing)'}`,
          `  Oval License Class: ${preview.parsed.oval_license_class ?? '(missing)'}`,
          `  Oval Safety Rating: ${preview.parsed.oval_safety_rating ?? '(missing)'}`,
          `  Oval iRating: ${preview.parsed.oval_irating ?? '(missing)'}`,
          preview.parsed.scrape_status === 'completed'
            ? 'Profile Complete ✔'
            : `Scrape Status: ${preview.parsed.scrape_status}`,
        ].join('\n')
      : '',
    '',
    'License excerpt:',
    preview.license.excerpt || '(none)',
    '',
    '--- Stats Page ---',
    `Outcome: ${preview.stats.outcome}`,
    `URL: ${preview.stats.finalUrl || 'n/a'}`,
    '',
    formatStatsPreview(preview.statsParsed, preview.stats),
  ];

  if (preview.savedSnapshotId) {
    lines.push('', `License snapshot saved: ${preview.savedSnapshotId}`);
  }
  if (preview.savedStatsSnapshotId) {
    lines.push(`Stats snapshot saved: ${preview.savedStatsSnapshotId}`);
  }

  return lines.join('\n');
}

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  setSettingsMessage('Saving...');
  try {
    await window.scannerApp.saveSettings({
      SUPABASE_URL: supabaseUrl.value.trim(),
      SUPABASE_SERVICE_ROLE_KEY: supabaseKey.value.trim(),
      CHROME_EXECUTABLE_PATH: chromePath.value.trim(),
      useEmbeddedBrowser: useEmbeddedBrowser.checked,
    });
    setSettingsMessage('Settings saved.', 'success');
    scheduleBoundsUpdate();
  } catch (error) {
    setSettingsMessage(error.message, 'error');
  }
});

document.getElementById('btnStart').addEventListener('click', async () => {
  appendLog('Starting scanner...');
  try {
    await window.scannerApp.startScanner();
    setScannerStatus(true);
    scheduleBoundsUpdate();
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnStop').addEventListener('click', async () => {
  try {
    await window.scannerApp.stopScanner();
    setScannerStatus(false);
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnLogin').addEventListener('click', async () => {
  try {
    await focusBrowserPanel();
    await window.scannerApp.openLogin();
    scheduleBoundsUpdate();
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnProcess').addEventListener('click', async () => {
  try {
    await window.scannerApp.processQueuedJobs();
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnClear').addEventListener('click', async () => {
  try {
    await window.scannerApp.clearSession();
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnSupabase').addEventListener('click', async () => {
  try {
    await window.scannerApp.openSupabase();
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnTest').addEventListener('click', async () => {
  const customerId = customerIdInput.value.trim();
  if (!customerId) {
    appendLog('Enter a Customer ID to test.', true);
    return;
  }

  testPreview.textContent = 'Running test...';
  try {
    await focusBrowserPanel();
    const result = await window.scannerApp.testCustomerId(customerId);
    testPreview.textContent = formatPreview(result);
    scheduleBoundsUpdate();
  } catch (error) {
    testPreview.textContent = error.message;
    appendLog(error.message, true);
  }
});

document.getElementById('btnFocusBrowser').addEventListener('click', async () => {
  try {
    await focusBrowserPanel();
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnSeparateWindow').addEventListener('click', async () => {
  try {
    await window.scannerApp.openBrowserSeparateWindow();
    await refreshBrowserZoom();
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnFitPanel').addEventListener('click', async () => {
  try {
    await focusBrowserPanel();
    const result = await window.scannerApp.fitBrowserToPanel();
    if (result?.browserZoomFactor != null) {
      updateZoomDisplay(result.browserZoomFactor);
    }
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnActualSize').addEventListener('click', async () => {
  try {
    const result = await window.scannerApp.setBrowserActualSize();
    if (result?.browserZoomFactor != null) {
      updateZoomDisplay(result.browserZoomFactor);
    }
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnZoomIn').addEventListener('click', async () => {
  try {
    await adjustBrowserZoom(ZOOM_STEP);
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnZoomOut').addEventListener('click', async () => {
  try {
    await adjustBrowserZoom(-ZOOM_STEP);
  } catch (error) {
    appendLog(error.message, true);
  }
});

browserHost?.addEventListener(
  'wheel',
  (event) => {
    if (!useEmbeddedBrowser.checked || !event.ctrlKey) {
      return;
    }

    event.preventDefault();
    void adjustBrowserZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  },
  { passive: false }
);

document.getElementById('btnClearLogs').addEventListener('click', () => {
  logOutput.innerHTML = '';
  scheduleBoundsUpdate();
});

useEmbeddedBrowser.addEventListener('change', () => {
  setSettingsMessage('Save settings to apply browser mode changes.', '');
  scheduleBoundsUpdate();
});

window.scannerApp.onLog((message) => appendLog(message));
window.scannerApp.onError((message) => appendLog(message, true));

loadSettings()
  .then(() => {
    setupBrowserBoundsTracking();
    return Promise.all([refreshStatus(), refreshBrowserZoom()]);
  })
  .catch((error) => appendLog(error.message, true));
