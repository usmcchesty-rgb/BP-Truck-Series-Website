/**
 * DOM selectors for iRacing members-ng profile Stats tab (Career Stats table).
 *
 * Discovered via Chrome DevTools on:
 * https://members-ng.iracing.com/web/racing/profile?cust_id={ID}&tab=stats
 */

export const STATS_DOM_SELECTORS = {
  statsPane: {
    field: 'statsPane',
    description: 'Active Stats tab content pane',
    selectors: [
      '[id="modal-profile modal-member-stats"]',
      '[id*="member-stats"]',
      '#modal-profile [class*="tab-pane"].active',
    ],
  },
  careerStatsRoot: {
    field: 'careerStatsRoot',
    description: 'Career Stats card container',
    selectors: ['#member-profile-career-stats', '#member-profile-career-stats-card'],
  },
  careerStatsTable: {
    field: 'careerStatsTable',
    description: 'Career Stats summary table with Category column',
    selectors: [
      '#member-profile-career-stats table',
      '#member-profile-career-stats-card table',
      '[id*="member-stats"] #member-profile-career-stats table',
    ],
  },
  ovalCategoryRow: {
    field: 'ovalCategoryRow',
    description: 'Oval row within Career Stats table',
    selectors: ['#member-profile-career-stats table tr', '#member-profile-career-stats-card table tr'],
    matchText: /^Oval$/i,
  },
};

const CAREER_HEADER_MAP = {
  category: 'category',
  starts: 'starts',
  wins: 'wins',
  'top 5': 'top5',
  poles: 'poles',
  'avg start': 'avgStart',
  'avg finish': 'avgFinish',
  'total laps': 'totalLaps',
  'laps led': 'lapsLed',
  'inc/race': 'incidentsPerRace',
  'pts/race': 'pointsPerRace',
  'win %': 'winPercentage',
  'top 5%': 'top5Percentage',
};

export const EXTRACT_STATS_DOM_SCRIPT = `
(() => {
  const selectorCatalog = ${JSON.stringify(
    Object.fromEntries(
      Object.entries(STATS_DOM_SELECTORS).map(([key, entry]) => [
        key,
        { field: entry.field, description: entry.description, selectors: entry.selectors },
      ])
    )
  )};

  const headerMap = ${JSON.stringify(CAREER_HEADER_MAP)};

  function cleanText(value) {
    return String(value ?? '').replace(/\\s+/g, ' ').trim();
  }

  function queryFirst(selectors) {
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element) return { element, selector };
      } catch (_err) {
        // try next
      }
    }
    return { element: null, selector: null, tried: selectors };
  }

  function normalizeHeader(text) {
    return cleanText(text).toLowerCase();
  }

  function parseInteger(value) {
    const raw = cleanText(value).replace(/,/g, '');
    if (!raw) return null;
    const num = Number.parseInt(raw, 10);
    return Number.isFinite(num) ? num : null;
  }

  function parseDecimal(value) {
    const raw = cleanText(value).replace(/,/g, '');
    if (!raw) return null;
    const num = Number.parseFloat(raw);
    return Number.isFinite(num) ? num : null;
  }

  function buildHeaderIndex(headers) {
    const headerIndex = {};
    headers.forEach((header, index) => {
      const key = headerMap[normalizeHeader(header)];
      if (key) headerIndex[key] = index;
    });
    return headerIndex;
  }

  function rowToStats(cells, headerIndex, categoryName) {
    return {
      category: categoryName || cells[headerIndex.category ?? 0] || null,
      starts: parseInteger(cells[headerIndex.starts]),
      wins: parseInteger(cells[headerIndex.wins]),
      top5: parseInteger(cells[headerIndex.top5]),
      poles: parseInteger(cells[headerIndex.poles]),
      avgStart: parseDecimal(cells[headerIndex.avgStart]),
      avgFinish: parseDecimal(cells[headerIndex.avgFinish]),
      totalLaps: parseInteger(cells[headerIndex.totalLaps]),
      lapsLed: parseInteger(cells[headerIndex.lapsLed]),
      incidentsPerRace: parseDecimal(cells[headerIndex.incidentsPerRace]),
      pointsPerRace: parseDecimal(cells[headerIndex.pointsPerRace]),
      winPercentage: parseDecimal(cells[headerIndex.winPercentage]),
      top5Percentage: parseDecimal(cells[headerIndex.top5Percentage]),
    };
  }

  function extractAllCareerRows(table) {
    const headerCells = [...table.querySelectorAll('thead th, tr:first-child th')];
    const headers = headerCells.length
      ? headerCells.map((cell) => cleanText(cell.textContent))
      : [...table.querySelectorAll('tr')][0]
        ? [...[...table.querySelectorAll('tr')][0].querySelectorAll('th, td')].map((cell) =>
            cleanText(cell.textContent)
          )
        : [];
    const headerIndex = buildHeaderIndex(headers);
    const rows = [...table.querySelectorAll('tr')];
    const categories = {};

    for (const row of rows) {
      const firstCell = row.querySelector('td, th');
      const label = cleanText(firstCell?.textContent || '');
      if (!label || /^category$/i.test(label)) continue;
      const cells = [...row.querySelectorAll('td, th')].map((cell) => cleanText(cell.textContent));
      if (!cells.length) continue;
      categories[label] = rowToStats(cells, headerIndex, label);
    }

    return { headers, headerIndex, categories };
  }

  function findYearlyStatsTable() {
    const roots = [
      document.querySelector('#member-profile-yearly-stats'),
      document.querySelector('#member-profile-yearly-stats-card'),
    ].filter(Boolean);

    for (const root of roots) {
      for (const table of root.querySelectorAll('table')) {
        const headers = [...table.querySelectorAll('th')].map((th) => cleanText(th.textContent));
        if (headers.some((h) => /^year$/i.test(h)) && headers.some((h) => /^category$/i.test(h))) {
          return { table, selector: '#member-profile-yearly-stats table (Year + Category headers)' };
        }
      }
    }

    return { table: null, selector: null };
  }

  function extractYearlyRows(table) {
    const headerCells = [...table.querySelectorAll('thead th, tr:first-child th')];
    const headers = headerCells.length
      ? headerCells.map((cell) => cleanText(cell.textContent))
      : [...table.querySelectorAll('tr')][0]
        ? [...[...table.querySelectorAll('tr')][0].querySelectorAll('th, td')].map((cell) =>
            cleanText(cell.textContent)
          )
        : [];

    const headerIndex = {};
    headers.forEach((header, index) => {
      const normalized = normalizeHeader(header);
      if (normalized === 'year') headerIndex.year = index;
      const mapped = headerMap[normalized];
      if (mapped) headerIndex[mapped] = index;
    });

    const yearly = [];
    for (const row of [...table.querySelectorAll('tr')]) {
      const cells = [...row.querySelectorAll('td, th')].map((cell) => cleanText(cell.textContent));
      if (!cells.length) continue;
      const year = parseInteger(cells[headerIndex.year ?? 0]);
      const category = cells[headerIndex.category ?? 1] || null;
      if (!year || !category || /^year$/i.test(category)) continue;
      yearly.push({
        year,
        category,
        starts: parseInteger(cells[headerIndex.starts]),
        wins: parseInteger(cells[headerIndex.wins]),
        top5: parseInteger(cells[headerIndex.top5]),
        poles: parseInteger(cells[headerIndex.poles]),
        avgStart: parseDecimal(cells[headerIndex.avgStart]),
        avgFinish: parseDecimal(cells[headerIndex.avgFinish]),
        totalLaps: parseInteger(cells[headerIndex.totalLaps]),
        lapsLed: parseInteger(cells[headerIndex.lapsLed]),
        incidentsPerRace: parseDecimal(cells[headerIndex.incidentsPerRace]),
        pointsPerRace: parseDecimal(cells[headerIndex.pointsPerRace]),
        winPercentage: parseDecimal(cells[headerIndex.winPercentage]),
        top5Percentage: parseDecimal(cells[headerIndex.top5Percentage]),
      });
    }

    return { headers, yearly };
  }

  function findCareerStatsTable() {
    const roots = [
      document.querySelector('#member-profile-career-stats'),
      document.querySelector('#member-profile-career-stats-card'),
      document.querySelector('[id="modal-profile modal-member-stats"]'),
    ].filter(Boolean);

    for (const root of roots) {
      for (const table of root.querySelectorAll('table')) {
        const headers = [...table.querySelectorAll('th')].map((th) => cleanText(th.textContent));
        if (headers.some((h) => /^category$/i.test(h)) && headers.some((h) => /^starts$/i.test(h))) {
          return { table, selector: '#member-profile-career-stats table (Category + Starts headers)' };
        }
      }
    }

    for (const table of document.querySelectorAll('table')) {
      const headers = [...table.querySelectorAll('th')].map((th) => cleanText(th.textContent));
      if (headers.some((h) => /^category$/i.test(h)) && headers.some((h) => /^starts$/i.test(h))) {
        return { table, selector: 'table (Category + Starts headers)' };
      }
    }

    return { table: null, selector: null };
  }

  const discovered = {};
  const failures = [];

  function recordSuccess(field, selector, value) {
    discovered[field] = { selector, value };
  }

  function recordFailure(field, selectors, reason) {
    failures.push({ field, selectors, reason });
  }

  const statsPaneHit = queryFirst(selectorCatalog.statsPane.selectors);
  if (!statsPaneHit.element) {
    recordFailure('statsPane', selectorCatalog.statsPane.selectors, 'Stats pane not found');
  } else {
    recordSuccess('statsPane', statsPaneHit.selector, true);
  }

  const careerRootHit = queryFirst(selectorCatalog.careerStatsRoot.selectors);
  if (!careerRootHit.element) {
    recordFailure('careerStatsRoot', selectorCatalog.careerStatsRoot.selectors, 'Career stats root not found');
  } else {
    recordSuccess('careerStatsRoot', careerRootHit.selector, true);
  }

  const tableHit = findCareerStatsTable();
  if (!tableHit.table) {
    recordFailure('careerStatsTable', selectorCatalog.careerStatsTable.selectors, 'Career stats table not found');
  } else {
    recordSuccess('careerStatsTable', tableHit.selector, true);
  }

  const careerExtract = tableHit.table
    ? extractAllCareerRows(tableHit.table)
    : { headers: [], categories: {} };
  const categoryNames = Object.keys(careerExtract.categories || {});

  if (!categoryNames.length) {
    recordFailure('careerCategoryRows', selectorCatalog.careerStatsTable.selectors, 'No career category rows found');
  } else {
    recordSuccess('careerCategoryRows', tableHit.selector, categoryNames.length);
    for (const name of categoryNames) {
      discovered['stats.' + name] = {
        selector: tableHit.selector,
        value: careerExtract.categories[name],
      };
    }
  }

  const ovalStats = careerExtract.categories?.Oval || null;
  if (!ovalStats) {
    recordFailure('ovalCategoryRow', selectorCatalog.ovalCategoryRow.selectors, 'Oval category row not found');
  } else {
    recordSuccess('ovalCategoryRow', tableHit.selector, 'Oval');
  }

  const yearlyHit = findYearlyStatsTable();
  let yearlyStats = [];
  let yearlyParseStatus = 'needs_manual_review';
  let yearlyParseError = 'Yearly stats table not found';

  if (!yearlyHit.table) {
    recordFailure('yearlyStatsTable', ['#member-profile-yearly-stats table'], yearlyParseError);
  } else {
    const yearlyExtract = extractYearlyRows(yearlyHit.table);
    yearlyStats = yearlyExtract.yearly || [];
    if (yearlyStats.length) {
      yearlyParseStatus = 'completed';
      yearlyParseError = null;
      recordSuccess('yearlyStatsTable', yearlyHit.selector, yearlyStats.length);
    } else {
      yearlyParseError = 'Yearly stats table found but no rows parsed';
      recordFailure('yearlyStatsRows', ['#member-profile-yearly-stats table tr'], yearlyParseError);
    }
  }

  const data = {
    category: ovalStats?.category || 'Oval',
    starts: ovalStats?.starts ?? null,
    wins: ovalStats?.wins ?? null,
    top5: ovalStats?.top5 ?? null,
    poles: ovalStats?.poles ?? null,
    avgStart: ovalStats?.avgStart ?? null,
    avgFinish: ovalStats?.avgFinish ?? null,
    totalLaps: ovalStats?.totalLaps ?? null,
    lapsLed: ovalStats?.lapsLed ?? null,
    incidentsPerRace: ovalStats?.incidentsPerRace ?? null,
    pointsPerRace: ovalStats?.pointsPerRace ?? null,
    winPercentage: ovalStats?.winPercentage ?? null,
    top5Percentage: ovalStats?.top5Percentage ?? null,
    statsByCategory: careerExtract.categories || {},
    yearlyStats,
    yearlyParseStatus,
    yearlyParseError,
  };

  return {
    data,
    discovered,
    failures,
    selectorCatalog,
    rawText: document.body?.innerText?.trim() || '',
    careerCategories: categoryNames,
    yearlyRowCount: yearlyStats.length,
  };
})()
`;

export const REQUIRED_STATS_FIELDS = [
  'category',
  'starts',
  'wins',
  'top5',
  'poles',
  'avgStart',
  'avgFinish',
  'totalLaps',
  'lapsLed',
  'incidentsPerRace',
  'pointsPerRace',
  'winPercentage',
  'top5Percentage',
];

export function getMissingRequiredStatsFields(statsData) {
  const missing = [];
  const data = statsData || {};

  if (!String(data.category ?? '').trim()) missing.push('category');
  if (data.starts == null) missing.push('starts');
  if (data.wins == null) missing.push('wins');
  if (data.top5 == null) missing.push('top5');
  if (data.poles == null) missing.push('poles');
  if (data.avgStart == null) missing.push('avgStart');
  if (data.avgFinish == null) missing.push('avgFinish');
  if (data.totalLaps == null) missing.push('totalLaps');
  if (data.lapsLed == null) missing.push('lapsLed');
  if (data.incidentsPerRace == null) missing.push('incidentsPerRace');
  if (data.pointsPerRace == null) missing.push('pointsPerRace');
  if (data.winPercentage == null) missing.push('winPercentage');
  if (data.top5Percentage == null) missing.push('top5Percentage');

  return missing;
}

export function logMissingRequiredStatsFields(logger, missing) {
  const log = typeof logger === 'function' ? logger : () => {};
  log('Stats missing fields:');
  if (!missing?.length) {
    log('(none)');
    return;
  }
  for (const field of missing) {
    log(`- ${field}`);
  }
}

export function evaluateStatsCompletion(statsData) {
  const missing = getMissingRequiredStatsFields(statsData);
  const success = missing.length === 0;

  return {
    scrape_status: success ? 'completed' : 'needs_manual_review',
    scrape_error: success ? null : `Missing fields: ${missing.join(', ')}`,
    missingFields: missing,
    statsComplete: success,
  };
}

export function logStatsSelectorReport(logger, domResult) {
  const log = typeof logger === 'function' ? logger : () => {};

  log('Stats DOM selector catalog:');
  for (const [key, entry] of Object.entries(domResult?.selectorCatalog || {})) {
    log(`  ${key}: ${(entry.selectors || []).join(' | ')}`);
  }

  log('Stats DOM selectors matched:');
  for (const [field, hit] of Object.entries(domResult?.discovered || {})) {
    log(`  ${field}: ${hit.selector} → ${JSON.stringify(hit.value)}`);
  }

  for (const failure of domResult?.failures || []) {
    log(`Stats DOM selector miss [${failure.field}]: ${failure.reason}`);
    log(`  tried: ${(failure.selectors || []).join(' | ')}`);
  }
}
