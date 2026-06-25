(function () {
  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function buildWeekOutlook(driver = {}, slate = {}) {
    const name = driver.driverName || 'This driver';
    const race = slate.raceNumber ?? '—';
    const rank = driver.fantasyRank;
    const salary = formatMoney(driver.salary);
    const tier = driver.tier || 'field';
    const parts = [];

    if (rank != null) {
      parts.push(
        `${name} enters Race ${race} as the #${rank} fantasy option at ${salary} (${tier}).`
      );
    } else {
      parts.push(`${name} enters Race ${race} at ${salary} (${tier}).`);
    }

    if (driver.recentFormSummary) {
      const lower = String(driver.recentFormSummary).toLowerCase();
      if (lower.includes('average finish')) {
        parts.push(`Recent form is strong with ${driver.recentFormSummary.toLowerCase()}.`);
      } else {
        parts.push(`${driver.recentFormSummary}.`);
      }
    }

    if (driver.provenTrackHistoryRank != null) {
      parts.push(`Proven track history ranks #${driver.provenTrackHistoryRank} in the field.`);
    } else if (driver.trackRankLabel && driver.trackRankLabel !== '—') {
      parts.push(`Track profile: ${driver.trackRankLabel}.`);
    }

    if (driver.projectedOwnershipPct != null && driver.ownershipLabel) {
      const own = `${driver.projectedOwnershipPct}% ${driver.ownershipLabel}`;
      if (driver.projectedOwnershipPct >= 40) {
        parts.push(
          `He projects as a ${own}, so he is a strong pick but may be heavily selected.`
        );
      } else if (driver.ownershipLabel === 'Sleeper' || driver.ownershipLabel === 'Dark Horse') {
        parts.push(
          `At ${own} projected ownership, he offers a lower-owned angle with upside if the model is right.`
        );
      } else {
        parts.push(`Projected ownership: ${own}.`);
      }
    }

    if (driver.valueGrade) {
      parts.push(`Value grade ${driver.valueGrade}${driver.valueScore != null ? ` (${Number(driver.valueScore).toFixed(2)} score per $1k)` : ''}.`);
    }

    if (driver.salaryChangeDirection === 'up' && driver.salaryChangeLabel) {
      parts.push(`Salary is trending up (${driver.salaryChangeLabel}).`);
    } else if (driver.salaryChangeDirection === 'down' && driver.salaryChangeLabel) {
      parts.push(`Salary dipped this week (${driver.salaryChangeLabel}), which may improve cap flexibility.`);
    }

    const salaryNum = Number(driver.salary);
    if (Number.isFinite(salaryNum) && salaryNum >= 14000) {
      parts.push(
        `At a premium salary, he needs a top finish to justify the cap spend.`
      );
    }

    return parts.join(' ');
  }

  window.BPFantasyOutlook = {
    buildWeekOutlook,
  };
})();
