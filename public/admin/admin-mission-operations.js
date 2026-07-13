(function () {
  const ROOT_ID = 'adminMissionOperationsRoot';
  const SESSION_KEY = 'bp_admin_pw';

  let state = {
    data: null,
    timelineFilter: null,
    stopTicker: null,
    expandedIntel: new Set(),
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function countdownLib() {
    return window.AdminMissionCountdown || null;
  }

  function formatCountdown(targetAt) {
    const lib = countdownLib();
    if (!lib?.formatCountdownHtml) return '—';
    return lib.formatCountdownHtml(targetAt, new Date());
  }

  function renderStatusCards(cards = []) {
    if (!cards.length) return '<p class="mc-ops__empty">No subsystem status available.</p>';
    return cards
      .map(
        (card) => `
      <div class="mc-ops__status-card is-${escapeHtml(card.status)}" title="${escapeHtml(card.detail)}">
        <div class="mc-ops__status-label">${escapeHtml(card.label)}</div>
        <div class="mc-ops__status-value">${escapeHtml(card.detail)}</div>
      </div>`,
      )
      .join('');
  }

  function renderCompletedToday(items = []) {
    if (!items.length) {
      return '<p class="mc-ops__empty">No tasks completed today yet.</p>';
    }
    return `<ul class="mc-ops__list">${items
      .map(
        (item) => `
        <li class="mc-ops__list-item is-complete">
          <span class="mc-ops__item-title">✓ ${escapeHtml(item.title)}</span>
        </li>`,
      )
      .join('')}</ul>`;
  }

  function renderDueToday(items = []) {
    if (!items.length) {
      return '<p class="mc-ops__empty">Nothing due today.</p>';
    }
    return `<ul class="mc-ops__list">${items
      .map((item) => {
        const countdown = item.countdownTarget
          ? `<div class="mc-ops__item-meta mc-countdown" data-countdown-at="${escapeHtml(item.countdownTarget)}">${formatCountdown(item.countdownTarget)}</div>`
          : '';
        return `
        <li class="mc-ops__list-item is-${escapeHtml(item.status)}">
          <div>
            <div class="mc-ops__item-title">${escapeHtml(item.title)}</div>
            <div class="mc-ops__item-meta">Due ${escapeHtml(item.dueTime)}</div>
            ${countdown}
          </div>
          <span class="mc-ops__severity is-${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span>
        </li>`;
      })
      .join('')}</ul>`;
  }

  function renderComingGroup(label, items = []) {
    if (!items.length) return '';
    return `
      <div class="mc-ops__coming-group">
        <div class="mc-ops__coming-label">${escapeHtml(label)}</div>
        <ul class="mc-ops__list">${items
          .map(
            (item) => `
          <li class="mc-ops__list-item">
            <span class="mc-ops__item-title">${escapeHtml(item.title)}</span>
            <span class="mc-ops__item-meta">${escapeHtml(item.dayLabel || '')}</span>
          </li>`,
          )
          .join('')}</ul>
      </div>`;
  }

  function renderComingUp(comingUp = {}) {
    const html = [
      renderComingGroup('Tomorrow', comingUp.tomorrow),
      renderComingGroup('Later This Week', comingUp.laterThisWeek),
      renderComingGroup('After Race', comingUp.afterRace),
    ].join('');
    return html || '<p class="mc-ops__empty">No upcoming tasks in the active windows.</p>';
  }

  function renderCountdowns(countdowns = []) {
    if (!countdowns.length) {
      return '<p class="mc-ops__empty">No active countdowns.</p>';
    }
    return `<div class="mc-ops__countdown-grid">${countdowns
      .map(
        (row) => `
      <div class="mc-ops__countdown">
        <div class="mc-ops__countdown-label">${escapeHtml(row.label)}</div>
        <div class="mc-countdown" data-countdown-at="${escapeHtml(row.targetAt)}">${formatCountdown(row.targetAt)}</div>
      </div>`,
      )
      .join('')}</div>`;
  }

  function renderProgress(progress = {}) {
    const pct = Number(progress.percent) || 0;
    return `
      <div class="mc-ops__progress-head">
        <h3 class="mc-ops__section-title">Race Week Progress</h3>
        <span class="mc-ops__progress-percent">${pct}%</span>
      </div>
      <div class="mc-ops__progress-bar" aria-hidden="true">
        <div class="mc-ops__progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="mc-ops__progress-meta">
        <span>${escapeHtml(String(progress.completed ?? 0))} / ${escapeHtml(String(progress.total ?? 0))} Tasks Complete</span>
        <span>${escapeHtml(String(progress.overdue ?? 0))} overdue</span>
        <span>${escapeHtml(String(progress.upcoming ?? 0))} upcoming</span>
      </div>`;
  }

  function renderReadiness(readiness = {}) {
    const pct = Number(readiness.percent) || 0;
    const rows = (readiness.subsystems || [])
      .map(
        (row) => `
      <div class="mc-ops__readiness-row" title="${escapeHtml(row.detail)}">
        <span><span class="mc-ops__dot is-${escapeHtml(row.status)}"></span> ${escapeHtml(row.label)}</span>
        <span class="mc-ops__readiness-detail">${escapeHtml(row.detail)}</span>
      </div>`,
      )
      .join('');

    return `
      <div class="mc-ops__gauge-wrap">
        <div class="mc-ops__gauge" style="--mc-gauge-pct:${pct}%">
          <span class="mc-ops__gauge-value">${pct}%</span>
        </div>
        <div>
          <h3 class="mc-ops__section-title">League Ready</h3>
          <div class="mc-ops__readiness-list">${rows}</div>
        </div>
      </div>`;
  }

  function renderTimeline(timeline = [], activeFilter = null) {
    return `<div class="mc-ops__timeline">${timeline
      .map((day) => {
        const done = day.tasks.filter((task) => task.status === 'done').length;
        const total = day.tasks.length;
        const active = activeFilter === day.key ? ' is-active' : '';
        const statusClass = day.tasks.length ? ` is-${day.worstStatus}` : '';
        return `
        <button type="button" class="mc-ops__timeline-day${statusClass}${active}" data-timeline-day="${escapeHtml(day.key)}" title="${escapeHtml(day.label)}">
          <div class="mc-ops__timeline-label">${escapeHtml(day.label)}</div>
          <div class="mc-ops__timeline-count">${done}/${total}</div>
          <div class="mc-ops__timeline-sub">${total ? escapeHtml(day.worstStatus) : '—'}</div>
        </button>`;
      })
      .join('')}</div>`;
  }

  function renderIntelligence(intelligence = {}) {
    const entries = Object.values(intelligence);
    if (!entries.length) {
      return '<p class="mc-ops__empty">Task intelligence populates as evaluators run.</p>';
    }

    return entries
      .map((entry) => {
        const open = state.expandedIntel.has(entry.taskId) ? ' is-open' : '';
        const detected = (entry.detected || [])
          .map((row) => `<li>${escapeHtml(row)}</li>`)
          .join('');
        return `
        <div class="mc-ops__intel-card${open}" data-intel-id="${escapeHtml(entry.taskId)}">
          <button type="button" class="mc-ops__intel-head" data-intel-toggle="${escapeHtml(entry.taskId)}">
            <span>${escapeHtml(entry.title)}</span>
            <span aria-hidden="true">${open ? '−' : '+'}</span>
          </button>
          <div class="mc-ops__intel-body">
            ${entry.why ? `<div class="mc-ops__intel-block"><strong>Why this task exists</strong>${escapeHtml(entry.why).replace(/\n/g, '<br>')}</div>` : ''}
            ${entry.current ? `<div class="mc-ops__intel-block"><strong>Current</strong>${escapeHtml(entry.current)}</div>` : ''}
            ${entry.expected ? `<div class="mc-ops__intel-block"><strong>Expected</strong>${escapeHtml(entry.expected)}</div>` : ''}
            ${detected ? `<div class="mc-ops__intel-block"><strong>Detected</strong><ul>${detected}</ul></div>` : ''}
            ${entry.recommendation ? `<div class="mc-ops__intel-block"><strong>Recommendation</strong>${escapeHtml(entry.recommendation)}</div>` : ''}
          </div>
        </div>`;
      })
      .join('');
  }

  function renderHistory(history = {}) {
    return `
      <div class="mc-ops__history-grid">
        <div class="mc-ops__history-stat"><strong>${history.completionPercent ?? '—'}%</strong><span>Operations completion</span></div>
        <div class="mc-ops__history-stat"><strong>${history.onTimeRate ?? '—'}%</strong><span>On-time rate</span></div>
        <div class="mc-ops__history-stat"><strong>${history.lateTasks ?? 0}</strong><span>Late tasks</span></div>
        <div class="mc-ops__history-stat"><strong>${history.manualOverrides ?? 0}</strong><span>Manual overrides</span></div>
      </div>`;
  }

  function renderRaceDayHero(raceDay = {}, countdowns = []) {
    if (!raceDay.active) return '';
    const heroCountdowns = (raceDay.countdowns || countdowns).slice(0, 3);
    return `
      <div class="mc-ops__race-day-hero">
        ${heroCountdowns
          .map(
            (row) => `
          <div class="mc-ops__countdown">
            <div class="mc-ops__countdown-label">${escapeHtml(row.label)}</div>
            <div class="mc-countdown" data-countdown-at="${escapeHtml(row.targetAt)}">${formatCountdown(row.targetAt)}</div>
          </div>`,
          )
          .join('')}
      </div>`;
  }

  function bindInteractions(root) {
    root.querySelectorAll('[data-timeline-day]').forEach((button) => {
      button.addEventListener('click', () => {
        const day = button.dataset.timelineDay;
        state.timelineFilter = state.timelineFilter === day ? null : day;
        if (window.AdminMissionTaskSummary?.setTimelineDayFilter) {
          window.AdminMissionTaskSummary.setTimelineDayFilter(state.timelineFilter);
        }
        render(state.data);
      });
    });

    root.querySelectorAll('[data-intel-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.intelToggle;
        if (state.expandedIntel.has(id)) state.expandedIntel.delete(id);
        else state.expandedIntel.add(id);
        render(state.data);
      });
    });
  }

  function refreshCountdowns(root) {
    root.querySelectorAll('[data-countdown-at]').forEach((el) => {
      const targetAt = el.dataset.countdownAt;
      if (!targetAt) return;
      el.innerHTML = formatCountdown(targetAt);
    });
  }

  function render(data) {
    const root = document.getElementById(ROOT_ID);
    if (!root || !data?.operations) {
      if (root) root.innerHTML = '';
      return;
    }

    state.data = data;
    const ops = data.operations;
    const raceDay = ops.raceDayOperations || {};
    const title = raceDay.active ? raceDay.headerTitle : "Today's Operations";
    const titleClass = raceDay.active ? ' is-race-day' : '';
    const filterNote = state.timelineFilter
      ? `Timeline filter: ${state.timelineFilter}`
      : `Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

    root.innerHTML = `
      <section class="mc-ops" aria-label="Mission Control Operations Center">
        <div class="mc-ops__glass">
          <div class="mc-ops__status-row">${renderStatusCards(ops.statusCards)}</div>
        </div>

        <div class="mc-ops__glass">
          <div class="mc-ops__header">
            <h2 class="mc-ops__title${titleClass}">${escapeHtml(title)}</h2>
            <span class="mc-ops__meta">${escapeHtml(filterNote)}</span>
          </div>
          ${renderRaceDayHero(raceDay, ops.countdowns)}
          <div class="mc-ops__grid-2">
            <div>
              <h3 class="mc-ops__section-title">✓ Completed Today</h3>
              ${renderCompletedToday(ops.todaysOperations?.completedToday)}
              <hr class="mc-ops__divider">
              <h3 class="mc-ops__section-title">⚠ Due Today</h3>
              ${renderDueToday(ops.todaysOperations?.dueToday)}
            </div>
            <div>
              <h3 class="mc-ops__section-title">⏳ Coming Up</h3>
              ${renderComingUp(ops.todaysOperations?.comingUp)}
            </div>
          </div>
        </div>

        <div class="mc-ops__grid-2">
          <div class="mc-ops__glass">
            <h3 class="mc-ops__section-title">Live Countdowns</h3>
            ${renderCountdowns(ops.countdowns)}
          </div>
          <div class="mc-ops__glass">
            ${renderProgress(ops.raceWeekProgress)}
          </div>
        </div>

        <div class="mc-ops__glass">
          ${renderReadiness(ops.leagueReadiness)}
        </div>

        <div class="mc-ops__glass">
          <h3 class="mc-ops__section-title">Race Week Timeline</h3>
          ${renderTimeline(ops.timeline, state.timelineFilter)}
        </div>

        <div class="mc-ops__glass">
          <h3 class="mc-ops__section-title">Task Intelligence</h3>
          ${renderIntelligence(ops.taskIntelligence)}
        </div>

        <div class="mc-ops__glass">
          <h3 class="mc-ops__section-title">Operations History</h3>
          ${renderHistory(ops.operationsHistory)}
        </div>
      </section>
    `;

    bindInteractions(root);
    refreshCountdowns(root);
  }

  function setMissionControl(data) {
    render(data);
  }

  function init() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    try {
      if (!sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      return;
    }

    if (window.__bpPendingMissionControl) {
      render(window.__bpPendingMissionControl);
    }

    const lib = countdownLib();
    if (lib?.startMinuteTicker) {
      if (state.stopTicker) state.stopTicker();
      state.stopTicker = lib.startMinuteTicker(() => {
        const mount = document.getElementById(ROOT_ID);
        if (mount) refreshCountdowns(mount);
      });
    }

    window.AdminMissionOperations = {
      setMissionControl,
      render,
      getTimelineFilter: () => state.timelineFilter,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
