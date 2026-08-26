/**
 * Car image resolution regression tests.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attachCarImage,
  isUsableCarImageUrl,
  loadCarImageCatalog,
  localCarAssetExists,
  lookupCatalogCarImage,
  resetCarImageCatalogCache,
  resolveCarImageForDriver,
} from '../api/_car-image-resolve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

resetCarImageCatalogCache();
const catalog = loadCarImageCatalog();

{
  // 1. Kody Miller2-shaped driver resolves catalog car image
  const kody = {
    driver_id: '118551',
    display_name: 'Kody Miller2',
    iracing_name: 'Kody Miller2',
    iracing_customer_id: '1207664',
    car_image_url: '',
  };
  const resolved = resolveCarImageForDriver(kody, catalog);
  assert.equal(resolved.carImageUrl, '/assets/images/cars/Kody Miller2.png');
  assert.equal(resolved.source, 'catalog');
  assert.equal(localCarAssetExists(resolved.carImageUrl), true);
}

{
  // 2. stored usable carImage wins over filename reconstruction / catalog
  const stored = resolveCarImageForDriver(
    {
      display_name: 'Kody Miller2',
      iracing_customer_id: '1207664',
      car_image_url: '/assets/images/cars/Kody Miller2.png',
    },
    catalog
  );
  assert.equal(stored.source, 'profile');
  assert.equal(stored.carImageUrl, '/assets/images/cars/Kody Miller2.png');
}

{
  // 3. display-name suffix does not break path when catalog matched by customer id
  const byCustomer = lookupCatalogCarImage(
    { iracing_customer_id: '1207664', display_name: 'Kody Miller' },
    catalog
  );
  assert.equal(byCustomer, '/assets/images/cars/Kody Miller2.png');
}

{
  // 4. canonical profile mapping preserves carImage via attachCarImage
  const attached = attachCarImage(
    {
      driver_id: '118551',
      display_name: 'Kody Miller2',
      iracing_customer_id: '1207664',
      car_image_url: '',
      photo_url: '/assets/drivers/kody-miller2.png',
    },
    catalog
  );
  assert.equal(attached.car_image_url, '/assets/images/cars/Kody Miller2.png');
  assert.equal(attached.carImageUrl, '/assets/images/cars/Kody Miller2.png');
  assert.equal(attached.photo_url, '/assets/drivers/kody-miller2.png');
}

{
  // 5. existing working driver still resolves; bad Drive stub rejected
  const carroll = resolveCarImageForDriver(
    {
      display_name: 'Chris Carroll3',
      iracing_customer_id: '307392',
      car_image_url: 'https://drive.google.com/open',
    },
    catalog
  );
  assert.equal(isUsableCarImageUrl('https://drive.google.com/open'), false);
  assert.equal(carroll.carImageUrl, '/assets/images/cars/Chris Carroll3.png');
  assert.equal(carroll.source, 'catalog');
}

{
  // 6. missing car PNG uses empty fallback cleanly
  const missing = resolveCarImageForDriver(
    {
      display_name: 'Nobody Driver',
      iracing_customer_id: '999999999',
      car_image_url: '',
    },
    catalog
  );
  assert.equal(missing.carImageUrl, '');
  assert.equal(missing.source, 'none');
}

{
  // 7. late-added / identity-split style: customer id lookup preserves carImage
  const perkinsCatalog = lookupCatalogCarImage(
    { iracing_customer_id: '175138', display_name: 'John Perkins' },
    catalog
  );
  if (perkinsCatalog) {
    assert.ok(localCarAssetExists(perkinsCatalog));
  }
}

{
  // 8. name-suffix mismatch still resolves via customer id → catalog
  const kelly = resolveCarImageForDriver(
    {
      driver_id: '130431',
      display_name: 'Michael Kelly10',
      iracing_name: 'Michael Kelly10',
      iracing_customer_id: '778311',
      car_image_url: '',
    },
    catalog
  );
  assert.equal(kelly.carImageUrl, '/assets/images/cars/Michael Kelly.png');
  assert.equal(localCarAssetExists(kelly.carImageUrl), true);
}

{
  // 9. Ryan Washeleski → Ryan Wash.png via customer id
  const ryan = resolveCarImageForDriver(
    {
      display_name: 'Ryan Washeleski',
      iracing_customer_id: '329874',
      car_image_url: '',
    },
    catalog
  );
  assert.equal(ryan.carImageUrl, '/assets/images/cars/Ryan Wash.png');
}

{
  // Kody PNG tracked on disk
  const png = path.join(root, 'public', 'assets', 'images', 'cars', 'Kody Miller2.png');
  assert.equal(fs.existsSync(png), true);
  assert.ok(fs.statSync(png).size > 1000);
}

console.log('test-car-image-resolve: ok');
