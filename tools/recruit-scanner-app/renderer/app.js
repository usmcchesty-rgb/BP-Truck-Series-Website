const logOutput = document.getElementById('logOutput');
const testPreview = document.getElementById('testPreview');
const scannerStatus = document.getElementById('scannerStatus');
const settingsMsg = document.getElementById('settingsMsg');
const browserHost = document.getElementById('iracingBrowserHost');
const browserBlock = document.getElementById('browserBlock');
const browserToolbar = document.getElementById('browserToolbar');

const supabaseUrl = document.getElementById('supabaseUrl');
const supabaseKey = document.getElementById('supabaseKey');
const chromePath = document.getElementById('chromePath');
const customerIdInput = document.getElementById('customerIdInput');
const useEmbeddedBrowser = document.getElementById('useEmbeddedBrowser');
const zoomPercent = document.getElementById('zoomPercent');

const ZOOM_STEP = 0.05;

let boundsFrame = null;
let lastSentBounds = null;

function appendLog(message, isError = false) {
  const line = document.createElement('div');
  line.className = isError ? 'log-line error' : 'log-line';
  line.textContent = message;
  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function setScannerStatus(running) {
  scannerStatus.textContent = running ? 'Running' : 'Stopped';
  scannerStatus.classList.toggle('running', running);
}

function setSettingsMessage(text, type = '') {
  settingsMsg.textContent = text;
  settingsMsg.className = `inline-msg ${type}`.trim();
}

function boundsEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.visible === b.visible
  );
}

function computeHostBounds() {
  if (!browserHost) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      visible: false,
    };
  }

  const rect = browserHost.getBoundingClientRect();
  const width = Math.max(0, Math.floor(rect.width));
  const height = Math.max(0, Math.floor(rect.height));

  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
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
    const hiddenBounds = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      visible: false,
    };

    if (!boundsEqual(lastSentBounds, hiddenBounds)) {
      lastSentBounds = hiddenBounds;
      await window.scannerApp.setBrowserBounds(hiddenBounds);
    }
    return;
  }

  const bounds = computeHostBounds();
  if (boundsEqual(lastSentBounds, bounds)) {
    return;
  }

  lastSentBounds = bounds;
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
    if (browserToolbar) {
      observer.observe(browserToolbar);
      browserToolbar.querySelectorAll('.browser-toolbar-row').forEach((row) => {
        observer.observe(row);
      });
    }
    const browserBlockHeader = document.querySelector('.browser-block-header');
    if (browserBlockHeader) {
      observer.observe(browserBlockHeader);
    }
    const browserHint = document.querySelector('.browser-block-hint');
    if (browserHint) {
      observer.observe(browserHint);
    }
    observer.observe(document.querySelector('.right-column'));
    observer.observe(document.querySelector('.layout'));
  }

  window.addEventListener('resize', scheduleBoundsUpdate);
  window.scannerApp.onRequestBrowserBounds(scheduleBoundsUpdate);
}

async function focusBrowserPanel() {
  scheduleBoundsUpdate();
  await window.scannerApp.focusIracingBrowser();
  scheduleBoundsUpdate();
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
  if (zoomPercent && factor != null) {
    zoomPercent.textContent = formatZoomPercent(factor);
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

function formatLicenseCategoriesPreview(parsed) {
  const categories = parsed?.licenses_json?.categories || parsed?.profileJson?.licenses?.categories || [];
  if (!categories.length) {
    return ['  License Categories: (none parsed)'].join('\n');
  }

  const lines = ['  License Categories:'];
  for (const entry of categories) {
    const primary = /^Oval$/i.test(entry.category || '') ? ' *primary*' : '';
    lines.push(
      `    ${entry.category || '?'} — Class ${entry.license_class ?? entry.class ?? '?'}, SR ${entry.safety_rating ?? entry.safetyRating ?? '?'}, iR ${entry.irating ?? '?'}${primary}`
    );
  }
  return lines.join('\n');
}

function formatAllStatsCategoriesPreview(statsParsed) {
  const statsJson = statsParsed?.stats_json || statsParsed?.statsJson || {};
  const categories = Object.keys(statsJson);
  if (!categories.length) {
    return '';
  }

  const lines = ['  Career Stats Categories:'];
  for (const name of categories) {
    const row = statsJson[name] || {};
    const primary = name === 'Oval' ? ' *primary*' : '';
    lines.push(
      `    ${name} — Starts ${row.starts ?? '?'}, Wins ${row.wins ?? '?'}, Top 5 ${row.top5 ?? '?'}${primary}`
    );
  }
  return lines.join('\n');
}

function formatYearlyProgressPreview(statsParsed) {
  const status = statsParsed?.yearly_parse_status || 'unknown';
  const yearly = statsParsed?.yearly_stats_json || [];
  if (status === 'completed' && yearly.length) {
    return `  Yearly Progression: ${yearly.length} row(s) parsed ✔`;
  }
  if (statsParsed?.yearly_parse_error) {
    return `  Yearly Progression: ${status} (${statsParsed.yearly_parse_error})`;
  }
  return `  Yearly Progression: ${status}`;
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
    `  Primary Category (Oval): ${statsParsed.category ?? '(missing)'}`,
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
    formatAllStatsCategoriesPreview(statsParsed),
    formatYearlyProgressPreview(statsParsed),
  ].filter(Boolean);

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
          formatLicenseCategoriesPreview(preview.parsed),
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
    await refreshBrowserZoom();
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
    await refreshBrowserZoom();
  } catch (error) {
    testPreview.textContent = error.message;
    appendLog(error.message, true);
  }
});

document.getElementById('btnRefreshCustomer').addEventListener('click', async () => {
  const customerId = customerIdInput.value.trim();
  if (!customerId) {
    appendLog('Enter a Customer ID to refresh.', true);
    return;
  }

  testPreview.textContent = 'Queueing refresh...';
  try {
    const result = await window.scannerApp.refreshCustomerId(customerId);
    if (result.ok) {
      testPreview.textContent = `Refresh queued.\nJob: ${result.job.id}\nStatus: ${result.job.status}`;
      appendLog(`Refresh queued for Customer ID ${customerId}: ${result.job.id}`);
    } else {
      testPreview.textContent = result.message || 'Refresh was not queued.';
      appendLog(result.message || 'Refresh was not queued.', result.status !== 'active_exists');
    }
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
    scheduleBoundsUpdate();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const result = await window.scannerApp.fitBrowserToPanel();
    if (result?.browserZoomFactor != null) {
      updateZoomDisplay(result.browserZoomFactor);
    }
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnFitWidth').addEventListener('click', async () => {
  try {
    scheduleBoundsUpdate();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const result = await window.scannerApp.fitBrowserWidth();
    if (result?.browserZoomFactor != null) {
      updateZoomDisplay(result.browserZoomFactor);
    }
  } catch (error) {
    appendLog(error.message, true);
  }
});

document.getElementById('btnFitHeight').addEventListener('click', async () => {
  try {
    scheduleBoundsUpdate();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const result = await window.scannerApp.fitBrowserHeight();
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
});

useEmbeddedBrowser.addEventListener('change', () => {
  setSettingsMessage('Save settings to apply browser mode changes.', '');
  lastSentBounds = null;
  scheduleBoundsUpdate();
});

window.scannerApp.onLog((message) => appendLog(message));
window.scannerApp.onError((message) => appendLog(message, true));
window.scannerApp.onBrowserZoomUpdated(({ browserZoomFactor }) => {
  updateZoomDisplay(browserZoomFactor);
});

loadSettings()
  .then(() => {
    setupBrowserBoundsTracking();
    return Promise.all([refreshStatus(), refreshBrowserZoom()]);
  })
  .catch((error) => appendLog(error.message, true));
