(function () {
  const SESSION_KEY = 'bp_admin_pw';
  const SEEN_PREFIX = 'bp_admin_seen_attention:';
  const STYLE_ID = 'admin-attention-styles';

  const APPLICATION_ATTENTION = [
    {
      id: 'applications-review',
      label: 'Applications review',
      parentNav: 'competition',
      groupToolHref: '/admin/applications.html',
      pagePath: '/admin/applications.html',
      severity: 'warning',
      statuses: ['pending', 'reviewing'],
    },
    {
      id: 'applications-recruiting',
      label: 'Recruiting race applications',
      parentNav: 'competition',
      groupToolHref: '/admin/applications.html',
      pagePath: '/admin/applications.html',
      severity: 'warning',
      statuses: ['recruiting_race'],
    },
    {
      id: 'applications-waitlist',
      label: 'Waitlist applications',
      parentNav: 'competition',
      groupToolHref: '/admin/applications.html',
      pagePath: '/admin/applications.html',
      severity: 'warning',
      statuses: ['waitlist'],
    },
  ];

  const MISSION_ATTENTION = window.AdminMissionSectionTasks?.MISSION_ATTENTION || [
    {
      id: 'race-ops-overdue',
      label: 'Overdue race operations',
      parentNav: 'race-operations',
      groupTabId: 'race-control',
      groupPageId: 'race-operations',
      severity: 'danger',
      taskStatuses: ['overdue'],
    },
    {
      id: 'race-ops-due',
      label: 'Due race operations',
      parentNav: 'race-operations',
      groupTabId: 'race-control',
      groupPageId: 'race-operations',
      severity: 'warning',
      taskStatuses: ['due'],
    },
  ];

  const state = {
    applications: [],
    missionControl: null,
    observers: [],
    getCurrentPageId: null,
    visibilityTargets: [],
  };

  function getSessionPw() {
    try {
      return sessionStorage.getItem(SESSION_KEY) || '';
    } catch {
      return '';
    }
  }

  function normalizePath(pathname) {
    let path = String(pathname || '').replace(/\\/g, '/');
    if (path.endsWith('/index.html')) path = path.slice(0, -'/index.html'.length);
    if (path.endsWith('/')) path = path.slice(0, -1);
    return path;
  }

  function pathMatches(pagePath) {
    const current = normalizePath(location.pathname);
    const target = normalizePath(pagePath);
    return current === target || current.endsWith(target);
  }

  function parseGroupHash() {
    const raw = String(location.hash || '').replace(/^#/, '');
    if (!raw) return { tabId: '', sub: '' };
    const parts = raw.split(':');
    return { tabId: parts[0] || '', sub: parts.slice(1).join(':') || '' };
  }

  function getSeenSignature(id) {
    try {
      return sessionStorage.getItem(`${SEEN_PREFIX}${id}`) || '';
    } catch {
      return '';
    }
  }

  function markSeen(id, signature) {
    if (!id || !signature) return;
    try {
      sessionStorage.setItem(`${SEEN_PREFIX}${id}`, signature);
    } catch {
      /* ignore */
    }
  }

  function appsSignature(applications, statuses) {
    return applications
      .filter((row) => statuses.includes(String(row.status || 'pending').toLowerCase()))
      .map((row) => String(row.id))
      .sort()
      .join(',');
  }

  function appsCount(applications, statuses) {
    return applications.filter((row) =>
      statuses.includes(String(row.status || 'pending').toLowerCase())
    ).length;
  }

  function collectMissionTasks(data) {
    if (window.AdminMissionSectionTasks?.collectMissionTasks) {
      return window.AdminMissionSectionTasks.collectMissionTasks(data);
    }
    const postRace = data?.workflows?.postRace?.tasks || [];
    const nextRace = data?.workflows?.nextRace?.tasks || [];
    return [...postRace, ...nextRace];
  }

  function missionSignature(tasks) {
    return tasks
      .map((task) => String(task.id))
      .sort()
      .join(',');
  }

  function getMissionSectionAttention(navId) {
    const tasks = window.AdminMissionSectionTasks?.getSectionAttentionTasks(
      state.missionControl,
      navId,
    ) || [];
    const signature = missionSignature(tasks);
    const seenKey = `mission-section-${navId}`;
    const unseen = tasks.length > 0 && signature && getSeenSignature(seenKey) !== signature;
    const severity = tasks.some((task) => task.status === 'overdue') ? 'danger' : 'warning';
    return { tasks, count: tasks.length, signature, unseen, severity, seenKey };
  }

  function getMissionTabAttention(pageId, tabId) {
    const tasks = window.AdminMissionSectionTasks?.getTabAttentionTasks(
      state.missionControl,
      pageId,
      tabId,
    ) || [];
    const signature = missionSignature(tasks);
    const seenKey = `mission-tab-${pageId}-${tabId}`;
    const unseen = tasks.length > 0 && signature && getSeenSignature(seenKey) !== signature;
    const severity = tasks.some((task) => task.status === 'overdue') ? 'danger' : 'warning';
    return { tasks, count: tasks.length, signature, unseen, severity, seenKey };
  }

  function buildMissionAttentionItems() {
    if (window.AdminMissionSectionTasks?.buildMissionAttentionItems) {
      return window.AdminMissionSectionTasks.buildMissionAttentionItems(state.missionControl);
    }
    return [];
  }

  function missionCount(tasks, statuses) {
    return tasks.filter((task) => statuses.includes(task.status)).length;
  }

  function buildAttentionItems() {
    const items = [];

    APPLICATION_ATTENTION.forEach((def) => {
      const count = appsCount(state.applications, def.statuses);
      const signature = appsSignature(state.applications, def.statuses);
      const unseen = count > 0 && signature && getSeenSignature(def.id) !== signature;
      items.push({ ...def, count, signature, unseen });
    });

    ['dashboard', 'content', 'competition', 'race-operations'].forEach((navId) => {
      const mission = getMissionSectionAttention(navId);
      if (!mission.count) return;
      items.push({
        id: mission.seenKey,
        label: `Mission tasks for ${navId}`,
        parentNav: navId,
        count: mission.count,
        signature: mission.signature,
        unseen: mission.unseen,
        severity: mission.severity,
      });
    });

    return items;
  }

  function getUnseenItems() {
    return buildAttentionItems().filter((item) => item.unseen);
  }

  function aggregateForNav(navId) {
    const unseen = getUnseenItems().filter((item) => item.parentNav === navId);
    if (!unseen.length) return null;
    const count = unseen.reduce((sum, item) => sum + item.count, 0);
    const severity = unseen.some((item) => item.severity === 'danger') ? 'danger' : 'warning';
    return { count, severity };
  }

  function aggregateForGroupTool(href) {
    const unseen = getUnseenItems().filter((item) => item.groupToolHref === href);
    if (!unseen.length) return null;
    const count = unseen.reduce((sum, item) => sum + item.count, 0);
    const severity = unseen.some((item) => item.severity === 'danger') ? 'danger' : 'warning';
    return { count, severity };
  }

  function aggregateForGroupTab(pageId, tabId) {
    const mission = getMissionTabAttention(pageId, tabId);
    if (!mission.unseen) return null;
    return { count: mission.count, severity: mission.severity };
  }

  function aggregateForApplicationsTab(statusId) {
    const config = {
      pending: { defId: 'applications-review', filter: ['pending'] },
      reviewing: { defId: 'applications-review', filter: ['reviewing'] },
      recruiting_race: { defId: 'applications-recruiting', filter: ['recruiting_race'] },
      waitlist: { defId: 'applications-waitlist', filter: ['waitlist'] },
    };
    const entry = config[statusId];
    if (!entry) return null;
    const item = buildAttentionItems().find((row) => row.id === entry.defId);
    if (!item?.unseen) return null;
    const count = appsCount(state.applications, entry.filter);
    if (!count) return null;
    return { count, severity: item.severity };
  }

  function isElementVisible(el, minRatio = 0.25) {
    if (!el || el.hidden) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    const visibleArea = visibleWidth * visibleHeight;
    const totalArea = rect.width * rect.height;
    if (!totalArea) return false;
    return visibleArea / totalArea >= minRatio;
  }

  function isApplicationsTableVisible() {
    if (!pathMatches('/admin/applications.html')) return false;
    const panel = document.getElementById('applicationsListPanel');
    const detail = document.getElementById('applicationDetailPanel');
    const tableWrap = document.querySelector('#applicationsListPanel .table-wrap');
    if (!panel || panel.hidden) return false;
    if (detail && !detail.hidden) return false;
    return isElementVisible(tableWrap || panel, 0.2);
  }

  function isRaceOperationsPageVisible() {
    if (!pathMatches('/admin/race-operations.html')) return false;
    const wrap = document.querySelector('.admin-group-frame-wrap');
    return isElementVisible(wrap, 0.2);
  }

  function markVisibleAttentionSeen() {
    let changed = false;

    if (isApplicationsTableVisible()) {
      APPLICATION_ATTENTION.forEach((def) => {
        const count = appsCount(state.applications, def.statuses);
        const signature = appsSignature(state.applications, def.statuses);
        if (count > 0 && signature && getSeenSignature(def.id) !== signature) {
          markSeen(def.id, signature);
          changed = true;
        }
      });
    }

    if (isRaceOperationsPageVisible()) {
      const mission = getMissionSectionAttention('race-operations');
      if (mission.count > 0 && mission.signature && getSeenSignature(mission.seenKey) !== mission.signature) {
        markSeen(mission.seenKey, mission.signature);
        changed = true;
      }
      const { tabId } = parseGroupHash();
      if (tabId) {
        const tabMission = getMissionTabAttention('race-operations', tabId);
        if (
          tabMission.count > 0 &&
          tabMission.signature &&
          getSeenSignature(tabMission.seenKey) !== tabMission.signature
        ) {
          markSeen(tabMission.seenKey, tabMission.signature);
          changed = true;
        }
      }
    }

    state.visibilityTargets.forEach((target) => {
      if (typeof target.isActive === 'function' && !target.isActive()) return;
      const el = typeof target.element === 'function' ? target.element() : target.element;
      if (!el || !isElementVisible(el, target.threshold || 0.25)) return;
      const item = buildAttentionItems().find((row) => row.id === target.id);
      if (item?.unseen) {
        markSeen(item.id, item.signature);
        changed = true;
      }
    });

    if (changed) applyAllDecorations();
  }

  function decorateElement(el, decoration) {
    if (!el) return;
    el.classList.remove('attention-pulse', 'attention-pulse-warning', 'attention-pulse-danger');
    el.querySelectorAll('.attention-badge').forEach((badge) => badge.remove());
    if (!decoration) return;
    el.classList.add(
      'attention-pulse',
      decoration.severity === 'danger' ? 'attention-pulse-danger' : 'attention-pulse-warning'
    );
    if (decoration.count > 0) {
      const badge = document.createElement('span');
      badge.className = `attention-badge attention-badge-${
        decoration.severity === 'danger' ? 'danger' : 'warning'
      }`;
      badge.textContent = String(decoration.count);
      badge.setAttribute('aria-label', `${decoration.count} items need attention`);
      el.appendChild(badge);
    }
  }

  function storeNavMissionHighlight(navId) {
    if (!window.AdminMissionTaskSummary || !navId) return;
    const tasks = window.AdminMissionSectionTasks?.getSectionAttentionTasks(
      state.missionControl,
      navId,
    ) || [];
    const top =
      tasks.find((task) => task.status === 'overdue') ||
      tasks.find((task) => task.status === 'due') ||
      tasks[0];
    if (top) window.AdminMissionTaskSummary.storeHighlight(top.id);
  }

  function getApplicationAttentionTasks(sectionId) {
    if (sectionId !== 'competition') return [];
    return APPLICATION_ATTENTION.flatMap((def) => {
      const count = appsCount(state.applications, def.statuses);
      if (!count) return [];
      return [
        {
          id: def.id,
          title: def.label,
          description: `${count} application${count === 1 ? '' : 's'} need review.`,
          href: def.groupToolHref,
          status: 'due',
          raceNumber: null,
          track: null,
          isApplicationAttention: true,
        },
      ];
    });
  }

  function getSectionPanelTasks(sectionId) {
    const missionTasks = window.AdminMissionSectionTasks?.getSectionAttentionTasks(
      state.missionControl,
      sectionId,
    ) || [];
    return [...missionTasks, ...getApplicationAttentionTasks(sectionId)];
  }

  function getNavBadgeCount(navId) {
    const agg = aggregateForNav(navId);
    return agg?.count ?? 0;
  }

  function applyNavDecorations() {
    document.querySelectorAll('[data-nav-id]').forEach((link) => {
      const navId = link.dataset.navId;
      const decoration = aggregateForNav(navId);
      decorateElement(link, decoration);
      if (link.dataset.missionNavBound === '1') return;
      link.dataset.missionNavBound = '1';
      link.addEventListener('click', () => {
        if (aggregateForNav(navId)) storeNavMissionHighlight(navId);
      });
    });
  }

  function applyGroupDecorations() {
    document.querySelectorAll('.admin-group-tools a[href]').forEach((link) => {
      decorateElement(link, aggregateForGroupTool(link.getAttribute('href')));
    });

    document.querySelectorAll('[data-tab-id]').forEach((button) => {
      const pageId = document.body.classList.contains('admin-group-page')
        ? state.getCurrentPageId?.() || ''
        : '';
      decorateElement(button, aggregateForGroupTab(pageId, button.dataset.tabId));
    });
  }

  function applyApplicationsTabDecorations() {
    document.querySelectorAll('[data-status-tab]').forEach((button) => {
      const statusId = button.dataset.statusTab;
      if (statusId === 'all') {
        decorateElement(button, null);
        return;
      }
      decorateElement(button, aggregateForApplicationsTab(statusId));
    });
  }

  function applyAllDecorations() {
    applyNavDecorations();
    applyGroupDecorations();
    applyApplicationsTabDecorations();
  }

  async function fetchApplications() {
    const pw = getSessionPw();
    if (!pw) return [];
    try {
      const res = await fetch('/api/admin/driver-applications', {
        headers: { 'X-Admin-Password': pw },
      });
      const data = await res.json();
      if (!res.ok) return [];
      return data.applications || [];
    } catch {
      return [];
    }
  }

  async function fetchMissionControl() {
    const pw = getSessionPw();
    if (!pw) return null;
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw, action: 'getAdminMissionControl' }),
      });
      const data = await res.json();
      if (!res.ok) return null;
      return data;
    } catch {
      return null;
    }
  }

  async function refresh(options = {}) {
    if (!getSessionPw()) {
      applyAllDecorations();
      return;
    }

    if (!options.skipFetch) {
      const [applications, missionControl] = await Promise.all([
        options.applications ? Promise.resolve(options.applications) : fetchApplications(),
        options.missionControl ? Promise.resolve(options.missionControl) : fetchMissionControl(),
      ]);
      if (Array.isArray(applications)) state.applications = applications;
      if (missionControl) state.missionControl = missionControl;
      if (missionControl && window.AdminMissionTaskSummary) {
        window.AdminMissionTaskSummary.setMissionControl(missionControl);
      }
    }

    markVisibleAttentionSeen();
    applyAllDecorations();
    if (window.AdminMissionTaskSummary) {
      window.AdminMissionTaskSummary.renderAll();
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = '/admin/admin-attention.css';
    document.head.appendChild(link);
  }

  function bindVisibilityChecks() {
    if (state.observers.length) return;

    const scheduleCheck = () => {
      window.requestAnimationFrame(() => markVisibleAttentionSeen());
    };

    window.addEventListener('scroll', scheduleCheck, { passive: true });
    window.addEventListener('resize', scheduleCheck, { passive: true });
    window.addEventListener('hashchange', () => {
      refresh({ skipFetch: true });
    });
    document.addEventListener('visibilitychange', scheduleCheck);

    const observer = new MutationObserver(scheduleCheck);
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
    state.observers.push(observer);
  }

  function bindFocusRefresh() {
    window.addEventListener('focus', () => refresh());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
  }

  function init(options = {}) {
    if (options.getCurrentPageId) state.getCurrentPageId = options.getCurrentPageId;
    injectStyles();
    bindVisibilityChecks();
    bindFocusRefresh();
    refresh();
  }

  window.AdminAttention = {
    init,
    refresh,
    markVisibleAttentionSeen,
    setApplications(applications) {
      if (Array.isArray(applications)) state.applications = applications;
      refresh({ skipFetch: true, applications });
    },
    setMissionControl(missionControl) {
      state.missionControl = missionControl;
      if (window.AdminMissionTaskSummary) {
        window.AdminMissionTaskSummary.setMissionControl(missionControl);
      }
      if (window.AdminMissionOperations?.setMissionControl) {
        window.AdminMissionOperations.setMissionControl(missionControl);
      }
      refresh({ skipFetch: true, missionControl });
    },
    observeTarget(target) {
      state.visibilityTargets.push(target);
    },
    getUnseenItems,
    markSeen,
    getSeenSignature,
    getMissionControl() {
      return state.missionControl;
    },
    getNavBadgeCount,
    getSectionPanelTasks,
    getApplicationAttentionTasks,
  };
})();
