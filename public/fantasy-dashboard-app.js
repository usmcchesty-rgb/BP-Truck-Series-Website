(function () {
  const { link: driverLink, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    escapeHtml: (v) => String(v ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
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

  function renderDashboard(data) {
    const slate = data.slate || {};
    const power = data.fantasyPowerRankings || [];
    const top3 = power.slice(0, 3);
    const bestValue = data.spotlightCards?.bestValue || null;
    const riser = (data.salaryMovers?.biggestRisers || data.cards?.biggestRisers || [])[0];
    const topOwned = [...(data.ownershipProjection || [])].sort(
      (a, b) => b.projectedOwnershipPct - a.projectedOwnershipPct
    )[0];

    return `
      <section class="fantasy-app-hero-panel fantasy-glass-panel">
        <p class="fantasy-app-eyebrow">Fantasy Central</p>
        <h1 class="fantasy-app-page-title">Race ${escapeHtml(slate.raceNumber ?? '—')} — ${escapeHtml(slate.track || 'TBD')}</h1>
        <div class="fantasy-slate-meta-grid">
          <div><span>Lock</span><strong>${escapeHtml(slate.lockTime || 'TBD')}</strong></div>
          <div><span>Salary Cap</span><strong>${formatMoney(slate.salaryCap ?? 50000)}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(slate.status || 'draft')}</strong></div>
          <div><span>Countdown</span><strong class="muted">Lock timer coming soon</strong></div>
        </div>
        <p class="fantasy-app-readonly-note">Read-only fantasy hub. No account required.</p>
      </section>

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">This Week at a Glance</h2>
        <div class="fantasy-dashboard-stat-grid">
          ${statCard(
            'Top 3 Fantasy Rankings',
            top3.length
              ? `<ol class="fantasy-dashboard-rank-list">${top3
                  .map(
                    (d) =>
                      `<li>#${escapeHtml(d.rank)} ${driverLink(d, d.driverName)} <span class="muted">${formatMoney(d.salary)}</span></li>`
                  )
                  .join('')}</ol>`
              : '<p class="muted">—</p>'
          )}
          ${statCard(
            'Best Value Pick',
            bestValue?.driverName
              ? `${driverLink(bestValue, bestValue.driverName)} · ${escapeHtml(bestValue.statLine || '')}`
              : '<p class="muted">—</p>'
          )}
          ${statCard(
            'Biggest Salary Riser',
            riser
              ? `${driverLink(riser, riser.driverName)} · <span class="fantasy-change is-up">${escapeHtml(riser.salaryChangeLabel || '—')}</span>`
              : '<p class="muted">—</p>'
          )}
          ${statCard(
            'Highest Projected Ownership',
            topOwned
              ? `${driverLink(topOwned, topOwned.driverName)} · ${topOwned.projectedOwnershipPct}% ${escapeHtml(topOwned.ownershipLabel || '')}`
              : '<p class="muted">—</p>'
          )}
        </div>
      </section>

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Quick Links</h2>
        <div class="fantasy-dashboard-link-grid">
          ${quickLink('/fantasy/slate.html', 'Race Slate', 'Full salaries, rankings, and ownership')}
          ${quickLink('/fantasy/lineup.html', 'Lineup Optimizer', 'Demo optimal lineups under the cap')}
          ${quickLink('/fantasy/compare.html', 'Driver Compare', 'Side-by-side driver matchup')}
          ${quickLink('/fantasy/history.html', 'Salary History', 'Multi-race salary movement')}
          ${quickLink('/fantasy/preview.html', 'Race Preview', 'Weekly fantasy preview article')}
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
