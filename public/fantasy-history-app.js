(function () {
  const { link: driverLink, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    escapeHtml: (v) => String(v ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');

  function $(selector) {
    return document.querySelector(selector);
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function formatChange(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (n === 0) return '—';
    return `${n > 0 ? '+' : '-'}$${Math.abs(n).toLocaleString('en-US')}`;
  }

  function renderEmpty(message) {
    const root = $('#fantasyHistoryRoot');
    if (!root) return;
    root.innerHTML = `<section class="fantasy-app-empty"><p>${escapeHtml(message)}</p></section>`;
  }

  function renderInsights(insights = {}) {
    if (!insights.hasEnoughHistory) {
      return `<section class="fantasy-app-section"><p class="fantasy-insights-notice">${escapeHtml(insights.notice || 'More salary trend data will appear after multiple fantasy slates are generated.')}</p></section>`;
    }

    const cards = [
      insights.biggestThreeRaceRiser
        ? {
            label: 'Biggest 3-Race Riser',
            name: insights.biggestThreeRaceRiser.driverName,
            stat: formatChange(insights.biggestThreeRaceRiser.salaryChange),
          }
        : null,
      insights.biggestThreeRaceFaller
        ? {
            label: 'Biggest 3-Race Faller',
            name: insights.biggestThreeRaceFaller.driverName,
            stat: formatChange(insights.biggestThreeRaceFaller.salaryChange),
          }
        : null,
      insights.highestAverageSalary
        ? {
            label: 'Highest Avg Salary',
            name: insights.highestAverageSalary.driverName,
            stat: formatMoney(insights.highestAverageSalary.averageSalary),
          }
        : null,
      insights.mostVolatileSalary
        ? {
            label: 'Most Volatile Salary',
            name: insights.mostVolatileSalary.driverName,
            stat: formatChange(insights.mostVolatileSalary.volatility),
          }
        : null,
      insights.currentBestValue
        ? {
            label: 'Current Best Value',
            name: insights.currentBestValue.driverName,
            statHtml: `${renderFantasyGradePill(insights.currentBestValue.valueGrade)} (${Number(insights.currentBestValue.valueScore).toFixed(2)})`,
          }
        : null,
    ].filter(Boolean);

    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Salary Trend Insights</h2>
        <div class="fantasy-value-card-grid">
          ${cards
            .map(
              (card) => `<article class="fantasy-value-card">
              <div class="fantasy-value-card__meta">${escapeHtml(card.label)}</div>
              <div class="fantasy-value-card__name">${driverLink({ driverName: card.name }, card.name)}</div>
              <div class="fantasy-value-card__stat">${card.statHtml || escapeHtml(card.stat || '')}</div>
            </article>`
            )
            .join('')}
        </div>
      </section>
    `;
  }

  function renderMoverCards(movers = {}) {
    const sections = [
      ['Biggest Salary Risers', movers.biggestRisers],
      ['Biggest Salary Fallers', movers.biggestFallers],
      ['New Drivers', movers.newDrivers],
      ['Highest Salaries', movers.highestSalaries],
    ];

    return sections
      .map(([title, cards]) => {
        if (!cards?.length) return '';
        return `
          <section class="fantasy-app-section">
            <h2 class="fantasy-app-section-title">${escapeHtml(title)}</h2>
            <div class="fantasy-value-card-grid">
              ${cards
                .map(
                  (driver) => `<article class="fantasy-value-card">
                    <div class="fantasy-value-card__name">${driverLink(driver, driver.driverName)}</div>
                    <div class="fantasy-value-card__meta">${escapeHtml(driver.tier || '')}</div>
                    <div class="fantasy-value-card__stat">${formatMoney(driver.salary)}</div>
                    <div class="fantasy-value-card__sub">${escapeHtml(driver.salaryChangeLabel || driver.valueGrade || '')}</div>
                  </article>`
                )
                .join('')}
            </div>
          </section>
        `;
      })
      .join('');
  }

  function renderFeaturedHistory(drivers = []) {
    const featured = drivers
      .filter((driver) => Array.isArray(driver.history) && driver.history.length > 1)
      .slice(0, 8);
    if (!featured.length) return '';

    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Salary Movement History</h2>
        ${featured
          .map(
            (driver) => `<div class="fantasy-history-block">
              <h3>${driverLink(driver, driver.driverName)} <span class="muted">${formatMoney(driver.salary)} · ${renderFantasyGradePill(driver.valueGrade)}</span></h3>
              <div class="fantasy-table-wrap">
                <table class="fantasy-slate-table fantasy-slate-table--compact">
                  <thead><tr><th>Race</th><th>Track</th><th>Salary</th><th>Tier</th><th>Score</th></tr></thead>
                  <tbody>
                    ${driver.history
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
            </div>`
          )
          .join('')}
      </section>
    `;
  }

  function renderLatestTable(drivers = []) {
    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Latest Slate Snapshot</h2>
        <div class="fantasy-table-wrap">
          <table class="fantasy-slate-table">
            <thead>
              <tr><th>Driver</th><th>Current</th><th>Previous</th><th>Change</th><th>Value</th></tr>
            </thead>
            <tbody>
              ${drivers
                .map(
                  (driver) => `<tr>
                    <td>${driverLink(driver, driver.driverName)}</td>
                    <td class="salary">${formatMoney(driver.salary)}</td>
                    <td class="salary">${formatMoney(driver.previousSalary)}</td>
                    <td>${escapeHtml(driver.salaryChangeLabel || '—')}</td>
                    <td class="fantasy-value-grade-cell">${renderFantasyGradePill(driver.valueGrade)}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/settings?action=getFantasySalaryHistory');
      if (!res.ok) {
        renderEmpty('Fantasy salary history coming soon.');
        return;
      }
      const data = await res.json();
      const root = $('#fantasyHistoryRoot');
      if (!root) return;
      root.innerHTML = `
        <section class="fantasy-app-hero-panel fantasy-glass-panel">
          <p class="fantasy-app-eyebrow">Salary History</p>
          <h1 class="fantasy-app-page-title">Race ${escapeHtml(data.latestSlate?.raceNumber ?? '—')} Salary Movement</h1>
          <p class="fantasy-app-readonly-note">Read-only salary history preview based on saved fantasy slates.</p>
        </section>
        ${renderInsights(data.insights || {})}
        ${renderMoverCards(data.movers || {})}
        ${renderLatestTable(data.drivers || [])}
        ${renderFeaturedHistory(data.drivers || [])}
      `;
    } catch {
      renderEmpty('Fantasy salary history coming soon.');
    }
  }

  window.BPFantasyHistoryApp = {
    init() {
      loadHistory();
    },
  };
})();
