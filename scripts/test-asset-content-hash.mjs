/**
 * Content-hash cache-bust for cars/numbers assets.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contentHashVersionForPublicAsset,
  resetAssetContentHashCache,
  withContentHashCacheBust,
} from '../api/_asset-content-hash.js';
import {
  attachCarImage,
  loadCarImageCatalog,
  normalizeCarImageUrl,
  resetCarImageCatalogCache,
  withCarImageCacheBust,
} from '../api/_car-image-resolve.js';
import { attachNumberArtwork, loadNumberArtworkCatalog } from '../api/_number-artwork-catalog.js';
import { buildStandingsGraphicModel } from '../public/standings-graphic-export-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const carsDir = path.join(root, 'public', 'assets', 'images', 'cars');
const numbersDir = path.join(root, 'public', 'assets', 'images', 'numbers');

function sha8(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

resetAssetContentHashCache();
resetCarImageCatalogCache();

{
  // A. same image contents -> same version string
  const url = '/assets/images/cars/John Perkins.png';
  resetAssetContentHashCache();
  const a = contentHashVersionForPublicAsset(url);
  resetAssetContentHashCache();
  const b = contentHashVersionForPublicAsset(url);
  assert.ok(a && /^[a-f0-9]{8}$/.test(a));
  assert.equal(a, b);
  const fileBuf = fs.readFileSync(path.join(carsDir, 'John Perkins.png'));
  assert.equal(a, sha8(fileBuf));
}

{
  // B/C. changed car image contents -> different version string / URL
  const tmpName = `__bp-hash-test-car-${Date.now()}.png`;
  const tmpPath = path.join(carsDir, tmpName);
  const publicUrl = `/assets/images/cars/${tmpName}`;
  try {
    fs.writeFileSync(tmpPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
    resetAssetContentHashCache();
    const v1 = contentHashVersionForPublicAsset(publicUrl);
    const u1 = withCarImageCacheBust(publicUrl);
    assert.equal(u1, `${publicUrl}?v=${v1}`);

    fs.writeFileSync(tmpPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6]));
    resetAssetContentHashCache();
    const v2 = contentHashVersionForPublicAsset(publicUrl);
    const u2 = withContentHashCacheBust(publicUrl);
    assert.notEqual(v1, v2);
    assert.equal(u2, `${publicUrl}?v=${v2}`);
    assert.notEqual(u1, u2);
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    resetAssetContentHashCache();
  }
}

{
  // D. number image URL changes after file overwrite
  const tmpName = `__bp-hash-test-num-${Date.now()}.png`;
  const tmpPath = path.join(numbersDir, tmpName);
  const publicUrl = `/assets/images/numbers/${tmpName}`;
  try {
    fs.writeFileSync(tmpPath, Buffer.from('number-a'));
    resetAssetContentHashCache();
    const u1 = withContentHashCacheBust(publicUrl);
    fs.writeFileSync(tmpPath, Buffer.from('number-b-changed'));
    resetAssetContentHashCache();
    const u2 = withContentHashCacheBust(publicUrl);
    assert.match(u1, /\?v=[a-f0-9]{8}$/);
    assert.match(u2, /\?v=[a-f0-9]{8}$/);
    assert.notEqual(u1, u2);
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    resetAssetContentHashCache();
  }
}

{
  // E/F. standings uses versioned number URL; carNumber from driver data
  const catalog = loadNumberArtworkCatalog();
  const artwork = attachNumberArtwork(
    {
      iracing_customer_id: '175138',
      display_name: 'John Perkins',
      carNumber: '33',
    },
    catalog,
    {}
  );
  assert.ok(artwork.imagePath.startsWith('/assets/images/numbers/'));
  assert.match(artwork.imageUrl, /\?v=[a-f0-9]{8}$/);
  assert.equal(normalizeCarImageUrl(artwork.imageUrl), artwork.imagePath);

  const carCatalog = loadCarImageCatalog();
  const withCar = attachCarImage(
    {
      driver_id: '175138',
      display_name: 'John Perkins',
      iracing_customer_id: '175138',
      car_number: '33',
      car_image_url: '',
    },
    carCatalog
  );
  assert.match(withCar.car_image_url, /John Perkins\.png\?v=[a-f0-9]{8}$/);

  const model = buildStandingsGraphicModel(
    {
      settings: { seasonName: 'Season 11', playoffCut: 16 },
      rows: [
        {
          position: 1,
          driver: 'John Perkins',
          points: 100,
          carNumber: '33',
          iracingCustomerId: '175138',
          numberArtwork: artwork,
        },
      ],
    },
    { races: [] },
    { pointsRaceNumber: 1, trackName: 'Test' }
  );
  assert.equal(model.drivers[0].carNumber, '33');
  assert.equal(model.drivers[0].numberArtwork.imageUrl, artwork.imageUrl);
  assert.match(model.drivers[0].numberArtwork.imageUrl, /\?v=[a-f0-9]{8}$/);
}

{
  // vercel: cars/numbers may be immutable because URLs are content-versioned
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const carHeader = (vercel.headers || []).find((h) =>
    String(h.source || '').includes('/assets/images/cars')
  );
  const cacheControl = carHeader.headers.find((h) => h.key === 'Cache-Control')?.value || '';
  assert.match(cacheControl, /max-age=31536000/);
  assert.match(cacheControl, /immutable/i);
}

console.log('test-asset-content-hash: ok');
