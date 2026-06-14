(function () {
  function renderAvgCautions(stats, root) {
    const scope = root || document;
    const valueEl = scope.querySelector('#avgCautions');
    if (!valueEl) return;

    const statRow = valueEl.closest('.stat-row');
    const labelEl = statRow?.querySelector('div span:last-child');

    if (stats?.cautionDataAvailable && stats.averageCautionsPerRace != null) {
      valueEl.textContent = Number(stats.averageCautionsPerRace).toFixed(2);
      valueEl.removeAttribute('title');
      valueEl.removeAttribute('aria-label');
      if (labelEl) labelEl.textContent = 'AVG CAUTIONS PER RACE';
      return;
    }

    valueEl.textContent = 'N/A';
    valueEl.title = 'Caution data unavailable';
    valueEl.setAttribute('aria-label', 'Average cautions per race unavailable');
    if (labelEl) labelEl.textContent = 'AVG CAUTIONS PER RACE';
  }

  window.BPSeasonSummary = { renderAvgCautions };
})();
