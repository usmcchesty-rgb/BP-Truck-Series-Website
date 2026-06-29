(function () {
  const ROOT_ID = 'admin-mission-control-root';
  const SESSION_KEY = 'bp_admin_pw';
  const EXPANDED_KEY = 'bp_admin_mc_expanded';

  const DAY_TABS = [
    { key: 'sunday', label: 'Sunday' },
    { key: 'monday', label: 'Monday' },
    { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' },
    { key: 'friday', label: 'Friday' },
    { key: 'saturday', label: 'Sat / Race Day' },
  ];

  const STATUS_LABELS = {
    done: 'Done',
    due: 'Due',
    upcoming: 'Upcoming',
    overdue: 'Overdue',
    pending: 'Pending',
  };

  const STATUS_PRIORITY = { overdue: 0, due: 1, pending: 2, upcoming: 3, done: 4 };

  let state = {
    data: null,
    raceNumber: null,
    seasonId: null,
    selectedDay: 'sunday',
    expanded: false,
    loading: false,
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getSessionPw() {
    try {
      return sessionStorage.getItem(SESSION_KEY) || '';
    } catch {
      return '';
    }
  }

  function easternDateKey(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function getDayTasks(tasks, dayKey) {
    return (tasks || []).filter((task) => task.day === dayKey);
  }

  function getDayTabStatus(tasks, dayKey) {
    const dayTasks = getDayTasks(tasks, dayKey);
    if (!dayTasks.length) return 'upcoming';
    if (dayTasks.every((task) => task.status === 'done')) return 'complete';

    let worst = 'done';
    for (const task of dayTasks) {
      if (task.status === 'done') continue;
      if (worst === 'done' || STATUS_PRIORITY[task.status] < STATUS_PRIORITY[worst]) {
        worst = task.status;
      }
    }
    return worst;
  }

  function getTodayTabKey(tasks, todayKey) {
    for (const tab of DAY_TABS) {
      const dayTasks = getDayTasks(tasks, tab.key);
      if (dayTasks.some((task) => task.dueDateKey === todayKey)) return tab.key;
    }
    return null;
  }

  function pickDefaultTab(tasks, todayKey) {
    for (const tab of DAY_TABS) {
      if (getDayTabStatus(tasks, tab.key) === 'overdue') return tab.key;
    }
    for (const tab of DAY_TABS) {
      if (getDayTabStatus(tasks, tab.key) === 'due') return tab.key;
    }
    const todayTab = getTodayTabKey(tasks, todayKey);
    if (todayTab) return todayTab;
    for (const tab of DAY_TABS) {
      const status = getDayTabStatus(tasks, tab.key);
      if (status === 'upcoming' || status === 'pending') return tab.key;
    }
    return 'sunday';
  }

  function formatRaceWeek(data) {
    const next = data?.nextRace;
    if (data?.raceNumber) {
      return `Race ${data.raceNumber}${data.raceDate ? ` — ${data.raceDate}` : ''}`;
    }
    if (next?.raceNumber) {
      return `Race ${next.raceNumber}${next.date ? ` — ${next.date}` : ''}`;
    }
    return 'Schedule unavailable';
  }

  function formatNextDue(data) {
    const next = data?.summary?.nextDueTask;
    if (!next) return 'All tasks complete';
    const label = STATUS_LABELS[next.status] || next.status;
    return `${next.dayLabel}: ${next.title} (${label})`;
  }

  function readExpandedPreference() {
    try {
      return sessionStorage.getItem(EXPANDED_KEY) === '1';
    } catch {
      return false;
    }
  }

  function writeExpandedPreference(expanded) {
    try {
      sessionStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  function renderTaskList(root, tasks) {
    const listEl = root.querySelector('[data-mc-task-list]');
    if (!listEl) return;

    const dayTasks = getDayTasks(tasks, state.selectedDay);
    if (!dayTasks.length) {
      listEl.innerHTML = '<p class="admin-mission-control__empty">No tasks for this day.</p>';
      return;
    }

    listEl.innerHTML = dayTasks
      .map(
        (task) => `
        <div class="admin-mission-control__task" data-task-id="${escapeHtml(task.id)}">
          <input
            class="admin-mission-control__check"
            type="checkbox"
            data-task-id="${escapeHtml(task.id)}"
            ${task.completed ? 'checked' : ''}
            aria-label="Mark ${escapeHtml(task.title)} complete"
          />
          <div>
            <div class="admin-mission-control__task-title">${escapeHtml(task.title)}</div>
            ${
              task.description
                ? `<div class="admin-mission-control__task-desc">${escapeHtml(task.description)}</div>`
                : ''
            }
            <div class="admin-mission-control__task-meta">
              <span class="admin-mission-control__badge is-${escapeHtml(task.status)}">${escapeHtml(STATUS_LABELS[task.status] || task.status)}</span>
              ${
                task.href
                  ? `<a class="admin-mission-control__link" href="${escapeHtml(task.href)}" target="_blank" rel="noopener">Open →</a>`
                  : ''
              }
            </div>
          </div>
        </div>`
      )
      .join('');

    listEl.querySelectorAll('.admin-mission-control__check').forEach((input) => {
      input.addEventListener('change', () => {
        toggleTask(input.dataset.taskId, input.checked);
      });
    });
  }

  function renderTabs(root, tasks) {
    const tabsEl = root.querySelector('[data-mc-tabs]');
    if (!tabsEl) return;

    tabsEl.innerHTML = DAY_TABS.map((tab) => {
      const tabStatus = getDayTabStatus(tasks, tab.key);
      const statusClass =
        tabStatus === 'complete'
          ? 'is-complete'
          : tabStatus === 'overdue'
            ? 'is-overdue'
            : tabStatus === 'due'
              ? 'is-due'
              : tabStatus === 'pending'
                ? 'is-pending'
                : 'is-upcoming';
      const activeClass = tab.key === state.selectedDay ? ' is-active' : '';
      return `<button type="button" class="admin-mission-control__tab ${statusClass}${activeClass}" data-day="${escapeHtml(tab.key)}">${escapeHtml(tab.label)}</button>`;
    }).join('');

    tabsEl.querySelectorAll('[data-day]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedDay = button.dataset.day;
        render(state.data);
      });
    });
  }

  function render(data) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    if (!getSessionPw()) {
      root.hidden = true;
      return;
    }

    root.hidden = false;

    if (data) {
      state.data = data;
      state.raceNumber = data.raceNumber ?? null;
      state.seasonId = data.seasonId ?? null;
      if (!state.selectedDay || !DAY_TABS.some((tab) => tab.key === state.selectedDay)) {
        state.selectedDay = pickDefaultTab(data.tasks || [], easternDateKey());
      }
    }

    const payload = state.data;
    const tasks = payload?.tasks || [];

    const phaseEl = root.querySelector('[data-mc-phase]');
    const raceEl = root.querySelector('[data-mc-race]');
    const remainingEl = root.querySelector('[data-mc-remaining]');
    const nextDueEl = root.querySelector('[data-mc-next-due]');
    const toggleBtn = root.querySelector('[data-mc-toggle]');
    const drawerEl = root.querySelector('[data-mc-drawer]');
    const noteEl = root.querySelector('[data-mc-note]');

    if (phaseEl) phaseEl.textContent = payload?.fantasyPhase || '—';
    if (raceEl) raceEl.textContent = formatRaceWeek(payload || {});
    if (remainingEl) remainingEl.textContent = String(payload?.summary?.remainingCount ?? '—');
    if (nextDueEl) nextDueEl.textContent = formatNextDue(payload || {});

    if (toggleBtn) {
      toggleBtn.textContent = state.expanded ? 'Collapse' : 'Expand';
      toggleBtn.setAttribute('aria-expanded', state.expanded ? 'true' : 'false');
    }
    if (drawerEl) drawerEl.hidden = !state.expanded;

    if (noteEl) {
      if (payload?.hasRaceDate === false) {
        noteEl.hidden = false;
        noteEl.textContent =
          'Schedule race date unavailable — overdue labels disabled. Confirm schedule in Admin settings.';
      } else {
        noteEl.hidden = true;
        noteEl.textContent = '';
      }
    }

    renderTabs(root, tasks);
    renderTaskList(root, tasks);
  }

  function renderShell(root) {
    root.innerHTML = `
      <section class="admin-mission-control" aria-label="Mission Control">
        <div class="admin-mission-control__bar">
          <div class="admin-mission-control__title">Mission Control</div>
          <div class="admin-mission-control__summary">
            <span class="admin-mission-control__chip"><strong data-mc-phase>—</strong></span>
            <span class="admin-mission-control__chip" data-mc-race>—</span>
            <span class="admin-mission-control__chip"><strong data-mc-remaining>—</strong> left</span>
            <span class="admin-mission-control__chip admin-mission-control__chip--next"><span data-mc-next-due>—</span></span>
          </div>
          <div class="admin-mission-control__actions">
            <span class="admin-mission-control__status" data-mc-status></span>
            <button type="button" class="btn btn-secondary admin-mission-control__reload" data-mc-reload>Reload</button>
            <button type="button" class="btn admin-mission-control__toggle" data-mc-toggle aria-expanded="false">Expand</button>
          </div>
        </div>
        <div class="admin-mission-control__drawer" data-mc-drawer hidden>
          <div class="admin-mission-control__tabs" data-mc-tabs role="tablist" aria-label="Mission Control weekdays"></div>
          <div class="admin-mission-control__tasks" data-mc-task-list></div>
          <p class="admin-mission-control__note" data-mc-note hidden></p>
        </div>
      </section>
    `;

    root.querySelector('[data-mc-toggle]')?.addEventListener('click', () => {
      state.expanded = !state.expanded;
      writeExpandedPreference(state.expanded);
      render(state.data);
    });

    root.querySelector('[data-mc-reload]')?.addEventListener('click', () => {
      load({ forceDefaultTab: false });
    });
  }

  function setStatus(message, isError) {
    const root = document.getElementById(ROOT_ID);
    const statusEl = root?.querySelector('[data-mc-status]');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('is-error', Boolean(isError));
  }

  async function load(options = {}) {
    if (!getSessionPw()) {
      const root = document.getElementById(ROOT_ID);
      if (root) root.hidden = true;
      return;
    }

    if (state.loading) return;
    state.loading = true;
    setStatus('Loading…', false);

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: getSessionPw(),
          action: 'getAdminMissionControl',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Mission control unavailable');

      if (options.forceDefaultTab !== false) {
        state.selectedDay = pickDefaultTab(data.tasks || [], easternDateKey());
      }

      render(data);
      setStatus('', false);
    } catch (error) {
      setStatus(error.message || 'Load failed', true);
    } finally {
      state.loading = false;
    }
  }

  async function toggleTask(taskId, completed) {
    if (!taskId || state.raceNumber == null || !getSessionPw()) return;

    setStatus('Saving…', false);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: getSessionPw(),
          action: 'updateAdminMissionControlTask',
          seasonId: state.seasonId,
          raceNumber: state.raceNumber,
          taskId,
          completed,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      render(data);
      setStatus(completed ? 'Task marked done.' : 'Task reopened.', false);
    } catch (error) {
      setStatus(error.message || 'Save failed', true);
      await load({ forceDefaultTab: false });
    }
  }

  function init() {
    const mount = document.getElementById(ROOT_ID);
    if (!mount) return;

    state.expanded = readExpandedPreference();
    renderShell(mount);

    if (!getSessionPw()) {
      mount.hidden = true;
      return;
    }

    load({ forceDefaultTab: true });

    window.AdminMissionControl = {
      refresh(options = {}) {
        if (!getSessionPw()) {
          mount.hidden = true;
          return Promise.resolve();
        }
        mount.hidden = false;
        return load({ forceDefaultTab: options.forceDefaultTab !== false });
      },
      show() {
        if (!getSessionPw()) {
          mount.hidden = true;
          return;
        }
        mount.hidden = false;
        load({ forceDefaultTab: false });
      },
      hide() {
        mount.hidden = true;
      },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
