(function () {
  const { link: driverLink, compareUrl, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    compareUrl: () => '/fantasy/compare.html',
    escapeHtml: (v) => String(v ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');

  const Photos = window.BPFantasyDriverPhotos || {};
  let slateDrivers = [];

  function $(sel) {
    return document.querySelector(sel);
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function queryParams() {
    const p = new URLSearchParams(window.location.search);
    return {
      driver1: p.get('driver1') || p.get('d1') || '',
      driver2: p.get('driver2') || p.get('d2') || '',
    };
  }

  function firstName(name) {
    return String(name || 'Driver').trim().split(/\s+/)[0] || 'Driver';
  }

  function compareAdvantage(aVal, bVal, nameA, nameB, { lowerWins = false, epsilon = 0.05 } = {}) {
    const a = Number(aVal);
    const b = Number(bVal);
    const aOk = Number.isFinite(a);
    const bOk = Number.isFinite(b);
    if (!aOk && !bOk) return 'Even';
    if (!aOk) return `Advantage: ${firstName(nameB)}`;
    if (!bOk) return `Advantage: ${firstName(nameA)}`;
    const diff = lowerWins ? b - a : a - b;
    if (Math.abs(diff) <= epsilon) return 'Even';
    return diff > 0 ? `Advantage: ${firstName(nameA)}` : `Advantage: ${firstName(nameB)}`;
  }

  function buildAdvantageRows(a, b) {
    return [
      {
        label: 'Overall Fantasy Rank',
        ...(() => {
          const verdict = compareAdvantage(a.fantasyRank, b.fantasyRank, a.driverName, b.driverName, {
            lowerWins: true,
            epsilon: 0,
          });
          return { verdict };
        })(),
      },
      {
        label: 'Salary Efficiency',
        verdict: compareAdvantage(a.valueScore, b.valueScore, a.driverName, b.driverName),
      },
      {
        label: 'Track History',
        verdict: compareAdvantage(
          a.provenTrackHistoryRank ?? a.trackRank,
          b.provenTrackHistoryRank ?? b.trackRank,
          a.driverName,
          b.driverName,
          { lowerWins: true, epsilon: 0 }
        ),
      },
      {
        label: 'Recent Form',
        verdict: compareAdvantage(a.recentFormScore, b.recentFormScore, a.driverName, b.driverName),
      },
      {
        label: 'Ownership Leverage',
        verdict: compareAdvantage(
          a.projectedOwnershipPct,
          b.projectedOwnershipPct,
          a.driverName,
          b.driverName,
          { lowerWins: true, epsilon: 0.5 }
        ),
      },
      {
        label: 'Salary Savings',
        verdict: compareAdvantage(a.salary, b.salary, a.driverName, b.driverName, {
          lowerWins: true,
          epsilon: 0,
        }),
      },
    ];
  }

  function finishPillClass(finish) {
    const n = Number(finish);
    if (n === 1) return 'is-win';
    if (n <= 5) return 'is-strong';
    if (n <= 10) return 'is-mid';
    return 'is-weak';
  }

  function renderFinishPills(finishes) {
    if (!Array.isArray(finishes) || !finishes.length) return '<span class="muted">—</span>';
    return finishes
      .map(
        (f) =>
          `<span class="fantasy-finish-pill ${finishPillClass(f)}">P${escapeHtml(f)}</span>`
      )
      .join('');
  }

  function statRow(label, value) {
    return `<div class="fantasy-compare-stat"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
  }

  function renderDriverCard(driver, detail, profile) {
    const d = { ...driver, ...(detail?.driver || {}) };
    const historyCount = Array.isArray(detail?.salaryHistory) ? detail.salaryHistory.length : 0;
    const name = d.driverName || 'Driver';
    const photoHtml = Photos.renderDriverPhotoImg
      ? Photos.renderDriverPhotoImg({
          profile,
          name,
          className: 'fantasy-compare-card__photo-img',
          alt: name,
        })
      : `<img class="fantasy-compare-card__photo-img" src="/assets/drivers/placeholder.png" alt="" />`;

    return `
      <article class="fantasy-compare-card">
        <div class="fantasy-compare-card__photo">
          ${photoHtml}
        </div>
        <h2 class="fantasy-compare-card__name">${driverLink(d, name)}${d.carNumber ? ` <span class="muted">#${escapeHtml(d.carNumber)}</span>` : ''}</h2>
        <div class="fantasy-compare-card__stats">
          ${statRow('Tier', escapeHtml(d.tier || '—'))}
          ${statRow('Salary', `<span class="salary">${formatMoney(d.salary)}</span>`)}
          ${statRow('Salary Change', escapeHtml(d.salaryChangeLabel || '—'))}
          ${statRow('Fantasy Rank', d.fantasyRank != null ? `#${escapeHtml(d.fantasyRank)}` : '—')}
          ${statRow('Value Grade', renderFantasyGradePill(d.valueGrade))}
          ${statRow('Value Score', d.valueScore != null ? Number(d.valueScore).toFixed(2) : '—')}
          ${statRow('Projected Ownership', d.projectedOwnershipPct != null ? `${d.projectedOwnershipPct}% (${escapeHtml(d.ownershipLabel || '')})` : '—')}
          ${statRow('Track Rank', escapeHtml(d.trackRankLabel || '—'))}
          ${statRow('Proven Track Rank', d.provenTrackHistoryRank != null ? `#${escapeHtml(d.provenTrackHistoryRank)}` : '—')}
          ${statRow('Recent Form', escapeHtml(d.recentFormSummary || '—'))}
          ${statRow('Last Finishes', renderFinishPills(d.recentFormFinishes))}
          ${statRow('Fantasy Tier Score', d.fantasyTierScore != null ? Number(d.fantasyTierScore).toFixed(1) : '—')}
          ${statRow('Salary History Races', String(historyCount))}
        </div>
      </article>
    `;
  }

  function renderComparison(a, b, detailA, detailB, profileA, profileB) {
    const rows = buildAdvantageRows(
      { ...a, ...(detailA?.driver || {}) },
      { ...b, ...(detailB?.driver || {}) }
    );

    return `
      <div class="fantasy-compare-grid">
        ${renderDriverCard(a, detailA, profileA)}
        ${renderDriverCard(b, detailB, profileB)}
      </div>
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Advantage Summary</h2>
        <div class="fantasy-table-wrap">
          <table class="fantasy-slate-table">
            <thead><tr><th>Category</th><th>Edge</th></tr></thead>
            <tbody>
              ${rows
                .map(
                  (row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.verdict)}</td></tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderSelectors(selected1, selected2) {
    const options = slateDrivers
      .map(
        (d) =>
          `<option value="${escapeHtml(d.driverName)}">${escapeHtml(d.driverName)}</option>`
      )
      .join('');

    return `
      <section class="fantasy-app-section fantasy-compare-controls">
        <form class="fantasy-compare-form" id="fantasyCompareForm">
          <label>Driver 1
            <select name="driver1" class="fantasy-compare-select">${options}</select>
          </label>
          <label>Driver 2
            <select name="driver2" class="fantasy-compare-select">${options}</select>
          </label>
          <button type="submit" class="fantasy-btn fantasy-btn--primary">Compare</button>
        </form>
      </section>
    `;
  }

  async function fetchDriverDetail(driver) {
    const q = driver.driverId
      ? `id=${encodeURIComponent(driver.driverId)}`
      : `driver=${encodeURIComponent(driver.driverName)}`;
    const res = await fetch(`/api/settings?action=getFantasyDriverDetail&${q}`);
    if (!res.ok) return null;
    return res.json();
  }

  function findDriverByName(name) {
    return slateDrivers.find(
      (d) => String(d.driverName).toLowerCase() === String(name).toLowerCase()
    );
  }

  function renderCompareHeader() {
    return `
      <section class="fantasy-app-hero-panel fantasy-glass-panel">
        <p class="fantasy-app-eyebrow">Driver Compare</p>
        <h1 class="fantasy-app-page-title">Side-by-Side Matchup</h1>
        <p class="fantasy-app-readonly-note">Compare two drivers from the current fantasy slate. Read-only demo.</p>
      </section>
    `;
  }

  async function runCompare(driver1Name, driver2Name) {
    const root = $('#fantasyCompareRoot');
    if (!root) return;

    const a = findDriverByName(driver1Name);
    const b = findDriverByName(driver2Name);
    if (!a || !b) {
      root.innerHTML = `<section class="fantasy-app-empty"><p>Select two drivers from the current slate.</p></section>`;
      return;
    }
    if (a.driverId === b.driverId) {
      root.innerHTML = `<section class="fantasy-app-empty"><p>Choose two different drivers to compare.</p></section>`;
      return;
    }

    root.innerHTML = `<section class="fantasy-app-empty"><p>Loading comparison…</p></section>`;

    const [detailA, detailB, profileA, profileB] = await Promise.all([
      fetchDriverDetail(a),
      fetchDriverDetail(b),
      Photos.resolveDriverProfile ? Photos.resolveDriverProfile(a) : null,
      Photos.resolveDriverProfile ? Photos.resolveDriverProfile(b) : null,
    ]);

    root.innerHTML = `
      ${renderCompareHeader()}
      ${renderSelectors(driver1Name, driver2Name)}
      ${renderComparison(a, b, detailA, detailB, profileA, profileB)}
    `;

    const form = $('#fantasyCompareForm');
    const sel1 = root.querySelector('select[name="driver1"]');
    const sel2 = root.querySelector('select[name="driver2"]');
    if (sel1) sel1.value = driver1Name;
    if (sel2) sel2.value = driver2Name;
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const d1 = fd.get('driver1');
      const d2 = fd.get('driver2');
      window.location.href = compareUrl(d1, d2);
    });
  }

  async function init() {
    const root = $('#fantasyCompareRoot');
    const { driver1, driver2 } = queryParams();

    try {
      const res = await fetch('/api/settings?action=getFantasyPublicSlate');
      if (!res.ok) throw new Error('slate');
      const data = await res.json();
      slateDrivers = [...(data.drivers || [])].sort((x, y) =>
        String(x.driverName).localeCompare(String(y.driverName))
      );

      if (!slateDrivers.length) {
        root.innerHTML = `<section class="fantasy-app-empty"><p>Fantasy slate coming soon.</p></section>`;
        return;
      }

      const d1 = driver1 || slateDrivers[0].driverName;
      const d2 = driver2 || slateDrivers[Math.min(1, slateDrivers.length - 1)].driverName;
      await runCompare(d1, d2);
    } catch {
      root.innerHTML = `<section class="fantasy-app-empty"><p>Fantasy slate coming soon.</p></section>`;
    }
  }

  window.BPFantasyCompareApp = { init };
})();
