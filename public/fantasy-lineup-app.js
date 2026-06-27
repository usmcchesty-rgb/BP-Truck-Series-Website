(function () {
  const { link: driverLink, compareUrl, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => String(l ?? d?.driverName ?? ''),
    compareUrl: () => '/fantasy/compare.html',
    escapeHtml: (v) => String(v ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
  const Photos = window.BPFantasyDriverPhotos || {};

  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');
  const renderActivityStatus = (driver, options) =>
    Pills.renderActivityStatus
      ? Pills.renderActivityStatus(driver, options)
      : escapeHtml(driver.status || 'Active');
  const driverInactiveRowClass = (driver) =>
    Pills.driverInactiveRowClass ? Pills.driverInactiveRowClass(driver) : '';
  const isDriverInactive = (driver) =>
    Pills.isDriverInactive ? Pills.isDriverInactive(driver) : driver?.status === 'Inactive';

  const Optimizer = window.BPFantasyLineupOptimizer || {};

  const STRATEGIES = [
    { id: 'best-overall', label: 'Best Overall', copy: 'Highest combined tier scores' },
    { id: 'best-value', label: 'Best Value', copy: 'Best grades for the salary' },
    { id: 'balanced', label: 'Balanced', copy: 'Score + value, uses most of cap' },
    { id: 'contrarian', label: 'Dark Horse', copy: 'Strong picks, lower ownership' },
    { id: 'stars-sleepers', label: 'Stars and Sleepers', copy: 'One star plus a value-tier pick' },
  ];

  let cachedDrivers = [];
  let activeStrategy = 'best-overall';
  let salaryCap = 50000;

  function $(sel) {
    return document.querySelector(sel);
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function renderDriverThumb(driver) {
    if (Photos.renderDriverPhotoImg) {
      return Photos.renderDriverPhotoImg({
        name: driver.driverName,
        className: 'fantasy-lineup-driver-photo',
        alt: driver.driverName,
      });
    }
    return `<img class="fantasy-lineup-driver-photo" src="/assets/drivers/placeholder.png" alt="" />`;
  }

  function lineupCompareHref(drivers = []) {
    if (drivers.length >= 2) return compareUrl(drivers[0], drivers[1]);
    if (drivers.length === 1) return compareUrl(drivers[0]);
    return '/fantasy/compare.html';
  }

  function renderSalaryMeter(lineup, cap) {
    const used = Number(lineup?.totalSalary) || 0;
    const limit = Number(cap) || 50000;
    const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
    return `
      <div class="fantasy-lineup-salary-meter">
        <div class="fantasy-lineup-salary-meter__track">
          <div class="fantasy-lineup-salary-meter__fill" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <div class="fantasy-lineup-salary-meter__label">
          <strong>${formatMoney(used)}</strong> / ${formatMoney(limit)}
        </div>
      </div>
    `;
  }

  function renderInactiveWarning(drivers = []) {
    const inactive = drivers.filter(isDriverInactive);
    if (!inactive.length) return '';
    const names = inactive.map((d) => escapeHtml(d.driverName)).join(', ');
    return `<p class="fantasy-lineup-warning">Inactive driver${inactive.length > 1 ? 's' : ''} in this lineup: ${names}. They may not start this race.</p>`;
  }

  function renderLineupDriverRow(driver) {
    const inactiveClass = driverInactiveRowClass(driver);
    const ownership =
      driver.projectedOwnershipPct != null
        ? `${driver.projectedOwnershipPct}% ${driver.ownershipLabel || ''}`.trim()
        : '—';
    return `
      <li class="fantasy-lineup-driver-row${inactiveClass ? ` ${inactiveClass}` : ''}">
        <div class="fantasy-lineup-driver-row__photo">${renderDriverThumb(driver)}</div>
        <div class="fantasy-lineup-driver-row__main">
          <div class="fantasy-lineup-driver-row__name">${driverLink(driver, driver.driverName)}</div>
          <div class="fantasy-lineup-driver-row__meta">
            <span class="salary">${formatMoney(driver.salary)}</span>
            <span class="fantasy-tier-pill">${escapeHtml(driver.tier || '—')}</span>
            ${renderFantasyGradePill(driver.valueGrade)}
            ${renderActivityStatus(driver, { uppercase: true })}
          </div>
          <div class="fantasy-lineup-driver-row__sub muted">Ownership ${escapeHtml(ownership)}</div>
        </div>
      </li>
    `;
  }

  function renderLineupCard(lineup, title, cap) {
    if (!lineup?.drivers?.length) return '';
    return `
      <article class="fantasy-lineup-result">
        <h3 class="fantasy-lineup-result__title">${escapeHtml(title)}</h3>
        ${renderSalaryMeter(lineup, cap)}
        ${renderInactiveWarning(lineup.drivers)}
        <ul class="fantasy-lineup-result__drivers fantasy-lineup-driver-list">
          ${lineup.drivers.map(renderLineupDriverRow).join('')}
        </ul>
        <div class="fantasy-lineup-result__meta">
          <div><span>Remaining Salary</span><strong>${formatMoney(lineup.remainingSalary)}</strong></div>
          <div><span>Avg Ownership</span><strong>${lineup.averageOwnership != null ? `${lineup.averageOwnership}%` : '—'}</strong></div>
          <div><span>Avg Value Score</span><strong>${lineup.averageValueScore != null ? Number(lineup.averageValueScore).toFixed(2) : '—'}</strong></div>
          <div><span>Projected Score</span><strong>${escapeHtml(String(lineup.projectedScore))}</strong></div>
        </div>
        <p class="fantasy-lineup-result__actions">
          <a class="fantasy-btn fantasy-btn--secondary" href="${escapeHtml(lineupCompareHref(lineup.drivers))}">Compare Drivers from Lineup</a>
        </p>
      </article>
    `;
  }

  function renderResults(result, cap) {
    if (!result.ok) {
      return `<section class="fantasy-app-empty"><p>${escapeHtml(result.error || 'Could not build lineup.')}</p></section>`;
    }

    const optimal = result.optimalLineup;
    const alts = result.alternativeLineups || [];

    return `
      <section class="fantasy-app-section">
        <p class="fantasy-lineup-strategy-note">${escapeHtml(optimal.strategyNote || '')}</p>
        ${renderLineupCard(optimal, 'Suggested Lineup', cap)}
        ${
          alts.length
            ? `<div class="fantasy-lineup-alt-grid">${alts
                .map((alt, i) => renderLineupCard(alt, `Alternative ${i + 1}`, cap))
                .join('')}</div>`
            : ''
        }
      </section>
    `;
  }

  function renderStrategyCards(selected) {
    return `
      <div class="fantasy-lineup-strategy-grid" role="group" aria-label="Lineup strategy">
        ${STRATEGIES.map(
          (s) => `
          <button type="button" class="fantasy-lineup-strategy-card${s.id === selected ? ' is-active' : ''}" data-strategy="${escapeHtml(s.id)}">
            <span class="fantasy-lineup-strategy-card__label">${escapeHtml(s.label)}</span>
            <span class="fantasy-lineup-strategy-card__copy">${escapeHtml(s.copy)}</span>
          </button>`
        ).join('')}
      </div>
    `;
  }

  function renderControls() {
    return `
      <section class="fantasy-app-section fantasy-lineup-controls">
        <h2 class="fantasy-app-section-title">Pick a Strategy</h2>
        ${renderStrategyCards(activeStrategy)}
        <form id="fantasyLineupForm" class="fantasy-lineup-form">
          <input type="hidden" name="strategy" value="${escapeHtml(activeStrategy)}" />
          <label>Salary Cap
            <input type="number" name="salaryCap" value="50000" min="10000" max="100000" step="500" />
          </label>
          <label>Drivers per Lineup
            <input type="number" name="lineupSize" value="5" min="3" max="8" step="1" />
          </label>
          <button type="submit" class="fantasy-btn fantasy-btn--primary">Build Lineup</button>
        </form>
        <p class="fantasy-app-readonly-note">Read-only demo optimizer. No lineup is saved or submitted. <a class="fantasy-driver-link" href="/fantasy/rules.html">How it works →</a></p>
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
                <th>Grade</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${sorted
                .map((driver) => {
                  const inactiveClass = driverInactiveRowClass(driver);
                  return `<tr${inactiveClass ? ` class="${inactiveClass}"` : ''}>
                  <td>${driver.fantasyRank != null ? `#${escapeHtml(driver.fantasyRank)}` : '—'}</td>
                  <td>${driverLink(driver, driver.driverName)}</td>
                  <td><span class="fantasy-tier-pill">${escapeHtml(driver.tier || '—')}</span></td>
                  <td class="salary">${formatMoney(driver.salary)}</td>
                  <td>${renderFantasyGradePill(driver.valueGrade)}</td>
                  <td>${renderActivityStatus(driver, { uppercase: true })}</td>
                </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function syncStrategyCards() {
    document.querySelectorAll('.fantasy-lineup-strategy-card').forEach((btn) => {
      const id = btn.getAttribute('data-strategy');
      btn.classList.toggle('is-active', id === activeStrategy);
    });
    const hidden = document.querySelector('#fantasyLineupForm input[name="strategy"]');
    if (hidden) hidden.value = activeStrategy;
  }

  function runOptimizer(form) {
    const fd = new FormData(form);
    salaryCap = Number(fd.get('salaryCap')) || 50000;
    const lineupSize = Number(fd.get('lineupSize')) || 5;
    const strategy = String(fd.get('strategy') || activeStrategy);

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

    $('#fantasyLineupResults').innerHTML = renderResults(result, salaryCap);
  }

  function bindStrategyCards(form) {
    document.querySelectorAll('.fantasy-lineup-strategy-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeStrategy = btn.getAttribute('data-strategy') || 'best-overall';
        syncStrategyCards();
        runOptimizer(form);
      });
    });
  }

  async function init() {
    const root = $('#fantasyLineupRoot');
    if (!root) return;

    root.innerHTML = `
      <section class="fantasy-app-hero-panel fantasy-glass-panel">
        <p class="fantasy-app-eyebrow">Lineup Builder</p>
        <h1 class="fantasy-app-page-title">Demo Lineup Optimizer</h1>
        <p class="fantasy-app-readonly-note">Build a 5-driver lineup under the $50,000 cap. Demo only — nothing is saved.</p>
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
      salaryCap = Number(data.slate?.salaryCap) || 50000;
      const capInput = document.querySelector('#fantasyLineupForm input[name="salaryCap"]');
      if (capInput) capInput.value = String(salaryCap);

      const poolEl = $('#fantasyLineupPool');
      if (poolEl) poolEl.innerHTML = renderPlayerPool(cachedDrivers);

      const form = $('#fantasyLineupForm');
      bindStrategyCards(form);
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
