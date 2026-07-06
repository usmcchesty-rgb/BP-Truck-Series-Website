(function () {
  const ATTENTION_TASK_STATUSES = ['overdue', 'due'];

  const STATUS_PRIORITY = { overdue: 0, due: 1, pending: 2, upcoming: 3, done: 4 };

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

  const MISSION_ATTENTION = [
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

  function normalizeHref(href) {
    let path = String(href || '').split('?')[0].split('#')[0].replace(/\\/g, '/');
    if (path.endsWith('.html')) path = path.slice(0, -'.html'.length);
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

  function collectMissionTasks(data) {
    if (!data) return [];
    if (Array.isArray(data.tasks) && data.tasks.length) return [...data.tasks];
    const postRace = data?.workflows?.postRace?.tasks || data?.postRace?.tasks || [];
    const nextRace = data?.workflows?.nextRace?.tasks || data?.nextRace?.tasks || [];
    return [...postRace, ...nextRace];
  }

  function enrichTask(task, missionControl) {
    const workflow = task.workflow;
    const bucket =
      workflow === 'nextRace'
        ? missionControl?.workflows?.nextRace || missionControl?.nextRace
        : missionControl?.workflows?.postRace || missionControl?.postRace;

    return {
      ...task,
      raceNumber: task.raceNumber ?? bucket?.raceNumber ?? null,
      track: task.track ?? bucket?.track ?? null,
      date: task.date ?? bucket?.date ?? null,
    };
  }

  function filterMissionTasks(missionControl, options = {}) {
    const {
      sectionId = null,
      tabId = null,
      statuses = ATTENTION_TASK_STATUSES,
    } = options;

    if (!missionControl || sectionId === 'analytics') return [];

    return collectMissionTasks(missionControl)
      .filter((task) => {
        if (task.completed || task.status === 'done') return false;
        if (statuses.length && !statuses.includes(task.status)) return false;

        const target = resolveHrefTarget(task.href);
        if (sectionId && target.section !== sectionId) return false;
        if (tabId && target.tab && target.tab !== tabId) return false;

        return true;
      })
      .map((task) => enrichTask(task, missionControl))
      .sort((a, b) => {
        const priorityDiff =
          (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
        if (priorityDiff !== 0) return priorityDiff;
        return String(a.title || '').localeCompare(String(b.title || ''));
      });
  }

  function getSectionAttentionTasks(missionControl, sectionId) {
    return filterMissionTasks(missionControl, { sectionId, statuses: ATTENTION_TASK_STATUSES });
  }

  function getTabAttentionTasks(missionControl, pageId, tabId) {
    return filterMissionTasks(missionControl, {
      sectionId: pageId,
      tabId,
      statuses: ATTENTION_TASK_STATUSES,
    });
  }

  function missionSignature(tasks) {
    return tasks
      .map((task) => String(task.id))
      .sort()
      .join(',');
  }

  function buildMissionAttentionItems(missionControl) {
    const allTasks = collectMissionTasks(missionControl);
    return MISSION_ATTENTION.map((def) => {
      const tasks = filterMissionTasks(missionControl, {
        sectionId: def.parentNav,
        tabId: def.groupTabId,
        statuses: def.taskStatuses,
      });
      return {
        ...def,
        tasks,
        count: tasks.length,
        signature: missionSignature(tasks),
      };
    });
  }

  function getNavMissionBadgeCount(missionControl, sectionId, unseenOnly, unseenSignatures) {
    const items = buildMissionAttentionItems(missionControl).filter(
      (item) => item.parentNav === sectionId,
    );
    const eligible = unseenOnly
      ? items.filter(
          (item) =>
            item.count > 0 &&
            item.signature &&
            unseenSignatures?.(item.id) !== item.signature,
        )
      : items.filter((item) => item.count > 0);

    return eligible.reduce((sum, item) => sum + item.count, 0);
  }

  function getTabMissionBadgeCount(
    missionControl,
    pageId,
    tabId,
    unseenOnly,
    unseenSignatures,
  ) {
    const items = buildMissionAttentionItems(missionControl).filter(
      (item) => item.groupPageId === pageId && item.groupTabId === tabId,
    );
    const eligible = unseenOnly
      ? items.filter(
          (item) =>
            item.count > 0 &&
            item.signature &&
            unseenSignatures?.(item.id) !== item.signature,
        )
      : items.filter((item) => item.count > 0);

    return eligible.reduce((sum, item) => sum + item.count, 0);
  }

  function assertPanelMatchesBadge(sectionId, badgeCount, renderedTasks, missionControl) {
    const renderedCount = Array.isArray(renderedTasks) ? renderedTasks.length : 0;
    if (!(badgeCount > 0 && renderedCount === 0)) return;

    const sectionTasks = getSectionAttentionTasks(missionControl, sectionId);
    console.warn('[MissionTaskSummary] badge/panel mismatch', {
      section: sectionId,
      badgeCount,
      renderedTaskCount: renderedCount,
      taskIds: sectionTasks.map((task) => task.id),
      taskHrefs: sectionTasks.map((task) => task.href),
      filterResult: sectionTasks.map((task) => ({
        id: task.id,
        href: task.href,
        status: task.status,
        section: resolveHrefTarget(task.href).section,
        tab: resolveHrefTarget(task.href).tab,
      })),
    });
  }

  window.AdminMissionSectionTasks = {
    ATTENTION_TASK_STATUSES,
    MISSION_ATTENTION,
    STATUS_PRIORITY,
    normalizeHref,
    resolveHrefTarget,
    collectMissionTasks,
    filterMissionTasks,
    getSectionAttentionTasks,
    getTabAttentionTasks,
    buildMissionAttentionItems,
    getNavMissionBadgeCount,
    getTabMissionBadgeCount,
    assertPanelMatchesBadge,
  };
})();
