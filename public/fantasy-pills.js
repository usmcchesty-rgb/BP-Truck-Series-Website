(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function valueGradeModifier(grade) {
    const normalized = String(grade ?? '').trim().toUpperCase();
    if (normalized === 'A+') return 'a-plus';
    if (normalized === 'A') return 'a';
    if (normalized === 'B+') return 'b-plus';
    if (normalized === 'B') return 'b';
    if (normalized === 'C+') return 'c-plus';
    if (normalized === 'C') return 'c';
    if (normalized === 'D') return 'd';
    return 'unknown';
  }

  function renderFantasyGradePill(grade) {
    if (!grade) return '—';
    const modifier = valueGradeModifier(grade);
    return `<span class="fantasy-value-grade-badge fantasy-value-grade-badge--${modifier}">${escapeHtml(grade)}</span>`;
  }

  function activityModifier(status) {
    return String(status || 'Active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active';
  }

  function isDriverInactive(input = {}) {
    const status = typeof input === 'object' && input != null ? input.status : input;
    return activityModifier(status || 'Active') === 'inactive';
  }

  function parseLastStartRaceNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function activityTooltip(status, lastStartRaceNumber) {
    if (activityModifier(status) !== 'inactive') return '';
    const raceNumber = parseLastStartRaceNumber(lastStartRaceNumber);
    if (raceNumber != null) return `Last start: Race ${raceNumber}`;
    return 'No starts in the last 5 races';
  }

  function formatLastStartDisplay(driver = {}) {
    if (!isDriverInactive(driver)) return 'Active in last 5';
    const raceNumber = parseLastStartRaceNumber(driver.lastStartRaceNumber);
    if (raceNumber != null) return `Race ${raceNumber}`;
    return '—';
  }

  function driverInactiveRowClass(driver = {}, className = 'fantasy-driver-row--inactive') {
    return isDriverInactive(driver) ? className : '';
  }

  function renderActivityBadgeContent(status, lastStartRaceNumber, options = {}) {
    const modifier = activityModifier(status);
    const isInactive = modifier === 'inactive';
    const uppercase = options.uppercase !== false;
    const display = uppercase ? String(status).toUpperCase() : status;
    const raceNumber = parseLastStartRaceNumber(lastStartRaceNumber);

    if (options.inlineLastStart && isInactive && raceNumber != null) {
      return `${escapeHtml(display)} • LAST START RACE ${escapeHtml(raceNumber)}`;
    }

    return escapeHtml(display);
  }

  function renderActivityStatus(input = {}, options = {}) {
    const status =
      typeof input === 'object' && input != null
        ? input.status || 'Active'
        : String(input || 'Active');
    const lastStartRaceNumber =
      typeof input === 'object' && input != null ? input.lastStartRaceNumber : null;
    const modifier = activityModifier(status);
    const isInactive = modifier === 'inactive';
    const tooltipText = activityTooltip(status, lastStartRaceNumber);
    const tooltip = tooltipText ? ` title="${escapeHtml(tooltipText)}"` : '';
    const badgeHtml = `<span class="fantasy-activity-badge fantasy-activity-badge--${modifier}"${tooltip}>${renderActivityBadgeContent(status, lastStartRaceNumber, options)}</span>`;

    if (options.layout === 'block') {
      const lastStartHtml =
        options.showLastStart && isInactive && parseLastStartRaceNumber(lastStartRaceNumber) != null && !options.inlineLastStart
          ? `<span class="fantasy-activity-last-start">Last Start: Race ${escapeHtml(parseLastStartRaceNumber(lastStartRaceNumber))}</span>`
          : '';
      return `<span class="fantasy-activity-status-block">${badgeHtml}${lastStartHtml}</span>`;
    }

    if (
      options.showLastStart &&
      isInactive &&
      parseLastStartRaceNumber(lastStartRaceNumber) != null &&
      !options.inlineLastStart
    ) {
      return `${badgeHtml}<span class="fantasy-activity-last-start">Last Start: Race ${escapeHtml(parseLastStartRaceNumber(lastStartRaceNumber))}</span>`;
    }

    return badgeHtml;
  }

  window.BPFantasyPills = {
    escapeHtml,
    valueGradeModifier,
    renderFantasyGradePill,
    activityModifier,
    isDriverInactive,
    activityTooltip,
    formatLastStartDisplay,
    driverInactiveRowClass,
    renderActivityStatus,
  };
})();
