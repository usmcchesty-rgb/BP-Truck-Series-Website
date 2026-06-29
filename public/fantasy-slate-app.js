(function () {
  const { link: driverLink, escapeHtml, compareUrl } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    escapeHtml: (v) => String(v ?? ''),
    compareUrl: () => '/fantasy/compare.html',
  };

  const Pills = window.BPFantasyPills || {};
  const Insights = window.BPFantasyInsights || {};
  const Photos = window.BPFantasyDriverPhotos || {};
  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');
  const renderActivityStatus = (driver, options) =>
    Pills.renderActivityStatus
      ? Pills.renderActivityStatus(driver, options)
      : escapeHtml(driver.status || 'Active');
  const driverInactiveRowClass = (driver) =>
    Pills.driverInactiveRowClass ? Pills.driverInactiveRowClass(driver) : '';

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
    if (Insights.ownershipLabelClass) return Insights.ownershipLabelClass(label);
    const map = {
      Favorite: 'is-favorite',
      Popular: 'is-popular',
      Moderate: 'is-moderate',
      Balanced: 'is-moderate',
      Sleeper: 'is-sleeper',
      'Dark Horse': 'is-dark-horse',
    };
    return map[label] || '';
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
                  <td class="fantasy-value-grade-cell">${renderFantasyGradePill(row.valueGrade)}</td>
                  <td>${row.projectedOwnership != null ? `${row.projectedOwnership}% <span class="fantasy-ownership-tag ${ownershipLabelClass(row.ownershipLabel)}">${escapeHtml(row.ownershipLabel || '')}</span>` : '—'}</td>
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
                <span>${row.projectedOwnershipPct}% · ${escapeHtml(row.ownershipLabel || '')}</span>
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

  function renderDriverCards(drivers = []) {
    const top = [...drivers]
      .sort((a, b) => Number(a.fantasyRank ?? 999) - Number(b.fantasyRank ?? 999))
      .slice(0, 8);
    if (!top.length || !Insights.renderDriverCard) return '';

    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">BP Fantasy Driver Cards</h2>
        <p class="fantasy-section-lead muted">Fantasy pick outlooks for the top-ranked drivers on this slate — not official race predictions.</p>
        <div class="fantasy-driver-card-grid">
          ${top.map((driver) => Insights.renderDriverCard(driver)).join('')}
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
                  (driver) => {
                  const inactiveClass = driverInactiveRowClass(driver);
                  return `<tr${inactiveClass ? ` class="${inactiveClass}"` : ''}>
                  <td>${driver.fantasyRank != null ? `<span class="fantasy-rank-badge">#${escapeHtml(driver.fantasyRank)}</span>` : '—'}</td>
                  <td>${driverLink(driver, driver.driverName)} <a class="fantasy-compare-link" href="${escapeHtml(compareUrl(driver))}">Compare</a></td>
                  <td>${driver.carNumber ? `#${escapeHtml(driver.carNumber)}` : '—'}</td>
                  <td><span class="fantasy-tier-pill">${escapeHtml(driver.tier || '—')}</span></td>
                  <td class="salary">${formatMoney(driver.salary)}</td>
                  <td><span class="fantasy-change ${changeClass(driver.salaryChangeDirection)}">${escapeHtml(driver.salaryChangeLabel || '—')}</span></td>
                  <td class="fantasy-value-grade-cell">${renderFantasyGradePill(driver.valueGrade)}</td>
                  <td>${driver.projectedOwnershipPct != null ? `${driver.projectedOwnershipPct}% <span class="fantasy-ownership-tag ${ownershipLabelClass(driver.ownershipLabel)}">${escapeHtml(driver.ownershipLabel || '')}</span>` : '—'}</td>
                  <td>${escapeHtml(driver.trackRankLabel || '—')}</td>
                  <td>${renderActivityStatus(driver, { uppercase: false })}</td>
                </tr>`;
                }
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderSlateHeader(slate = {}, progression = {}) {
    const raceComplete = Boolean(slate.raceComplete || slate.slatePhase === 'race-complete' || progression?.slatePhase === 'race-complete');
    const playable = slate.playable !== false && progression?.isPlayable !== false;
    const statusLabel = raceComplete
      ? 'Race complete — scoring pending'
      : playable
        ? 'Published'
        : 'Archived';

    return `
      <section class="fantasy-app-hero-panel fantasy-glass-panel">
        <div class="fantasy-hero-header-row">
          <div>
            <p class="fantasy-app-eyebrow">${raceComplete ? 'Archived Race Slate' : 'Race Slate'}</p>
            <h1 class="fantasy-app-page-title">Race ${escapeHtml(slate.raceNumber ?? '—')} — ${escapeHtml(slate.track || 'TBD')}</h1>
          </div>
          <div id="fantasySlateShareHost"></div>
        </div>
        ${raceComplete ? '<p class="fantasy-lineup-warning">Results are posted for this race. This slate is archived — lineup submission is closed.</p>' : ''}
        <div class="fantasy-slate-meta-grid">
          <div><span>Lock</span><strong>${escapeHtml(slate.lockTime || 'TBD')}</strong></div>
          <div><span>Salary Cap</span><strong>${formatMoney(slate.salaryCap ?? 50000)}</strong></div>
          <div><span>Model</span><strong>${escapeHtml(slate.modelVersion || '—')}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(statusLabel)}</strong></div>
        </div>
        <p class="fantasy-slate-hero-actions">
          ${playable ? '<a class="fantasy-btn fantasy-btn--primary" href="/fantasy/lineup.html">Build Lineup</a>' : '<a class="fantasy-btn fantasy-btn--primary" href="/fantasy/standings.html">View Standings</a>'}
          <a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/preview.html">Race Preview</a>
        </p>
      </section>
    `;
  }

  function mountSlateShare(slate = {}) {
    if (!window.BPShare?.initPageShare) return;
    const raceNumber = slate.raceNumber ?? '—';
    const track = slate.track || 'TBD';
    const title = `BP Fantasy Race Slate — Race ${raceNumber} — ${track}`;
    const text = `BP Fantasy slate for Race ${raceNumber} at ${track}. Salaries, tiers, and fantasy driver rankings.`;
    window.BPShare.initPageShare('#fantasySlateShareHost', {
      title,
      text,
      description: text,
      url: window.location.href,
      image: '/assets/fantasy/fantasy-logo.png',
      type: 'website',
    });
  }

  function renderSlatePage(data) {
    const root = $('#fantasySlateRoot');
    if (!root) return;
    root.innerHTML = `
      ${renderSlateHeader(data.slate || {}, data.progression || {})}
      ${Insights.renderProphetSection ? Insights.renderProphetSection(Insights.buildProphetLines?.(data.drivers || [], data.slate || {}) || []) : ''}
      ${renderDriverCards(data.drivers || [])}
      ${renderPowerRankings(data.fantasyPowerRankings || [])}
      ${renderSpotlightCards(data.spotlightCards || {})}
      ${renderOwnershipProjection(data.ownershipProjection || [])}
      ${renderSalaryMovers(data.salaryMovers || data.cards || {})}
      ${renderWeeklyBreakdown(data.weeklyBreakdown || {})}
      ${renderDriverTable(data.drivers || [])}
    `;
    mountSlateShare(data.slate || {});
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
      const subtitleEl = document.querySelector('.page-season');
      if (subtitleEl && data?.slate) {
        const raceNumber = data.slate.raceNumber ?? '—';
        const track = data.slate.track || 'TBD';
        const archived = data.slate.raceComplete || data.slate.slatePhase === 'race-complete';
        subtitleEl.textContent = archived
          ? `RACE ${raceNumber} ARCHIVE`
          : `RACE ${raceNumber} — ${String(track).toUpperCase()}`;
      }
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
