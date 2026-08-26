import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const carsDir = path.join(ROOT, 'public', 'assets', 'images', 'cars');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'drivers.json'), 'utf8'));
const drivers = catalog.drivers || catalog;
const files = new Set(
  fs.readdirSync(carsDir).filter((f) => f.endsWith('.png') && !f.includes('.bak'))
);

const profiles = await fetch('https://www.blazingpedalsracing.com/api/drivers').then((r) =>
  r.json()
);

function basename(url) {
  try {
    const clean = String(url || '').split('?')[0];
    return decodeURIComponent(clean.split('/').pop() || '');
  } catch {
    return String(url || '').split('/').pop() || '';
  }
}

const mismatches = [];
for (const p of profiles) {
  const name = p.display_name || p.iracing_name || '';
  const expected = `${name}.png`;
  const api = String(p.car_image_url || p.carImageUrl || '').trim();
  const catalogEntry =
    drivers.find((d) => String(d.iracingCustomerId) === String(p.iracing_customer_id)) ||
    drivers.find((d) => String(d.name || '').toLowerCase() === name.toLowerCase());
  const catalogFile = basename(catalogEntry?.carImage || '');
  const catalogExists = Boolean(catalogFile && files.has(catalogFile));
  if (catalogExists && catalogFile !== expected) {
    mismatches.push({
      name,
      expected,
      catalogFile,
      api,
      driver_id: p.driver_id,
    });
  }
}

const emptyApiWithCatalog = profiles
  .map((p) => {
    const catalogEntry =
      drivers.find((d) => String(d.iracingCustomerId) === String(p.iracing_customer_id)) ||
      drivers.find(
        (d) =>
          String(d.name || '').toLowerCase() ===
          String(p.display_name || p.iracing_name || '').toLowerCase()
      );
    const catalogPath = catalogEntry?.carImage || '';
    const catalogFile = basename(catalogPath);
    const api = String(p.car_image_url || '').trim();
    if (!catalogFile || !files.has(catalogFile)) return null;
    if (api && !/^https?:\/\/drive\.google\.com\/open\/?$/i.test(api)) return null;
    return {
      name: p.display_name,
      driver_id: p.driver_id,
      customerId: p.iracing_customer_id,
      catalogPath,
      api: api || '(empty)',
    };
  })
  .filter(Boolean);

console.log(
  JSON.stringify(
    {
      nameVsCatalogMismatches: mismatches,
      emptyOrBadApiButCatalogFile: emptyApiWithCatalog.length,
      kody: emptyApiWithCatalog.find((r) => /kody/i.test(r.name)),
      badDriveUrls: profiles
        .filter((p) => /drive\.google\.com\/open/i.test(p.car_image_url || ''))
        .map((p) => ({ name: p.display_name, url: p.car_image_url })),
    },
    null,
    2
  )
);
