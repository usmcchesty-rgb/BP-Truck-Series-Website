import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export const BROWSER_ZOOM_MIN = 0.25;
export const BROWSER_ZOOM_MAX = 2.5;
export const BROWSER_ZOOM_STEP = 0.05;
export const BROWSER_ZOOM_DEFAULT = 1.25;

const DEFAULTS = {
  useEmbeddedBrowser: true,
  browserZoomFactor: BROWSER_ZOOM_DEFAULT,
};

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'app-settings.json');
}

export function clampBrowserZoomFactor(value) {
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) {
    return BROWSER_ZOOM_DEFAULT;
  }

  const stepped = Math.round(num / BROWSER_ZOOM_STEP) * BROWSER_ZOOM_STEP;
  return Math.min(BROWSER_ZOOM_MAX, Math.max(BROWSER_ZOOM_MIN, Number(stepped.toFixed(2))));
}

export function readAppSettings() {
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return { ...DEFAULTS };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return {
      ...DEFAULTS,
      ...parsed,
      useEmbeddedBrowser: parsed.useEmbeddedBrowser !== false,
      browserZoomFactor: clampBrowserZoomFactor(
        parsed.browserZoomFactor ?? BROWSER_ZOOM_DEFAULT
      ),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeAppSettings(settings) {
  const next = {
    useEmbeddedBrowser: settings.useEmbeddedBrowser !== false,
    browserZoomFactor: clampBrowserZoomFactor(
      settings.browserZoomFactor ?? BROWSER_ZOOM_DEFAULT
    ),
  };
  fs.writeFileSync(getSettingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function getAppSettingsPath() {
  return getSettingsPath();
}
