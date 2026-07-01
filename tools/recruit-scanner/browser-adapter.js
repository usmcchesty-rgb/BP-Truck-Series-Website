import { createPlaywrightBrowserAdapter } from './iracing-browser-playwright.js';

let activeAdapter = createPlaywrightBrowserAdapter();

export function getBrowserAdapter() {
  return activeAdapter;
}

export function setBrowserAdapter(adapter) {
  activeAdapter = adapter;
}

export function resetBrowserAdapter() {
  activeAdapter = createPlaywrightBrowserAdapter();
}

export function getBrowserMode() {
  return activeAdapter.mode;
}
