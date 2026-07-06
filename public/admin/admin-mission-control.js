(function () {
  const ROOT_ID = 'admin-mission-control-root';
  const SESSION_KEY = 'bp_admin_pw';
  const EXPANDED_KEY = 'bp_admin_mc_expanded';

  const WORKFLOW_TABS = [
    { key: 'postRace', label: 'Post-Race' },
    { key: 'nextRace', label: 'Next Race' },
  ];

  const DAY_TABS = {
    postRace: [
      { key: 'sunday', label: 'Sunday' },
      { key: 'monday', label: 'Monday' },
      { key: 'wednesday', label: 'Wednesday' },
    ],
    nextRace: [
      { key: 'wednesday', label: 'Wednesday' },
      { key: 'thursday', label: 'Thursday' },
      { key: 'friday', label: 'Friday' },
      { key: 'saturday', label: 'Sat / Race Day' },
    ],
  };

  const STATUS_LABELS = {
    done: 'Done',
    due: 'Due',
    upcoming: 'Upcoming',
    overdue: 'Overdue',
    pending: 'Pending',
    inactive: 'Inactive',
  };

  const STATUS_PRIORITY = { overdue: 0, due: 1, pending: 2, upcoming: 3, inactive: 4, done: 5 };

  let state = {
    data: null,
    selectedWorkflow: 'postRace',
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

  function getWorkflowBucket(data, workflow) {
    return data?.workflows?.[workflow] || data?.[workflow] || null;
  }

  function getWorkflowTasks(data, workflow) {
    const bucket = getWorkflowBucket(data, workflow);
    return bucket?.tasks || (data?.tasks || []).filter((task) => task.workflow === workflow);
  }

  function getDayTabs(workflow) {
    return DAY_TABS[workflow] || [];
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
      if (task.status === 'done' || task.status === 'inactive') continue;
      if (worst === 'done' || STATUS_PRIORITY[task.status] < STATUS_PRIORITY[worst]) {
        worst = task.status;
      }
    }
    return worst;
  }

  function getWorkflowTabStatus(data, workflow) {
    const tasks = getWorkflowTasks(data, workflow);
    if (!tasks.length) return 'upcoming';
    if (tasks.every((task) => task.status === 'done')) return 'complete';

    let worst = 'done';
    for (const task of tasks) {
      if (task.status === 'done' || task.status === 'inactive') continue;
      if (worst === 'done' || STATUS_PRIORITY[task.status] < STATUS_PRIORITY[worst]) {
        worst = task.status;
      }
    }
    return worst;
  }

  function getTodayTabKey(tasks, todayKey, workflow) {
    for (const tab of getDayTabs(workflow)) {
      const dayTasks = getDayTasks(tasks, tab.key);
      if (dayTasks.some((task) => task.dueDateKey === todayKey)) return tab.key;
    }
    return null;
  }

  function pickDefaultDayTab(tasks, workflow, todayKey) {
    for (const tab of getDayTabs(workflow)) {
      if (getDayTabStatus(tasks, tab.key) === 'overdue') return tab.key;
    }
    for (const tab of getDayTabs(workflow)) {
      if (getDayTabStatus(tasks, tab.key) === 'due') return tab.key;
    }
    const todayTab = getTodayTabKey(tasks, todayKey, workflow);
    if (todayTab) return todayTab;
    for (const tab of getDayTabs(workflow)) {
      const status = getDayTabStatus(tasks, tab.key);
      if (status === 'upcoming' || status === 'pending') return tab.key;
    }
    return getDayTabs(workflow)[0]?.key || 'sunday';
  }

  function pickDefaultWorkflow(data) {
    for (const tab of WORKFLOW_TABS) {
      if (getWorkflowTabStatus(data, tab.key) === 'overdue') return tab.key;
    }
    for (const tab of WORKFLOW_TABS) {
      if (getWorkflowTabStatus(data, tab.key) === 'due') return tab.key;
    }
    for (const tab of WORKFLOW_TABS) {
      const status = getWorkflowTabStatus(data, tab.key);
      if (status === 'pending' || status === 'upcoming') return tab.key;
    }
    return getWorkflowBucket(data, 'postRace')?.raceNumber ? 'postRace' : 'nextRace';
  }

  function formatRaceLabel(bucket, fallbackLabel) {
    if (!bucket?.raceNumber) return fallbackLabel;
    const track = bucket.track ? ` ${bucket.track}` : '';
    const date = bucket.date ? ` (${bucket.date})` : '';
    return `Race ${bucket.raceNumber}${track}${date}`;
  }

  function formatNextDue(data) {
    if (data?.windowContext?.isOffWeek || data?.summary?.isOffWeek) {
      return data?.summary?.offWeekMessage || 'Off week — no race-week tasks due.';
    }
    const next = data?.summary?.nextDueTask;
    if (!next) return 'All tasks complete';
    const label = STATUS_LABELS[next.status] || next.status;
    const workflowLabel = next.workflow === 'postRace' ? 'Post-race' : 'Next race';
    return `${workflowLabel}: ${next.dayLabel} — ${next.title} (${label})`;
  }

  function formatLatestRaceLabel(windowContext, bucket, fallbackLabel) {
    const latest = windowContext?.latestCompletedRace;
    if (latest?.raceNumber) {
      const track = latest.track ? ` — ${latest.track}` : '';
      const date = latest.date ? ` (${latest.date})` : '';
      return `Race ${latest.raceNumber}${track}${date}`;
    }
    return formatRaceLabel(bucket, fallbackLabel);
  }

  function formatNextRaceLabel(windowContext, bucket, fallbackLabel) {
    const upcoming = windowContext?.nextUpcomingRace;
    if (upcoming?.raceNumber) {
      const track = upcoming.track ? ` — ${upcoming.track}` : '';
      const date = upcoming.date ? ` (${upcoming.date})` : '';
      return `Race ${upcoming.raceNumber}${track}${date}`;
    }
    return formatRaceLabel(bucket, fallbackLabel);
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

  function isManualTask(task) {
    return task?.detectionMode === 'manual';
  }

  function renderDetectionSummary(data) {
    const detection = data?.detectionSummary;
    if (!detection) return '—';
    return `Auto ${detection.automatic.label} · Manual ${detection.manual.label} · Overall ${detection.overall.label}`;
  }

  function renderTaskList(root, tasks, options = {}) {
    const listEl = root.querySelector('[data-mc-task-list]');
    if (!listEl) return;

    const isOffWeek = Boolean(options.isOffWeek);
    let dayTasks = getDayTasks(tasks, state.selectedDay);
    if (isOffWeek) {
      dayTasks = dayTasks.filter((task) => task.status !== 'inactive');
    }
    if (!dayTasks.length) {
      listEl.innerHTML = '<p class="admin-mission-control__empty">No tasks for this day.</p>';
      return;
    }

    listEl.innerHTML = dayTasks
      .map((task) => {
        const isManual = isManualTask(task);
        const isInactive = task.status === 'inactive';
        const isAuto = !isManual;
        const modeBadge = isManual
          ? '<span class="admin-mission-control__mode-badge is-manual">Manual</span>'
          : '<span class="admin-mission-control__mode-badge is-auto"><span class="admin-mission-control__auto-icon" aria-hidden="true">⚙</span> Auto</span>';
        const control = isManual && !isInactive
          ? `<input
              class="admin-mission-control__check"
              type="checkbox"
              data-task-id="${escapeHtml(task.id)}"
              data-workflow="${escapeHtml(task.workflow)}"
              ${task.completed ? 'checked' : ''}
              aria-label="Mark ${escapeHtml(task.title)} complete"
            />`
          : `<span class="admin-mission-control__task-check-placeholder" aria-hidden="true">${task.completed ? '✓' : '—'}</span>`;

        return `
        <div class="admin-mission-control__task" data-task-id="${escapeHtml(task.id)}">
          ${control}
          <div>
            <div class="admin-mission-control__task-title">${escapeHtml(task.title)}</div>
            ${
              task.description
                ? `<div class="admin-mission-control__task-desc">${escapeHtml(task.description)}</div>`
                : ''
            }
            <div class="admin-mission-control__task-meta">
              ${modeBadge}
              <span class="admin-mission-control__badge is-${escapeHtml(task.status)}">${escapeHtml(STATUS_LABELS[task.status] || task.status)}</span>
              ${
                isAuto && task.autoReason
                  ? `<span class="admin-mission-control__task-desc">${escapeHtml(task.autoReason)}</span>`
                  : ''
              }
              ${
                task.href
                  ? `<a class="admin-mission-control__link" href="${escapeHtml(task.href)}" data-mc-task-link data-task-id="${escapeHtml(task.id)}" rel="noopener">Open →</a>`
                  : ''
              }
            </div>
          </div>
        </div>`;
      })
      .join('');

    listEl.querySelectorAll('.admin-mission-control__check').forEach((input) => {
      input.addEventListener('change', () => {
        toggleTask(input.dataset.taskId, input.dataset.workflow, input.checked);
      });
    });
  }

  function renderDayTabs(root, tasks) {
    const tabsEl = root.querySelector('[data-mc-day-tabs]');
    if (!tabsEl) return;

    const dayTabs = getDayTabs(state.selectedWorkflow);
    tabsEl.innerHTML = dayTabs
      .map((tab) => {
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
      })
      .join('');

    tabsEl.querySelectorAll('[data-day]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedDay = button.dataset.day;
        render(state.data);
      });
    });
  }

  function renderWorkflowTabs(root, data) {
    const tabsEl = root.querySelector('[data-mc-workflow-tabs]');
    if (!tabsEl) return;

    tabsEl.innerHTML = WORKFLOW_TABS.map((tab) => {
      const tabStatus = getWorkflowTabStatus(data, tab.key);
      const statusClass =
        tabStatus === 'complete'
          ? 'is-complete'
          : tabStatus === 'overdue'
            ? 'is-overdue'
            : tabStatus === 'due'
              ? 'is-due'
              : '';
      const activeClass = tab.key === state.selectedWorkflow ? ' is-active' : '';
      return `<button type="button" class="admin-mission-control__workflow-tab ${statusClass}${activeClass}" data-workflow="${escapeHtml(tab.key)}">${escapeHtml(tab.label)}</button>`;
    }).join('');

    tabsEl.querySelectorAll('[data-workflow]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedWorkflow = button.dataset.workflow;
        state.selectedDay = pickDefaultDayTab(
          getWorkflowTasks(state.data, state.selectedWorkflow),
          state.selectedWorkflow,
          easternDateKey()
        );
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
      const dayTabs = getDayTabs(state.selectedWorkflow);
      if (!dayTabs.some((tab) => tab.key === state.selectedDay)) {
        state.selectedDay = pickDefaultDayTab(
          getWorkflowTasks(data, state.selectedWorkflow),
          state.selectedWorkflow,
          easternDateKey()
        );
      }
    }

    const payload = state.data || {};
    const workflowTasks = getWorkflowTasks(payload, state.selectedWorkflow);
    const postRace = getWorkflowBucket(payload, 'postRace');
    const nextRace = getWorkflowBucket(payload, 'nextRace');
    const windowContext = payload.windowContext || {};
    const isOffWeek = Boolean(windowContext.isOffWeek || payload.summary?.isOffWeek);

    const postRaceEl = root.querySelector('[data-mc-post-race]');
    const nextRaceEl = root.querySelector('[data-mc-next-race]');
    const remainingEl = root.querySelector('[data-mc-remaining]');
    const detectionEl = root.querySelector('[data-mc-detection]');
    const nextDueEl = root.querySelector('[data-mc-next-due]');
    const toggleBtn = root.querySelector('[data-mc-toggle]');
    const drawerEl = root.querySelector('[data-mc-drawer]');
    const noteEl = root.querySelector('[data-mc-note]');
    const workflowLabelEl = root.querySelector('[data-mc-workflow-label]');

    if (postRaceEl) {
      postRaceEl.textContent = isOffWeek
        ? `Latest: ${formatLatestRaceLabel(windowContext, postRace, 'No completed race')}`
        : formatRaceLabel(postRace, 'No completed race');
    }
    if (nextRaceEl) {
      nextRaceEl.textContent = isOffWeek
        ? `Next: ${formatNextRaceLabel(windowContext, nextRace, 'No upcoming race')}`
        : formatRaceLabel(nextRace, 'No upcoming race');
    }
    if (remainingEl) remainingEl.textContent = String(payload?.summary?.remainingCount ?? '—');
    if (detectionEl) detectionEl.textContent = renderDetectionSummary(payload);
    if (nextDueEl) nextDueEl.textContent = formatNextDue(payload);

    if (workflowLabelEl) {
      const bucket = getWorkflowBucket(payload, state.selectedWorkflow);
      workflowLabelEl.textContent =
        state.selectedWorkflow === 'postRace'
          ? `Post-race tasks — ${formatRaceLabel(bucket, 'No completed race')}`
          : `Next race prep — ${formatRaceLabel(bucket, 'No upcoming race')}`;
    }

    if (toggleBtn) {
      toggleBtn.textContent = state.expanded ? 'Collapse' : 'Expand';
      toggleBtn.setAttribute('aria-expanded', state.expanded ? 'true' : 'false');
    }
    if (drawerEl) drawerEl.hidden = !state.expanded;

    const activeBucket = getWorkflowBucket(payload, state.selectedWorkflow);
    if (noteEl) {
      if (isOffWeek) {
        noteEl.hidden = false;
        noteEl.textContent =
          'Off week — no race-week tasks are due. Upcoming prep tasks stay hidden from due/overdue counts until their race-work window begins.';
      } else if (activeBucket && activeBucket.hasRaceDate === false) {
        noteEl.hidden = false;
        noteEl.textContent =
          'Schedule race date unavailable for this bucket — overdue labels disabled. Confirm schedule in Admin settings.';
      } else {
        noteEl.hidden = true;
        noteEl.textContent = '';
      }
    }

    renderWorkflowTabs(root, payload);
    renderDayTabs(root, workflowTasks);
    renderTaskList(root, workflowTasks, { isOffWeek });
    if (window.AdminMissionTaskSummary) {
      window.AdminMissionTaskSummary.bindMissionControlLinks(root);
    }
  }

  function renderShell(root) {
    root.innerHTML = `
      <section class="admin-mission-control" aria-label="Mission Control">
        <div class="admin-mission-control__bar">
          <div class="admin-mission-control__title">Mission Control</div>
          <div class="admin-mission-control__summary">
            <span class="admin-mission-control__chip">Post-race: <strong data-mc-post-race>—</strong></span>
            <span class="admin-mission-control__chip">Next race: <strong data-mc-next-race>—</strong></span>
            <span class="admin-mission-control__chip admin-mission-control__chip--counts" data-mc-detection>—</span>
            <span class="admin-mission-control__chip"><strong data-mc-remaining>—</strong> open</span>
            <span class="admin-mission-control__chip admin-mission-control__chip--next"><span data-mc-next-due>—</span></span>
          </div>
          <div class="admin-mission-control__actions">
            <span class="admin-mission-control__status" data-mc-status></span>
            <button type="button" class="btn btn-secondary admin-mission-control__reload" data-mc-reload>Reload</button>
            <button type="button" class="btn admin-mission-control__toggle" data-mc-toggle aria-expanded="false">Expand</button>
          </div>
        </div>
        <div class="admin-mission-control__drawer" data-mc-drawer hidden>
          <div class="admin-mission-control__workflow-tabs" data-mc-workflow-tabs role="tablist" aria-label="Mission Control workflows"></div>
          <div class="admin-mission-control__workflow-label" data-mc-workflow-label></div>
          <div class="admin-mission-control__tabs" data-mc-day-tabs role="tablist" aria-label="Mission Control weekdays"></div>
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
      load({ forceDefaultTabs: false });
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

      if (options.forceDefaultTabs !== false) {
        state.selectedWorkflow = pickDefaultWorkflow(data);
        state.selectedDay = pickDefaultDayTab(
          getWorkflowTasks(data, state.selectedWorkflow),
          state.selectedWorkflow,
          easternDateKey()
        );
      }

      render(data);
      window.__bpPendingMissionControl = data;
      if (window.AdminAttention) window.AdminAttention.setMissionControl(data);
      if (window.AdminMissionTaskSummary) window.AdminMissionTaskSummary.setMissionControl(data);
      setStatus('', false);
    } catch (error) {
      setStatus(error.message || 'Load failed', true);
    } finally {
      state.loading = false;
    }
  }

  async function toggleTask(taskId, workflow, completed) {
    const bucket = getWorkflowBucket(state.data, workflow || state.selectedWorkflow);
    const raceNumber = bucket?.raceNumber;
    const task = (bucket?.tasks || []).find((row) => row.id === taskId);

    if (!taskId || raceNumber == null || !getSessionPw()) return;
    if (task && !isManualTask(task)) return;

    setStatus('Saving…', false);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: getSessionPw(),
          action: 'updateAdminMissionControlTask',
          seasonId: state.data?.seasonId,
          raceNumber,
          workflow: workflow || state.selectedWorkflow,
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
      await load({ forceDefaultTabs: false });
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

    load({ forceDefaultTabs: true });

    window.AdminMissionControl = {
      refresh(options = {}) {
        if (!getSessionPw()) {
          mount.hidden = true;
          return Promise.resolve();
        }
        mount.hidden = false;
        return load({ forceDefaultTabs: options.forceDefaultTab !== false });
      },
      show() {
        if (!getSessionPw()) {
          mount.hidden = true;
          return;
        }
        mount.hidden = false;
        load({ forceDefaultTabs: false });
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
