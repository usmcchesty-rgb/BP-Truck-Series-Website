(function () {
  const { link: driverLink, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    escapeHtml: (v) => String(v ?? ''),
  };

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

  function renderReasons(reasons = []) {
    if (!reasons.length) return '<p class="muted">No breakdown reasons available.</p>';
    return `<ul class="fantasy-driver-reasons">${reasons.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
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

  function renderDriverPage(data) {
    const root = $('#fantasyDriverRoot');
    if (!root) return;

    const driver = data.driver || {};
    const slate = data.slate || {};

    root.innerHTML = `
      <section class="fantasy-app-hero-panel fantasy-glass-panel">
        <p class="fantasy-app-eyebrow">Driver Detail</p>
        <h1 class="fantasy-app-page-title">${escapeHtml(driver.driverName || 'Driver')}${driver.carNumber ? ` <span class="muted">#${escapeHtml(driver.carNumber)}</span>` : ''}</h1>
        <p class="fantasy-app-readonly-note">Race ${escapeHtml(slate.raceNumber ?? '—')} · ${escapeHtml(slate.track || 'TBD')} · Read-only preview</p>
      </section>

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

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Salary History</h2>
        ${renderHistoryTable(data.salaryHistory || [])}
      </section>

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Breakdown Summary</h2>
        ${renderReasons(driver.breakdownSummary || [])}
      </section>

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
      const res = await fetch(`/api/settings?action=getFantasyDriverDetail&${query}`);
      if (!res.ok) {
        renderEmpty('Driver not found in current fantasy slate.');
        return;
      }
      const data = await res.json();
      renderDriverPage(data);
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
