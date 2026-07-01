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

  function extractOvalRow(table) {
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
      const key = headerMap[normalizeHeader(header)];
      if (key) headerIndex[key] = index;
    });

    const rows = [...table.querySelectorAll('tr')];
    const ovalRow = rows.find((row) => {
      const firstCell = row.querySelector('td, th');
      return /^Oval$/i.test(cleanText(firstCell?.textContent || ''));
    });

    if (!ovalRow) {
      return { values: null, headers, headerIndex, selector: null };
    }

    const cells = [...ovalRow.querySelectorAll('td, th')].map((cell) => cleanText(cell.textContent));
    const values = {
      category: cells[headerIndex.category ?? 0] || 'Oval',
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

    return {
      values,
      headers,
      headerIndex,
      cells,
      selector: '#member-profile-career-stats table tr:has(td:first-child:text("Oval"))',
    };
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

  const ovalExtract = tableHit.table ? extractOvalRow(tableHit.table) : { values: null, selector: null };
  if (!ovalExtract.values) {
    recordFailure('ovalCategoryRow', selectorCatalog.ovalCategoryRow.selectors, 'Oval category row not found');
  } else {
    recordSuccess('ovalCategoryRow', ovalExtract.selector, ovalExtract.values.category);
    for (const [field, value] of Object.entries(ovalExtract.values)) {
      if (field === 'category') continue;
      discovered['stats.' + field] = {
        selector: ovalExtract.selector,
        value,
      };
    }
  }

  const data = ovalExtract.values
    ? {
        category: ovalExtract.values.category,
        starts: ovalExtract.values.starts,
        wins: ovalExtract.values.wins,
        top5: ovalExtract.values.top5,
        poles: ovalExtract.values.poles,
        avgStart: ovalExtract.values.avgStart,
        avgFinish: ovalExtract.values.avgFinish,
        totalLaps: ovalExtract.values.totalLaps,
        lapsLed: ovalExtract.values.lapsLed,
        incidentsPerRace: ovalExtract.values.incidentsPerRace,
        pointsPerRace: ovalExtract.values.pointsPerRace,
        winPercentage: ovalExtract.values.winPercentage,
        top5Percentage: ovalExtract.values.top5Percentage,
      }
    : {
        category: null,
        starts: null,
        wins: null,
        top5: null,
        poles: null,
        avgStart: null,
        avgFinish: null,
        totalLaps: null,
        lapsLed: null,
        incidentsPerRace: null,
        pointsPerRace: null,
        winPercentage: null,
        top5Percentage: null,
      };

  return {
    data,
    discovered,
    failures,
    selectorCatalog,
    rawText: document.body?.innerText?.trim() || '',
    tableHeaders: ovalExtract.headers || [],
    tableCells: ovalExtract.cells || [],
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
