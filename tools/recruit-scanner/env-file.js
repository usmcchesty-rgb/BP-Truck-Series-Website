import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let configuredEnvPath = null;

export function configureScannerEnvPath(filePath) {
  configuredEnvPath = filePath ? String(filePath) : null;
  if (configuredEnvPath) {
    process.env.BP_SCANNER_ENV_PATH = configuredEnvPath;
  } else {
    delete process.env.BP_SCANNER_ENV_PATH;
  }
}

export function getScannerEnvPath() {
  if (configuredEnvPath) {
    return configuredEnvPath;
  }

  if (process.env.BP_SCANNER_ENV_PATH) {
    return process.env.BP_SCANNER_ENV_PATH;
  }

  if (process.env.BP_SCANNER_USER_DATA) {
    return path.join(process.env.BP_SCANNER_USER_DATA, 'scanner.env');
  }

  return path.join(__dirname, '.env');
}

/** @deprecated Use getScannerEnvPath() for runtime path resolution. */
export const SCANNER_ENV_PATH = path.join(__dirname, '.env');

export function readEnvFile(filePath) {
  const targetPath = filePath ?? getScannerEnvPath();

  if (!fs.existsSync(targetPath)) {
    return {};
  }

  const values = {};
  const content = fs.readFileSync(targetPath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

export function writeEnvFile(values, filePath) {
  const targetPath = filePath ?? getScannerEnvPath();
  const lines = [
    '# BP Recruit Scanner local settings (do not commit)',
    `SUPABASE_URL=${values.SUPABASE_URL || ''}`,
    `SUPABASE_SERVICE_ROLE_KEY=${values.SUPABASE_SERVICE_ROLE_KEY || ''}`,
  ];

  if (values.CHROME_EXECUTABLE_PATH) {
    lines.push(`CHROME_EXECUTABLE_PATH=${values.CHROME_EXECUTABLE_PATH}`);
  }

  lines.push('');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, lines.join('\n'), 'utf8');
}

export function loadScannerEnv(filePath) {
  const targetPath = filePath ?? getScannerEnvPath();
  const fileValues = readEnvFile(targetPath);
  return {
    SUPABASE_URL: process.env.SUPABASE_URL || fileValues.SUPABASE_URL || '',
    SUPABASE_SERVICE_ROLE_KEY:
      process.env.SUPABASE_SERVICE_ROLE_KEY || fileValues.SUPABASE_SERVICE_ROLE_KEY || '',
    CHROME_EXECUTABLE_PATH:
      process.env.CHROME_EXECUTABLE_PATH || fileValues.CHROME_EXECUTABLE_PATH || '',
  };
}
