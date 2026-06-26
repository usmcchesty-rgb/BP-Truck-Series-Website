import {
  photoCacheVersion,
  stripPhotoUrlQuery,
  withPhotoCacheBust,
} from './_lib.js';

/** @typedef {'facebook'|'x'|'link'|'native'|'instagram'|'tiktok'} SharePlatformId */

export const SHARE_PLATFORM_DEFS = [
  {
    id: 'facebook',
    label: 'Facebook',
    tooltip: 'Share / Copy for Facebook',
    enabledKey: 'facebookEnabled',
    iconKey: 'facebookIcon',
    updatedKey: 'facebookIconUpdatedAt',
    defaultIcon: '/assets/social/facebook.svg',
    defaultEnabled: true,
    render: 'external',
  },
  {
    id: 'x',
    label: 'X',
    tooltip: 'Share to X',
    enabledKey: 'xEnabled',
    iconKey: 'xIcon',
    updatedKey: 'xIconUpdatedAt',
    defaultIcon: '/assets/social/x.svg',
    defaultEnabled: true,
    render: 'external',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    tooltip: 'Copy for Instagram',
    enabledKey: 'instagramEnabled',
    iconKey: 'instagramIcon',
    updatedKey: 'instagramIconUpdatedAt',
    defaultIcon: '/assets/social/instagram.svg',
    defaultEnabled: true,
    action: 'copy-instagram',
  },
  {
    id: 'link',
    label: 'Copy Link',
    tooltip: 'Copy Link',
    enabledKey: 'linkEnabled',
    iconKey: 'linkIcon',
    updatedKey: 'linkIconUpdatedAt',
    defaultIcon: '/assets/social/link.svg',
    defaultEnabled: true,
    action: 'copy',
  },
  {
    id: 'native',
    label: 'Native Share',
    tooltip: 'Share',
    enabledKey: 'shareEnabled',
    iconKey: 'shareIcon',
    updatedKey: 'shareIconUpdatedAt',
    defaultIcon: '',
    defaultEnabled: false,
    action: 'native',
    textFallback: 'Share',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    tooltip: 'Copy for TikTok',
    enabledKey: 'tiktokEnabled',
    iconKey: 'tiktokIcon',
    updatedKey: 'tiktokIconUpdatedAt',
    defaultIcon: '',
    defaultEnabled: false,
    action: 'copy-tiktok',
    textFallback: 'TikTok',
  },
];

export const DEFAULT_SHARE_ORDER = SHARE_PLATFORM_DEFS.map((p) => p.id);

export const SOCIAL_SHARE_DEFAULTS = {
  facebookEnabled: true,
  facebookIcon: '/assets/social/facebook.svg',
  facebookIconUpdatedAt: null,
  xEnabled: true,
  xIcon: '/assets/social/x.svg',
  xIconUpdatedAt: null,
  instagramEnabled: true,
  instagramIcon: '/assets/social/instagram.svg',
  instagramIconUpdatedAt: null,
  linkEnabled: true,
  linkIcon: '/assets/social/link.svg',
  linkIconUpdatedAt: null,
  shareEnabled: false,
  shareIcon: '',
  shareIconUpdatedAt: null,
  tiktokEnabled: false,
  tiktokIcon: '',
  tiktokIconUpdatedAt: null,
  socialShareOrder: JSON.stringify(DEFAULT_SHARE_ORDER),
  socialShareBoxSizePx: 48,
  socialShareIconMaxPx: 40,
};

const PLATFORM_BY_ID = Object.fromEntries(SHARE_PLATFORM_DEFS.map((p) => [p.id, p]));

export function getSharePlatformDef(platformId) {
  return PLATFORM_BY_ID[String(platformId || '').trim()] || null;
}

export function parseShareOrder(raw) {
  if (Array.isArray(raw)) {
    return normalizeShareOrder(raw);
  }
  const text = String(raw || '').trim();
  if (!text) return [...DEFAULT_SHARE_ORDER];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return normalizeShareOrder(parsed);
  } catch {
    /* ignore */
  }
  return [...DEFAULT_SHARE_ORDER];
}

function normalizeShareOrder(order) {
  const valid = new Set(SHARE_PLATFORM_DEFS.map((p) => p.id));
  const seen = new Set();
  const result = [];
  for (const id of order) {
    const key = String(id || '').trim();
    if (!valid.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  for (const def of SHARE_PLATFORM_DEFS) {
    if (!seen.has(def.id)) result.push(def.id);
  }
  return result;
}

function resolveEnabled(settings, def) {
  const value = settings?.[def.enabledKey];
  if (value === undefined || value === null) return def.defaultEnabled;
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeSocialIconPath(pathOrUrl) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return '';
  return raw
    .replace(/\/assets\/social\/X\.svg/gi, '/assets/social/x.svg')
    .replace(/\/assets\/social\/Link\.svg/gi, '/assets/social/link.svg')
    .replace(/\/assets\/social\/Facebook\.svg/gi, '/assets/social/facebook.svg')
    .replace(/\/assets\/social\/Instagram\.svg/gi, '/assets/social/instagram.svg');
}

export function resolveShareIconUrl(settings, def) {
  const stored = normalizeSocialIconPath(stripPhotoUrlQuery(settings?.[def.iconKey] || ''));
  const raw = stored || normalizeSocialIconPath(def.defaultIcon || '');
  if (!raw) return '';
  const version = photoCacheVersion(settings?.[def.updatedKey]);
  if (!stored || !version) return raw;
  return withPhotoCacheBust(raw, version);
}

export function buildPublicSocialShareConfig(settings = {}) {
  const merged = { ...SOCIAL_SHARE_DEFAULTS, ...settings };
  const order = parseShareOrder(merged.socialShareOrder);
  const boxSizePx = clampNumber(merged.socialShareBoxSizePx, 36, 64, 48);
  const iconMaxPx = clampNumber(merged.socialShareIconMaxPx, 24, 56, 40);

  const platforms = order
    .map((id) => {
      const def = getSharePlatformDef(id);
      if (!def) return null;
      if (!resolveEnabled(merged, def)) return null;
      const icon = resolveShareIconUrl(merged, def);
      return {
        id: def.id,
        label: def.label,
        tooltip: def.tooltip,
        icon,
        action: def.action || null,
        render: def.render || null,
        textFallback: def.textFallback || def.label,
      };
    })
    .filter(Boolean);

  return {
    order,
    boxSizePx,
    iconMaxPx,
    platforms,
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function buildSocialShareSettingsPatch(body = {}) {
  const patch = {};
  for (const def of SHARE_PLATFORM_DEFS) {
    if (body[def.enabledKey] !== undefined) {
      patch[def.enabledKey] = Boolean(body[def.enabledKey]);
    }
    if (body[def.iconKey] !== undefined) {
      patch[def.iconKey] = stripPhotoUrlQuery(String(body[def.iconKey] || '').trim());
    }
    if (body[def.updatedKey] !== undefined) {
      patch[def.updatedKey] = body[def.updatedKey] || null;
    }
  }
  if (body.socialShareOrder !== undefined) {
    patch.socialShareOrder = JSON.stringify(parseShareOrder(body.socialShareOrder));
  }
  if (body.socialShareBoxSizePx !== undefined) {
    patch.socialShareBoxSizePx = clampNumber(body.socialShareBoxSizePx, 36, 64, 48);
  }
  if (body.socialShareIconMaxPx !== undefined) {
    patch.socialShareIconMaxPx = clampNumber(body.socialShareIconMaxPx, 24, 56, 40);
  }
  return patch;
}

export function storageFilenameForPlatform(platformId, ext = 'png') {
  const safe = String(platformId || '').trim().toLowerCase();
  const normalized = safe === 'native' ? 'share' : safe;
  return `social-icon-${normalized}.${ext.replace(/^\./, '')}`;
}
