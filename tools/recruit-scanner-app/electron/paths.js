import path from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import { configureScannerEnvPath, getScannerEnvPath } from '../recruit-scanner/env-file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function initScannerPaths() {
  if (app.isPackaged) {
    const userData = app.getPath('userData');
    process.env.BP_SCANNER_USER_DATA = userData;
    configureScannerEnvPath(path.join(userData, 'scanner.env'));
  } else {
    delete process.env.BP_SCANNER_USER_DATA;
    const devEnvPath = path.join(__dirname, '..', '..', 'recruit-scanner', '.env');
    configureScannerEnvPath(devEnvPath);
  }

  const resolved = getScannerEnvPath();
  console.log(`Scanner env path: ${resolved}`);
  return resolved;
}
