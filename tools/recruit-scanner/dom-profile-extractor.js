/**
 * DOM selectors for iRacing members-ng profile (Licenses tab).
 *
 * Discovered via Chrome DevTools on:
 * https://members-ng.iracing.com/web/racing/profile?cust_id={ID}&tab=licenses
 *
 * Prefer semantic/stable hooks (IDs, aria-label, BEM-style class suffixes) over
 * hashed Chakra CSS classes (css-xxxxx), which may change between builds.
 */

export const CAPTURE_VISIBLE_TEXT_SCRIPT = `
(() => {
  const candidates = [
    document.querySelector('main'),
    document.querySelector('[role="main"]'),
    document.querySelector('#root'),
    document.body,
  ];
  for (const element of candidates) {
    if (element && element.innerText && element.innerText.trim().length > 40) {
      return element.innerText.trim();
    }
  }
  return document.body?.innerText?.trim() || '';
})()
`;

export const DETECT_LOGIN_FORM_SCRIPT = `
(() => {
  const passwordInput = document.querySelector('input[type="password"]');
  if (!passwordInput) return false;
  const rect = passwordInput.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
})()
`;

export const PROFILE_DOM_SELECTORS = {
  profileRoot: {
    field: 'profileRoot',
    description: 'Profile modal container',
    selectors: ['#modal-as-screen', '#modal-profile'],
  },
  displayName: {
    field: 'displayName',
    description: 'Driver display name in profile billboard',
    selectors: [
      '#modal-as-screen .chakra-screen-billboard h2.chakra-heading',
      '#modal-as-screen .chakra-stack.css-1nq5ir > h2.chakra-heading',
      '#modal-as-screen h2.chakra-heading',
    ],
  },
  memberSince: {
    field: 'memberSince',
    description: 'Member tenure (years) in profile billboard',
    selectors: [
      '#modal-as-screen .chakra-screen-billboard span[aria-label*="Years" i]',
      '#modal-as-screen span.css-jfboti[aria-label*="Years" i]',
      '#modal-as-screen span[aria-label*="Years" i]',
    ],
  },
  country: {
    field: 'country',
    description: 'Country flair name in profile billboard',
    selectors: [
      '#modal-as-screen .chakra-screen-billboard span.chakra-text__flair-name',
      '#modal-as-screen .chakra-screen-billboard a.chakra-link span.chakra-text__flair-name',
      '#modal-as-screen .chakra-screen-billboard .css-6srhoh span.chakra-text__flair-name',
      '#modal-as-screen .chakra-screen-billboard a.chakra-link',
    ],
  },
  licensesPane: {
    field: 'licensesPane',
    description: 'Active Licenses tab content pane',
    selectors: [
      '[id="modal-profile modal-member-licenses"]',
      '[id*="member-licenses"]',
      '#modal-profile [class*="tab-pane"].active',
    ],
  },
  ovalSectionHeader: {
    field: 'ovalSectionHeader',
    description: 'Oval Racing category label within licenses pane',
    selectors: [
      '[id*="member-licenses"] p.chakra-text',
    ],
    matchText: /^Oval Racing$/i,
  },
  ovalLicenseClass: {
    field: 'licenses.oval.class',
    description: 'Oval license class within Oval Racing card',
    selectors: [
      '[id*="member-licenses"] p.chakra-text',
    ],
    matchText: /^Class (?:Pro|[A-Z])$/i,
    scope: 'ovalSection',
  },
  ovalSafetyRating: {
    field: 'licenses.oval.safetyRating',
    description: 'Oval safety rating value within Oval Racing card',
    selectors: ['[id*="member-licenses"] p.chakra-text'],
    matchText: /^\d\.\d{2}$/,
    scope: 'ovalSection',
  },
  ovalIrating: {
    field: 'licenses.oval.irating',
    description: 'Oval iRating within Oval Racing card',
    selectors: [
      '[id*="member-licenses"] p.chakra-text.css-xwl7qa',
      '[id*="member-licenses"] p.chakra-text',
    ],
    matchText: /^\d{3,5}$/,
    scope: 'ovalSection',
  },
  ovalMprSummary: {
    field: 'licenses.oval.classFallback',
    description: 'MPR chart oval summary line (fallback for class/SR)',
    selectors: ['#member-profile-mpr-chart p.chakra-text', 'p.chakra-text.css-1xwjfc3'],
    matchText: /^Oval:\s*Class/i,
  },
};

function normalizeLicenseClass(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const classMatch = raw.match(/^Class\s+(Pro|[A-Z])/i);
  const token = classMatch ? classMatch[1] : raw;

  const upper = token.toUpperCase();
  if (upper === 'ROOKIE' || upper === 'R') return 'R';
  if (upper === 'PRO') return 'Pro';
  if (/^[RDCBA]$/.test(upper)) return upper;
  return raw;
}

function normalizeSafetyRating(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/(\d\.\d{2})/);
  if (!match) return null;
  const num = Number.parseFloat(match[1]);
  if (!Number.isFinite(num) || num < 0 || num > 5) return null;
  return num.toFixed(2);
}

function normalizeIrating(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{3,5})$/);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  if (!Number.isFinite(num) || num < 0 || num > 99_999) return null;
  return num;
}

export const EXTRACT_PROFILE_DOM_SCRIPT = `
(() => {
  const selectorCatalog = ${JSON.stringify(PROFILE_DOM_SELECTORS)};

  function cleanText(value) {
    return String(value ?? '').replace(/\\s+/g, ' ').trim();
  }

  function queryFirst(selectors) {
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          return { element, selector };
        }
      } catch (_err) {
        // Invalid selector — try next.
      }
    }
    return { element: null, selector: null, tried: selectors };
  }

  function queryAll(selectors) {
    for (const selector of selectors) {
      try {
        const elements = [...document.querySelectorAll(selector)];
        if (elements.length) {
          return { elements, selector };
        }
      } catch (_err) {
        // Invalid selector — try next.
      }
    }
    return { elements: [], selector: null, tried: selectors };
  }

  function normalizeCategoryLabel(headerText) {
    return cleanText(headerText).replace(/\\s+Racing$/i, '').trim();
  }

  function isLicenseCategoryHeader(text) {
    const cleaned = cleanText(text);
    if (!cleaned || /^Racing$/i.test(cleaned)) return false;
    return /\\s+Racing$/i.test(cleaned) || /Retired/i.test(cleaned);
  }

  function extractFromLicenseSection(section) {
    if (!section) {
      return { license_class: null, safety_rating: null, irating: null };
    }

    const texts = [...section.querySelectorAll('p.chakra-text')].map((el) => cleanText(el.textContent));
    const licenseClass = texts.find((text) => /^Class (?:Pro|[A-Z])$/i.test(text)) || null;
    const safetyRating = texts.find((text) => /^\\d\\.\\d{2}$/.test(text)) || null;
    const iratingText = texts.find((text) => /^\\d{3,5}$/.test(text) && !/ttRating/i.test(text));
    return {
      license_class: licenseClass,
      safety_rating: safetyRating,
      irating: iratingText ? Number.parseInt(iratingText, 10) : null,
    };
  }

  function extractAllLicenseCategories(pane) {
    const root = pane || document;
    const headers = [...root.querySelectorAll('p.chakra-text')].filter((el) =>
      isLicenseCategoryHeader(el.textContent)
    );

    return headers.map((header) => {
      const section = header.closest('.chakra-stack') || header.parentElement;
      const category = normalizeCategoryLabel(header.textContent);
      const values = extractFromLicenseSection(section);
      return {
        category,
        license_class: values.license_class,
        safety_rating: values.safety_rating,
        irating: values.irating,
      };
    });
  }

  function findOvalSection(pane) {
    const root = pane || document;
    const headers = [...root.querySelectorAll('p.chakra-text')].filter((el) =>
      /^Oval Racing$/i.test(cleanText(el.textContent))
    );
    if (!headers.length) {
      return null;
    }
    return headers[0].closest('.chakra-stack') || headers[0].parentElement;
  }

  function extractFromOvalSection(section) {
    const values = extractFromLicenseSection(section);
    return {
      class: values.license_class,
      safetyRating: values.safety_rating,
      irating: values.irating,
      selectors: {
        sectionRoot: {
          selector: 'p.chakra-text:text("Oval Racing") → closest(.chakra-stack)',
        },
      },
    };
  }

  function extractMprFallback() {
    const lines = [...document.querySelectorAll('#member-profile-mpr-chart p.chakra-text, p.chakra-text.css-1xwjfc3')];
    const ovalLine = lines.find((el) => /^Oval:\\s*Class/i.test(cleanText(el.textContent)));
    if (!ovalLine) {
      return { class: null, safetyRating: null, selector: null };
    }

    const classMatch = cleanText(ovalLine.textContent).match(/Class\\s+(Pro|[A-Z])/i);
    const container = ovalLine.closest('.card, div') || ovalLine.parentElement;
    const srLine = container
      ? [...container.querySelectorAll('small, p, span')].find((el) =>
          /SR:\\s*\\d\\.\\d{2}/i.test(cleanText(el.textContent))
        )
      : null;
    const srMatch = srLine ? cleanText(srLine.textContent).match(/(\\d\\.\\d{2})/) : null;

    return {
      class: classMatch ? 'Class ' + classMatch[1] : null,
      safetyRating: srMatch ? srMatch[1] : null,
      selector: ovalLine
        ? '#member-profile-mpr-chart p.chakra-text (Oval: Class …)'
        : null,
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

  const profileRootHit = queryFirst(selectorCatalog.profileRoot.selectors);
  if (!profileRootHit.element) {
    recordFailure('profileRoot', selectorCatalog.profileRoot.selectors, 'Profile root not found');
  } else {
    recordSuccess('profileRoot', profileRootHit.selector, true);
  }

  let displayName = null;
  const displayNameHit = queryFirst(selectorCatalog.displayName.selectors);
  if (displayNameHit.element) {
    displayName = cleanText(displayNameHit.element.textContent);
    recordSuccess('displayName', displayNameHit.selector, displayName);
  } else {
    recordFailure('displayName', selectorCatalog.displayName.selectors, 'Display name element not found');
  }

  let memberSince = null;
  const memberSinceHit = queryFirst(selectorCatalog.memberSince.selectors);
  if (memberSinceHit.element) {
    memberSince =
      memberSinceHit.element.getAttribute('aria-label') ||
      cleanText(memberSinceHit.element.textContent);
    recordSuccess('memberSince', memberSinceHit.selector, memberSince);
  } else {
    recordFailure('memberSince', selectorCatalog.memberSince.selectors, 'Member since element not found');
  }

  let country = null;
  const countryHit = queryFirst(selectorCatalog.country.selectors);
  if (countryHit.element) {
    country = cleanText(countryHit.element.textContent);
    recordSuccess('country', countryHit.selector, country);
  } else {
    recordFailure('country', selectorCatalog.country.selectors, 'Country element not found');
  }

  const licensesPaneHit = queryFirst(selectorCatalog.licensesPane.selectors);
  const licensesPane = licensesPaneHit.element;
  if (!licensesPane) {
    recordFailure('licensesPane', selectorCatalog.licensesPane.selectors, 'Licenses pane not found');
  } else {
    recordSuccess('licensesPane', licensesPaneHit.selector, true);
  }

  const allLicenses = licensesPane ? extractAllLicenseCategories(licensesPane) : [];
  if (!allLicenses.length) {
    recordFailure('licenses.categories', selectorCatalog.licensesPane.selectors, 'No license categories found');
  } else {
    recordSuccess('licenses.categories', 'p.chakra-text:Racing|Retired', allLicenses.length);
    for (const entry of allLicenses) {
      discovered['licenses.' + entry.category] = {
        selector: 'p.chakra-text section card',
        value: entry,
      };
    }
  }

  const ovalSection = findOvalSection(licensesPane);
  if (!ovalSection) {
    recordFailure('ovalSectionHeader', selectorCatalog.ovalSectionHeader.selectors, 'Oval Racing section not found');
  } else {
    recordSuccess('ovalSectionHeader', 'p.chakra-text:text("Oval Racing")', 'Oval Racing');
  }

  const ovalFromList = allLicenses.find((entry) => /^Oval$/i.test(entry.category)) || null;
  const ovalDom = ovalFromList
    ? {
        class: ovalFromList.license_class,
        safetyRating: ovalFromList.safety_rating,
        irating: ovalFromList.irating,
        selectors: {},
      }
    : extractFromOvalSection(ovalSection);

  if (!ovalDom.class) {
    recordFailure('licenses.oval.class', selectorCatalog.ovalLicenseClass.selectors, 'Oval class not found in section');
  } else {
    recordSuccess('licenses.oval.class', ovalDom.selectors.class?.selector || 'ovalSection', ovalDom.class);
  }
  if (!ovalDom.safetyRating) {
    recordFailure(
      'licenses.oval.safetyRating',
      selectorCatalog.ovalSafetyRating.selectors,
      'Oval safety rating not found in section'
    );
  } else {
    recordSuccess(
      'licenses.oval.safetyRating',
      ovalDom.selectors.safetyRating?.selector || 'ovalSection',
      ovalDom.safetyRating
    );
  }
  if (ovalDom.irating == null) {
    recordFailure('licenses.oval.irating', selectorCatalog.ovalIrating.selectors, 'Oval iRating not found in section');
  } else {
    recordSuccess(
      'licenses.oval.irating',
      ovalDom.selectors.irating?.selector || 'ovalSection',
      ovalDom.irating
    );
  }

  const mprFallback = extractMprFallback();
  if (mprFallback.selector) {
    discovered['licenses.oval.mprFallback'] = {
      selector: mprFallback.selector,
      value: mprFallback,
    };
  }

  const data = {
    displayName,
    country,
    memberSince,
    licenses: {
      categories: allLicenses,
      oval: {
        class: ovalDom.class,
        safetyRating: ovalDom.safetyRating,
        irating: ovalDom.irating,
      },
    },
  };

  return {
    data,
    discovered,
    failures,
    selectorCatalog: Object.fromEntries(
      Object.entries(selectorCatalog).map(([key, entry]) => [
        key,
        {
          field: entry.field,
          description: entry.description,
          selectors: entry.selectors,
        },
      ])
    ),
    rawText: document.body?.innerText?.trim() || '',
  };
})()
`;

export function mergeProfileWithTextFallbacks(domResult, textParsers = {}) {
  const {
    parseDisplayName,
    parseOvalLicenseClass,
    parseOvalSafetyRating,
    parseOvalIrating,
    extractOvalSection,
  } = textParsers;

  const rawText = domResult?.rawText || '';
  const ovalSection = extractOvalSection ? extractOvalSection(rawText) : rawText;
  const data = {
    displayName: domResult?.data?.displayName ?? null,
    country: domResult?.data?.country ?? null,
    memberSince: domResult?.data?.memberSince ?? null,
    licenses: {
      categories: domResult?.data?.licenses?.categories ?? [],
      oval: {
        class: domResult?.data?.licenses?.oval?.class ?? null,
        safetyRating: domResult?.data?.licenses?.oval?.safetyRating ?? null,
        irating: domResult?.data?.licenses?.oval?.irating ?? null,
      },
    },
  };

  const fallbackUsed = [];
  const failures = [...(domResult?.failures || [])];

  const mprFallback = domResult?.discovered?.['licenses.oval.mprFallback']?.value;

  if (!data.displayName && parseDisplayName) {
    data.displayName = parseDisplayName(rawText);
    if (data.displayName) fallbackUsed.push('displayName:text');
  }

  if (!data.country && rawText) {
    const countryMatch = rawText.match(
      /\n([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)*)\nLicenses\n/i
    );
    if (countryMatch) {
      data.country = countryMatch[1].trim();
      fallbackUsed.push('country:text');
    }
  }

  if (!data.memberSince && rawText) {
    const yearsMatch = rawText.match(/\b(\d+\s+Years?)\b/i);
    if (yearsMatch) {
      data.memberSince = yearsMatch[1];
      fallbackUsed.push('memberSince:text');
    }
  }

  if (!data.licenses.oval.class) {
    const fromMpr = mprFallback?.class;
    const fromText = parseOvalLicenseClass ? parseOvalLicenseClass(ovalSection || rawText) : null;
    const merged = fromMpr || (fromText ? (fromText === 'Pro' ? 'Class Pro' : 'Class ' + fromText) : null);
    if (merged) {
      data.licenses.oval.class = merged;
      fallbackUsed.push('licenses.oval.class:' + (fromMpr ? 'mpr' : 'text'));
    }
  }

  if (!data.licenses.oval.safetyRating) {
    const fromMpr = mprFallback?.safetyRating;
    const fromText = parseOvalSafetyRating ? parseOvalSafetyRating(ovalSection || rawText) : null;
    const merged = fromMpr || fromText;
    if (merged) {
      data.licenses.oval.safetyRating = merged;
      fallbackUsed.push('licenses.oval.safetyRating:' + (fromMpr ? 'mpr' : 'text'));
    }
  }

  if (data.licenses.oval.irating == null && parseOvalIrating) {
    const fromText = parseOvalIrating(ovalSection || rawText);
    if (fromText != null) {
      data.licenses.oval.irating = fromText;
      fallbackUsed.push('licenses.oval.irating:text');
    }
  }

  return {
    data,
    discovered: domResult?.discovered || {},
    failures,
    fallbackUsed,
    selectorCatalog: domResult?.selectorCatalog || {},
    rawText,
  };
}

export function getMissingRequiredProfileFields(profileData) {
  const missing = [];

  if (!String(profileData?.displayName ?? '').trim()) {
    missing.push('displayName');
  }
  if (!String(profileData?.country ?? '').trim()) {
    missing.push('country');
  }
  if (!String(profileData?.memberSince ?? '').trim()) {
    missing.push('memberSince');
  }
  if (!String(profileData?.licenses?.oval?.class ?? '').trim()) {
    missing.push('oval.class');
  }
  if (!String(profileData?.licenses?.oval?.safetyRating ?? '').trim()) {
    missing.push('oval.safetyRating');
  }
  if (profileData?.licenses?.oval?.irating == null) {
    missing.push('oval.irating');
  }

  return missing;
}

export function logMissingRequiredFields(logger, missing) {
  const log = typeof logger === 'function' ? logger : () => {};
  log('Missing fields:');
  if (!missing?.length) {
    log('(none)');
    return;
  }
  for (const field of missing) {
    log(`- ${field}`);
  }
}

export function evaluateProfileCompletion(profileData) {
  const missing = getMissingRequiredProfileFields(profileData);
  const success = missing.length === 0;

  return {
    scrape_status: success ? 'completed' : 'needs_manual_review',
    scrape_error: success ? null : `Missing fields: ${missing.join(', ')}`,
    missingFields: missing,
    profileComplete: success,
  };
}

function normalizeLicenseCategoryName(value) {
  return String(value ?? '')
    .replace(/\s+Racing$/i, '')
    .trim();
}

export function buildLicensesJson(profileData) {
  const categories = Array.isArray(profileData?.licenses?.categories)
    ? profileData.licenses.categories
        .map((entry) => ({
          category: normalizeLicenseCategoryName(entry.category),
          license_class: normalizeLicenseClass(entry.license_class || entry.class),
          safety_rating: normalizeSafetyRating(entry.safety_rating || entry.safetyRating),
          irating: normalizeIrating(entry.irating),
        }))
        .filter((entry) => entry.category && !/^Racing$/i.test(entry.category))
    : [];

  if (categories.length) {
    return { categories };
  }

  const oval = profileData?.licenses?.oval;
  if (!oval?.class && oval?.irating == null) {
    return { categories: [] };
  }

  return {
    categories: [
      {
        category: 'Oval',
        license_class: normalizeLicenseClass(oval.class),
        safety_rating: normalizeSafetyRating(oval.safetyRating),
        irating: normalizeIrating(oval.irating),
      },
    ],
  };
}

export function profileDomToSnapshotFields(merged) {
  const displayName = merged.data.displayName || null;
  const ovalLicenseClass = normalizeLicenseClass(merged.data.licenses?.oval?.class);
  const ovalSafetyRating = normalizeSafetyRating(merged.data.licenses?.oval?.safetyRating);
  const ovalIrating = normalizeIrating(merged.data.licenses?.oval?.irating);
  const completion = evaluateProfileCompletion(merged.data);
  const licensesJson = buildLicensesJson(merged.data);

  return {
    ...completion,
    display_name: displayName,
    oval_license_class: ovalLicenseClass,
    oval_safety_rating: ovalSafetyRating,
    oval_irating: ovalIrating,
    licenses_json: licensesJson,
    profileJson: merged.data,
    discoveredSelectors: merged.discovered,
    selectorFailures: merged.failures,
    textFallbacksUsed: merged.fallbackUsed,
    selectorCatalog: merged.selectorCatalog,
  };
}

export function formatProfileCompletionLabel(parsed) {
  if (parsed?.scrape_status === 'completed' || parsed?.profileComplete) {
    return 'Profile Complete ✔';
  }
  return `Scrape Status: ${parsed?.scrape_status ?? 'unknown'}`;
}

export function logSelectorReport(logger, merged) {
  const log = typeof logger === 'function' ? logger : () => {};

  log('DOM selector catalog:');
  for (const [key, entry] of Object.entries(merged.selectorCatalog || {})) {
    log(`  ${key}: ${entry.selectors.join(' | ')}`);
  }

  log('DOM selectors matched:');
  for (const [field, hit] of Object.entries(merged.discovered || {})) {
    log(`  ${field}: ${hit.selector} → ${JSON.stringify(hit.value)}`);
  }

  for (const failure of merged.failures || []) {
    log(`DOM selector miss [${failure.field}]: ${failure.reason}`);
    log(`  tried: ${(failure.selectors || []).join(' | ')}`);
  }

  for (const field of merged.fallbackUsed || []) {
    log(`Text fallback used: ${field}`);
  }
}
