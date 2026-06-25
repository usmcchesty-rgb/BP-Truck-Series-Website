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

  function renderActivityStatus(input = {}, options = {}) {
    const status =
      typeof input === 'object' && input != null
        ? input.status || 'Active'
        : String(input || 'Active');
    const lastStartRaceNumber =
      typeof input === 'object' && input != null ? input.lastStartRaceNumber : null;
    const modifier = activityModifier(status);
    const isInactive = modifier === 'inactive';
    const display = options.uppercase ? String(status).toUpperCase() : status;
    const tooltip = isInactive ? ' title="No starts in the last 5 races"' : '';
    const statusHtml = `<span class="fantasy-activity-status fantasy-activity-status--${modifier}"${tooltip}>${escapeHtml(display)}</span>`;

    if (options.layout === 'block') {
      const lastStartHtml =
        options.showLastStart && isInactive && lastStartRaceNumber != null
          ? `<span class="fantasy-activity-last-start">Last Start: Race ${escapeHtml(lastStartRaceNumber)}</span>`
          : '';
      return `<span class="fantasy-activity-status-block">${statusHtml}${lastStartHtml}</span>`;
    }

    if (options.showLastStart && isInactive && lastStartRaceNumber != null) {
      return `${statusHtml}<span class="fantasy-activity-last-start">Last Start: Race ${escapeHtml(lastStartRaceNumber)}</span>`;
    }

    return statusHtml;
  }

  window.BPFantasyPills = {
    escapeHtml,
    valueGradeModifier,
    renderFantasyGradePill,
    activityModifier,
    renderActivityStatus,
  };
})();
