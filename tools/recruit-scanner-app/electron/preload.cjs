const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scannerApp', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  setBrowserBounds: (bounds) => ipcRenderer.invoke('set-browser-bounds', bounds),
  setBrowserZoom: (factor) => ipcRenderer.invoke('set-browser-zoom', factor),
  adjustBrowserZoom: (delta) => ipcRenderer.invoke('adjust-browser-zoom', delta),
  fitBrowserToPanel: () => ipcRenderer.invoke('fit-browser-to-panel'),
  fitBrowserWidth: () => ipcRenderer.invoke('fit-browser-width'),
  fitBrowserHeight: () => ipcRenderer.invoke('fit-browser-height'),
  setBrowserActualSize: () => ipcRenderer.invoke('set-browser-actual-size'),
  getBrowserZoom: () => ipcRenderer.invoke('get-browser-zoom'),
  startScanner: () => ipcRenderer.invoke('start-scanner'),
  stopScanner: () => ipcRenderer.invoke('stop-scanner'),
  openLogin: () => ipcRenderer.invoke('open-login'),
  testCustomerId: (customerId) => ipcRenderer.invoke('test-customer-id', customerId),
  refreshCustomerId: (customerId) => ipcRenderer.invoke('refresh-customer-id', customerId),
  processQueuedJobs: () => ipcRenderer.invoke('process-queued-jobs'),
  clearSession: () => ipcRenderer.invoke('clear-session'),
  openSupabase: () => ipcRenderer.invoke('open-supabase'),
  openBrowserSeparateWindow: () => ipcRenderer.invoke('open-browser-separate-window'),
  focusIracingBrowser: () => ipcRenderer.invoke('focus-iracing-browser'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  onLog: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('scanner-log', listener);
    return () => ipcRenderer.removeListener('scanner-log', listener);
  },
  onError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('scanner-error', listener);
    return () => ipcRenderer.removeListener('scanner-error', listener);
  },
  onRequestBrowserBounds: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('request-browser-bounds', listener);
    return () => ipcRenderer.removeListener('request-browser-bounds', listener);
  },
  onBrowserZoomUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('browser-zoom-updated', listener);
    return () => ipcRenderer.removeListener('browser-zoom-updated', listener);
  },
});
