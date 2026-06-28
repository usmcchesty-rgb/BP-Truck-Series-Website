(function () {
  const { link: driverLink, compareUrl, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    compareUrl: () => '/fantasy/compare.html',
    escapeHtml: (v) => String(v ?? ''),
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
  const isDriverInactive = (driver) =>
    Pills.isDriverInactive ? Pills.isDriverInactive(driver) : false;

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

  function mergeDriver(base, detail) {
    return { ...base, ...(detail?.driver || {}) };
  }

  function renderTaleDriverCard(driver, profile) {
    const name = driver.driverName || 'Driver';
    const photoHtml = Photos.renderDriverPhotoImg
      ? Photos.renderDriverPhotoImg({
          profile,
          name,
          className: 'fantasy-compare-tale__photo',
          alt: name,
        })
      : `<img class="fantasy-compare-tale__photo" src="/assets/drivers/placeholder.png" alt="" />`;

    const ownership =
      driver.projectedOwnershipPct != null
        ? `${driver.projectedOwnershipPct}% ${driver.ownershipLabel || ''}`.trim()
        : '—';

    return `
      <article class="fantasy-compare-tale${isDriverInactive(driver) ? ' fantasy-compare-tale--inactive' : ''}">
        <div class="fantasy-compare-tale__photo-wrap">${photoHtml}</div>
        <h2 class="fantasy-compare-tale__name">${driverLink(driver, name)}${driver.carNumber ? ` <span class="muted">#${escapeHtml(driver.carNumber)}</span>` : ''}</h2>
        ${renderActivityStatus(driver, { uppercase: true, showLastStart: true, inlineLastStart: true })}
        <div class="fantasy-compare-tale__facts">
          <div><span>Salary</span><strong class="salary">${formatMoney(driver.salary)}</strong></div>
          <div><span>Fantasy Rank</span><strong>${driver.fantasyRank != null ? `#${escapeHtml(driver.fantasyRank)}` : '—'}</strong></div>
          <div><span>Value Grade</span><strong>${renderFantasyGradePill(driver.valueGrade)}</strong></div>
          <div><span>Ownership</span><strong><span class="fantasy-ownership-tag ${Insights.ownershipLabelClass ? Insights.ownershipLabelClass(driver.ownershipLabel) : ''}">${escapeHtml(ownership)}</span></strong></div>
        </div>
        ${Insights.renderSalaryTrend ? `<div class="fantasy-compare-tale__trend">${Insights.renderSalaryTrend(driver)}</div>` : ''}
        ${Insights.buildFantasyPickOutlook ? `<p class="fantasy-compare-tale__outlook">${escapeHtml(Insights.buildFantasyPickOutlook(driver))}</p>` : ''}
      </article>`;
  }

  function renderEdgeTable(edges, nameA, nameB) {
    return `
      <div class="fantasy-compare-edge-table">
        <div class="fantasy-compare-edge-table__head">
          <span>Category</span>
          <span>${escapeHtml(nameA)}</span>
          <span>${escapeHtml(nameB)}</span>
          <span>Winner</span>
        </div>
        ${edges
          .map((edge) => {
            const aWin = edge.winner === 'a';
            const bWin = edge.winner === 'b';
            const winnerLabel =
              edge.winner === 'even' ? 'Even' : edge.winner === 'a' ? nameA : nameB;
            return `
              <div class="fantasy-compare-edge-table__row${edge.winner === 'even' ? ' is-even' : ''}">
                <div class="fantasy-compare-edge-table__cat">${escapeHtml(edge.category || edge.label || '')}</div>
                <div class="fantasy-compare-edge-table__cell${aWin ? ' is-winner' : ''}">${aWin ? '◀ Edge' : '—'}</div>
                <div class="fantasy-compare-edge-table__cell${bWin ? ' is-winner' : ''}">${bWin ? 'Edge ▶' : '—'}</div>
                <div class="fantasy-compare-edge-table__winner">${escapeHtml(winnerLabel)}</div>
              </div>`;
          })
          .join('')}
      </div>`;
  }

  function renderOverallEdgeCard(edges, a, b) {
    const fantasyEdge = edges.find((e) => e.key === 'fantasy');
    let headline = 'Even fantasy profile';
    let detail = 'Both drivers profile similarly on this slate.';
    if (fantasyEdge?.winner === 'a') {
      headline = `${a.driverName} — Fantasy Edge`;
      detail = `Better overall fantasy rank (#${a.fantasyRank ?? '—'}) on this BP Fantasy slate.`;
    } else if (fantasyEdge?.winner === 'b') {
      headline = `${b.driverName} — Fantasy Edge`;
      detail = `Better overall fantasy rank (#${b.fantasyRank ?? '—'}) on this BP Fantasy slate.`;
    }
    return `
      <article class="fantasy-compare-overall-edge fantasy-glass-panel">
        <p class="fantasy-compare-overall-edge__eyebrow">Overall Fantasy Edge</p>
        <h3 class="fantasy-compare-overall-edge__title">${escapeHtml(headline)}</h3>
        <p class="fantasy-compare-overall-edge__copy">${escapeHtml(detail)}</p>
      </article>`;
  }

  function renderComparison(a, b, detailA, detailB, profileA, profileB) {
    const da = mergeDriver(a, detailA);
    const db = mergeDriver(b, detailB);
    const edges = Insights.buildCompareEdges ? Insights.buildCompareEdges(da, db) : [];
    const verdict = Insights.buildFantasyVerdict ? Insights.buildFantasyVerdict(da, db, edges) : '';

    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Tale of the Tape</h2>
        <p class="fantasy-section-lead muted">BP Fantasy side-by-side comparison — not official race predictions.</p>
        <div class="fantasy-compare-tale-grid">
          ${renderTaleDriverCard(da, profileA)}
          ${renderTaleDriverCard(db, profileB)}
        </div>
      </section>

      ${renderOverallEdgeCard(edges, da, db)}

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Fantasy Edge Breakdown</h2>
        ${renderEdgeTable(edges, da.driverName, db.driverName)}
      </section>

      ${
        verdict
          ? `<section class="fantasy-app-section fantasy-compare-verdict-panel">
              <h2 class="fantasy-app-section-title">BP Fantasy Verdict</h2>
              <p class="fantasy-compare-verdict">${escapeHtml(verdict)}</p>
            </section>`
          : ''
      }
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
        <p class="fantasy-app-eyebrow">BP Fantasy Compare Drivers</p>
        <h1 class="fantasy-app-page-title">Tale of the Tape</h1>
        <p class="fantasy-app-readonly-note">Compare two drivers from the current BP Fantasy slate. Fantasy projections only — not official race predictions.</p>
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
      window.location.href = compareUrl(fd.get('driver1'), fd.get('driver2'));
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
