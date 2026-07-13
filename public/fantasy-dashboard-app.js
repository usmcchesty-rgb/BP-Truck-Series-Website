(function () {
  const { link: driverLink, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    escapeHtml: (v) => String(v ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
  const Auth = window.BPFantasyAuth || {};
  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');

  function $(sel) {
    return document.querySelector(sel);
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function quickLink(href, label, copy) {
    return `<a class="fantasy-dashboard-link-card" href="${escapeHtml(href)}">
      <span class="fantasy-dashboard-link-card__label">${escapeHtml(label)}</span>
      <span class="fantasy-dashboard-link-card__copy">${escapeHtml(copy)}</span>
    </a>`;
  }

  function statCard(label, body) {
    return `<article class="fantasy-dashboard-stat-card">
      <div class="fantasy-dashboard-stat-card__label">${escapeHtml(label)}</div>
      <div class="fantasy-dashboard-stat-card__body">${body}</div>
    </article>`;
  }

  function lineupDriverCards(lineup) {
    if (!lineup?.drivers?.length) return '';
    return `<div class="fantasy-dashboard-lineup-cards">
      ${lineup.drivers
        .map(
          (driver, index) => `<article class="fantasy-dashboard-lineup-card">
            <span class="fantasy-dashboard-lineup-card__slot">${index + 1}</span>
            <strong>${escapeHtml(driver.driverName)}</strong>
            <span class="salary">${formatMoney(driver.salary)}</span>
          </article>`
        )
        .join('')}
    </div>`;
  }

  function lineupStatusCard(profile, slate, lineup, lock, progression = {}, scoring = null) {
    if (!profile) {
      return `
        <section class="fantasy-app-section fantasy-dashboard-auth-panel fantasy-glass-panel">
          <h2 class="fantasy-app-section-title">Your Account</h2>
          <p class="fantasy-app-copy">Log in to submit your BP Fantasy lineup for the current race.</p>
          <div class="fantasy-cta-actions">
            <a class="fantasy-btn fantasy-btn--primary" href="/fantasy/login.html">Log In</a>
            <a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/signup.html">Sign Up</a>
          </div>
        </section>`;
    }

    const locked = Boolean(lock?.isLocked || lineup?.status === 'locked');
    const raceComplete = Boolean(
      slate?.raceComplete || progression?.slatePhase === 'race-complete' || lock?.raceComplete
    );
    const playable = slate?.playable !== false && progression?.isPlayable !== false;
    let statusText = 'Not submitted';
    let statusClass = 'is-pending';

    if (raceComplete && lineup?.drivers?.length) {
      statusText = scoring
        ? `Scored — ${scoring.racePoints} pts (Rank ${scoring.raceRank})`
        : 'Race complete — scoring pending';
      statusClass = scoring ? 'is-submitted' : 'is-locked';
    } else if (raceComplete) {
      statusText = 'Race complete';
      statusClass = 'is-locked';
    } else if (lineup?.drivers?.length) {
      statusText = locked ? 'Locked' : 'Submitted';
      statusClass = locked ? 'is-locked' : 'is-submitted';
    } else if (!playable) {
      statusText = 'Next slate coming soon';
      statusClass = 'is-pending';
    }

    const lineupActionLabel = raceComplete
      ? 'View Archived Lineup'
      : lineup?.drivers?.length
        ? locked
          ? 'View Lineup'
          : 'Edit Lineup'
        : playable
          ? 'Build Lineup'
          : 'Driver Outlook';

    const lineupActionHref =
      playable || lineup?.drivers?.length || raceComplete
        ? '/fantasy/lineup.html'
        : '/fantasy/slate.html';

    const notSubmittedCopy = raceComplete
      ? `Race ${escapeHtml(slate?.raceNumber ?? '—')} is complete. Fantasy scoring is pending.`
      : playable
        ? `You have not submitted a lineup for Race ${escapeHtml(slate?.raceNumber ?? '—')} yet.`
        : 'The next BP Fantasy slate has not been published yet.';

    return `
      <section class="fantasy-app-section fantasy-dashboard-auth-panel fantasy-glass-panel" id="fantasyDashboardProfile">
        <h2 class="fantasy-app-section-title">Welcome, ${escapeHtml(profile.displayName || profile.email || 'Player')}</h2>
        <div class="fantasy-slate-meta-grid">
          <div><span>Email</span><strong>${escapeHtml(profile.email || '—')}</strong></div>
          <div><span>Lineup Status</span><strong class="fantasy-dashboard-status ${statusClass}">${escapeHtml(statusText)}</strong></div>
          <div><span>Lock</span><strong>${escapeHtml(slate?.lockTime || lock?.lockMessage || 'TBD')}</strong></div>
          <div><span>Slate</span><strong>${escapeHtml(raceComplete ? 'Race complete' : playable ? 'Active' : 'Archived / upcoming')}</strong></div>
          <div><span>Salary Cap</span><strong>${formatMoney(slate?.salaryCap ?? 50000)}</strong></div>
        </div>
        ${
          lineup?.drivers?.length
            ? `<div class="fantasy-dashboard-lineup-summary">
                <p class="fantasy-app-copy">${formatMoney(lineup.totalSalary)} spent · ${lineup.drivers.length} drivers · submitted ${escapeHtml(formatDate(lineup.submittedAt))}</p>
                ${lineupDriverCards(lineup)}
              </div>`
            : `<p class="fantasy-app-copy">${notSubmittedCopy}</p>`
        }
        <div class="fantasy-cta-actions">
          <a class="fantasy-btn fantasy-btn--primary" href="${escapeHtml(lineupActionHref)}">${escapeHtml(lineupActionLabel)}</a>
          <button type="button" id="fantasyLogoutBtn" class="fantasy-btn fantasy-btn--secondary">Log Out</button>
        </div>
      </section>`;
  }

  function formatCountdown(nextRaceDate) {
    if (!nextRaceDate) return null;
    const target = new Date(nextRaceDate);
    if (Number.isNaN(target.getTime())) return null;

    const diffMs = target.getTime() - Date.now();
    if (diffMs <= 0) return 'Next race is underway or recently completed.';

    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);

    if (days > 0) return `${days} day${days === 1 ? '' : 's'}, ${hours} hour${hours === 1 ? '' : 's'} until next race`;
    if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}, ${minutes} minute${minutes === 1 ? '' : 's'} until next race`;
    return `${minutes} minute${minutes === 1 ? '' : 's'} until next race`;
  }

  function renderNoActiveSlatePanel(progression, slate) {
    const countdown = formatCountdown(progression?.nextRaceDate);
    const nextRaceLabel = progression?.nextRaceNumber
      ? `Race ${progression.nextRaceNumber}${progression.nextRaceTrack ? ` — ${progression.nextRaceTrack}` : ''}`
      : null;
    const hasPreviousResults = Boolean(
      progression?.isArchived ||
      progression?.slatePhase === 'race-complete' ||
      (slate?.raceNumber && slate?.raceComplete)
    );

    return `
      <section class="fantasy-app-section fantasy-dashboard-idle-panel fantasy-glass-panel">
        <h2 class="fantasy-app-section-title">No Active Fantasy Slate</h2>
        <p class="fantasy-app-copy">There is no active fantasy slate right now. Check back when the next race slate is published.</p>
        ${
          nextRaceLabel
            ? `<div class="fantasy-slate-meta-grid">
                <div><span>Next Race</span><strong>${escapeHtml(nextRaceLabel)}</strong></div>
                ${countdown ? `<div><span>Countdown</span><strong>${escapeHtml(countdown)}</strong></div>` : ''}
              </div>`
            : ''
        }
        <div class="fantasy-cta-actions">
          <a class="fantasy-btn fantasy-btn--primary" href="/fantasy/slate.html">Driver Outlook</a>
          <a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/rules.html">View Rules</a>
          ${
            hasPreviousResults
              ? `<a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/standings.html">Previous Results</a>`
              : ''
          }
        </div>
      </section>`;
  }

  function renderDashboard(slateData, launchData) {
    const slate = launchData?.slate || slateData?.slate || {};
    const profile = launchData?.profile || null;
    const lineup = launchData?.lineup || null;
    const lock = launchData?.lock || {};
    const scoring = launchData?.scoring || null;
    const progression = launchData?.progression || slateData?.progression || {};
    const drivers = slateData?.drivers || [];
    const power = slateData?.fantasyPowerRankings || [];
    const topPick = power[0] || null;
    const bestValue = slateData?.spotlightCards?.bestValue || null;
    const hasPublishedSlate = Boolean(slate?.raceNumber);
    const raceComplete = Boolean(slate?.raceComplete || progression?.slatePhase === 'race-complete');
    const playable = progression?.isPlayable !== false && slate?.playable !== false;
    const hasActiveSlate = playable && hasPublishedSlate && !raceComplete;

    return `
      <section class="fantasy-app-hero-panel fantasy-glass-panel fantasy-dashboard-hero">
        <p class="fantasy-app-eyebrow">BP Fantasy Central</p>
        <h1 class="fantasy-app-page-title">${hasActiveSlate ? `Race ${escapeHtml(slate.raceNumber)} — ${escapeHtml(slate.track || 'TBD')}` : 'BP Fantasy Dashboard'}</h1>
        ${
          hasActiveSlate
            ? `<div class="fantasy-slate-meta-grid">
                <div><span>Current Race</span><strong>Race ${escapeHtml(slate.raceNumber)}</strong></div>
                <div><span>Lock</span><strong>${escapeHtml(slate.lockTime || lock.lockMessage || 'TBD')}</strong></div>
                <div><span>Slate</span><strong>${escapeHtml(raceComplete ? 'Race complete' : 'Active')}</strong></div>
                <div><span>Salary Cap</span><strong>${formatMoney(slate.salaryCap ?? 50000)}</strong></div>
              </div>
              ${raceComplete && !scoring ? '<p class="fantasy-app-copy">This race has results posted. Fantasy scoring is pending for this slate.</p>' : ''}
              ${scoring ? `<p class="fantasy-app-copy">Your lineup scored <strong>${escapeHtml(scoring.racePoints)}</strong> points (Race rank ${escapeHtml(scoring.raceRank)}). Season total: <strong>${escapeHtml(scoring.seasonPoints)}</strong>.</p>` : ''}`
            : `<p class="fantasy-app-copy"><strong>No active fantasy slate.</strong> The next BP Fantasy slate has not been published yet.</p>`
        }
      </section>

      ${hasActiveSlate ? '' : renderNoActiveSlatePanel(progression, slate)}

      ${lineupStatusCard(profile, slate, lineup, lock, progression, scoring)}

      ${
        hasActiveSlate
          ? `<section class="fantasy-app-section">
              <h2 class="fantasy-app-section-title">This Week at a Glance</h2>
              <div class="fantasy-dashboard-stat-grid">
                ${statCard(
                  'Top BP Fantasy Pick',
                  topPick
                    ? `${driverLink(topPick, topPick.driverName)} · ${formatMoney(topPick.salary)}`
                    : '<p class="muted">—</p>'
                )}
                ${statCard(
                  'Best Fantasy Value',
                  bestValue?.driverName
                    ? `${driverLink(bestValue, bestValue.driverName)} · ${renderFantasyGradePill(bestValue.valueGrade || '')}`
                    : '<p class="muted">—</p>'
                )}
              </div>
            </section>`
          : ''
      }

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Explore BP Fantasy</h2>
        <div class="fantasy-dashboard-link-grid">
          ${quickLink('/fantasy/slate.html', 'Current Slate', 'Salaries, rankings, ownership, and tiers')}
          ${quickLink('/fantasy/lineup.html', 'My Lineups', 'Pick and submit your 5-driver lineup')}
          ${quickLink('/fantasy/standings.html', 'Leaderboards', 'See submitted fantasy lineups')}
          ${quickLink('/fantasy/slate.html', 'Driver Outlook', 'Explore driver salaries and outlook')}
          ${quickLink('/fantasy/rules.html', 'Rules & Guide', 'How BP Fantasy works')}
          ${quickLink('#fantasyDashboardProfile', 'Profile', 'Your account and lineup status')}
        </div>
      </section>`;
  }

  async function init() {
    const root = $('#fantasyDashboardRoot');
    if (!root) return;

    try {
      let launchData = {};
      let slateData = { slate: null, drivers: [] };

      try {
        await Auth.init();
        const launchRes = await Auth.authFetch('/api/settings?action=getDashboard');
        if (launchRes.ok) launchData = await launchRes.json();
      } catch {
        try {
          const launchRes = await fetch('/api/settings?action=getDashboard');
          if (launchRes.ok) launchData = await launchRes.json();
        } catch {
          launchData = {};
        }
      }

      const slateRes = await fetch('/api/settings?action=getFantasyPublicSlate');
      if (slateRes.ok) {
        slateData = await slateRes.json();
      } else if (launchData?.slate) {
        slateData = {
          slate: {
            raceNumber: launchData.slate.raceNumber,
            track: launchData.slate.track,
            lockTime: launchData.slate.lockTime,
            salaryCap: launchData.slate.salaryCap,
            status: launchData.slate.status,
          },
          drivers: [],
        };
      }

      root.innerHTML = renderDashboard(slateData, launchData);

      $('#fantasyLogoutBtn')?.addEventListener('click', async () => {
        try {
          await Auth.signOut();
          window.location.reload();
        } catch {
          window.location.reload();
        }
      });
    } catch {
      root.innerHTML = `<section class="fantasy-app-empty"><p>Could not load BP Fantasy dashboard.</p></section>`;
    }
  }

  window.BPFantasyDashboardApp = { init };
})();
