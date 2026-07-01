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

function renderCtaButtons(actionsEl, buttons) {
  if (!actionsEl) return;
  actionsEl.innerHTML = buttons
    .map(
      (btn) =>
        `<a class="fantasy-btn fantasy-btn--${btn.variant || 'secondary'}" href="${escapeHtml(btn.href)}">${escapeHtml(btn.label)}</a>`,
    )
    .join('');
}

async function renderLandingCta() {
  const titleEl = document.getElementById('fantasyCtaTitle');
  const copyEl = document.getElementById('fantasyCtaCopy');
  const actionsEl = document.getElementById('fantasyCtaActions');
  if (!titleEl || !copyEl || !actionsEl) return;

  let slatePublished = false;
  try {
    const slateRes = await fetch('/api/settings?action=getFantasyPublicSlate');
    if (slateRes.ok) {
      const slateData = await slateRes.json();
      slatePublished =
        slateData?.progression?.isPlayable === true || slateData?.slate?.playable === true;
    }
  } catch {
    // Default to logged-out CTA when slate cannot be loaded.
  }

  let loggedIn = false;
  let profile = null;
  let hasLineup = false;

  try {
    const Auth = window.BPFantasyAuth;
    if (Auth) {
      await Auth.init();
      const session = await Auth.getSession();
      loggedIn = Boolean(session);
      if (loggedIn) {
        const dashRes = await Auth.authFetch('/api/settings?action=getDashboard');
        if (dashRes.ok) {
          const dashboard = await dashRes.json();
          profile = dashboard.profile || null;
          hasLineup = Boolean(dashboard.lineup?.drivers?.length);
        }
      }
    }
  } catch {
    loggedIn = false;
  }

  const comingSoonTitle = 'Next BP Fantasy Slate Coming Soon';
  const comingSoonCopy =
    'The next BP Fantasy slate has not been published yet. You can still create an account, log in, view the rules, explore driver outlooks, and prepare for the next race.';

  if (!slatePublished) {
    titleEl.textContent = comingSoonTitle;
    copyEl.textContent = comingSoonCopy;

    if (!loggedIn) {
      renderCtaButtons(actionsEl, [
        { label: 'Create Account', href: '/fantasy/signup.html', variant: 'primary' },
        { label: 'Login', href: '/fantasy/login.html', variant: 'secondary' },
        { label: 'View Rules', href: '/fantasy/rules.html', variant: 'secondary' },
        { label: 'Driver Outlook', href: '/fantasy/slate.html', variant: 'secondary' },
      ]);
      return;
    }

    const loggedInButtons = [
      { label: 'Fantasy Dashboard', href: '/fantasy/dashboard.html', variant: 'primary' },
      { label: 'View Rules', href: '/fantasy/rules.html', variant: 'secondary' },
      { label: 'Driver Outlook', href: '/fantasy/slate.html', variant: 'secondary' },
    ];
    if (hasLineup) {
      loggedInButtons.push({ label: 'View My Lineup', href: '/fantasy/lineup.html', variant: 'secondary' });
    }
    renderCtaButtons(actionsEl, loggedInButtons);
    return;
  }

  if (!loggedIn) {
    titleEl.textContent = 'Ready to Play BP Fantasy?';
    copyEl.textContent =
      'Create your free BP Fantasy account and compete against other Blazing Pedals drivers every race week.';
    renderCtaButtons(actionsEl, [
      { label: 'Create Account', href: '/fantasy/signup.html', variant: 'primary' },
      { label: 'Login', href: '/fantasy/login.html', variant: 'secondary' },
    ]);
    return;
  }

  const displayName =
    String(profile?.displayName || profile?.email?.split('@')[0] || 'Player').trim() || 'Player';
  titleEl.textContent = `Welcome Back, ${displayName}`;
  copyEl.textContent = "Build or manage your lineup for this week's BP Fantasy slate.";
  renderCtaButtons(
    actionsEl,
    hasLineup
      ? [
          { label: 'View My Lineup', href: '/fantasy/lineup.html', variant: 'primary' },
          { label: 'Fantasy Dashboard', href: '/fantasy/dashboard.html', variant: 'secondary' },
        ]
      : [
          { label: 'Build My Lineup', href: '/fantasy/lineup.html', variant: 'primary' },
          { label: 'Fantasy Dashboard', href: '/fantasy/dashboard.html', variant: 'secondary' },
        ],
  );
}

window.BPFantasyLanding = {
  init() {
    if (!isFantasyPublicLandingPage()) return;

    const root = document.querySelector('main.fantasy-landing');
    if (!root) return;

    this.renderScoringPreview(root);
    this.loadPageSettings(root);
    applyLandingAssets();
    renderLandingCta().catch((err) => {
      console.warn('BP Fantasy landing CTA failed:', err);
    });
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
