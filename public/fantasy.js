// BP Fantasy — public marketing landing page (frontend only).
// Requires fantasy-branding-assets.js loaded first.

function getFantasyBrandingAssets() {
  return window.BPFantasyBrandingAssets || null;
}

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

  branding.applyImageFromCandidates(
    img,
    branding.resolveFantasyHeroBackgroundCandidates(settings),
  );
}

function applyLandingAssets(settings = {}) {
  if (!isFantasyPublicLandingPage()) return;
  applyHeroImage(settings);
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
