(function () {
  const { link: driverLink, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    escapeHtml: (v) => String(v ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');
  const renderFantasyOwnershipPill = (label) =>
    Pills.renderFantasyOwnershipPill ? Pills.renderFantasyOwnershipPill(label) : escapeHtml(label || '');
  const renderFantasyTierPill = (tier) =>
    Pills.renderFantasyTierPill ? Pills.renderFantasyTierPill(tier) : escapeHtml(tier || '—');
  const renderFantasyStatusPill = (status) =>
    Pills.renderFantasyStatusPill ? Pills.renderFantasyStatusPill(status) : escapeHtml(status || '—');
  const ownershipBarClass = (label) =>
    Pills.ownershipModifier ? `fantasy-pill--${Pills.ownershipModifier(label)}` : '';

  function $(selector) {
    return document.querySelector(selector);
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function changeClass(direction) {
    if (direction === 'up') return 'is-up';
    if (direction === 'down') return 'is-down';
    if (direction === 'new') return 'is-new';
    return 'is-same';
  }

  function ownershipLabelClass(label) {
    return ownershipBarClass(label);
  }

  function renderEmpty(message) {
    const root = $('#fantasySlateRoot');
    if (!root) return;
    root.innerHTML = `<section class="fantasy-app-empty"><p>${escapeHtml(message)}</p><a class="fantasy-btn fantasy-btn--secondary" href="/fantasy.html">Back to Fantasy Home</a></section>`;
  }

  function renderPowerRankings(rankings = []) {
    if (!rankings.length) return '';
    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Fantasy Power Rankings</h2>
        <div class="fantasy-table-wrap">
          <table class="fantasy-slate-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Driver</th>
                <th>Salary</th>
                <th>Value</th>
                <th>Ownership</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              ${rankings
                .map(
                  (row) => `<tr>
                  <td><span class="fantasy-rank-badge">#${escapeHtml(row.rank)}</span></td>
                  <td>${driverLink(row, row.driverName)}${row.carNumber ? ` <span class="muted">#${escapeHtml(row.carNumber)}</span>` : ''}</td>
                  <td class="salary">${formatMoney(row.salary)}</td>
                  <td class="fantasy-pill-cell">${renderFantasyGradePill(row.valueGrade)}</td>
                  <td>${row.projectedOwnership != null ? `${row.projectedOwnership}% ${renderFantasyOwnershipPill(row.ownershipLabel)}` : '—'}</td>
                  <td class="fantasy-reason-cell">${escapeHtml(row.shortReason || '')}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderSpotlightStatLine(key, card) {
    if (key === 'bestValue' && card.statLine) {
      const match = String(card.statLine).match(/^([\d.]+)\s+value\s·\s*(.+)$/i);
      if (match) {
        return `${escapeHtml(match[1])} value · ${renderFantasyGradePill(match[2].trim())}`;
      }
    }
    return escapeHtml(card.statLine || '');
  }

  function renderSpotlightCard(key, card) {
    if (!card?.driverName) {
      return `<article class="fantasy-spotlight-card fantasy-spotlight-card--${key}">
        <div class="fantasy-spotlight-card__label">${escapeHtml(card?.label || key)}</div>
        <p class="fantasy-spotlight-card__empty">No driver selected.</p>
      </article>`;
    }
    return `
      <article class="fantasy-spotlight-card fantasy-spotlight-card--${key}">
        <div class="fantasy-spotlight-card__label">${escapeHtml(card.label || '')}</div>
        <div class="fantasy-spotlight-card__name">${driverLink(card, card.driverName)}</div>
        <div class="fantasy-spotlight-card__meta">${formatMoney(card.salary)} · ${escapeHtml(card.tier || '')}</div>
        <div class="fantasy-spotlight-card__stat">${renderSpotlightStatLine(key, card)}</div>
        <p class="fantasy-spotlight-card__copy">${escapeHtml(card.explanation || '')}</p>
      </article>
    `;
  }

  function renderSpotlightCards(spotlight = {}) {
    const keys = ['bestValue', 'hottestDriver', 'trackSpecialist', 'riskyPick'];
    const cards = keys.map((key) => renderSpotlightCard(key, spotlight[key])).join('');
    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Spotlight Cards</h2>
        <div class="fantasy-spotlight-grid">${cards}</div>
      </section>
    `;
  }

  function renderOwnershipProjection(projections = []) {
    const top = projections.slice(0, 12);
    if (!top.length) return '';
    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Ownership Projection</h2>
        <div class="fantasy-ownership-list">
          ${top
            .map(
              (row) => `<div class="fantasy-ownership-row">
              <div class="fantasy-ownership-row__head">
                <span>${driverLink(row, row.driverName)}</span>
                <span>${row.projectedOwnershipPct}% · ${renderFantasyOwnershipPill(row.ownershipLabel)}</span>
              </div>
              <div class="fantasy-ownership-bar" aria-hidden="true">
                <span class="fantasy-ownership-bar__fill ${ownershipLabelClass(row.ownershipLabel)}" style="width:${Math.min(100, row.projectedOwnershipPct)}%"></span>
              </div>
            </div>`
            )
            .join('')}
        </div>
      </section>
    `;
  }

  function renderSalaryMovers(movers = {}) {
    const renderList = (title, drivers) => {
      if (!drivers?.length) return '';
      return `
        <div class="fantasy-mover-column">
          <h3 class="fantasy-mover-column__title">${escapeHtml(title)}</h3>
          <div class="fantasy-value-card-grid">
            ${drivers
              .map(
                (driver) => `<article class="fantasy-value-card">
                <div class="fantasy-value-card__name">${driverLink(driver, driver.driverName)}</div>
                <div class="fantasy-value-card__meta">${escapeHtml(driver.tier || '')}</div>
                <div class="fantasy-value-card__stat">${formatMoney(driver.salary)}</div>
                <div class="fantasy-value-card__sub"><span class="fantasy-change ${changeClass(driver.salaryChangeDirection)}">${escapeHtml(driver.salaryChangeLabel || '—')}</span></div>
              </article>`
              )
              .join('')}
          </div>
        </div>
      `;
    };

    const html = [
      renderList('Biggest Risers', movers.biggestRisers),
      renderList('Biggest Fallers', movers.biggestFallers),
    ].join('');
    if (!html.trim()) return '';

    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Salary Movers</h2>
        <div class="fantasy-mover-grid">${html}</div>
      </section>
    `;
  }

  function renderWeeklyBreakdown(breakdown = {}) {
    if (!breakdown?.narrative) return '';
    return `
      <section class="fantasy-app-section fantasy-breakdown-panel">
        <h2 class="fantasy-app-section-title">Weekly Fantasy Breakdown</h2>
        <p class="fantasy-breakdown-narrative">${escapeHtml(breakdown.narrative)}</p>
        <div class="fantasy-breakdown-grid">
          <div><span>Core Picks</span><strong>${escapeHtml(breakdown.thisWeeksCorePicks || '—')}</strong></div>
          <div><span>Best Values</span><strong>${escapeHtml(breakdown.bestValues || '—')}</strong></div>
          <div><span>High Risk / High Reward</span><strong>${escapeHtml(breakdown.highRiskHighReward || '—')}</strong></div>
          <div><span>Drivers To Avoid</span><strong>${escapeHtml(breakdown.driversToAvoid || '—')}</strong></div>
          <div><span>Track History Edge</span><strong>${escapeHtml(breakdown.trackHistoryEdge || '—')}</strong></div>
          <div><span>Predicted Favorite</span><strong>${escapeHtml(breakdown.predictedFavorite || '—')}</strong></div>
        </div>
      </section>
    `;
  }

  function renderDriverTable(drivers = []) {
    const sorted = [...drivers].sort((a, b) => {
      const rankA = a.fantasyRank ?? 999;
      const rankB = b.fantasyRank ?? 999;
      return rankA - rankB;
    });

    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Driver Salaries</h2>
        <div class="fantasy-table-wrap">
          <table class="fantasy-slate-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Driver</th>
                <th>Car #</th>
                <th>Tier</th>
                <th>Salary</th>
                <th>Change</th>
                <th>Value</th>
                <th>Ownership</th>
                <th>Track Rank</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${sorted
                .map(
                  (driver) => `<tr>
                  <td>${driver.fantasyRank != null ? `<span class="fantasy-rank-badge">#${escapeHtml(driver.fantasyRank)}</span>` : '—'}</td>
                  <td>${driverLink(driver, driver.driverName)}</td>
                  <td>${driver.carNumber ? `#${escapeHtml(driver.carNumber)}` : '—'}</td>
                  <td>${renderFantasyTierPill(driver.tier)}</td>
                  <td class="salary">${formatMoney(driver.salary)}</td>
                  <td><span class="fantasy-change ${changeClass(driver.salaryChangeDirection)}">${escapeHtml(driver.salaryChangeLabel || '—')}</span></td>
                  <td class="fantasy-pill-cell">${renderFantasyGradePill(driver.valueGrade)}</td>
                  <td>${driver.projectedOwnershipPct != null ? `${driver.projectedOwnershipPct}%` : '—'}</td>
                  <td>${escapeHtml(driver.trackRankLabel || '—')}</td>
                  <td>${renderFantasyStatusPill(driver.status || 'Active')}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderSlateHeader(slate = {}) {
    return `
      <section class="fantasy-app-hero-panel fantasy-glass-panel">
        <p class="fantasy-app-eyebrow">Race Slate</p>
        <h1 class="fantasy-app-page-title">Race ${escapeHtml(slate.raceNumber ?? '—')} — ${escapeHtml(slate.track || 'TBD')}</h1>
        <div class="fantasy-slate-meta-grid">
          <div><span>Lock</span><strong>${escapeHtml(slate.lockTime || 'TBD')}</strong></div>
          <div><span>Salary Cap</span><strong>${formatMoney(slate.salaryCap ?? 50000)}</strong></div>
          <div><span>Model</span><strong>${escapeHtml(slate.modelVersion || '—')}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(slate.status || 'draft')}</strong></div>
        </div>
        <p class="fantasy-app-readonly-note">Read-only demo slate preview. Lineup submission opens in a later phase.</p>
      </section>
    `;
  }

  function renderSlatePage(data) {
    const root = $('#fantasySlateRoot');
    if (!root) return;
    root.innerHTML = `
      ${renderSlateHeader(data.slate || {})}
      ${renderPowerRankings(data.fantasyPowerRankings || [])}
      ${renderSpotlightCards(data.spotlightCards || {})}
      ${renderOwnershipProjection(data.ownershipProjection || [])}
      ${renderSalaryMovers(data.salaryMovers || data.cards || {})}
      ${renderWeeklyBreakdown(data.weeklyBreakdown || {})}
      ${renderDriverTable(data.drivers || [])}
    `;
  }

  async function loadPublicSlate() {
    try {
      const res = await fetch('/api/settings?action=getFantasyPublicSlate');
      if (!res.ok) {
        renderEmpty('Fantasy slate coming soon.');
        return;
      }
      const data = await res.json();
      renderSlatePage(data);
    } catch {
      renderEmpty('Fantasy slate coming soon.');
    }
  }

  window.BPFantasySlateApp = {
    init() {
      loadPublicSlate();
    },
  };
})();
