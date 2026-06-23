(function () {
  const { escapeHtml } = window.BPFantasyDriverLinks || {
    escapeHtml: (v) => String(v ?? ''),
  };

  const PLACEHOLDER_PHOTO = '/assets/drivers/placeholder.png';

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

  function driverImage(name) {
    const slug = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `/assets/drivers/${slug}.png`;
  }

  function normalizeLookupName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findProfileByName(profiles, name, driverId) {
    if (!Array.isArray(profiles) || !profiles.length) return null;

    if (driverId) {
      const match = profiles.find((row) => String(row.driver_id) === String(driverId));
      if (match) return match;
    }

    const lookupName = normalizeLookupName(name);
    if (!lookupName) return null;

    return (
      profiles.find((row) => {
        const names = [row.display_name, row.iracing_name, row.driver_name].map(normalizeLookupName);
        return names.includes(lookupName);
      }) || null
    );
  }

  async function resolveDriverProfile(fantasyDriver = {}, queryId = '', queryName = '') {
    const name = fantasyDriver.driverName || queryName || '';
    const id = fantasyDriver.driverId || queryId || '';

    if (id) {
      try {
        const res = await fetch(`/api/drivers?driver_id=${encodeURIComponent(id)}`);
        if (res.ok) {
          const profile = await res.json();
          if (profile?.driver_id) return profile;
        }
      } catch {
        /* fall through */
      }
    }

    if (name || id) {
      try {
        const res = await fetch('/api/drivers');
        if (res.ok) {
          const profiles = await res.json();
          return findProfileByName(Array.isArray(profiles) ? profiles : [], name, id);
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  function resolveDriverPhoto(profile, name) {
    return profile?.photoUrl || profile?.photo_url || driverImage(name);
  }

  function renderHeroPhoto(profile, name) {
    const photo = resolveDriverPhoto(profile, name);
    return `<div class="fantasy-driver-hero-media">
      <img
        class="fantasy-driver-hero-photo"
        src="${escapeHtml(photo)}"
        alt="${escapeHtml(name)}"
        onerror="this.onerror=null;this.src='${PLACEHOLDER_PHOTO}'"
      />
    </div>`;
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
    const value = driver.valueGrade || '—';
    const trend = driver.salaryChangeLabel || '—';
    const trendClass = changeClass(driver.salaryChangeDirection);

    return `<div class="fantasy-driver-quick-stats">
      <div class="fantasy-driver-quick-stat">
        <span class="fantasy-driver-quick-stat__label">Ownership</span>
        <strong>${escapeHtml(ownership)}</strong>
      </div>
      <div class="fantasy-driver-quick-stat">
        <span class="fantasy-driver-quick-stat__label">Value</span>
        <strong>${driver.valueGrade ? `<span class="fantasy-grade-pill">${escapeHtml(value)}</span>` : escapeHtml(value)}</strong>
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
            ${renderHeroBadges(driver)}
            <p class="fantasy-app-readonly-note">Race ${escapeHtml(slate.raceNumber ?? '—')} · ${escapeHtml(slate.track || 'TBD')} · Read-only preview</p>
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

  function renderRecentFormStrip(driver = {}) {
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

    return `
      <section class="fantasy-app-section fantasy-recent-form-panel">
        <h2 class="fantasy-app-section-title">Recent Form</h2>
        ${body}
        ${summaryLine}
        ${scoreLine}
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

    if (driver.trackHistoryLimitedSample || driver.status === 'Limited sample') {
      risks.push('Limited track-history sample size');
    }

    if (driver.salaryChangeDirection === 'down') {
      risks.push('Salary trending down from prior slate');
    }

    if (grade === 'C' || grade === 'D') {
      risks.push(`Weaker value grade (${driver.valueGrade}) for this salary`);
    }

    if (driver.projectedOwnershipPct != null && driver.projectedOwnershipPct >= 40) {
      risks.push('High projected ownership may limit differentiation');
    }

    return risks.slice(0, 5);
  }

  function renderInsightsSection(driver = {}) {
    const rank = driver.fantasyRank != null ? driver.fantasyRank : '—';
    const positives = buildRankedInsights(driver);
    const risks = buildRiskFactors(driver);

    return `
      <section class="fantasy-app-section fantasy-insight-panel">
        <h2 class="fantasy-app-section-title">Why He's Ranked #${escapeHtml(rank)}</h2>
        ${
          positives.length
            ? `<ul class="fantasy-insight-list fantasy-insight-list--positive">${positives.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
            : '<p class="muted">No insight bullets available.</p>'
        }
        ${
          risks.length
            ? `<h3 class="fantasy-insight-subtitle">Risk Factors</h3>
               <ul class="fantasy-insight-list fantasy-insight-list--risk">${risks.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
            : ''
        }
      </section>
    `;
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

  function renderSalaryTrendCard(history = [], driver = {}) {
    const salaries = history
      .map((row) => Number(row.salary))
      .filter((value) => Number.isFinite(value));

    if (salaries.length <= 1) {
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
        <div class="fantasy-salary-trend-grid">
          <div><span>Current</span><strong class="salary">${formatMoney(driver.salary)}</strong></div>
          <div><span>Previous</span><strong>${formatMoney(driver.previousSalary)}</strong></div>
          <div><span>Change</span><strong><span class="fantasy-change ${changeClass(driver.salaryChangeDirection)}">${escapeHtml(driver.salaryChangeLabel || '—')}</span></strong></div>
          <div><span>High</span><strong class="salary">${formatMoney(highest)}</strong></div>
          <div><span>Low</span><strong class="salary">${formatMoney(lowest)}</strong></div>
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

    const driver = data.driver || {};
    const slate = data.slate || {};
    const history = data.salaryHistory || [];

    root.innerHTML = `
      ${renderHero(driver, slate, profile)}
      ${renderRecentFormStrip(driver)}
      ${renderInsightsSection(driver)}

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Slate Profile</h2>
        <div class="fantasy-driver-detail-grid">
          <div><span>Current Salary</span><strong class="salary">${formatMoney(driver.salary)}</strong></div>
          <div><span>Previous Salary</span><strong>${formatMoney(driver.previousSalary)}</strong></div>
          <div><span>Salary Change</span><strong><span class="fantasy-change ${changeClass(driver.salaryChangeDirection)}">${escapeHtml(driver.salaryChangeLabel || '—')}</span></strong></div>
          <div><span>Value Grade</span><strong>${driver.valueGrade ? `<span class="fantasy-grade-pill">${escapeHtml(driver.valueGrade)}</span>` : '—'}</strong></div>
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
