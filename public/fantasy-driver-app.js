(function () {
  const { escapeHtml, compareUrl } = window.BPFantasyDriverLinks || {
    escapeHtml: (v) => String(v ?? ''),
    compareUrl: () => '/fantasy/compare.html',
  };

  const Pills = window.BPFantasyPills || {};
  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');
  const renderActivityStatus = (driver, options = {}) =>
    Pills.renderActivityStatus
      ? Pills.renderActivityStatus(driver, options)
      : escapeHtml(driver.status || 'Active');

  const Outlook = window.BPFantasyOutlook || {};

  const Photos = window.BPFantasyDriverPhotos || {};

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

  function resolveFantasyRank(driver = {}, detail = {}) {
    if (driver.fantasyRank != null && Number.isFinite(Number(driver.fantasyRank))) {
      return Number(driver.fantasyRank);
    }
    if (detail.fantasyRank != null && Number.isFinite(Number(detail.fantasyRank))) {
      return Number(detail.fantasyRank);
    }
    return null;
  }

  async function resolveDriverProfile(fantasyDriver = {}, queryId = '', queryName = '') {
    if (Photos.resolveDriverProfile) {
      return Photos.resolveDriverProfile(fantasyDriver, queryId, queryName);
    }
    return null;
  }

  function renderHeroPhoto(profile, name) {
    const body = Photos.renderDriverPhotoImg
      ? Photos.renderDriverPhotoImg({
          profile,
          name,
          className: 'fantasy-driver-hero-photo',
          alt: name,
        })
      : `<img class="fantasy-driver-hero-photo" src="/assets/drivers/placeholder.png" alt="${escapeHtml(name)}" />`;
    return `<div class="fantasy-driver-hero-media">${body}</div>`;
  }

  function renderHeroBadges(driver = {}) {
    const badges = [
      driver.tier ? { label: 'Tier', value: driver.tier } : null,
      driver.fantasyRank != null ? { label: 'Fantasy Rank', value: `#${driver.fantasyRank}` } : null,
      driver.trackRankLabel && driver.trackRankLabel !== '—'
        ? { label: 'Track Rank', value: driver.trackRankLabel }
        : null,
    ].filter(Boolean);

    if (!badges.length) return '';

    return `<div class="fantasy-driver-hero-badges">
      ${badges
        .map(
          (badge) => `<span class="fantasy-driver-hero-badge">
            <span class="fantasy-driver-hero-badge__label">${escapeHtml(badge.label)}</span>
            <span class="fantasy-driver-hero-badge__value">${escapeHtml(badge.value)}</span>
          </span>`
        )
        .join('')}
    </div>`;
  }

  function renderHeroQuickStats(driver = {}) {
    const ownership =
      driver.projectedOwnershipPct != null
        ? `${driver.projectedOwnershipPct}%`
        : '—';
    const trend = driver.salaryChangeLabel || '—';
    const trendClass = changeClass(driver.salaryChangeDirection);

    return `<div class="fantasy-driver-quick-stats">
      <div class="fantasy-driver-quick-stat">
        <span class="fantasy-driver-quick-stat__label">Ownership</span>
        <strong>${escapeHtml(ownership)}</strong>
      </div>
      <div class="fantasy-driver-quick-stat">
        <span class="fantasy-driver-quick-stat__label">Value Grade</span>
        ${renderFantasyGradePill(driver.valueGrade)}
      </div>
      <div class="fantasy-driver-quick-stat">
        <span class="fantasy-driver-quick-stat__label">Salary Trend</span>
        <strong><span class="fantasy-change ${trendClass}">${escapeHtml(trend)}</span></strong>
      </div>
      <div class="fantasy-driver-quick-stat">
        <span class="fantasy-driver-quick-stat__label">Current Salary</span>
        <strong class="salary">${formatMoney(driver.salary)}</strong>
      </div>
    </div>`;
  }

  function renderHero(driver = {}, slate = {}, profile = null) {
    const name = driver.driverName || 'Driver';
    return `
      <section class="fantasy-driver-hero fantasy-app-hero-panel fantasy-glass-panel">
        <div class="fantasy-driver-hero-inner">
          <div class="fantasy-driver-hero__content">
            <p class="fantasy-app-eyebrow">Driver Detail</p>
            <h1 class="fantasy-app-page-title">${escapeHtml(name)}${driver.carNumber ? ` <span class="muted">#${escapeHtml(driver.carNumber)}</span>` : ''}</h1>
            <div class="fantasy-driver-hero-share-row">
              <div class="fantasy-driver-activity-header">${renderActivityStatus(driver, { uppercase: true, showLastStart: true, inlineLastStart: true })}</div>
              <div id="fantasyDriverShareHost"></div>
            </div>
            ${renderHeroBadges(driver)}
            <p class="fantasy-app-readonly-note">Race ${escapeHtml(slate.raceNumber ?? '—')} · ${escapeHtml(slate.track || 'TBD')} · Read-only preview</p>
            <p class="fantasy-driver-hero-actions">
              <a class="fantasy-btn fantasy-btn--secondary" href="${escapeHtml(compareUrl(driver))}">Compare Driver</a>
              <a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/slate.html">Back to Race Slate</a>
            </p>
          </div>
          ${renderHeroPhoto(profile, name)}
          ${renderHeroQuickStats(driver)}
        </div>
      </section>
    `;
  }

  function finishPillClass(finish) {
    const n = Number(finish);
    if (n === 1) return 'is-win';
    if (n <= 5) return 'is-strong';
    if (n <= 10) return 'is-mid';
    return 'is-weak';
  }

  function renderRecentFormColumn(driver = {}) {
    const finishes = Array.isArray(driver.recentFormFinishes) ? driver.recentFormFinishes : [];
    const hasPills = finishes.length > 0;

    let body = '';
    if (hasPills) {
      body = `<div class="fantasy-recent-form-pills">
        ${finishes
          .map(
            (finish) =>
              `<span class="fantasy-finish-pill ${finishPillClass(finish)}">P${escapeHtml(finish)}</span>`
          )
          .join('')}
      </div>`;
    } else {
      body = `<p class="fantasy-recent-form-summary">${escapeHtml(driver.recentFormSummary || 'Recent form data unavailable.')}</p>`;
    }

    const scoreLine =
      driver.recentFormScore != null && Number.isFinite(Number(driver.recentFormScore))
        ? `<span class="fantasy-recent-form-score">Form score ${Number(driver.recentFormScore).toFixed(0)}</span>`
        : '';

    const summaryLine =
      hasPills && driver.recentFormSummary
        ? `<p class="fantasy-recent-form-summary">${escapeHtml(driver.recentFormSummary)}</p>`
        : '';

    return `${body}${summaryLine}${scoreLine}    `;
  }

  function renderWeekOutlook(driver = {}, slate = {}) {
    const text = Outlook.buildWeekOutlook
      ? Outlook.buildWeekOutlook(driver, slate)
      : 'Outlook unavailable for this driver.';
    return `
      <section class="fantasy-app-section fantasy-outlook-panel">
        <h2 class="fantasy-app-section-title">This Week Outlook</h2>
        <p class="fantasy-outlook-copy">${escapeHtml(text)}</p>
      </section>
    `;
  }

  function renderDriverAnalysisCard(driver = {}) {
    const rank = driver.fantasyRank != null ? driver.fantasyRank : '—';
    const positives = buildRankedInsights(driver);
    const risks = buildRiskFactors(driver);

    return `
      <section class="fantasy-app-section">
        <div class="fantasy-driver-analysis-card fantasy-glass-panel">
          <div class="fantasy-driver-analysis-grid">
            <div class="fantasy-driver-analysis-col">
              <h3 class="fantasy-driver-analysis-col__title">Recent Form</h3>
              ${renderRecentFormColumn(driver)}
            </div>
            <div class="fantasy-driver-analysis-col">
              <h3 class="fantasy-driver-analysis-col__title">Why He's Ranked #${escapeHtml(rank)}</h3>
              ${
                positives.length
                  ? `<ul class="fantasy-insight-list fantasy-insight-list--positive">${positives.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
                  : '<p class="muted">No insight bullets available.</p>'
              }
            </div>
            <div class="fantasy-driver-analysis-col fantasy-driver-analysis-col--risk">
              <h3 class="fantasy-driver-analysis-col__title">Risk Factors</h3>
              ${
                risks.length
                  ? `<ul class="fantasy-insight-list fantasy-insight-list--risk">${risks.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
                  : '<p class="muted">No major risk flags.</p>'
              }
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function buildRankedInsights(driver = {}) {
    const bullets = [];
    const grade = String(driver.valueGrade || '').toUpperCase();

    if (grade === 'A+' || grade === 'A') {
      bullets.push(`Strong value grade: ${driver.valueGrade}`);
    } else if (driver.valueGrade) {
      bullets.push(`Value grade: ${driver.valueGrade}`);
    }

    if (driver.projectedOwnershipPct != null) {
      bullets.push(
        `Projected ownership: ${driver.projectedOwnershipPct}% ${driver.ownershipLabel || ''}`.trim()
      );
    }

    if (driver.provenTrackHistoryRank != null && Number(driver.provenTrackHistoryRank) <= 5) {
      bullets.push(`Proven track rank: #${driver.provenTrackHistoryRank}`);
    } else if (driver.trackRankLabel && driver.trackRankLabel !== '—') {
      bullets.push(`Track rank: ${driver.trackRankLabel}`);
    }

    if (driver.recentFormSummary) {
      bullets.push(`Recent form: ${driver.recentFormSummary}`);
    }

    if (driver.salary != null && driver.tier) {
      bullets.push(`Salary: ${formatMoney(driver.salary)} ${driver.tier} tier`);
    } else if (driver.salary != null) {
      bullets.push(`Salary: ${formatMoney(driver.salary)}`);
    }

    if (driver.fantasyRank != null) {
      bullets.push(`Fantasy tier score: ${driver.fantasyTierScore != null ? Number(driver.fantasyTierScore).toFixed(1) : '—'}`);
    }

    return bullets.slice(0, 6);
  }

  function buildRiskFactors(driver = {}) {
    const risks = [];
    const grade = String(driver.valueGrade || '').toUpperCase();
    const salary = Number(driver.salary);

    if (Number.isFinite(salary) && salary >= 13000) {
      risks.push('Higher salary requires a strong finish to pay off');
    }

    if (driver.provenTrackHistoryRank != null && Number(driver.provenTrackHistoryRank) > 5) {
      risks.push(`Track history outside top 5 (#${driver.provenTrackHistoryRank})`);
    } else if (
      driver.trackRankLabel &&
      driver.trackRankLabel !== '—' &&
      !driver.provenTrackHistoryRank
    ) {
      risks.push(`Track history outside top 5 (${driver.trackRankLabel})`);
    }

    if (driver.trackHistoryLimitedSample) {
      risks.push('Limited track-history sample size');
    }

    if (driver.salaryChangeDirection === 'down') {
      risks.push('Salary trending down from prior slate');
    }

    if (grade === 'C' || grade === 'D') {
      risks.push(`Weaker value grade (${driver.valueGrade}) for this salary`);
    }

    if (driver.projectedOwnershipPct != null && driver.projectedOwnershipPct >= 40) {
      risks.push('High projected ownership means many players may choose him');
    }

    return risks.slice(0, 5);
  }

  function renderModelBreakdown(reasons = []) {
    if (!reasons.length) {
      return `
        <section class="fantasy-app-section">
          <details class="fantasy-model-breakdown">
            <summary class="fantasy-app-section-title">Model Breakdown</summary>
            <p class="muted">No model breakdown lines available.</p>
          </details>
        </section>
      `;
    }

    return `
      <section class="fantasy-app-section">
        <details class="fantasy-model-breakdown">
          <summary class="fantasy-app-section-title">Model Breakdown</summary>
          <ul class="fantasy-driver-reasons fantasy-driver-reasons--compact">${reasons.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
        </details>
      </section>
    `;
  }

  function renderSalaryChart(history = []) {
    if (!history.length) return '';

    const chronological = [...history].sort(
      (a, b) => Number(a.raceNumber) - Number(b.raceNumber)
    );
    const salaries = chronological.map((row) => Number(row.salary)).filter(Number.isFinite);
    if (!salaries.length) return '';

    const maxSalary = Math.max(...salaries);
    const minSalary = Math.min(...salaries);

    const bars = chronological
      .map((row, index) => {
        const salary = Number(row.salary);
        const prev = index > 0 ? Number(chronological[index - 1].salary) : null;
        let changeLabel = '—';
        let changeClass = 'is-same';
        if (prev != null && Number.isFinite(prev)) {
          const delta = salary - prev;
          if (delta > 0) {
            changeLabel = `+$${delta.toLocaleString('en-US')}`;
            changeClass = 'is-up';
          } else if (delta < 0) {
            changeLabel = `-$${Math.abs(delta).toLocaleString('en-US')}`;
            changeClass = 'is-down';
          } else {
            changeLabel = 'No change';
          }
        } else if (index === 0) {
          changeLabel = 'First tracked';
        }

        const heightPct = maxSalary > 0 ? Math.max(8, (salary / maxSalary) * 100) : 8;

        return `
          <div class="fantasy-salary-chart-bar">
            <div class="fantasy-salary-chart-bar__value salary">${formatMoney(salary)}</div>
            <div class="fantasy-salary-chart-bar__col" style="height:${heightPct.toFixed(1)}%"></div>
            <div class="fantasy-salary-chart-bar__race">R${escapeHtml(row.raceNumber)}</div>
            <div class="fantasy-salary-chart-bar__change fantasy-change ${changeClass}">${escapeHtml(changeLabel)}</div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="fantasy-salary-chart" aria-label="Salary history chart">
        ${bars}
      </div>
      <div class="fantasy-salary-chart-legend muted">Bar height = salary relative to highest tracked race (${formatMoney(maxSalary)}). Lowest tracked: ${formatMoney(minSalary)}.</div>
    `;
  }

  function renderSalaryTrendCard(history = [], driver = {}) {
    const salaries = history
      .map((row) => Number(row.salary))
      .filter((value) => Number.isFinite(value));

    if (salaries.length < 2) {
      return `
        <section class="fantasy-app-section fantasy-salary-trend-card">
          <h2 class="fantasy-app-section-title">Salary Trend</h2>
          <p class="fantasy-insights-notice">More salary trend data will appear after additional slates are generated.</p>
          <div class="fantasy-salary-trend-grid">
            <div><span>Current</span><strong class="salary">${formatMoney(driver.salary)}</strong></div>
            <div><span>Previous</span><strong>${formatMoney(driver.previousSalary)}</strong></div>
            <div><span>Change</span><strong><span class="fantasy-change ${changeClass(driver.salaryChangeDirection)}">${escapeHtml(driver.salaryChangeLabel || '—')}</span></strong></div>
          </div>
        </section>
      `;
    }

    const highest = Math.max(...salaries);
    const lowest = Math.min(...salaries);

    return `
      <section class="fantasy-app-section fantasy-salary-trend-card">
        <h2 class="fantasy-app-section-title">Salary Trend</h2>
        ${renderSalaryChart(history)}
        <div class="fantasy-salary-trend-grid">
          <div><span>Current</span><strong class="salary">${formatMoney(driver.salary)}</strong></div>
          <div><span>Change</span><strong><span class="fantasy-change ${changeClass(driver.salaryChangeDirection)}">${escapeHtml(driver.salaryChangeLabel || '—')}</span></strong></div>
          <div><span>Highest</span><strong class="salary">${formatMoney(highest)}</strong></div>
          <div><span>Lowest</span><strong class="salary">${formatMoney(lowest)}</strong></div>
          <div><span>Races Tracked</span><strong>${salaries.length}</strong></div>
        </div>
      </section>
    `;
  }

  function renderHistoryTable(history = []) {
    if (!history.length) {
      return '<p class="muted">No salary history rows for this driver yet.</p>';
    }
    return `
      <div class="fantasy-table-wrap">
        <table class="fantasy-slate-table fantasy-slate-table--compact">
          <thead><tr><th>Race</th><th>Track</th><th>Salary</th><th>Tier</th><th>Score</th></tr></thead>
          <tbody>
            ${history
              .map(
                (row) => `<tr>
                <td>${escapeHtml(row.raceNumber)}</td>
                <td>${escapeHtml(row.track)}</td>
                <td class="salary">${formatMoney(row.salary)}</td>
                <td>${escapeHtml(row.tier)}</td>
                <td>${Number(row.fantasyScore).toFixed(1)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function queryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      id: params.get('id') || params.get('driverId') || '',
      driver: params.get('driver') || params.get('driverName') || '',
    };
  }

  function renderEmpty(message) {
    const root = $('#fantasyDriverRoot');
    if (!root) return;
    root.innerHTML = `
      <section class="fantasy-app-empty">
        <p>${escapeHtml(message)}</p>
        <a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/slate.html">Back to Race Slate</a>
      </section>
    `;
  }

  function renderDriverPage(data, profile = null) {
    const root = $('#fantasyDriverRoot');
    if (!root) return;

    const driver = {
      ...(data.driver || {}),
      fantasyRank: resolveFantasyRank(data.driver || {}, data),
    };
    const slate = data.slate || {};
    const history = data.salaryHistory || [];

    root.innerHTML = `
      ${renderHero(driver, slate, profile)}
      ${renderWeekOutlook(driver, slate)}
      ${renderDriverAnalysisCard(driver)}

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Slate Profile</h2>
        <div class="fantasy-driver-detail-grid">
          <div><span>Current Salary</span><strong class="salary">${formatMoney(driver.salary)}</strong></div>
          <div><span>Previous Salary</span><strong>${formatMoney(driver.previousSalary)}</strong></div>
          <div><span>Salary Change</span><strong><span class="fantasy-change ${changeClass(driver.salaryChangeDirection)}">${escapeHtml(driver.salaryChangeLabel || '—')}</span></strong></div>
          <div class="fantasy-driver-quick-stat">
            <span class="fantasy-driver-quick-stat__label">Value Grade</span>
            ${renderFantasyGradePill(driver.valueGrade)}
          </div>
          <div><span>Value Score</span><strong>${driver.valueScore != null ? Number(driver.valueScore).toFixed(2) : '—'}</strong></div>
          <div><span>Fantasy Rank</span><strong>${driver.fantasyRank != null ? `#${escapeHtml(driver.fantasyRank)}` : '—'}</strong></div>
          <div><span>Tier</span><strong>${escapeHtml(driver.tier || '—')}</strong></div>
          <div><span>Track Rank</span><strong>${escapeHtml(driver.trackRankLabel || '—')}</strong></div>
          <div><span>Proven Track Rank</span><strong>${driver.provenTrackHistoryRank != null ? `#${escapeHtml(driver.provenTrackHistoryRank)}` : '—'}</strong></div>
          <div><span>Projected Ownership</span><strong>${driver.projectedOwnershipPct != null ? `${driver.projectedOwnershipPct}% (${escapeHtml(driver.ownershipLabel || '')})` : '—'}</strong></div>
          <div><span>Fantasy Tier Score</span><strong>${driver.fantasyTierScore != null ? Number(driver.fantasyTierScore).toFixed(1) : '—'}</strong></div>
          <div><span>Recent Form</span><strong>${escapeHtml(driver.recentFormSummary || '—')}</strong></div>
        </div>
      </section>

      ${renderSalaryTrendCard(history, driver)}

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Salary History</h2>
        ${renderHistoryTable(history)}
      </section>

      ${renderModelBreakdown(driver.breakdownSummary || [])}

      <p><a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/slate.html">Back to Race Slate</a></p>
    `;

    const shareTitle = `${driver.driverName || 'Driver'} — BP Fantasy`;
    const shareText = `BP Fantasy profile for ${driver.driverName || 'driver'} — salary ${driver.salary != null ? `$${Number(driver.salary).toLocaleString('en-US')}` : 'TBD'}, tier ${driver.tier || '—'}.`;
    if (window.BPShare?.initPageShare) {
      window.BPShare.initPageShare('#fantasyDriverShareHost', {
        title: shareTitle,
        text: shareText,
        description: shareText,
        url: window.location.href,
        image: '/assets/fantasy/fantasy-logo.png',
        type: 'website',
      });
    }
  }

  async function loadDriverDetail() {
    const { id, driver } = queryParams();
    if (!id && !driver) {
      renderEmpty('Driver not found in current fantasy slate.');
      return;
    }

    const query = id
      ? `id=${encodeURIComponent(id)}`
      : `driver=${encodeURIComponent(driver)}`;

    try {
      const [detailRes, profile] = await Promise.all([
        fetch(`/api/settings?action=getFantasyDriverDetail&${query}`),
        resolveDriverProfile({ driverId: id, driverName: driver }, id, driver),
      ]);

      if (!detailRes.ok) {
        renderEmpty('Driver not found in current fantasy slate.');
        return;
      }

      const data = await detailRes.json();
      const resolvedProfile =
        profile || (await resolveDriverProfile(data.driver || {}, id, driver));
      renderDriverPage(data, resolvedProfile);
    } catch {
      renderEmpty('Driver not found in current fantasy slate.');
    }
  }

  window.BPFantasyDriverApp = {
    init() {
      loadDriverDetail();
    },
  };
})();
