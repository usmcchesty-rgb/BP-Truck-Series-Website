(function () {
  const { link: driverLink, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    escapeHtml: (v) => String(v ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');
  const isDriverInactive = (driver) =>
    Pills.isDriverInactive ? Pills.isDriverInactive(driver) : driver?.status === 'Inactive';

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

  function renderDashboard(data) {
    const slate = data.slate || {};
    const drivers = data.drivers || [];
    const power = data.fantasyPowerRankings || [];
    const topPick = power[0] || null;
    const bestValue = data.spotlightCards?.bestValue || null;
    const riser = (data.salaryMovers?.biggestRisers || data.cards?.biggestRisers || [])[0];
    const topOwned = [...(data.ownershipProjection || [])].sort(
      (a, b) => b.projectedOwnershipPct - a.projectedOwnershipPct
    )[0];
    const inactiveCount = drivers.filter(isDriverInactive).length;

    return `
      <section class="fantasy-app-hero-panel fantasy-glass-panel fantasy-dashboard-hero">
        <p class="fantasy-app-eyebrow">Fantasy Central</p>
        <h1 class="fantasy-app-page-title">Race ${escapeHtml(slate.raceNumber ?? '—')} — ${escapeHtml(slate.track || 'TBD')}</h1>
        <div class="fantasy-slate-meta-grid">
          <div><span>Current Race</span><strong>Race ${escapeHtml(slate.raceNumber ?? '—')}</strong></div>
          <div><span>Lock</span><strong>${escapeHtml(slate.lockTime || 'TBD')}</strong></div>
          <div><span>Salary Cap</span><strong>${formatMoney(slate.salaryCap ?? 50000)}</strong></div>
          <div><span>Drivers on Slate</span><strong>${drivers.length}</strong></div>
        </div>
        <p class="fantasy-app-readonly-note">Your hub for salaries, lineups, and race-week research. Demo mode — no account required.</p>
      </section>

      ${
        inactiveCount
          ? `<section class="fantasy-dashboard-alert"><strong>${inactiveCount} inactive driver${inactiveCount === 1 ? '' : 's'}</strong> on this slate — check status before picking.</section>`
          : ''
      }

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">This Week at a Glance</h2>
        <div class="fantasy-dashboard-stat-grid">
          ${statCard(
            'Top Fantasy Pick',
            topPick
              ? `${driverLink(topPick, topPick.driverName)} · ${formatMoney(topPick.salary)} · ${escapeHtml(topPick.tier || '')}`
              : '<p class="muted">—</p>'
          )}
          ${statCard(
            'Best Value',
            bestValue?.driverName
              ? `${driverLink(bestValue, bestValue.driverName)} · ${renderFantasyGradePill(bestValue.valueGrade || bestValue.statLine?.match(/A\+?|B\+?|C\+?|D/)?.[0] || '')} ${escapeHtml(bestValue.statLine || '')}`
              : '<p class="muted">—</p>'
          )}
          ${statCard(
            'Highest Projected Ownership',
            topOwned
              ? `${driverLink(topOwned, topOwned.driverName)} · ${topOwned.projectedOwnershipPct}% ${escapeHtml(topOwned.ownershipLabel || '')}`
              : '<p class="muted">—</p>'
          )}
          ${statCard(
            'Biggest Salary Riser',
            riser
              ? `${driverLink(riser, riser.driverName)} · <span class="fantasy-change is-up">${escapeHtml(riser.salaryChangeLabel || '—')}</span>`
              : '<p class="muted">—</p>'
          )}
        </div>
      </section>

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Explore BP Fantasy</h2>
        <div class="fantasy-dashboard-link-grid">
          ${quickLink('/fantasy/slate.html', 'Race Slate', 'Salaries, rankings, ownership, and tiers')}
          ${quickLink('/fantasy/lineup.html', 'Lineup Builder', 'Demo optimal lineups under the cap')}
          ${quickLink('/fantasy/compare.html', 'Compare Drivers', 'Side-by-side driver matchup')}
          ${quickLink('/fantasy/history.html', 'Salary History', 'Multi-race salary movement')}
          ${quickLink('/fantasy/preview.html', 'Race Preview', 'Weekly fantasy preview article')}
          ${quickLink('/fantasy/rules.html', 'Rules & Guide', 'How BP Fantasy works — plain language')}
        </div>
      </section>
    `;
  }

  async function init() {
    const root = $('#fantasyDashboardRoot');
    if (!root) return;

    try {
      const res = await fetch('/api/settings?action=getFantasyPublicSlate');
      if (!res.ok) throw new Error('slate');
      const data = await res.json();
      root.innerHTML = renderDashboard(data);
    } catch {
      root.innerHTML = `<section class="fantasy-app-empty"><p>Fantasy dashboard coming soon.</p></section>`;
    }
  }

  window.BPFantasyDashboardApp = { init };
})();
