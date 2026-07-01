import { getBrowserAdapter } from './browser-adapter.js';
import { logError, logMessage } from './logger.js';
import {
  buildLicenseProfileUrl,
  buildStatsProfileUrl,
  IRACING_LOGIN_URL,
  LOGIN_POLL_MS,
  verifyProfilePageUrl,
} from './iracing-urls.js';

export {
  buildLicenseProfileUrl,
  buildStatsProfileUrl,
  verifyProfilePageUrl,
} from './iracing-urls.js';

export {
  resolveChromeExecutable,
  getBrowserProfileDir,
} from './iracing-browser-playwright.js';

async function navigateProfileTab(customerId, profileUrl, tabLabel) {
  const adapter = getBrowserAdapter();
  const isStatsTab = tabLabel === 'stats';
  logMessage(`Opening ${tabLabel} page...`);

  await adapter.navigate(profileUrl);

  if (await adapter.looksLikeLogin()) {
    return {
      outcome: 'needs_login',
      message: 'iRacing login page detected.',
    };
  }

  const finalUrl = await adapter.getCurrentUrl();
  const urlCheck = verifyProfilePageUrl(finalUrl, customerId);
  if (!urlCheck.ok) {
    logError(`Wrong page: ${urlCheck.reason} (${finalUrl})`);
    return {
      outcome: 'wrong_page',
      message: urlCheck.reason,
      finalUrl,
    };
  }

  logMessage('Page loaded');
  await adapter.waitForTabContent(tabLabel);

  const domExtraction = isStatsTab
    ? await adapter.extractStatsDom?.()
    : await adapter.extractProfileDom?.();
  const rawText = domExtraction?.rawText || (await adapter.captureVisibleText());

  if (isStatsTab) {
    if (!rawText && !domExtraction?.data?.category) {
      return {
        outcome: 'failed',
        message: 'Stats tab loaded but career stats DOM could not be extracted.',
        finalUrl,
      };
    }
    logMessage('Stats DOM extracted');
  } else if (!rawText && !domExtraction?.data?.displayName) {
    return {
      outcome: 'failed',
      message: `${tabLabel} tab loaded but profile DOM could not be extracted.`,
      finalUrl,
    };
  } else {
    logMessage('Profile DOM extracted');
  }

  return {
    outcome: 'scraped',
    rawText,
    domExtraction,
    finalUrl,
    tab: isStatsTab ? 'stats' : 'license',
  };
}

export async function initBrowser() {
  await getBrowserAdapter().init();
}

export async function closeBrowser() {
  await getBrowserAdapter().close();
}

export async function clearBrowserProfile() {
  await getBrowserAdapter().clearSession();
}

export async function openIracingLoginPage() {
  logMessage('Opening iRacing login page...');
  await getBrowserAdapter().openLoginPage();
}

export async function isLoggedIn() {
  return getBrowserAdapter().checkLoggedIn();
}

export async function waitForIracingLogin({ label = 'iRacing login' } = {}) {
  const adapter = getBrowserAdapter();
  logMessage(`Waiting for ${label} — complete sign-in in the browser window.`);

  while (true) {
    if (!(await adapter.looksLikeLogin())) {
      const loggedIn = await adapter.checkLoggedIn();
      if (loggedIn) {
        logMessage('iRacing session ready.');
        return true;
      }
    }

    await adapter.sleep(LOGIN_POLL_MS);
  }
}

export async function prepareScannerSession({ blocking = true } = {}) {
  const adapter = getBrowserAdapter();
  await initBrowser();

  const hasStoredSession = await adapter.hasStoredSession();
  const sessionLabel = adapter.getSessionLabel();

  if (!hasStoredSession) {
    logMessage(`First run — log into iRacing to save a session in ${sessionLabel}`);
    await openIracingLoginPage();
    if (blocking) {
      await waitForIracingLogin({ label: 'first-run iRacing login' });
    }
    return;
  }

  const loggedIn = await adapter.checkLoggedIn();
  if (loggedIn) {
    logMessage(`Reusing saved iRacing session from ${sessionLabel}`);
    return;
  }

  logMessage('Saved session expired — opening iRacing login page.');
  await openIracingLoginPage();
  if (blocking) {
    await waitForIracingLogin({ label: 'iRacing re-login' });
  }
}

export async function watchForLoginAndRetry(callback) {
  const adapter = getBrowserAdapter();

  while (true) {
    await adapter.sleep(LOGIN_POLL_MS);

    if (await adapter.looksLikeLogin()) {
      continue;
    }

    const loggedIn = await adapter.checkLoggedIn();
    if (!loggedIn) {
      continue;
    }

    logMessage('Login detected — continuing scanner.');
    await callback();
    return;
  }
}

export async function scrapeProfileLicenses(customerId) {
  try {
    return await navigateProfileTab(
      customerId,
      buildLicenseProfileUrl(customerId),
      'license'
    );
  } catch (err) {
    return {
      outcome: 'failed',
      message: err instanceof Error ? err.message : 'Unexpected error scraping license page.',
    };
  }
}

export async function scrapeProfileStats(customerId) {
  try {
    return await navigateProfileTab(
      customerId,
      buildStatsProfileUrl(customerId),
      'stats'
    );
  } catch (err) {
    return {
      outcome: 'failed',
      message: err instanceof Error ? err.message : 'Unexpected error scraping stats page.',
    };
  }
}

export async function scrapeCustomerProfile(customerId) {
  const licenseResult = await scrapeProfileLicenses(customerId);
  if (licenseResult.outcome !== 'scraped') {
    return {
      license: licenseResult,
      stats: null,
    };
  }

  const statsResult = await scrapeProfileStats(customerId);
  return {
    license: licenseResult,
    stats: statsResult,
  };
}

export { IRACING_LOGIN_URL };
