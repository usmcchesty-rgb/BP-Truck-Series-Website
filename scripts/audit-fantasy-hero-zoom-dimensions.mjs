/**
 * Read-only audit: fantasy hero dimensions at simulated browser zoom levels.
 * Does not modify site code.
 */
import puppeteer from 'puppeteer';

const URL = 'http://127.0.0.1:3000/fantasy.html';
const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 };
const ZOOM_LEVELS = [0.5, 1.0, 1.25];

function measurePage() {
  const pick = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      offsetWidth: el.offsetWidth,
      offsetHeight: el.offsetHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      boundingRect: {
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
        top: Math.round(r.top * 100) / 100,
        bottom: Math.round(r.bottom * 100) / 100,
      },
      computed: {
        width: cs.width,
        height: cs.height,
        minHeight: cs.minHeight,
        maxHeight: cs.maxHeight,
        aspectRatio: cs.aspectRatio,
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        marginTop: cs.marginTop,
        marginBottom: cs.marginBottom,
        position: cs.position,
        display: cs.display,
        objectFit: cs.objectFit,
      },
    };
  };

  const banner = document.querySelector('.fantasy-hero-banner');
  const stage = document.querySelector('.fantasy-hero-stage');
  const img = document.querySelector('.fantasy-hero-banner-img');
  const logo = document.querySelector('.fantasy-hero-logo');
  const wrap = document.querySelector('.fantasy-wrap');
  const overview = document.querySelector('#fantasy-overview');
  const overviewGrid = document.querySelector('.fantasy-overview-grid');
  const firstCard = document.querySelector('.fantasy-overview-item');

  const heroTop = banner?.getBoundingClientRect().top ?? 0;
  const heroBottom = banner?.getBoundingClientRect().bottom ?? 0;
  const gridTop = overviewGrid?.getBoundingClientRect().top ?? 0;
  const overviewTop = overview?.getBoundingClientRect().top ?? 0;
  const cardTop = firstCard?.getBoundingClientRect().top ?? 0;
  const overviewTitleTop = document.querySelector('#fantasyOverviewTitle')?.getBoundingClientRect().top ?? 0;

  const stageCs = stage ? getComputedStyle(stage) : null;

  return {
    env: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      bodyMinHeight: getComputedStyle(document.body).minHeight,
      htmlZoom: getComputedStyle(document.documentElement).zoom || '(none)',
      appliedZoomAttr: document.documentElement.getAttribute('data-audit-zoom'),
    },
    heroImageNatural: img
      ? { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, complete: img.complete }
      : null,
    stageCssVars: stageCs
      ? {
          artboardW: stageCs.getPropertyValue('--fantasy-hero-artboard-w').trim(),
          artboardH: stageCs.getPropertyValue('--fantasy-hero-artboard-h').trim(),
          designWidth: stageCs.getPropertyValue('--fantasy-hero-design-width').trim(),
        }
      : null,
    elements: {
      fantasyHeroBanner: pick(banner),
      fantasyHeroStage: pick(stage),
      fantasyHeroBannerImg: pick(img),
      fantasyHeroLogo: pick(logo),
      fantasyWrap: pick(wrap),
      fantasyOverview: pick(overview),
      fantasyOverviewGrid: pick(overviewGrid),
      firstOverviewCard: pick(firstCard),
    },
    distances: {
      heroTopToOverviewTitle: Math.round((overviewTitleTop - heroTop) * 100) / 100,
      heroTopToOverviewGrid: Math.round((gridTop - heroTop) * 100) / 100,
      heroTopToFirstCard: Math.round((cardTop - heroTop) * 100) / 100,
      heroBottomToOverviewTop: Math.round((overviewTop - heroBottom) * 100) / 100,
      heroBottomToOverviewGrid: Math.round((gridTop - heroBottom) * 100) / 100,
      heroBottomToFirstCard: Math.round((cardTop - heroBottom) * 100) / 100,
      wrapPaddingTop: wrap ? getComputedStyle(wrap).paddingTop : null,
    },
    heightDrivers: {
      bannerEqualsStage: banner && stage
        ? banner.offsetHeight === stage.offsetHeight
        : null,
      stageExpectedHeightFromAspect:
        stage && stageCs
          ? Math.round(
              (stage.offsetWidth * Number(stageCs.getPropertyValue('--fantasy-hero-artboard-h').trim() || 1086)) /
                Number(stageCs.getPropertyValue('--fantasy-hero-artboard-w').trim() || 1448),
            )
          : null,
      imgFillsStage:
        img && stage
          ? {
              widthMatch: Math.abs(img.getBoundingClientRect().width - stage.getBoundingClientRect().width) < 2,
              heightMatch: Math.abs(img.getBoundingClientRect().height - stage.getBoundingClientRect().height) < 2,
            }
          : null,
    },
  };
}

async function runWithCssZoom(page, zoom) {
  await page.setViewport(VIEWPORT);
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.fantasy-hero-stage');
  await page.waitForFunction(() => {
    const img = document.getElementById('fantasyHeroImage');
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 15000 });

  await page.evaluate((z) => {
    document.documentElement.setAttribute('data-audit-zoom', String(z));
    document.documentElement.style.zoom = String(z);
  }, zoom);

  await new Promise((r) => setTimeout(r, 300));
  return page.evaluate(measurePage);
}

async function runWithCdpScale(client, page, zoom) {
  await page.setViewport(VIEWPORT);
  try {
    await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: zoom });
  } catch {
    // Older/newer CDP may differ; fall back silently.
  }
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.fantasy-hero-stage');
  await page.waitForFunction(() => {
    const img = document.getElementById('fantasyHeroImage');
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 15000 });
  await page.evaluate((z) => {
    document.documentElement.setAttribute('data-audit-zoom', String(z));
  }, zoom);
  return page.evaluate(measurePage);
}

function printReport(label, zoom, data) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`${label} @ ${Math.round(zoom * 100)}% zoom`);
  console.log('='.repeat(72));
  console.log(JSON.stringify(data, null, 2));
}

function compareZooms(results) {
  console.log(`\n${'#'.repeat(72)}`);
  console.log('COMPARISON SUMMARY (layout offset sizes & visual bounding rects)');
  console.log('#'.repeat(72));

  const keys = [
    ['fantasyHeroBanner', 'offsetHeight', 'layout height'],
    ['fantasyHeroStage', 'offsetHeight', 'layout height'],
    ['fantasyHeroBannerImg', 'boundingRect.height', 'visual height'],
    ['fantasyHeroLogo', 'boundingRect.height', 'visual height'],
    ['fantasyOverviewGrid', 'boundingRect.top', 'visual top'],
  ];

  const get = (obj, path) => {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
      cur = cur?.[p];
    }
    return cur;
  };

  for (const [elKey, metricPath, label] of keys) {
    const row = results.map(({ zoom, data }) => {
      const el = data.elements[elKey];
      const val = get(el, metricPath) ?? get(el, 'offsetHeight');
      return `${Math.round(zoom * 100)}%=${val}`;
    });
    console.log(`${elKey} ${label}: ${row.join(' | ')}`);
  }

  console.log('\nDistances (visual px, getBoundingClientRect):');
  for (const key of [
    'heroTopToOverviewGrid',
    'heroBottomToOverviewGrid',
    'heroBottomToOverviewTop',
  ]) {
    const row = results.map(({ zoom, data }) => `${Math.round(zoom * 100)}%=${data.distances[key]}`);
    console.log(`  ${key}: ${row.join(' | ')}`);
  }

  const base = results.find((r) => r.zoom === 1)?.data;
  const z50 = results.find((r) => r.zoom === 0.5)?.data;
  const z125 = results.find((r) => r.zoom === 1.25)?.data;

  if (base && z50 && z125) {
    const stageH100 = base.elements.fantasyHeroStage.offsetHeight;
    const stageH50 = z50.elements.fantasyHeroStage.offsetHeight;
    const stageH125 = z125.elements.fantasyHeroStage.offsetHeight;
    const stageVisual100 = base.elements.fantasyHeroStage.boundingRect.height;
    const stageVisual50 = z50.elements.fantasyHeroStage.boundingRect.height;
    const stageVisual125 = z125.elements.fantasyHeroStage.boundingRect.height;

    console.log('\nScaling ratios (relative to 100%):');
    console.log(`  stage layout height 50%/100%: ${(stageH50 / stageH100).toFixed(3)} (expect ~0.5 with CSS zoom)`);
    console.log(`  stage layout height 125%/100%: ${(stageH125 / stageH100).toFixed(3)} (expect ~1.25)`);
    console.log(`  stage visual height 50%/100%: ${(stageVisual50 / stageVisual100).toFixed(3)}`);
    console.log(`  stage visual height 125%/100%: ${(stageVisual125 / stageVisual100).toFixed(3)}`);

    const overviewTop100 = base.elements.fantasyOverviewGrid.boundingRect.top;
    const overviewTop50 = z50.elements.fantasyOverviewGrid.boundingRect.top;
    console.log(`  overview grid visual top 50%/100%: ${(overviewTop50 / overviewTop100).toFixed(3)}`);

    console.log('\nHeight driver analysis @ 100%:');
    console.log(`  stage aspect-ratio computed: ${base.elements.fantasyHeroStage.computed.aspectRatio}`);
    console.log(`  stage expected height from aspect: ${base.heightDrivers.stageExpectedHeightFromAspect}px`);
    console.log(`  stage actual offsetHeight: ${base.elements.fantasyHeroStage.offsetHeight}px`);
    console.log(`  banner offsetHeight: ${base.elements.fantasyHeroBanner.offsetHeight}px`);
    console.log(`  img offsetHeight: ${base.elements.fantasyHeroBannerImg.offsetHeight}px`);
    console.log(`  banner === stage height: ${base.heightDrivers.bannerEqualsStage}`);
    console.log(`  img fills stage: ${JSON.stringify(base.heightDrivers.imgFillsStage)}`);
    console.log(`  wrap padding-top: ${base.distances.wrapPaddingTop}`);
    console.log(`  body min-height: ${base.env.bodyMinHeight}`);
  }
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: VIEWPORT,
  });

  const page = await browser.newPage();
  const client = await page.createCDPSession();

  console.log('Fantasy hero zoom dimension audit');
  console.log(`URL: ${URL}`);
  console.log(`Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);

  const cssZoomResults = [];
  for (const zoom of ZOOM_LEVELS) {
    const data = await runWithCssZoom(page, zoom);
    printReport('CSS zoom (Chrome-like layout scaling)', zoom, data);
    cssZoomResults.push({ zoom, data, method: 'css-zoom' });
  }

  compareZooms(cssZoomResults);

  console.log(`\n${'#'.repeat(72)}`);
  console.log('CDP PageScaleFactor pass (Ctrl+wheel style visual scaling)');
  console.log('#'.repeat(72));

  const cdpResults = [];
  for (const zoom of ZOOM_LEVELS) {
    await client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    }).catch(() => {});
    const data = await runWithCdpScale(client, page, zoom);
    printReport('CDP pageScaleFactor', zoom, data);
    cdpResults.push({ zoom, data, method: 'cdp-scale' });
  }

  compareZooms(cdpResults);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
