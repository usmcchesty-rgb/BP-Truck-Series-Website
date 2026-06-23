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

  window.BPFantasyPills = {
    escapeHtml,
    valueGradeModifier,
    renderFantasyGradePill,
  };
})();
