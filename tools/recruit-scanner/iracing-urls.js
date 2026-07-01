import {
  CAPTURE_VISIBLE_TEXT_SCRIPT,
  DETECT_LOGIN_FORM_SCRIPT,
  EXTRACT_PROFILE_DOM_SCRIPT,
  PROFILE_DOM_SELECTORS,
} from './dom-profile-extractor.js';
import { EXTRACT_STATS_DOM_SCRIPT, STATS_DOM_SELECTORS } from './dom-stats-extractor.js';

export const IRACING_LOGIN_URL =
  process.env.IRACING_LOGIN_URL?.trim() ||
  'https://members.iracing.com/membersite/login.jsp';
export const LICENSE_PROFILE_URL =
  'https://members-ng.iracing.com/web/racing/profile?cust_id={CUSTOMER_ID}&tab=licenses';

export const STATS_PROFILE_URL =
  'https://members-ng.iracing.com/web/racing/profile?cust_id={CUSTOMER_ID}&tab=stats';

export const MEMBERS_HOME_URL = 'https://members-ng.iracing.com/web/racing/home';

export const NAVIGATION_TIMEOUT_MS = 60_000;
export const PAGE_SETTLE_MS = 2_500;
export const TAB_RENDER_TIMEOUT_MS = 30_000;
export const LOGIN_POLL_MS = 2_000;

export function buildLicenseProfileUrl(customerId) {
  const id = String(customerId ?? '').trim();
  return LICENSE_PROFILE_URL.replace('{CUSTOMER_ID}', encodeURIComponent(id));
}

export function buildStatsProfileUrl(customerId) {
  const id = String(customerId ?? '').trim();
  return STATS_PROFILE_URL.replace('{CUSTOMER_ID}', encodeURIComponent(id));
}

export function verifyProfilePageUrl(url, customerId) {
  const id = String(customerId ?? '').trim();
  const normalizedUrl = String(url ?? '');

  if (!normalizedUrl.includes('/web/racing/profile')) {
    return {
      ok: false,
      reason: 'Wrong page: expected /web/racing/profile.',
    };
  }

  if (!id || !normalizedUrl.includes(`cust_id=${encodeURIComponent(id)}`)) {
    return {
      ok: false,
      reason: `Wrong page: expected cust_id=${id}.`,
    };
  }

  return { ok: true };
}

export function urlLooksLikeLogin(url) {
  const lower = String(url ?? '').toLowerCase();
  return (
    lower.includes('/login') ||
    lower.includes('/signin') ||
    lower.includes('/sign-in') ||
    lower.includes('/auth/') ||
    lower.includes('login.iracing.com') ||
    lower.includes('membersite/login') ||
    lower.includes('oauth') ||
    lower.includes('openid')
  );
}

export {
  CAPTURE_VISIBLE_TEXT_SCRIPT,
  DETECT_LOGIN_FORM_SCRIPT,
  EXTRACT_PROFILE_DOM_SCRIPT,
  EXTRACT_STATS_DOM_SCRIPT,
  PROFILE_DOM_SELECTORS,
  STATS_DOM_SELECTORS,
};
