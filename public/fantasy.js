// BP Fantasy — public marketing landing page (frontend only).
// Gameplay (lineups, salaries, standings) will live on separate pages later.

/** Default asset paths — swap via admin settings when backend wiring is added. */
const FANTASY_LANDING_ASSETS = {
  heroBackgroundUrl: '/assets/fantasy/hero-background.jpg',
  headerLogoUrl: '/assets/fantasy/fantasy-logo.png',
};

function stripPhotoUrlQuery(photoUrl) {
  const url = String(photoUrl || '').trim();
  if (!url) return '';
  return url.split('?')[0].split('#')[0];
}

function photoCacheVersion(updatedAt) {
  if (!updatedAt) return null;
  const ms = new Date(updatedAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function withPhotoCacheBust(photoUrl, version) {
  const clean = stripPhotoUrlQuery(photoUrl);
  if (!clean) return clean;
  if (version == null || version === '') return clean;
  return `${clean}?v=${encodeURIComponent(version)}`;
}

function resolveFantasyHeroBackgroundDisplayUrl(settings = {}) {
  const stored = stripPhotoUrlQuery(settings.fantasyHeroBackgroundUrl || '');
  const url = stored || FANTASY_LANDING_ASSETS.heroBackgroundUrl;
  const version = stored
    ? photoCacheVersion(settings.fantasyHeroBackgroundUpdatedAt) || Date.now()
    : null;
  return version ? withPhotoCacheBust(url, version) : url;
}

function resolveFantasyHeaderLogoDisplayUrl(settings = {}) {
  const stored = stripPhotoUrlQuery(settings.fantasyHeaderLogoUrl || '');
  const url = stored || FANTASY_LANDING_ASSETS.headerLogoUrl;
  const version = stored
    ? photoCacheVersion(settings.fantasyHeaderLogoUpdatedAt) || Date.now()
    : null;
  return version ? withPhotoCacheBust(url, version) : url;
}

const DEMO_FEATURED_DRIVERS = [
  { name: 'Mark Arthur', carNumber: '12', salary: 12500 },
  { name: 'Cody Gibson', carNumber: '7', salary: 11200 },
  { name: 'Mike Massengill', carNumber: '20', salary: 10800 },
  { name: 'Dalton Kilroe', carNumber: '41', salary: 9400 },
  { name: 'Larry Bell', carNumber: '43', salary: 8750 },
  { name: 'Michael Boone', carNumber: '15', salary: 8200 },
];

const SCORING_CATEGORIES = [
  { key: 'Finish Points', value: 'Points earned from where your driver finishes the race.' },
  { key: 'Place Differential', value: 'Bonus or penalty based on positions gained or lost.' },
  { key: 'Laps Completed', value: 'Credit for every lap your driver completes.' },
  { key: 'Laps Led', value: 'Extra points for leading laps during the race.' },
];

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSalary(value) {
  return `$${Number(value).toLocaleString('en-US')}`;
}

function applyHeroImage(url) {
  const img = document.getElementById('fantasyHeroImage');
  if (!img || !url) return;
  img.src = url;
}

function applyHeaderLogo(url) {
  const logo = document.getElementById('fantasyHeaderLogo');
  const fallback = document.getElementById('fantasyLogoFallback');
  if (!logo || !url) return;

  const probe = new Image();
  probe.onload = () => {
    logo.src = url;
    logo.hidden = false;
    if (fallback) fallback.hidden = true;
  };
  probe.onerror = () => {
    logo.hidden = true;
    if (fallback) fallback.hidden = false;
  };
  probe.src = url;
}

const FANTASY_LOGO_PLACEMENT_DEFAULTS = {
  topPercent: 21,
  widthVw: 32,
  maxWidthPx: 560,
};

function clampFantasyLogoPlacement(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function resolveFantasyHeaderLogoPlacement(settings = {}) {
  return {
    topPercent: clampFantasyLogoPlacement(
      settings.fantasyHeaderLogoTopPercent,
      8,
      45,
      FANTASY_LOGO_PLACEMENT_DEFAULTS.topPercent,
    ),
    widthVw: clampFantasyLogoPlacement(
      settings.fantasyHeaderLogoWidthVw,
      15,
      60,
      FANTASY_LOGO_PLACEMENT_DEFAULTS.widthVw,
    ),
    maxWidthPx: clampFantasyLogoPlacement(
      settings.fantasyHeaderLogoMaxWidthPx,
      240,
      900,
      FANTASY_LOGO_PLACEMENT_DEFAULTS.maxWidthPx,
    ),
  };
}

function applyHeroLogoPlacement(settings = {}) {
  const banner = document.querySelector('.fantasy-hero-banner');
  if (!banner) return;

  const placement = resolveFantasyHeaderLogoPlacement(settings);
  banner.style.setProperty('--fantasy-hero-logo-top', `${placement.topPercent}%`);
  banner.style.setProperty('--fantasy-hero-logo-width', `${placement.widthVw}vw`);
  banner.style.setProperty('--fantasy-hero-logo-max-width', `${placement.maxWidthPx}px`);
}

function applyLandingAssets(settings = {}) {
  applyHeroImage(resolveFantasyHeroBackgroundDisplayUrl(settings));
  applyHeaderLogo(resolveFantasyHeaderLogoDisplayUrl(settings));
  applyHeroLogoPlacement(settings);
}

window.BPFantasyLanding = {
  init() {
    const root = document.querySelector('.fantasy-landing');
    if (!root) return;

    this.renderFeaturedDrivers(root);
    this.renderScoringPreview(root);
    this.loadPageSettings(root);
    applyLandingAssets();
  },

  async loadPageSettings(root) {
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

  renderFeaturedDrivers(root) {
    const grid = root.querySelector('#featuredDriversGrid');
    if (!grid) return;

    grid.innerHTML = DEMO_FEATURED_DRIVERS.map((driver) => `
      <article class="fantasy-driver-card">
        <div class="fantasy-driver-name">${escapeHtml(driver.name)}</div>
        <div class="fantasy-driver-number">#${escapeHtml(driver.carNumber)}</div>
        <div class="fantasy-driver-salary">${formatSalary(driver.salary)}</div>
      </article>
    `).join('');
  },

  renderScoringPreview(root) {
    const list = root.querySelector('#fantasyScoringList');
    if (!list) return;

    list.innerHTML = SCORING_CATEGORIES.map((item) => `
      <li>
        <span class="fantasy-scoring-k">${escapeHtml(item.key)}</span>
        <span class="fantasy-scoring-v">${escapeHtml(item.value)}</span>
      </li>
    `).join('');
  },
};

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.BPFantasyLanding?.init?.();
  } catch {
    // no-op
  }
});
