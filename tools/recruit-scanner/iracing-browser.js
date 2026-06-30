import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_PROFILE_DIR = path.join(__dirname, 'browser-profile');
const PROFILE_BASE_URL =
  'https://members-ng.iracing.com/web/racing/home/dashboard?cust_id={CUSTOMER_ID}&tab=licenses';
const NAVIGATION_TIMEOUT_MS = 60_000;
const PAGE_SETTLE_MS = 2_500;

let browserContext = null;

function isHeadless() {
  return process.env.HEADLESS === 'true';
}

function buildProfileUrl(customerId) {
  const id = String(customerId ?? '').trim();
  return PROFILE_BASE_URL.replace('{CUSTOMER_ID}', encodeURIComponent(id));
}

function urlLooksLikeLogin(url) {
  const lower = String(url ?? '').toLowerCase();
  return (
    lower.includes('/login') ||
    lower.includes('/signin') ||
    lower.includes('/sign-in') ||
    lower.includes('/auth/') ||
    lower.includes('login.iracing.com') ||
    lower.includes('oauth') ||
    lower.includes('openid')
  );
}

async function pageLooksLikeLogin(page) {
  if (urlLooksLikeLogin(page.url())) {
    return true;
  }

  const passwordInput = page.locator('input[type="password"]').first();
  const hasPasswordField = await passwordInput
    .isVisible({ timeout: 2_000 })
    .catch(() => false);

  if (!hasPasswordField) {
    return false;
  }

  const signInControl = page
    .locator('button, input[type="submit"], a')
    .filter({ hasText: /sign in|log in|login/i })
    .first();

  return signInControl.isVisible({ timeout: 1_000 }).catch(() => true);
}

async function pageLooksLikeProfile(page, customerId) {
  const url = page.url();
  const id = String(customerId ?? '').trim();

  if (!url.includes('members-ng.iracing.com')) {
    return false;
  }

  if (!url.includes('dashboard')) {
    return false;
  }

  if (id && url.includes(`cust_id=${encodeURIComponent(id)}`)) {
    return true;
  }

  if (url.includes('tab=licenses')) {
    return true;
  }

  const licensesHint = page.locator('text=/licenses/i').first();
  return licensesHint.isVisible({ timeout: 3_000 }).catch(() => false);
}

export async function initBrowser() {
  if (browserContext) {
    return browserContext;
  }

  browserContext = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    headless: isHeadless(),
    viewport: null,
  });

  if (isHeadless()) {
    console.log('Browser started (headless mode)');
  } else {
    console.log('Browser started (headed — log into iRacing manually if prompted)');
  }

  return browserContext;
}

export async function checkProfileAccess(customerId) {
  const context = await initBrowser();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const profileUrl = buildProfileUrl(customerId);
    console.log('Opening iRacing profile page...');

    await page.goto(profileUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    await page.waitForTimeout(PAGE_SETTLE_MS);

    if (await pageLooksLikeLogin(page)) {
      return {
        outcome: 'needs_login',
        message: 'iRacing login page detected.',
      };
    }

    if (await pageLooksLikeProfile(page, customerId)) {
      return {
        outcome: 'completed',
        message: 'Profile page loaded successfully. Scraping not implemented yet.',
      };
    }

    return {
      outcome: 'failed',
      message: 'Profile page did not load — could not confirm dashboard access.',
    };
  } catch (err) {
    return {
      outcome: 'failed',
      message: err instanceof Error ? err.message : 'Unexpected error opening profile page.',
    };
  }
}

export async function closeBrowser() {
  if (!browserContext) {
    return;
  }

  await browserContext.close();
  browserContext = null;
}
