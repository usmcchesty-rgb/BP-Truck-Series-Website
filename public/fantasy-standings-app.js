(function () {
  const { escapeHtml } = window.BPFantasyDriverLinks || {
    escapeHtml: (v) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'),
  };

  function $(sel) {
    return document.querySelector(sel);
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString();
  }

  function statusLabel(status) {
    if (status === 'locked') return 'Locked';
    if (status === 'submitted') return 'Submitted';
    return status || '—';
  }

  function renderStandings(data) {
    const slate = data?.slate || null;
    const entries = data?.entries || [];
    const raceComplete = Boolean(slate?.raceComplete || slate?.slatePhase === 'race-complete');
    const scoringPhase = data?.scoringPhase || slate?.scoringPhase || (data?.scoringAvailable ? 'scored' : 'pending');
    const scoringLabel =
      data?.scoringLabel ||
      slate?.scoringLabel ||
      (scoringPhase === 'scored' ? 'Scoring Complete' : scoringPhase === 'needs_review' ? 'Needs Review' : 'Pending');
    const root = $('#fantasyStandingsRoot');
    if (!root) return;

    if (!slate) {
      root.innerHTML = `
        <section class="fantasy-app-placeholder-card">
          <p class="fantasy-app-eyebrow">BP Fantasy</p>
          <h1 class="fantasy-app-page-title">Standings</h1>
          <p class="fantasy-app-lead">No published slate yet.</p>
          <p class="fantasy-app-copy">${escapeHtml(data?.message || 'Standings will appear after a slate is published and race scoring is complete.')}</p>
          <div class="fantasy-cta-actions">
            <a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/slate.html">View Race Slate</a>
            <a class="fantasy-btn fantasy-btn--secondary" href="/fantasy.html">Back to Fantasy Home</a>
          </div>
        </section>`;
      return;
    }

    root.innerHTML = `
      <section class="fantasy-app-hero-panel fantasy-glass-panel">
        <p class="fantasy-app-eyebrow">BP Fantasy Standings</p>
        <h1 class="fantasy-app-page-title">Race ${escapeHtml(slate.raceNumber)} — ${escapeHtml(slate.track || 'TBD')}</h1>
        <div class="fantasy-slate-meta-grid">
          <div><span>Lock</span><strong>${escapeHtml(slate.lockTime || 'TBD')}</strong></div>
          <div><span>Entries</span><strong>${entries.length}</strong></div>
          <div><span>Scoring</span><strong>${escapeHtml(scoringLabel)}</strong></div>
          <div><span>Slate</span><strong>${raceComplete ? 'Race complete' : 'Published'}</strong></div>
        </div>
        <p class="fantasy-app-copy">${escapeHtml(data.message || '')}</p>
      </section>

      <section class="fantasy-app-section fantasy-glass-panel">
        <h2 class="fantasy-app-section-title">Player Standings</h2>
        ${
          entries.length
            ? `<div class="fantasy-table-wrap">
                <table class="fantasy-standings-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Player</th>
                      <th>Status</th>
                      <th>Lineup Salary</th>
                      <th>Race Pts</th>
                      <th>Total Pts</th>
                      <th>Drivers</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${entries
                      .map(
                        (entry) => `<tr>
                          <td>${entry.rank != null ? escapeHtml(entry.rank) : '—'}</td>
                          <td>${escapeHtml(entry.displayName)}</td>
                          <td>${escapeHtml(statusLabel(entry.status))}</td>
                          <td class="salary">${formatMoney(entry.totalSalary)}</td>
                          <td>${entry.racePoints != null ? escapeHtml(entry.racePoints) : '—'}</td>
                          <td>${entry.totalPoints != null ? escapeHtml(entry.totalPoints) : '—'}</td>
                          <td>${(entry.drivers || []).map((d) => escapeHtml(d.driverName)).join(', ') || '—'}</td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>
              <p class="fantasy-app-copy muted">${
                scoringPhase === 'scored'
                  ? 'Points reflect official race results.'
                  : scoringPhase === 'needs_review'
                    ? 'Race scoring is under review. Standings will update after admin approval.'
                    : 'Race scoring pending — no fantasy points posted yet.'
              }</p>`
            : `<p class="fantasy-app-copy">No lineups submitted yet for this race. Be the first — <a class="fantasy-driver-link" href="/fantasy/lineup.html">build your lineup</a>.</p>`
        }
      </section>

      <div class="fantasy-cta-actions">
        <a class="fantasy-btn fantasy-btn--primary" href="/fantasy/lineup.html">Build Lineup</a>
        <a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/dashboard.html">Fantasy Central</a>
      </div>`;
  }

  async function init() {
    const root = $('#fantasyStandingsRoot');
    if (!root) return;

    try {
      const res = await fetch('/api/settings?action=getFantasyStandings');
      const data = res.ok ? await res.json() : { slate: null, entries: [], message: 'Standings unavailable.' };
      renderStandings(data);
      const subtitleEl = document.querySelector('.page-season');
      if (subtitleEl && data?.slate?.raceNumber) {
        subtitleEl.textContent = `RACE ${data.slate.raceNumber} STANDINGS`;
      }
    } catch {
      root.innerHTML = `<section class="fantasy-app-empty"><p>Could not load fantasy standings.</p></section>`;
    }
  }

  window.BPFantasyStandingsApp = { init };
})();
