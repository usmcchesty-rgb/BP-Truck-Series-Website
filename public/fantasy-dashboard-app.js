(function () {
  const { link: driverLink, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    escapeHtml: (v) => String(v ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
  const Insights = window.BPFantasyInsights || {};
  const Auth = window.BPFantasyAuth || {};
  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');

  function $(sel) {
    return document.querySelector(sel);
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function quickLink(href, label, copy) {
    return `<a class="fantasy-dashboard-link-card" href="${escapeHtml(href)}">
      <span class="fantasy-dashboard-link-card__label">${escapeHtml(label)}</span>
      <span class="fantasy-dashboard-link-card__copy">${escapeHtml(copy)}</span>
    </a>`;
  }

  function statCard(label, body) {
    return `<article class="fantasy-dashboard-stat-card">
      <div class="fantasy-dashboard-stat-card__label">${escapeHtml(label)}</div>
      <div class="fantasy-dashboard-stat-card__body">${body}</div>
    </article>`;
  }

  function lineupStatusCard(profile, slate, lineup, lock) {
    if (!profile) {
      return `
        <section class="fantasy-app-section fantasy-dashboard-auth-panel fantasy-glass-panel">
          <h2 class="fantasy-app-section-title">Your Account</h2>
          <p class="fantasy-app-copy">Log in to submit your BP Fantasy lineup for the current race.</p>
          <div class="fantasy-cta-actions">
            <a class="fantasy-btn fantasy-btn--primary" href="/fantasy/login.html">Log In</a>
            <a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/signup.html">Sign Up</a>
          </div>
        </section>`;
    }

    const locked = Boolean(lock?.isLocked || lineup?.status === 'locked');
    let statusText = 'Not submitted yet';
    let statusDetail = `<a class="fantasy-driver-link" href="/fantasy/lineup.html">Build your lineup →</a>`;

    if (lineup?.drivers?.length) {
      statusText = locked ? 'Lineup locked' : 'Lineup submitted';
      const names = lineup.drivers.map((d) => escapeHtml(d.driverName)).join(', ');
      statusDetail = `${names}<br><span class="muted">${formatMoney(lineup.totalSalary)} · ${lineup.drivers.length} drivers</span>`;
      if (!locked) {
        statusDetail += `<br><a class="fantasy-driver-link" href="/fantasy/lineup.html">Edit lineup →</a>`;
      }
    }

    return `
      <section class="fantasy-app-section fantasy-dashboard-auth-panel fantasy-glass-panel">
        <h2 class="fantasy-app-section-title">Welcome, ${escapeHtml(profile.displayName || profile.email || 'Player')}</h2>
        <div class="fantasy-slate-meta-grid">
          <div><span>Email</span><strong>${escapeHtml(profile.email || '—')}</strong></div>
          <div><span>Lineup Status</span><strong>${escapeHtml(statusText)}</strong></div>
          <div><span>Lock</span><strong>${escapeHtml(slate?.lockTime || lock?.lockMessage || 'TBD')}</strong></div>
          <div><span>Salary Cap</span><strong>${formatMoney(slate?.salaryCap ?? 50000)}</strong></div>
        </div>
        <p class="fantasy-app-copy">${statusDetail}</p>
        <div class="fantasy-cta-actions">
          <a class="fantasy-btn fantasy-btn--primary" href="/fantasy/lineup.html">${lineup ? 'Open Lineup Builder' : 'Submit Lineup'}</a>
          <button type="button" id="fantasyLogoutBtn" class="fantasy-btn fantasy-btn--secondary">Log Out</button>
        </div>
      </section>`;
  }

  async function renderDashboard(slateData, launchData) {
    const slate = launchData?.slate || slateData?.slate || {};
    const profile = launchData?.profile || null;
    const lineup = launchData?.lineup || null;
    const lock = launchData?.lock || {};
    const drivers = slateData?.drivers || [];
    const power = slateData?.fantasyPowerRankings || [];
    const topPick = power[0] || null;
    const bestValue = slateData?.spotlightCards?.bestValue || null;

    return `
      <section class="fantasy-app-hero-panel fantasy-glass-panel fantasy-dashboard-hero">
        <p class="fantasy-app-eyebrow">BP Fantasy Central</p>
        <h1 class="fantasy-app-page-title">Race ${escapeHtml(slate.raceNumber ?? '—')} — ${escapeHtml(slate.track || 'TBD')}</h1>
        <div class="fantasy-slate-meta-grid">
          <div><span>Current Race</span><strong>Race ${escapeHtml(slate.raceNumber ?? '—')}</strong></div>
          <div><span>Lock</span><strong>${escapeHtml(slate.lockTime || lock.lockMessage || 'TBD')}</strong></div>
          <div><span>Salary Cap</span><strong>${formatMoney(slate.salaryCap ?? 50000)}</strong></div>
          <div><span>Drivers on Slate</span><strong>${drivers.length}</strong></div>
        </div>
      </section>

      ${lineupStatusCard(profile, slate, lineup, lock)}

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">This Week at a Glance</h2>
        <div class="fantasy-dashboard-stat-grid">
          ${statCard(
            'Top BP Fantasy Pick',
            topPick
              ? `${driverLink(topPick, topPick.driverName)} · ${formatMoney(topPick.salary)}`
              : '<p class="muted">—</p>'
          )}
          ${statCard(
            'Best Fantasy Value',
            bestValue?.driverName
              ? `${driverLink(bestValue, bestValue.driverName)} · ${renderFantasyGradePill(bestValue.valueGrade || '')}`
              : '<p class="muted">—</p>'
          )}
        </div>
      </section>

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Explore BP Fantasy</h2>
        <div class="fantasy-dashboard-link-grid">
          ${quickLink('/fantasy/lineup.html', 'Lineup Builder', 'Pick and submit your 5-driver lineup')}
          ${quickLink('/fantasy/slate.html', 'Race Slate', 'Salaries, rankings, ownership, and tiers')}
          ${quickLink('/fantasy/compare.html', 'Compare Drivers', 'Side-by-side fantasy matchup')}
          ${quickLink('/fantasy/rules.html', 'Rules & Guide', 'How BP Fantasy works')}
        </div>
      </section>`;
  }

  async function init() {
    const root = $('#fantasyDashboardRoot');
    if (!root) return;

    try {
      const [slateRes, launchRes] = await Promise.all([
        fetch('/api/settings?action=getFantasyPublicSlate'),
        (async () => {
          try {
            await Auth.init();
            return Auth.authFetch('/api/settings?action=getDashboard');
          } catch {
            return fetch('/api/settings?action=getDashboard');
          }
        })(),
      ]);

      if (!slateRes.ok) throw new Error('slate');
      const slateData = await slateRes.json();
      const launchData = launchRes.ok ? await launchRes.json() : {};
      root.innerHTML = await renderDashboard(slateData, launchData);

      $('#fantasyLogoutBtn')?.addEventListener('click', async () => {
        try {
          await Auth.signOut();
          window.location.reload();
        } catch {
          window.location.reload();
        }
      });
    } catch {
      root.innerHTML = `<section class="fantasy-app-empty"><p>Fantasy dashboard coming soon.</p></section>`;
    }
  }

  window.BPFantasyDashboardApp = { init };
})();
