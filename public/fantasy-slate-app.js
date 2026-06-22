(function () {
  function $(selector) {
    return document.querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function renderEmpty(message) {
    const root = $('#fantasySlateRoot');
    if (!root) return;
    root.innerHTML = `<section class="fantasy-app-empty"><p>${escapeHtml(message)}</p><a class="fantasy-btn fantasy-btn--secondary" href="/fantasy.html">Back to Fantasy Home</a></section>`;
  }

  function renderCardGrid(title, cards, renderCard) {
    if (!cards?.length) return '';
    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">${escapeHtml(title)}</h2>
        <div class="fantasy-value-card-grid">
          ${cards.map(renderCard).join('')}
        </div>
      </section>
    `;
  }

  function renderDriverCard(driver, extra = '') {
    return `
      <article class="fantasy-value-card">
        <div class="fantasy-value-card__name">${escapeHtml(driver.driverName)}</div>
        <div class="fantasy-value-card__meta">${escapeHtml(driver.carNumber ? `#${driver.carNumber}` : '')} ${escapeHtml(driver.tier || '')}</div>
        <div class="fantasy-value-card__stat">${formatMoney(driver.salary)}</div>
        ${driver.valueGrade ? `<div class="fantasy-value-card__badge">${escapeHtml(driver.valueGrade)}</div>` : ''}
        ${extra ? `<div class="fantasy-value-card__sub">${extra}</div>` : ''}
      </article>
    `;
  }

  function renderCards(cards = {}) {
    return [
      renderCardGrid('Best Value Picks', cards.bestValuePicks, (driver) =>
        renderDriverCard(driver, `Value ${escapeHtml(driver.valueScore ?? '—')}`)
      ),
      renderCardGrid('Biggest Salary Risers', cards.biggestRisers, (driver) =>
        renderDriverCard(driver, escapeHtml(driver.salaryChangeLabel || ''))
      ),
      renderCardGrid('Biggest Salary Fallers', cards.biggestFallers, (driver) =>
        renderDriverCard(driver, escapeHtml(driver.salaryChangeLabel || ''))
      ),
      renderCardGrid('Highest Salaries', cards.highestSalaries, (driver) => renderDriverCard(driver)),
      renderCardGrid(
        'Top Proven Track History Drivers',
        cards.topTrackHistory,
        (driver) =>
          renderDriverCard(
            driver,
            `Track rank ${escapeHtml(driver.trackRankLabel || '—')}`
          )
      ),
    ].join('');
  }

  function renderDriverTable(drivers = []) {
    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Driver Salaries</h2>
        <div class="fantasy-table-wrap">
          <table class="fantasy-slate-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Car #</th>
                <th>Tier</th>
                <th>Salary</th>
                <th>Change</th>
                <th>Value</th>
                <th>Track Rank</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${drivers
                .map(
                  (driver) => `<tr>
                  <td>${escapeHtml(driver.driverName)}</td>
                  <td>${driver.carNumber ? `#${escapeHtml(driver.carNumber)}` : '—'}</td>
                  <td><span class="fantasy-tier-pill">${escapeHtml(driver.tier || '—')}</span></td>
                  <td class="salary">${formatMoney(driver.salary)}</td>
                  <td><span class="fantasy-change ${changeClass(driver.salaryChangeDirection)}">${escapeHtml(driver.salaryChangeLabel || '—')}</span></td>
                  <td>${driver.valueGrade ? `<span class="fantasy-grade-pill">${escapeHtml(driver.valueGrade)}</span>` : '—'}</td>
                  <td>${escapeHtml(driver.trackRankLabel || '—')}</td>
                  <td>${escapeHtml(driver.status || 'Active')}</td>
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
      ${renderCards(data.cards || {})}
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
