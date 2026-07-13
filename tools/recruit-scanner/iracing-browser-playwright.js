import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { logMessage } from './logger.js';
import {
  EXTRACT_PROFILE_DOM_SCRIPT,
  EXTRACT_STATS_DOM_SCRIPT,
  IRACING_LOGIN_URL,
  MEMBERS_HOME_URL,
  NAVIGATION_TIMEOUT_MS,
  PAGE_SETTLE_MS,
  TAB_RENDER_TIMEOUT_MS,
  urlLooksLikeLogin,
} from './iracing-urls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getBrowserProfileDir() {
  if (process.env.BP_SCANNER_USER_DATA) {
    return path.join(process.env.BP_SCANNER_USER_DATA, 'browser-profile');
  }

  return path.join(__dirname, 'browser-profile');
}

const DEFAULT_CHROME_EXECUTABLES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

let browserContext = null;

function isHeadless() {
  return process.env.HEADLESS === 'true';
}

export function resolveChromeExecutable() {
  const configured = String(process.env.CHROME_EXECUTABLE_PATH ?? '').trim();
  if (configured) {
    return configured;
  }

  for (const candidate of DEFAULT_CHROME_EXECUTABLES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Google Chrome not found. Install Chrome or set CHROME_EXECUTABLE_PATH in .env.'
  );
}

async function getActivePage() {
  if (!browserContext) {
    await createPlaywrightBrowserAdapter().init();
  }
  return browserContext.pages()[0] ?? (await browserContext.newPage());
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

function profileHasStoredSession() {
  const profileDir = getBrowserProfileDir();

  if (!fs.existsSync(profileDir)) {
    return false;
  }

  const cookiePaths = [
    path.join(profileDir, 'Default', 'Network', 'Cookies'),
    path.join(profileDir, 'Default', 'Cookies'),
  ];

  return cookiePaths.some((cookiePath) => fs.existsSync(cookiePath));
}

async function waitForTabContent(page, tabName) {
  const hints = [
    page.getByText(new RegExp(`^${tabName}$`, 'i')).first(),
    page.getByText(new RegExp(tabName, 'i')).first(),
    page.locator('[class*="license" i]').first(),
    page.locator('[class*="stat" i]').first(),
  ];

  for (const locator of hints) {
    const visible = await locator.isVisible({ timeout: TAB_RENDER_TIMEOUT_MS }).catch(() => false);
    if (visible) {
      await page.waitForTimeout(PAGE_SETTLE_MS);
      return true;
    }
  }

  await page.waitForTimeout(PAGE_SETTLE_MS);
  return false;
}

export function createPlaywrightBrowserAdapter() {
  return {
    mode: 'playwright',

    async init() {
      if (browserContext) {
        return;
      }

      const executablePath = resolveChromeExecutable();
      if (!fs.existsSync(executablePath)) {
        throw new Error(`Chrome executable not found: ${executablePath}`);
      }

      const profileDir = getBrowserProfileDir();
      fs.mkdirSync(profileDir, { recursive: true });

      browserContext = await chromium.launchPersistentContext(profileDir, {
        executablePath,
        headless: isHeadless(),
        viewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
      });

      if (isHeadless()) {
        logMessage('Browser started using scanner profile (headless mode)');
      } else {
        logMessage('Browser started using external scanner profile (browser-profile/)');
      }
    },

    async close() {
      if (!browserContext) {
        return;
      }

      await browserContext.close();
      browserContext = null;
    },

    async clearSession() {
      await this.close();
      fs.rmSync(getBrowserProfileDir(), { recursive: true, force: true });
      logMessage('Saved iRacing session cleared (browser-profile/).');
    },

    async navigate(url) {
      const page = await getActivePage();
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      await page.waitForTimeout(PAGE_SETTLE_MS);
    },

    async getCurrentUrl() {
      const page = await getActivePage();
      return page.url();
    },

    async looksLikeLogin() {
      const page = await getActivePage();
      return pageLooksLikeLogin(page);
    },

    async waitForTabContent(tabLabel) {
      const page = await getActivePage();
      const tabName = tabLabel === 'license' ? 'licenses' : 'stats';
      await waitForTabContent(page, tabName);
    },

    async captureVisibleText() {
      const page = await getActivePage();
      const candidates = [
        page.locator('main').first(),
        page.locator('[role="main"]').first(),
        page.locator('#root').first(),
        page.locator('body').first(),
      ];

      for (const locator of candidates) {
        const text = await locator.innerText({ timeout: 5_000 }).catch(() => '');
        if (String(text).trim().length > 40) {
          return String(text).trim();
        }
      }

      return String(await page.locator('body').innerText().catch(() => '')).trim();
    },

    async extractProfileDom() {
      const page = await getActivePage();
      return page.evaluate(EXTRACT_PROFILE_DOM_SCRIPT);
    },

    async extractStatsDom() {
      const page = await getActivePage();
      return page.evaluate(EXTRACT_STATS_DOM_SCRIPT);
    },

    async hasStoredSession() {
      return profileHasStoredSession();
    },

    getSessionLabel() {
      return 'browser-profile/';
    },

    async openLoginPage() {
      await this.navigate(IRACING_LOGIN_URL);
    },

    async checkLoggedIn() {
      await this.navigate(MEMBERS_HOME_URL);
      return !(await this.looksLikeLogin());
    },

    async sleep(ms) {
      const page = await getActivePage();
      await page.waitForTimeout(ms);
    },
  };
}
