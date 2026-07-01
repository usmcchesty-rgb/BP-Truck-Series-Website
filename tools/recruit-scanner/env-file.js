import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCANNER_ENV_PATH = path.join(__dirname, '.env');

export function readEnvFile(filePath = SCANNER_ENV_PATH) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const values = {};
  const content = fs.readFileSync(filePath, 'utf8');

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

export function writeEnvFile(values, filePath = SCANNER_ENV_PATH) {
  const lines = [
    '# BP Recruit Scanner local settings (do not commit)',
    `SUPABASE_URL=${values.SUPABASE_URL || ''}`,
    `SUPABASE_SERVICE_ROLE_KEY=${values.SUPABASE_SERVICE_ROLE_KEY || ''}`,
  ];

  if (values.CHROME_EXECUTABLE_PATH) {
    lines.push(`CHROME_EXECUTABLE_PATH=${values.CHROME_EXECUTABLE_PATH}`);
  }

  lines.push('');
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

export function loadScannerEnv() {
  const fileValues = readEnvFile();
  return {
    SUPABASE_URL: process.env.SUPABASE_URL || fileValues.SUPABASE_URL || '',
    SUPABASE_SERVICE_ROLE_KEY:
      process.env.SUPABASE_SERVICE_ROLE_KEY || fileValues.SUPABASE_SERVICE_ROLE_KEY || '',
    CHROME_EXECUTABLE_PATH:
      process.env.CHROME_EXECUTABLE_PATH || fileValues.CHROME_EXECUTABLE_PATH || '',
  };
}
