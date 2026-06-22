// BP Fantasy — public marketing landing page (frontend only).
// Requires fantasy-branding-assets.js loaded first.
// Shared hero placement helpers (window.BPFantasyHeroPlacement) are safe on admin pages.

function getFantasyBrandingAssets() {
  return window.BPFantasyBrandingAssets || null;
}

const FANTASY_HERO_DESIGN_WIDTH = 1920;
const FANTASY_HERO_BANNER_RATIO = { w: 1920, h: 820 };

const FANTASY_LOGO_PLACEMENT_DEFAULTS = {
  topPercent: 21,
  widthPercent: 32,
  maxWidthPx: 560,
};

function clampFantasyLogoPlacement(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function logoMaxWidthPercent(maxWidthPx) {
  const px = Number(maxWidthPx);
  if (!Number.isFinite(px)) return (FANTASY_LOGO_PLACEMENT_DEFAULTS.maxWidthPx / FANTASY_HERO_DESIGN_WIDTH) * 100;
  return (px / FANTASY_HERO_DESIGN_WIDTH) * 100;
}

function getFantasyHeroStage(banner) {
  return banner?.querySelector?.('.fantasy-hero-stage') || banner;
}

function resolveFantasyHeaderLogoPlacement(settings = {}) {
  return {
    topPercent: clampFantasyLogoPlacement(
      settings.fantasyHeaderLogoTopPercent,
      8,
      45,
      FANTASY_LOGO_PLACEMENT_DEFAULTS.topPercent,
    ),
    widthPercent: clampFantasyLogoPlacement(
      settings.fantasyHeaderLogoWidthVw,
      15,
      60,
      FANTASY_LOGO_PLACEMENT_DEFAULTS.widthPercent,
    ),
    maxWidthPx: clampFantasyLogoPlacement(
      settings.fantasyHeaderLogoMaxWidthPx,
      240,
      900,
      FANTASY_LOGO_PLACEMENT_DEFAULTS.maxWidthPx,
    ),
  };
}

function applyHeroLogoPlacementToBanner(banner, settings = {}) {
  const stage = getFantasyHeroStage(banner);
  if (!stage) return;

  const placement = resolveFantasyHeaderLogoPlacement(settings);
  stage.style.setProperty('--fantasy-hero-logo-top', `${placement.topPercent}%`);
  stage.style.setProperty('--fantasy-hero-logo-width', `${placement.widthPercent}%`);
  stage.style.setProperty('--fantasy-hero-logo-max-width', `${logoMaxWidthPercent(placement.maxWidthPx)}%`);
}

function clearHeroBannerImageStyles(img) {
  if (!img) return;

  img.style.removeProperty('width');
  img.style.removeProperty('height');
  img.style.removeProperty('max-width');
  img.style.removeProperty('min-width');
  img.style.removeProperty('transform');
  img.style.removeProperty('aspect-ratio');
}

window.BPFantasyHeroPlacement = {
  resolve: resolveFantasyHeaderLogoPlacement,
  applyToBanner: applyHeroLogoPlacementToBanner,
  clearHeroImageStyles: clearHeroBannerImageStyles,
  defaults: FANTASY_LOGO_PLACEMENT_DEFAULTS,
  designWidth: FANTASY_HERO_DESIGN_WIDTH,
  bannerRatio: FANTASY_HERO_BANNER_RATIO,
};

function isFantasyPublicLandingPage() {
  return Boolean(
    document.querySelector('main.fantasy-landing') &&
    document.getElementById('fantasyHeroImage'),
  );
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyHeroImage(settings = {}) {
  const img = document.getElementById('fantasyHeroImage');
  const branding = getFantasyBrandingAssets();
  if (!img || !branding) return;

  const clearStyles = () => clearHeroBannerImageStyles(img);
  if (img.complete) clearStyles();
  else img.addEventListener('load', clearStyles, { once: true });

  branding.applyImageFromCandidates(
    img,
    branding.resolveFantasyHeroBackgroundCandidates(settings),
    {
      onLoaded: clearStyles,
    },
  );
}

function applyHeaderLogo(settings = {}) {
  const logo = document.getElementById('fantasyHeaderLogo');
  const fallback = document.getElementById('fantasyLogoFallback');
  const branding = getFantasyBrandingAssets();
  if (!logo) return;
  if (!branding) {
    console.warn('BP Fantasy: fantasy-branding-assets.js must load before fantasy.js');
    if (fallback) fallback.hidden = false;
    return;
  }

  branding.applyImageFromCandidates(
    logo,
    branding.resolveFantasyHeaderLogoCandidates(settings),
    {
      onLoaded: () => {
        if (fallback) fallback.setAttribute('hidden', '');
      },
      onMissing: () => {
        console.warn('BP Fantasy: header logo not found after trying custom and default URLs.');
        if (fallback) fallback.removeAttribute('hidden');
      },
    },
  );
}

function applyHeroLogoPlacement(settings = {}) {
  applyHeroLogoPlacementToBanner(
    document.querySelector('main.fantasy-landing .fantasy-hero-banner'),
    settings,
  );
}

function applyLandingAssets(settings = {}) {
  if (!isFantasyPublicLandingPage()) return;
  applyHeroImage(settings);
  applyHeaderLogo(settings);
  applyHeroLogoPlacement(settings);
}

const SCORING_CATEGORIES = [
  { key: 'Finish Points', value: 'Points earned from where your driver finishes the race.' },
  { key: 'Place Differential', value: 'Bonus or penalty based on positions gained or lost.' },
  { key: 'Laps Completed', value: 'Credit for every lap your driver completes.' },
  { key: 'Laps Led', value: 'Extra points for leading laps during the race.' },
];

window.BPFantasyLanding = {
  init() {
    if (!isFantasyPublicLandingPage()) return;

    const root = document.querySelector('main.fantasy-landing');
    if (!root) return;

    this.renderScoringPreview(root);
    this.loadPageSettings(root);
    applyLandingAssets();
  },

  async loadPageSettings(root) {
    if (!root || !isFantasyPublicLandingPage()) return;

    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;

      const settings = await res.json();
      applyLandingAssets(settings);

      const navSeason = document.getElementById('seasonLabel');
      if (navSeason && settings.seasonName) {
        navSeason.textContent = String(settings.seasonName).trim().toUpperCase();
      }
    } catch {
      // Landing page works with static defaults when settings are unavailable.
    }
  },

  renderScoringPreview(root) {
    const list = root?.querySelector('#fantasyScoringList');
    if (!list) return;

    list.innerHTML = SCORING_CATEGORIES.map((item) => `
      <li>
        <span class="fantasy-scoring-k">${escapeHtml(item.key)}</span>
        <span class="fantasy-scoring-v">${escapeHtml(item.value)}</span>
      </li>
    `).join('');
  },
};

function initFantasyPublicLandingPage() {
  if (!isFantasyPublicLandingPage()) return;

  try {
    window.BPFantasyLanding?.init?.();
  } catch (err) {
    console.warn('BP Fantasy landing init failed:', err);
  }
}

function bootFantasyPublicLandingPage() {
  initFantasyPublicLandingPage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootFantasyPublicLandingPage);
} else {
  bootFantasyPublicLandingPage();
}
