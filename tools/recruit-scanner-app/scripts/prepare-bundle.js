import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
const source = path.join(appRoot, '..', 'recruit-scanner');
const target = path.join(appRoot, 'recruit-scanner');

const EXCLUDE_DIRS = new Set(['node_modules', 'browser-profile', '.git']);
const EXCLUDE_FILES = new Set(['.env']);

function shouldSkip(name, isDirectory) {
  if (EXCLUDE_FILES.has(name)) {
    return true;
  }

  return isDirectory && EXCLUDE_DIRS.has(name);
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldSkip(entry.name, entry.isDirectory())) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
      continue;
    }

    fs.copyFileSync(srcPath, destPath);
  }
}

if (!fs.existsSync(source)) {
  console.error(`Source recruit-scanner not found: ${source}`);
  process.exit(1);
}

if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
}

copyRecursive(source, target);
console.log(`Bundled recruit-scanner into ${target}`);
