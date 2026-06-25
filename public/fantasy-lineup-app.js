(function () {
  const { link: driverLink, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    escapeHtml: (v) => String(v ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
  const renderActivityStatus = (driver) =>
    Pills.renderActivityStatus ? Pills.renderActivityStatus(driver) : escapeHtml(driver.status || 'Active');

  const Optimizer = window.BPFantasyLineupOptimizer || {};

  function $(sel) {
    return document.querySelector(sel);
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function renderLineupCard(lineup, title) {
    if (!lineup?.drivers?.length) return '';
    return `
      <article class="fantasy-lineup-result">
        <h3 class="fantasy-lineup-result__title">${escapeHtml(title)}</h3>
        <ul class="fantasy-lineup-result__drivers">
          ${lineup.drivers
            .map(
              (d) =>
                `<li>${driverLink(d, d.driverName)} <span class="muted">${formatMoney(d.salary)} · ${escapeHtml(d.tier || '')}</span></li>`
            )
            .join('')}
        </ul>
        <div class="fantasy-lineup-result__meta">
          <div><span>Total Salary</span><strong class="salary">${formatMoney(lineup.totalSalary)}</strong></div>
          <div><span>Remaining</span><strong>${formatMoney(lineup.remainingSalary)}</strong></div>
          <div><span>Projected Score</span><strong>${escapeHtml(String(lineup.projectedScore))}</strong></div>
          <div><span>Avg Ownership</span><strong>${lineup.averageOwnership != null ? `${lineup.averageOwnership}%` : '—'}</strong></div>
          <div><span>Avg Value</span><strong>${lineup.averageValueScore != null ? Number(lineup.averageValueScore).toFixed(2) : '—'}</strong></div>
        </div>
      </article>
    `;
  }

  function renderResults(result) {
    if (!result.ok) {
      return `<section class="fantasy-app-empty"><p>${escapeHtml(result.error || 'Could not build lineup.')}</p></section>`;
    }

    const optimal = result.optimalLineup;
    const alts = result.alternativeLineups || [];

    return `
      <section class="fantasy-app-section">
        <p class="fantasy-lineup-strategy-note">${escapeHtml(optimal.strategyNote || '')}</p>
        ${renderLineupCard(optimal, 'Optimal Lineup')}
        ${
          alts.length
            ? `<div class="fantasy-lineup-alt-grid">${alts
                .map((alt, i) => renderLineupCard(alt, `Alternative ${i + 1}`))
                .join('')}</div>`
            : ''
        }
      </section>
    `;
  }

  function renderControls() {
    return `
      <section class="fantasy-app-section fantasy-lineup-controls">
        <form id="fantasyLineupForm" class="fantasy-lineup-form">
          <label>Salary Cap
            <input type="number" name="salaryCap" value="50000" min="10000" max="100000" step="500" />
          </label>
          <label>Drivers per Lineup
            <input type="number" name="lineupSize" value="5" min="3" max="8" step="1" />
          </label>
          <label>Strategy
            <select name="strategy">
              <option value="best-overall">Best Overall</option>
              <option value="best-value">Best Value</option>
              <option value="balanced">Balanced</option>
              <option value="contrarian">Contrarian</option>
              <option value="stars-sleepers">Stars and Sleepers</option>
            </select>
          </label>
          <button type="submit" class="fantasy-btn fantasy-btn--primary">Build Lineup</button>
        </form>
        <p class="fantasy-app-readonly-note">Read-only demo optimizer. No lineup is saved or submitted.</p>
      </section>
    `;
  }

  function renderPlayerPool(drivers = []) {
    const sorted = [...drivers].sort(
      (a, b) => Number(a.fantasyRank ?? 999) - Number(b.fantasyRank ?? 999)
    );

    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Player Pool</h2>
        <div class="fantasy-table-wrap">
          <table class="fantasy-slate-table fantasy-lineup-pool-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Driver</th>
                <th>Tier</th>
                <th>Salary</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${sorted
                .map(
                  (driver) => `<tr>
                  <td>${driver.fantasyRank != null ? `#${escapeHtml(driver.fantasyRank)}` : '—'}</td>
                  <td>${driverLink(driver, driver.driverName)}</td>
                  <td><span class="fantasy-tier-pill">${escapeHtml(driver.tier || '—')}</span></td>
                  <td class="salary">${formatMoney(driver.salary)}</td>
                  <td>${renderActivityStatus(driver)}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  let cachedDrivers = [];

  function runOptimizer(form) {
    const fd = new FormData(form);
    const salaryCap = Number(fd.get('salaryCap')) || 50000;
    const lineupSize = Number(fd.get('lineupSize')) || 5;
    const strategy = String(fd.get('strategy') || 'best-overall');

    if (!Optimizer.optimizePublicLineup) {
      $('#fantasyLineupResults').innerHTML =
        '<section class="fantasy-app-empty"><p>Optimizer unavailable.</p></section>';
      return;
    }

    const result = Optimizer.optimizePublicLineup(cachedDrivers, {
      salaryCap,
      lineupSize,
      strategy,
      maxAlternatives: 3,
    });

    $('#fantasyLineupResults').innerHTML = renderResults(result);
  }

  async function init() {
    const root = $('#fantasyLineupRoot');
    if (!root) return;

    root.innerHTML = `
      <section class="fantasy-app-hero-panel fantasy-glass-panel">
        <p class="fantasy-app-eyebrow">Lineup Builder</p>
        <h1 class="fantasy-app-page-title">Demo Lineup Optimizer</h1>
        <p class="fantasy-app-readonly-note">Explore optimal 5-driver combinations under the salary cap. Demo only — no account required.</p>
      </section>
      ${renderControls()}
      <div id="fantasyLineupPool"></div>
      <div id="fantasyLineupResults"></div>
    `;

    try {
      const res = await fetch('/api/settings?action=getFantasyPublicSlate');
      if (!res.ok) throw new Error('slate');
      const data = await res.json();
      cachedDrivers = data.drivers || [];
      const poolEl = $('#fantasyLineupPool');
      if (poolEl) poolEl.innerHTML = renderPlayerPool(cachedDrivers);

      const form = $('#fantasyLineupForm');
      form?.addEventListener('submit', (e) => {
        e.preventDefault();
        runOptimizer(form);
      });
      if (form) runOptimizer(form);
    } catch {
      $('#fantasyLineupResults').innerHTML =
        '<section class="fantasy-app-empty"><p>Fantasy slate coming soon.</p></section>';
    }
  }

  window.BPFantasyLineupApp = { init };
})();
