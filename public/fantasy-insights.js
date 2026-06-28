(function () {
  const { escapeHtml, link: driverLink } = window.BPFantasyDriverLinks || {
    escapeHtml: (v) => String(v ?? ''),
    link: (d, l) => String(l ?? d?.driverName ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
  const Photos = window.BPFantasyDriverPhotos || {};

  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');

  const isDriverInactive = (driver) =>
    Pills.isDriverInactive ? Pills.isDriverInactive(driver) : driver?.status === 'Inactive';

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function firstName(name) {
    return String(name || 'Driver').trim().split(/\s+/)[0] || 'Driver';
  }

  function ownershipLabelClass(label) {
    const map = {
      Favorite: 'is-favorite',
      Popular: 'is-popular',
      Moderate: 'is-moderate',
      Balanced: 'is-moderate',
      Sleeper: 'is-sleeper',
      'Dark Horse': 'is-dark-horse',
    };
    return map[label] || '';
  }

  function salaryTrendMeta(direction) {
    if (direction === 'up') return { symbol: '▲', className: 'is-up' };
    if (direction === 'down') return { symbol: '▼', className: 'is-down' };
    if (direction === 'new') return { symbol: '●', className: 'is-new' };
    return { symbol: '—', className: 'is-same' };
  }

  function renderSalaryTrend(driver = {}) {
    const meta = salaryTrendMeta(driver.salaryChangeDirection);
    const label = driver.salaryChangeLabel || 'No change';
    return `<span class="fantasy-salary-trend fantasy-salary-trend--${meta.className}"><span class="fantasy-salary-trend__arrow" aria-hidden="true">${meta.symbol}</span> ${escapeHtml(label)}</span>`;
  }

  function buildFantasyPickOutlook(driver = {}) {
    const name = driver.driverName || 'This driver';
    const grade = String(driver.valueGrade || '').toUpperCase();
    const label = driver.ownershipLabel || '';
    const rank = Number(driver.fantasyRank);

    let body = '';

    if (grade === 'A+' || grade === 'A' || grade === 'B+') {
      body = label
        ? `grades as a strong fantasy value at this salary with a ${label} ownership projection`
        : 'grades as a strong fantasy value at this salary';
    } else if (Number.isFinite(rank) && rank <= 5) {
      body = label
        ? `ranks as one of the top BP Fantasy options this week with ${label} projected ownership`
        : 'ranks as one of the top BP Fantasy options this week based on tier score and salary';
    } else if (label === 'Sleeper' || label === 'Dark Horse') {
      body = `projects as a ${label} fantasy option with lower expected roster rates`;
    } else if (label === 'Favorite' || label === 'Popular') {
      body = `profiles as a ${label} fantasy play — widely rostered in BP Fantasy projections`;
    } else if (label === 'Moderate') {
      body = 'projects as a Moderate ownership fantasy option with balanced roster appeal';
    } else {
      body = `fits the slate as a ${driver.tier || 'mid-tier'} BP Fantasy option at ${formatMoney(driver.salary)}`;
    }

    if (driver.salaryChangeDirection === 'down' && driver.salaryChangeLabel) {
      body += ' after a recent salary dip';
    }

    return `BP Fantasy Pick Outlook: ${name} ${body}.`;
  }

  function buildProphetLines(drivers = [], slate = {}) {
    const pool = [...(drivers || [])];
    if (!pool.length) return [];

    const lines = [];
    const race = slate.raceNumber ?? '—';
    const track = slate.track || 'TBD';

    const valuePick = [...pool]
      .filter((d) => d.valueScore != null)
      .sort((a, b) => Number(b.valueScore) - Number(a.valueScore))[0];
    if (valuePick && ['A+', 'A', 'B+'].includes(String(valuePick.valueGrade || '').toUpperCase())) {
      lines.push(
        `Fantasy Value Note: ${valuePick.driverName} grades as a strong value play for Race ${race} at ${track} with a ${valuePick.valueGrade} rating at ${formatMoney(valuePick.salary)}.`
      );
    }

    const sleeper =
      pool.find((d) => d.ownershipLabel === 'Dark Horse') ||
      [...pool]
        .filter((d) => d.ownershipLabel === 'Sleeper')
        .sort((a, b) => Number(a.fantasyRank ?? 99) - Number(b.fantasyRank ?? 99))[0];
    if (sleeper) {
      lines.push(
        `Fantasy Sleeper Watch: ${sleeper.driverName} projects as a ${sleeper.ownershipLabel || 'Sleeper'} option in BP Fantasy this week.`
      );
    }

    const premium = [...pool]
      .filter((d) => Number(d.salary) >= 13500)
      .sort((a, b) => Number(b.salary) - Number(a.salary))[0];
    if (premium) {
      lines.push(
        `Fantasy Risk Note: ${premium.driverName} carries a premium fantasy salary (${formatMoney(premium.salary)}) and needs a strong finish to pay it off in BP Fantasy.`
      );
    }

    const topOwned = [...pool]
      .filter((d) => d.projectedOwnershipPct != null)
      .sort((a, b) => Number(b.projectedOwnershipPct) - Number(a.projectedOwnershipPct))[0];
    if (topOwned) {
      lines.push(
        `BP Fantasy Projection: ${topOwned.driverName} leads projected fantasy ownership at ${topOwned.projectedOwnershipPct}% (${topOwned.ownershipLabel || 'Favorite'}).`
      );
    }

    return lines.slice(0, 4);
  }

  function buildProphetLineForDriver(driver = {}) {
    const name = driver.driverName || 'This driver';
    const grade = String(driver.valueGrade || '').toUpperCase();
    const label = driver.ownershipLabel || '';
    const salary = Number(driver.salary);

    if (label === 'Dark Horse' || label === 'Sleeper') {
      return `Fantasy Sleeper Watch: ${name} projects as a ${label} option in BP Fantasy this week.`;
    }
    if (grade === 'A+' || grade === 'A' || grade === 'B+') {
      return `Fantasy Value Note: ${name} grades as a strong value play this week with a ${driver.valueGrade} rating.`;
    }
    if (Number.isFinite(salary) && salary >= 13500) {
      return `Fantasy Risk Note: ${name} carries a premium fantasy salary (${formatMoney(salary)}) and needs a strong finish to pay it off in BP Fantasy.`;
    }
    if (label === 'Favorite' || label === 'Popular') {
      return `BP Fantasy Projection: ${name} profiles as a ${label} fantasy play with ${driver.projectedOwnershipPct != null ? `${driver.projectedOwnershipPct}% projected ownership` : 'high projected ownership'}.`;
    }
    return buildFantasyPickOutlook(driver);
  }

  function renderProphetSection(lines = [], options = {}) {
    if (!lines?.length) return '';
    const title = options.title || 'The Pedal Prophet — BP Fantasy Notes';
    return `
      <section class="fantasy-app-section fantasy-prophet-panel">
        <h2 class="fantasy-app-section-title">${escapeHtml(title)}</h2>
        <p class="fantasy-prophet-disclaimer muted">Fantasy game notes only — not official race predictions.</p>
        <ul class="fantasy-prophet-lines">
          ${lines.map((line) => `<li class="fantasy-prophet-line">${escapeHtml(line)}</li>`).join('')}
        </ul>
      </section>`;
  }

  function renderDriverCard(driver = {}, options = {}) {
    const { profile = null, showOutlook = true, compact = false } = options;
    const name = driver.driverName || 'Driver';
    const inactive = isDriverInactive(driver);
    const photoHtml = Photos.renderDriverPhotoImg
      ? Photos.renderDriverPhotoImg({
          profile,
          name,
          className: 'fantasy-driver-card__photo',
          alt: name,
        })
      : `<img class="fantasy-driver-card__photo" src="/assets/drivers/placeholder.png" alt="" />`;

    const ownership =
      driver.projectedOwnershipPct != null
        ? `${driver.projectedOwnershipPct}% ${driver.ownershipLabel || ''}`.trim()
        : '—';

    const outlookHtml = showOutlook
      ? `<p class="fantasy-driver-card__outlook">${escapeHtml(buildFantasyPickOutlook(driver))}</p>`
      : '';

    return `
      <article class="fantasy-driver-card${inactive ? ' fantasy-driver-card--inactive' : ''}${compact ? ' fantasy-driver-card--compact' : ''}">
        <div class="fantasy-driver-card__top">
          <div class="fantasy-driver-card__photo-wrap">${photoHtml}</div>
          <div class="fantasy-driver-card__head">
            <h3 class="fantasy-driver-card__name">${driverLink(driver, name)}${driver.carNumber ? `<span class="fantasy-driver-card__number"> #${escapeHtml(driver.carNumber)}</span>` : ''}</h3>
            ${Pills.renderActivityStatus ? Pills.renderActivityStatus(driver, { uppercase: true }) : ''}
          </div>
        </div>
        <div class="fantasy-driver-card__stats">
          <div class="fantasy-driver-card__stat"><span>Salary</span><strong class="salary">${formatMoney(driver.salary)}</strong></div>
          <div class="fantasy-driver-card__stat"><span>Fantasy Rank</span><strong>${driver.fantasyRank != null ? `#${escapeHtml(driver.fantasyRank)}` : '—'}</strong></div>
          <div class="fantasy-driver-card__stat"><span>Value Grade</span><strong>${renderFantasyGradePill(driver.valueGrade)}</strong></div>
          <div class="fantasy-driver-card__stat"><span>Ownership</span><strong><span class="fantasy-ownership-tag ${ownershipLabelClass(driver.ownershipLabel)}">${escapeHtml(ownership)}</span></strong></div>
        </div>
        <div class="fantasy-driver-card__trend">${renderSalaryTrend(driver)}</div>
        ${outlookHtml}
      </article>`;
  }

  function compareEdge(aVal, bVal, nameA, nameB, { lowerWins = false, epsilon = 0.05 } = {}) {
    const a = Number(aVal);
    const b = Number(bVal);
    const aOk = Number.isFinite(a);
    const bOk = Number.isFinite(b);
    if (!aOk && !bOk) return { winner: 'even' };
    if (!aOk) return { winner: 'b' };
    if (!bOk) return { winner: 'a' };
    const diff = lowerWins ? b - a : a - b;
    if (Math.abs(diff) <= epsilon) return { winner: 'even' };
    return diff > 0 ? { winner: 'a' } : { winner: 'b' };
  }

  function activityEdge(a, b) {
    const aActive = !isDriverInactive(a);
    const bActive = !isDriverInactive(b);
    if (aActive && !bActive) return { winner: 'a' };
    if (bActive && !aActive) return { winner: 'b' };
    return { winner: 'even' };
  }

  function buildCompareEdges(a, b) {
    return [
      {
        key: 'fantasy',
        category: 'Fantasy Edge',
        ...compareEdge(a.fantasyRank, b.fantasyRank, a.driverName, b.driverName, {
          lowerWins: true,
          epsilon: 0,
        }),
      },
      {
        key: 'value',
        category: 'Value Edge',
        ...compareEdge(a.valueScore, b.valueScore, a.driverName, b.driverName),
      },
      {
        key: 'track',
        category: 'Track History Edge',
        ...compareEdge(
          a.provenTrackHistoryRank ?? a.trackRank,
          b.provenTrackHistoryRank ?? b.trackRank,
          a.driverName,
          b.driverName,
          { lowerWins: true, epsilon: 0 }
        ),
      },
      {
        key: 'form',
        category: 'Recent Form Edge',
        ...compareEdge(a.recentFormScore, b.recentFormScore, a.driverName, b.driverName),
      },
      {
        key: 'ownership',
        category: 'Ownership Edge',
        ...compareEdge(a.projectedOwnershipPct, b.projectedOwnershipPct, a.driverName, b.driverName, {
          lowerWins: true,
          epsilon: 0.5,
        }),
      },
      {
        key: 'activity',
        category: 'Activity Edge',
        ...activityEdge(a, b),
      },
      {
        key: 'salary',
        category: 'Salary Savings Edge',
        ...compareEdge(a.salary, b.salary, a.driverName, b.driverName, {
          lowerWins: true,
          epsilon: 0,
        }),
      },
    ];
  }

  function buildFantasyVerdict(a, b, edges = []) {
    const score = { a: 0, b: 0 };
    for (const edge of edges) {
      if (edge.winner === 'a') score.a += 1;
      if (edge.winner === 'b') score.b += 1;
    }
    const winner =
      score.a > score.b ? a : score.b > score.a ? b : Number(a.fantasyRank ?? 99) <= Number(b.fantasyRank ?? 99) ? a : b;
    const loser = winner.driverId === a.driverId ? b : a;

    const reasons = [];
    const fantasyEdge = edges.find((e) => e.key === 'fantasy');
    const valueEdge = edges.find((e) => e.key === 'value');
    const trackEdge = edges.find((e) => e.key === 'track');
    const formEdge = edges.find((e) => e.key === 'form');

    if (fantasyEdge?.winner === (winner.driverId === a.driverId ? 'a' : 'b')) {
      reasons.push(`a better overall fantasy rank (#${winner.fantasyRank ?? '—'})`);
    }
    if (valueEdge?.winner === (winner.driverId === a.driverId ? 'a' : 'b') && winner.valueGrade) {
      reasons.push(`stronger value grade (${winner.valueGrade})`);
    }
    if (trackEdge?.winner === (winner.driverId === a.driverId ? 'a' : 'b')) {
      reasons.push('a track-history edge on this slate');
    }
    if (formEdge?.winner === (winner.driverId === a.driverId ? 'a' : 'b')) {
      reasons.push('stronger recent form score');
    }
    if (!reasons.length) {
      reasons.push('a slightly stronger composite fantasy profile on this slate');
    }

    return `BP Fantasy Verdict: ${winner.driverName} has the stronger fantasy profile this week because of ${reasons.slice(0, 3).join(', ')}. ${loser.driverName} remains viable at ${formatMoney(loser.salary)} if you need cap flexibility.`;
  }

  function computeLineupGrade(lineup = {}) {
    const avg = Number(lineup.averageValueScore);
    if (!Number.isFinite(avg)) return 'B';
    if (avg >= 3.8) return 'A';
    if (avg >= 3.3) return 'B+';
    if (avg >= 2.9) return 'B';
    if (avg >= 2.4) return 'C+';
    return 'C';
  }

  function computeRiskLevel(lineup = {}, strategyId = '') {
    const avgOwn = Number(lineup.averageOwnership);
    const strategyMap = {
      'best-overall': 'Safe',
      balanced: 'Balanced',
      'best-value': 'Balanced',
      contrarian: 'Dark Horse',
      'stars-sleepers': 'Aggressive',
    };
    let level = strategyMap[strategyId] || 'Balanced';
    if (Number.isFinite(avgOwn)) {
      if (avgOwn >= 32) level = 'Safe';
      else if (avgOwn >= 22) level = level === 'Dark Horse' ? 'Aggressive' : 'Balanced';
      else if (avgOwn < 12) level = 'Dark Horse';
      else if (avgOwn < 18) level = 'Aggressive';
    }
    return level;
  }

  function computeSalaryEfficiency(lineup = {}, cap = 50000) {
    const used = Number(lineup.totalSalary);
    const limit = Number(cap) || 50000;
    if (!Number.isFinite(used) || limit <= 0) return null;
    return Number(((used / limit) * 100).toFixed(1));
  }

  function buildLineupExplanation(lineup = {}, strategyId = '', cap = 50000) {
    const grade = computeLineupGrade(lineup);
    const risk = computeRiskLevel(lineup, strategyId);
    const eff = computeSalaryEfficiency(lineup, cap);
    const avgOwn = lineup.averageOwnership;
    const parts = [
      `This ${risk.toLowerCase()} BP Fantasy demo lineup earns a ${grade} lineup grade`,
      eff != null ? `using ${eff}% of the salary cap` : null,
      avgOwn != null ? `with ${avgOwn}% average projected ownership` : null,
    ].filter(Boolean);
    return `${parts.join(' ')}. Projected fantasy score: ${lineup.projectedScore ?? '—'}. Demo only — not saved or submitted.`;
  }

  window.BPFantasyInsights = {
    escapeHtml,
    formatMoney,
    ownershipLabelClass,
    renderSalaryTrend,
    buildFantasyPickOutlook,
    buildProphetLines,
    buildProphetLineForDriver,
    renderProphetSection,
    renderDriverCard,
    buildCompareEdges,
    buildFantasyVerdict,
    computeLineupGrade,
    computeRiskLevel,
    computeSalaryEfficiency,
    buildLineupExplanation,
  };
})();
