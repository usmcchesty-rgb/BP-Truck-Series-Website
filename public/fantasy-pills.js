(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeGrade(grade) {
    return String(grade ?? '').trim().toUpperCase();
  }

  function fantasyGradeModifier(grade) {
    const normalized = normalizeGrade(grade);
    if (normalized === 'A+') return 'grade-a-plus';
    if (normalized === 'A') return 'grade-a';
    if (normalized === 'B+') return 'grade-b-plus';
    if (normalized === 'B') return 'grade-b';
    if (normalized === 'C+') return 'grade-c-plus';
    if (normalized === 'C') return 'grade-c';
    if (normalized === 'D') return 'grade-d';
    return 'grade-unknown';
  }

  function renderFantasyGradePill(grade) {
    if (!grade) return '—';
    const modifier = fantasyGradeModifier(grade);
    return `<span class="fantasy-pill fantasy-pill--grade fantasy-pill--${modifier}">${escapeHtml(grade)}</span>`;
  }

  function finishModifier(finish) {
    const raw = String(finish ?? '').trim().toUpperCase();
    if (raw === 'DNF' || raw === 'DNP') return 'form-muted';
    const n = Number(finish);
    if (!Number.isFinite(n) || n < 1) return 'form-muted';
    if (n <= 5) return 'form-top';
    if (n <= 10) return 'form-mid';
    if (n <= 15) return 'form-low';
    return 'form-poor';
  }

  function renderFantasyFinishPill(finish) {
    const raw = String(finish ?? '').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();
    const label = upper === 'DNF' || upper === 'DNP' ? upper : `P${raw}`;
    const modifier = finishModifier(finish);
    return `<span class="fantasy-pill fantasy-pill--form fantasy-pill--${modifier}">${escapeHtml(label)}</span>`;
  }

  function ownershipModifier(label) {
    const map = {
      Chalk: 'ownership-chalk',
      Popular: 'ownership-popular',
      Balanced: 'ownership-balanced',
      Sleeper: 'ownership-sleeper',
      'Long Shot': 'ownership-longshot',
    };
    return map[String(label ?? '').trim()] || 'ownership-unknown';
  }

  function renderFantasyOwnershipPill(label) {
    if (!label) return '';
    const modifier = ownershipModifier(label);
    return `<span class="fantasy-pill fantasy-pill--ownership fantasy-pill--${modifier}">${escapeHtml(label)}</span>`;
  }

  function statusModifier(status) {
    const normalized = String(status ?? '').trim().toLowerCase();
    if (normalized === 'limited sample') return 'status-limited';
    if (normalized === 'new') return 'status-new';
    if (normalized === 'risk' || normalized === 'risky') return 'status-risk';
    if (normalized === 'active') return 'status-active';
    return 'status-neutral';
  }

  function renderFantasyStatusPill(status) {
    const label = String(status ?? '').trim();
    if (!label) return '—';
    const modifier = statusModifier(label);
    return `<span class="fantasy-pill fantasy-pill--status fantasy-pill--${modifier}">${escapeHtml(label)}</span>`;
  }

  function renderFantasyTierPill(tier) {
    const label = String(tier ?? '').trim();
    if (!label || label === '—') return '—';
    return `<span class="fantasy-pill fantasy-pill--status fantasy-pill--tier">${escapeHtml(label)}</span>`;
  }

  window.BPFantasyPills = {
    escapeHtml,
    fantasyGradeModifier,
    renderFantasyGradePill,
    renderFantasyFinishPill,
    renderFantasyOwnershipPill,
    renderFantasyStatusPill,
    renderFantasyTierPill,
    ownershipModifier,
    finishModifier,
    statusModifier,
  };
})();
