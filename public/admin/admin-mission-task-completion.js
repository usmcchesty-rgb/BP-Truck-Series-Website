(function () {
  const SESSION_KEY = 'bp_admin_pw';
  const AUTO_CONFIRM =
    'This task is normally detected automatically. Mark it complete manually anyway?';

  function getSessionPw() {
    try {
      return sessionStorage.getItem(SESSION_KEY) || '';
    } catch {
      return '';
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isAutomaticTask(task) {
    const mode = String(task?.detectionMode || '').toLowerCase();
    return mode === 'automatic' || mode === 'placeholder';
  }

  function isTaskActionable(task) {
    return Boolean(task && task.status !== 'inactive');
  }

  function formatManualCompletionAt(value) {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function buildOverrideBadge(task) {
    if (!task?.manualOverride || !task?.completed) return '';
    return '<span class="admin-mission-control__mode-badge is-override">MANUAL OVERRIDE</span>';
  }

  function buildManualAuditLine(task) {
    if (task?.completionSource !== 'manual') return '';
    const at = task.manuallyCompletedAt || task.completedAt;
    const formatted = formatManualCompletionAt(at);
    if (!formatted) return '';
    return `<div class="admin-mission-control__task-audit">Completed manually on: ${escapeHtml(formatted)}</div>`;
  }

  function buildTaskActionButton(task) {
    if (!isTaskActionable(task)) {
      return '<span class="admin-mission-control__task-inactive-note">Task inactive outside race-work window.</span>';
    }

    if (task.completed) {
      return `<button
        type="button"
        class="btn btn-secondary admin-mission-control__task-action"
        data-mc-task-action="reopen"
        data-task-id="${escapeHtml(task.id)}"
        data-workflow="${escapeHtml(task.workflow)}"
      >Reopen Task</button>`;
    }

    return `<button
      type="button"
      class="btn admin-mission-control__task-action"
      data-mc-task-action="complete"
      data-task-id="${escapeHtml(task.id)}"
      data-workflow="${escapeHtml(task.workflow)}"
    >Mark Complete</button>`;
  }

  async function confirmTaskToggle(task, completed) {
    if (!completed) return true;
    if (!isAutomaticTask(task)) return true;
    return window.confirm(AUTO_CONFIRM);
  }

  function applyMissionControlPayload(data) {
    if (!data) return;
    window.__bpPendingMissionControl = data;
    if (window.AdminAttention?.setMissionControl) {
      window.AdminAttention.setMissionControl(data);
    }
    if (window.AdminMissionTaskSummary?.setMissionControl) {
      window.AdminMissionTaskSummary.setMissionControl(data);
    }
    if (window.AdminMissionOperations?.setMissionControl) {
      window.AdminMissionOperations.setMissionControl(data);
    }
    if (window.AdminMissionControl?.applyPayload) {
      window.AdminMissionControl.applyPayload(data);
    }
  }

  async function setTaskCompletion(task, completed, missionControl = null) {
    const mc = missionControl || window.__bpPendingMissionControl || window.AdminAttention?.getMissionControl?.();
    const seasonId = mc?.seasonId;
    const raceNumber = task?.raceNumber;
    const workflow = task?.workflow;
    const taskId = task?.id;
    const password = getSessionPw();

    if (!taskId || raceNumber == null || !workflow || !password) {
      throw new Error('Mission Control task context unavailable.');
    }

    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password,
        action: 'updateAdminMissionControlTask',
        seasonId,
        raceNumber,
        workflow,
        taskId,
        completed,
        manualOverride: completed && isAutomaticTask(task),
        manuallyCompletedBy: 'admin',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    applyMissionControlPayload(data);
    return data;
  }

  function findTaskInPayload(missionControl, taskId, workflow) {
    if (!missionControl || !taskId) return null;
    const postRace = missionControl?.workflows?.postRace?.tasks || missionControl?.postRace?.tasks || [];
    const nextRace = missionControl?.workflows?.nextRace?.tasks || missionControl?.nextRace?.tasks || [];
    const tasks = [...postRace, ...nextRace];
    return (
      tasks.find(
        (row) =>
          String(row.id) === String(taskId) &&
          (!workflow || String(row.workflow) === String(workflow)),
      ) || null
    );
  }

  function bindTaskActionButtons(root, tasks, missionControl) {
    if (!root) return;
    root.querySelectorAll('[data-mc-task-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const task =
          tasks.find(
            (row) =>
              String(row.id) === String(button.dataset.taskId) &&
              String(row.workflow) === String(button.dataset.workflow),
          ) || findTaskInPayload(missionControl, button.dataset.taskId, button.dataset.workflow);

        if (!task) return;

        const completed = button.dataset.mcTaskAction === 'complete';
        if (!(await confirmTaskToggle(task, completed))) return;

        button.disabled = true;
        try {
          await setTaskCompletion(task, completed, missionControl);
        } catch (error) {
          window.alert(error.message || 'Failed to update task.');
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  window.AdminMissionTaskCompletion = {
    AUTO_CONFIRM,
    isAutomaticTask,
    isTaskActionable,
    formatManualCompletionAt,
    buildOverrideBadge,
    buildManualAuditLine,
    buildTaskActionButton,
    confirmTaskToggle,
    applyMissionControlPayload,
    setTaskCompletion,
    bindTaskActionButtons,
    findTaskInPayload,
  };
})();
