(function () {
  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function buildWeekOutlook(driver = {}, slate = {}) {
    const Insights = window.BPFantasyInsights || {};
    if (Insights.buildFantasyPickOutlook) {
      const pickLine = Insights.buildFantasyPickOutlook(driver);
      const parts = [pickLine];

      if (driver.recentFormSummary) {
        parts.push(
          `BP Fantasy form note: ${String(driver.recentFormSummary).replace(/\.$/, '')} on this slate.`
        );
      }

      if (driver.provenTrackHistoryRank != null) {
        parts.push(
          `BP Fantasy track note: proven track history ranks #${driver.provenTrackHistoryRank} in the field this week.`
        );
      } else if (driver.trackRankLabel && driver.trackRankLabel !== '—') {
        parts.push(`BP Fantasy track note: track profile ${driver.trackRankLabel}.`);
      }

      const salaryNum = Number(driver.salary);
      if (Number.isFinite(salaryNum) && salaryNum >= 14000) {
        parts.push(
          `Fantasy Risk Note: at ${formatMoney(salaryNum)}, this driver needs a strong finish to justify the fantasy salary.`
        );
      }

      return parts.join(' ');
    }

    const name = driver.driverName || 'This driver';
    const race = slate.raceNumber ?? '—';
    return `BP Fantasy Driver Outlook: ${name} is on the Race ${race} fantasy slate at ${formatMoney(driver.salary)}.`;
  }

  window.BPFantasyOutlook = {
    buildWeekOutlook,
  };
})();
