(function () {
  const SESSION_KEY = 'bp_admin_pw';
  const HIGHLIGHT_KEY = 'bp_admin_mission_task_highlight';
  const HIGHLIGHT_TTL_MS = 30000;

  const STATUS_LABELS = {
    done: 'Done',
    due: 'Due',
    upcoming: 'Upcoming',
    overdue: 'Overdue',
    pending: 'Pending',
  };

  const STATUS_PRIORITY = { overdue: 0, due: 1, pending: 2, upcoming: 3, done: 4 };

  const SEVERITY_LABELS = {
    overdue: 'Critical',
    due: 'High',
    pending: 'Medium',
    upcoming: 'Info',
    done: 'Complete',
  };

  const STATUS_ICONS = {
    overdue: '!',
    due: '●',
    pending: '◷',
    upcoming: '○',
    done: '✓',
  };

  const HREF_TARGETS = [
    { href: '/admin/race-control', section: 'race-operations', tab: 'race-control' },
    { href: '/admin/transcripts', section: 'race-operations', tab: 'transcripts' },
    { href: '/admin/social-sharing', section: 'content', tab: 'social-sharing' },
    { href: '/admin/track-images', section: 'content', tab: 'track-images' },
    { href: '/admin/driver-photos', section: 'content', tab: 'driver-photos' },
    { href: '/admin/power-rankings', section: 'competition', tab: 'power-rankings' },
    { href: '/admin/fantasy', section: 'competition', tab: 'fantasy' },
    { href: '/admin/news', section: 'content', tab: 'news' },
    { href: '/fantasy/lineup', section: 'competition', tab: 'fantasy', external: true },
    { href: '/results', section: 'dashboard', tab: null },
    { href: '/admin', section: 'dashboard', tab: null },
  ].sort((a, b) => b.href.length - a.href.length);

  const state = {
    data: null,
    updatedAt: null,
    loading: false,
    mounts: new Map(),
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

  function normalizeHref(href) {
    let path = String(href || '').split('?')[0].split('#')[0].replace(/\\/g, '/');
    if (path.endsWith('.html')) path = path.slice(0, -'.html'.length);
    if (path.endsWith('/')) path = path.slice(0, -1);
    return path;
  }

  function normalizePath(pathname) {
    let path = String(pathname || '').replace(/\\/g, '/');
    if (path.endsWith('/index.html')) path = path.slice(0, -'/index.html'.length);
    if (path.endsWith('/')) path = path.slice(0, -1);
    return path;
  }

  function resolveHrefTarget(href) {
    const normalized = normalizeHref(href);
    for (const rule of HREF_TARGETS) {
      if (normalized === rule.href || normalized.startsWith(`${rule.href}/`)) {
        return rule;
      }
    }
    return { section: 'dashboard', tab: null, external: false };
  }

  function taskBelongsToSection(task, sectionId) {
    if (sectionId === 'analytics') return false;
    if (!task?.href) return sectionId === 'dashboard';
    return resolveHrefTarget(task.href).section === sectionId;
  }

  function collectActionableTasks(data, sectionId) {
    if (!data || sectionId === 'analytics') return [];

    const groups = [
      { workflow: 'postRace', bucket: data.workflows?.postRace || data.postRace },
      { workflow: 'nextRace', bucket: data.workflows?.nextRace || data.nextRace },
    ];

    const tasks = [];
    for (const group of groups) {
      const bucket = group.bucket || {};
      for (const task of bucket.tasks || []) {
        if (task.completed || task.status === 'done') continue;
        if (!taskBelongsToSection(task, sectionId)) continue;
        tasks.push({
          ...task,
          workflow: task.workflow || group.workflow,
          raceNumber: bucket.raceNumber ?? task.raceNumber ?? null,
          track: bucket.track || null,
          date: bucket.date || null,
        });
      }
    }

    return tasks.sort((a, b) => {
      const priorityDiff =
        (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
  }

  function worstStatus(tasks) {
    let worst = 'done';
    for (const task of tasks) {
      if (task.status === 'done') continue;
      if (worst === 'done' || STATUS_PRIORITY[task.status] < STATUS_PRIORITY[worst]) {
        worst = task.status;
      }
    }
    return worst;
  }

  function formatRaceLabel(task) {
    if (!task?.raceNumber) return null;
    const track = task.track ? ` — ${task.track}` : '';
    return `Race ${task.raceNumber}${track}`;
  }

  function formatDueState(task) {
    const status = STATUS_LABELS[task.status] || task.status || 'Pending';
    const day = task.dayLabel ? `${task.dayLabel}` : '';
    if (day && status) return `${day} · ${status}`;
    return day || status;
  }

  function formatUpdatedAt(date) {
    if (!date) return '—';
    const now = new Date();
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    const time = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    return sameDay ? `Today ${time}` : `${date.toLocaleDateString('en-US')} ${time}`;
  }

  function groupTasksByRace(tasks) {
    const groups = new Map();
    for (const task of tasks) {
      const key = task.raceNumber != null ? String(task.raceNumber) : 'general';
      if (!groups.has(key)) {
        groups.set(key, {
          raceNumber: task.raceNumber,
          track: task.track,
          date: task.date,
          tasks: [],
        });
      }
      groups.get(key).tasks.push(task);
    }
    return [...groups.values()].sort((a, b) => {
      const aNum = Number(a.raceNumber) || 0;
      const bNum = Number(b.raceNumber) || 0;
      return bNum - aNum;
    });
  }

  function storeHighlight(taskId) {
    if (!taskId) return;
    try {
      sessionStorage.setItem(
        HIGHLIGHT_KEY,
        JSON.stringify({ taskId: String(taskId), ts: Date.now() }),
      );
    } catch {
      /* ignore */
    }
  }

  function consumeHighlight(sectionId) {
    try {
      const raw = sessionStorage.getItem(HIGHLIGHT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.taskId || Date.now() - Number(parsed.ts || 0) > HIGHLIGHT_TTL_MS) {
        sessionStorage.removeItem(HIGHLIGHT_KEY);
        return null;
      }
      const tasks = collectActionableTasks(state.data, sectionId);
      const match = tasks.find((task) => String(task.id) === String(parsed.taskId));
      if (!match) return null;
      sessionStorage.removeItem(HIGHLIGHT_KEY);
      return String(parsed.taskId);
    } catch {
      return null;
    }
  }

  function pulseElement(el) {
    if (!el) return;
    el.classList.remove('is-mission-highlight');
    void el.offsetWidth;
    el.classList.add('is-mission-highlight');
    window.setTimeout(() => el.classList.remove('is-mission-highlight'), 4500);
  }

  function navigateToTask(task, mountConfig = {}) {
    if (!task) return;
    storeHighlight(task.id);

    const target = resolveHrefTarget(task.href);
    if (target.external) {
      window.location.href = task.href;
      return;
    }

    if (target.tab && typeof mountConfig.setTab === 'function') {
      mountConfig.setTab(target.tab);
      window.setTimeout(() => {
        pulseElement(document.querySelector(`[data-tab-id="${target.tab}"]`));
        pulseElement(document.querySelector('.admin-group-frame-wrap'));
      }, 120);
      return;
    }

    if (task.href) {
      window.location.href = task.href;
    }
  }

  function renderRaceGroup(group, mountConfig, highlightTaskId) {
    const label = group.raceNumber
      ? `Race ${group.raceNumber}${group.track ? ` — ${group.track}` : ''}`
      : 'General';

    const bullets = group.tasks
      .map((task) => `<li>${escapeHtml(task.title)}.</li>`)
      .join('');

    const cards = group.tasks
      .map((task) => {
        const statusClass = `is-${escapeHtml(task.status || 'pending')}`;
        const highlightClass =
          highlightTaskId && String(task.id) === String(highlightTaskId)
            ? ' is-highlighted'
            : '';
        const raceLabel = formatRaceLabel(task);
        const dueState = formatDueState(task);
        const autoReason = task.autoReason
          ? `<div class="admin-mission-summary__card-desc">${escapeHtml(task.autoReason)}</div>`
          : '';

        return `
          <article class="admin-mission-summary__card${highlightClass}" data-task-id="${escapeHtml(task.id)}">
            <span class="admin-mission-summary__status-icon ${statusClass}" aria-hidden="true">${STATUS_ICONS[task.status] || '•'}</span>
            <div>
              <div class="admin-mission-summary__card-title">${escapeHtml(task.title)}</div>
              ${raceLabel ? `<div class="admin-mission-summary__card-race">${escapeHtml(raceLabel)}</div>` : ''}
              ${task.description ? `<div class="admin-mission-summary__card-desc">${escapeHtml(task.description)}</div>` : ''}
              ${autoReason}
              <div class="admin-mission-summary__card-meta">
                <span class="admin-mission-control__badge ${statusClass}">${escapeHtml(SEVERITY_LABELS[task.status] || STATUS_LABELS[task.status] || task.status)}</span>
                <span class="admin-mission-control__badge ${statusClass}">${escapeHtml(dueState)}</span>
              </div>
            </div>
            <button type="button" class="btn btn-secondary admin-mission-summary__go-btn" data-go-task="${escapeHtml(task.id)}">Go to section</button>
          </article>
        `;
      })
      .join('');

    return `
      <div class="admin-mission-summary__race-group">
        <h3 class="admin-mission-summary__race-title">${escapeHtml(label)}</h3>
        <ul class="admin-mission-summary__bullets">${bullets}</ul>
        <div class="admin-mission-summary__cards">${cards}</div>
      </div>
    `;
  }

  function renderSection(sectionId) {
    const mountConfig = state.mounts.get(sectionId);
    const mountEl = mountConfig?.mountEl;
    if (!mountEl) return;

    const tasks = collectActionableTasks(state.data, sectionId);
    const priorityStatus =
      sectionId === 'analytics' ? 'done' : tasks.length ? worstStatus(tasks) : 'done';
    const priorityLabel = SEVERITY_LABELS[priorityStatus] || 'Complete';
    const highlightTaskId = consumeHighlight(sectionId);

    if (!tasks.length) {
      const message =
        sectionId === 'analytics'
          ? 'All analytics systems are operating normally.'
          : 'No action required.';
      mountEl.innerHTML = `
        <section class="admin-mission-summary" aria-live="polite">
          <div class="admin-mission-summary__header">
            <h2 class="admin-mission-summary__title">Action Required</h2>
            <span class="admin-mission-summary__priority is-complete">Priority: Complete</span>
          </div>
          <div class="admin-mission-summary__clear">
            <span>${escapeHtml(message)}</span>
            <span class="admin-mission-summary__clear-meta">Last updated: ${escapeHtml(formatUpdatedAt(state.updatedAt))}</span>
          </div>
        </section>
      `;
      return;
    }

    const raceGroups = groupTasksByRace(tasks)
      .map((group) => renderRaceGroup(group, mountConfig, highlightTaskId))
      .join('');

    mountEl.innerHTML = `
      <section class="admin-mission-summary" aria-live="polite">
        <div class="admin-mission-summary__header">
          <h2 class="admin-mission-summary__title">Action Required</h2>
          <span class="admin-mission-summary__priority is-${escapeHtml(priorityStatus)}">Priority: ${escapeHtml(priorityLabel)}</span>
        </div>
        ${raceGroups}
      </section>
    `;

    mountEl.querySelectorAll('[data-go-task]').forEach((button) => {
      button.addEventListener('click', () => {
        const task = tasks.find((row) => String(row.id) === String(button.dataset.goTask));
        navigateToTask(task, mountConfig);
      });
    });

    if (highlightTaskId) {
      const card = mountEl.querySelector(`[data-task-id="${highlightTaskId}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const target = tasks.find((row) => String(row.id) === String(highlightTaskId));
        if (target) {
          const hrefTarget = resolveHrefTarget(target.href);
          if (hrefTarget.tab && typeof mountConfig.setTab === 'function') {
            mountConfig.setTab(hrefTarget.tab);
          }
          window.setTimeout(() => {
            pulseElement(document.querySelector(`[data-tab-id="${hrefTarget.tab}"]`));
            pulseElement(document.querySelector('.admin-group-frame-wrap'));
          }, 180);
        }
      }
    }
  }

  function renderAll() {
    state.mounts.forEach((_config, sectionId) => renderSection(sectionId));
  }

  async function ensureData() {
    if (state.data || state.loading || !getSessionPw()) return state.data;
    state.loading = true;
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
      setMissionControl(data);
      return data;
    } catch {
      return null;
    } finally {
      state.loading = false;
    }
  }

  function setMissionControl(data) {
    state.data = data || null;
    state.updatedAt = new Date();
    renderAll();
  }

  function init(config = {}) {
    const sectionId = config.section || inferSectionFromPath();
    const mountEl =
      typeof config.mount === 'string'
        ? document.querySelector(config.mount)
        : config.mount;
    if (!sectionId || !mountEl) return;

    state.mounts.set(sectionId, {
      mountEl,
      setTab: typeof config.setTab === 'function' ? config.setTab : null,
    });

    if (state.data) {
      renderSection(sectionId);
    } else {
      ensureData().then(() => renderSection(sectionId));
    }
  }

  function inferSectionFromPath() {
    const path = normalizePath(location.pathname);
    if (path.endsWith('/content')) return 'content';
    if (path.endsWith('/competition')) return 'competition';
    if (path.endsWith('/race-operations')) return 'race-operations';
    if (path.endsWith('/analytics')) return 'analytics';
    if (path === '/admin' || path.endsWith('/admin')) return 'dashboard';
    return 'dashboard';
  }

  function bindMissionControlLinks(root = document) {
    root.querySelectorAll('[data-mc-task-link]').forEach((link) => {
      if (link.dataset.boundMcLink === '1') return;
      link.dataset.boundMcLink = '1';
      link.addEventListener('click', () => {
        storeHighlight(link.dataset.taskId || '');
      });
    });
  }

  window.AdminMissionTaskSummary = {
    init,
    refresh: ensureData,
    setMissionControl,
    renderAll,
    storeHighlight,
    resolveHrefTarget,
    collectActionableTasks,
    bindMissionControlLinks,
    inferSectionFromPath,
  };
})();
