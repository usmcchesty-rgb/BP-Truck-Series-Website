/**
 * Phase 3e — browser-side writer run orchestration (no backend changes).
 */

export const WRITER_AUTO_ALLOW_PREFIX = 'bp-writer-auto-allow:';

export function clearWriterAutoAllowFlags(runTypes = ['multipass_preview', 'shadow_compare']) {
  for (const rt of runTypes) {
    try {
      sessionStorage.removeItem(`${WRITER_AUTO_ALLOW_PREFIX}${rt}`);
    } catch {
      /* ignore */
    }
  }
}

export function markWriterAutoAllowed(runType) {
  try {
    sessionStorage.setItem(`${WRITER_AUTO_ALLOW_PREFIX}${runType}`, '1');
  } catch {
    /* ignore */
  }
}

export function isWriterAutoAllowed(runType) {
  try {
    return sessionStorage.getItem(`${WRITER_AUTO_ALLOW_PREFIX}${runType}`) === '1';
  } catch {
    return false;
  }
}

const SECTION_TITLE_MAP = {
  introduction: 'Introduction',
  race_summary: 'Race Summary',
  battle_for_win: 'Battle for the Win',
  strategy: 'Strategy',
  championship_picture: 'Championship Picture',
  key_incidents: 'Key Incidents',
  driver_spotlight: 'Driver Spotlight',
  closing: 'Closing',
};

export function formatWriterStageName(stepId) {
  if (!stepId) return '—';
  const id = String(stepId);
  if (id === 'editor' || id === 'repair:editor') return 'Editorial Pass';
  if (id === 'headline' || id === 'repair:headline') return 'Headline Generation';
  if (id === 'validation' || id === 'validation:post-repair') return 'Final Validation';
  if (id === 'validation:repair-scheduled') return 'Validation (scheduling repair)';
  if (id === 'shadow:legacy') return 'Legacy Writer';
  if (id === 'shadow:compare') return 'Article Comparison';
  if (id.startsWith('section:')) {
    const key = id.slice('section:'.length);
    return SECTION_TITLE_MAP[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (id.startsWith('repair:section:')) {
    const key = id.slice('repair:section:'.length);
    const label = SECTION_TITLE_MAP[key] || key.replace(/_/g, ' ');
    return `Repair: ${label}`;
  }
  return id.replace(/_/g, ' ');
}

export function activityLabelForStep(stepId, inFlight) {
  if (!inFlight) return 'Waiting...';
  const id = String(stepId || '');
  if (id.startsWith('section:') || id.startsWith('repair:section:')) return 'Generating section…';
  if (id === 'editor' || id === 'repair:editor') return 'Running editorial pass…';
  if (id === 'headline' || id === 'repair:headline') return 'Building headlines…';
  if (id.startsWith('validation')) return 'Running validation…';
  if (id === 'shadow:legacy') return 'Generating legacy article…';
  if (id === 'shadow:compare') return 'Comparing articles…';
  return 'Processing…';
}

function stepUnitWeight(stepId, sectionsTotal, runType) {
  const st = Math.max(1, sectionsTotal || 1);
  const id = String(stepId);
  if (id === 'shadow:legacy') return runType === 'shadow_compare' ? 0.1 : 0;
  if (id === 'shadow:compare') return runType === 'shadow_compare' ? 0.1 : 0;
  if (id.startsWith('section:')) return 0.55 / st;
  if (id.startsWith('repair:section:')) return (0.55 / st) * 0.35;
  if (id === 'editor') return 0.12;
  if (id === 'repair:editor') return 0.05;
  if (id === 'headline') return 0.06;
  if (id === 'repair:headline') return 0.025;
  if (id === 'validation' || id === 'validation:post-repair') return 0.035;
  return 0;
}

/**
 * Weighted completion 0–100. Never 100 until status is complete.
 */
export function computeWriterRunProgressPercent(progress, runType = 'multipass_preview') {
  if (!progress) return 0;
  const status = String(progress.status || '').toLowerCase();
  if (status === 'complete') return 100;

  const completed = progress.completedStepIds || [];
  const sectionsTotal = progress.sectionsTotal || 1;
  let sum = 0;
  for (const step of completed) {
    sum += stepUnitWeight(step, sectionsTotal, runType);
  }
  if (sum > 0.99) sum = 0.99;
  if (status !== 'complete' && sum >= 1) sum = 0.99;
  return Math.max(0, Math.min(99, Math.round(sum * 100)));
}

export function formatDurationMs(ms) {
  const n = Math.max(0, Number(ms) || 0);
  const sec = Math.floor(n / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function estimateRemainingMs(elapsedMs, percent) {
  const elapsed = Number(elapsedMs) || 0;
  const p = Math.max(1, Math.min(99, percent || 1));
  const total = elapsed / (p / 100);
  return Math.max(0, Math.round(total - elapsed));
}

export function shouldStopWriterAutoContinue(payload, { offline = false } = {}) {
  if (offline) return { stop: true, reason: 'offline' };
  if (!payload) return { stop: true, reason: 'empty_response' };
  if (payload.stale || payload.progress?.packageStale) {
    return { stop: true, reason: 'stale', message: payload.message };
  }
  if (payload.cancelled) return { stop: true, reason: 'cancelled' };
  if (payload.failed) return { stop: true, reason: 'failed' };
  const st = String(payload.progress?.status || '').toLowerCase();
  if (st === 'cancelled' || st === 'failed') return { stop: true, reason: st };
  if (payload.done && !payload.stale) return { stop: true, reason: 'complete' };
  if (payload.error) return { stop: true, reason: 'api_error', message: payload.error };
  if (!payload.progress?.currentStep && payload.done === false && st === 'complete') {
    return { stop: true, reason: 'no_next_step' };
  }
  return { stop: false };
}

export function createInitialWriterRunClientState(runId = null) {
  return {
    running: false,
    paused: false,
    cancelled: false,
    requestInFlight: false,
    runId,
    autoContinue: false,
    pausedAfterRefresh: false,
    lastError: null,
    requestNumber: 0,
    activityLabel: 'Waiting...',
    lastContinueAt: 0,
    lastContinueDurationMs: 0,
  };
}

function randomContinueDelayMs() {
  return 250 + Math.floor(Math.random() * 501);
}

/**
 * Orchestrates continue calls from the browser only.
 */
export class WriterRunController {
  constructor(runType, hooks = {}) {
    this.runType = runType;
    this.hooks = hooks;
    this.state = createInitialWriterRunClientState();
    this._autoTimer = null;
    this._lastProgress = null;
    this._lastDraft = null;
    this._lastComparison = null;
  }

  getState() {
    return { ...this.state };
  }

  getLastSnapshot() {
    return {
      progress: this._lastProgress,
      draft: this._lastDraft,
      comparison: this._lastComparison,
    };
  }

  _notify() {
    this.hooks.onStateChange?.({
      state: this.getState(),
      progress: this._lastProgress,
      draft: this._lastDraft,
      comparison: this._lastComparison,
      runType: this.runType,
    });
  }

  _debug(entry) {
    if (!this.hooks.debugEnabled?.()) return;
    this.hooks.debugLog?.({
      runId: this.state.runId,
      requestNumber: this.state.requestNumber,
      ...entry,
    });
  }

  _clearAutoTimer() {
    if (this._autoTimer) {
      clearTimeout(this._autoTimer);
      this._autoTimer = null;
    }
  }

  syncProgress(progress, { draft = null, comparison = null } = {}) {
    if (progress) this._lastProgress = progress;
    if (draft != null) this._lastDraft = draft;
    if (comparison != null) this._lastComparison = comparison;
    if (progress?.runId) this.state.runId = progress.runId;
    this._notify();
  }

  applyPausedAfterRefreshIfNeeded(hasActiveRun) {
    if (!hasActiveRun) {
      this.state.pausedAfterRefresh = false;
      return;
    }
    const allowed = isWriterAutoAllowed(this.runType);
    if (!allowed) {
      this.state.paused = true;
      this.state.autoContinue = false;
      this.state.pausedAfterRefresh = true;
      this.state.running = true;
    }
    this._notify();
  }

  beginAutoAfterStart(runId, progress, extras = {}) {
    this._clearAutoTimer();
    this.state.runId = runId;
    this.state.running = true;
    this.state.paused = false;
    this.state.cancelled = false;
    this.state.autoContinue = true;
    this.state.pausedAfterRefresh = false;
    this.state.lastError = null;
    markWriterAutoAllowed(this.runType);
    if (progress) this._lastProgress = progress;
    if (extras.draft != null) this._lastDraft = extras.draft;
    if (extras.comparison != null) this._lastComparison = extras.comparison;
    this._notify();
    this.scheduleAutoContinue();
  }

  pause() {
    this._clearAutoTimer();
    this.state.paused = true;
    this.state.autoContinue = false;
    if (!this.state.requestInFlight) this.state.activityLabel = 'Waiting…';
    this._notify();
  }

  resume() {
    if (this.state.cancelled || !this.state.runId) return;
    this.state.paused = false;
    this.state.pausedAfterRefresh = false;
    this.state.autoContinue = true;
    this.state.lastError = null;
    this.state.running = true;
    markWriterAutoAllowed(this.runType);
    this._notify();
    if (!this.state.requestInFlight) this.scheduleAutoContinue();
  }

  runOneStep() {
    if (!this.state.runId || this.state.requestInFlight) return Promise.resolve(null);
    this.state.autoContinue = false;
    this._clearAutoTimer();
    this.state.paused = false;
    return this.tickContinue({ forceOneStep: true });
  }

  async retryAfterError() {
    this.state.lastError = null;
    this.state.paused = false;
    if (this.state.runId && this.hooks.fetchStatus) {
      try {
        const synced = await this.hooks.fetchStatus(this.state.runId);
        if (synced?.progress) this._lastProgress = synced.progress;
        if (synced?.draft) this._lastDraft = synced.draft;
        if (synced?.comparison) this._lastComparison = synced.comparison;
      } catch (e) {
        this.state.lastError = e;
        this._notify();
        return null;
      }
    }
    this._notify();
    return this.runOneStep();
  }

  cancelLocal() {
    this._clearAutoTimer();
    this.state.cancelled = true;
    this.state.autoContinue = false;
    this.state.running = false;
    this.state.paused = true;
    this._notify();
  }

  resetForNewRun() {
    this._clearAutoTimer();
    this.state = createInitialWriterRunClientState();
    this._lastProgress = null;
    this._lastDraft = null;
    this._lastComparison = null;
    this._notify();
  }

  markComplete() {
    this._clearAutoTimer();
    this.state.autoContinue = false;
    this.state.running = false;
    this.state.paused = false;
    this.state.activityLabel = 'Complete';
    this._notify();
  }

  scheduleAutoContinue() {
    this._clearAutoTimer();
    if (!this.state.autoContinue || this.state.paused || this.state.cancelled || this.state.lastError) return;
    if (this.state.requestInFlight) return;
    const delay = randomContinueDelayMs();
    this.state.activityLabel = 'Waiting…';
    this._notify();
    this._autoTimer = setTimeout(() => {
      this.tickContinue().catch(() => {});
    }, delay);
  }

  async tickContinue({ forceOneStep = false } = {}) {
    const { runId } = this.state;
    if (!runId) return null;
    if (this.state.requestInFlight) return null;
    if (this.state.cancelled) return null;
    if (this.state.paused && !forceOneStep) return null;
    if (!forceOneStep && !this.state.autoContinue) return null;
    if (this.state.runId !== runId) return null;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.state.lastError = new Error('Browser is offline.');
      this.state.autoContinue = false;
      this.state.paused = true;
      this._notify();
      return null;
    }

    this._clearAutoTimer();
    this.state.requestInFlight = true;
    const stepBefore = this._lastProgress?.currentStep;
    this.state.activityLabel = activityLabelForStep(stepBefore, true);
    this._notify();

    const started = Date.now();
    this.state.requestNumber += 1;
    const reqNum = this.state.requestNumber;

    try {
      const data = await this.hooks.continueRun(runId);
      if (this.state.runId !== runId || this.state.cancelled) return data;

      this.state.lastContinueDurationMs = Date.now() - started;
      this.state.lastContinueAt = Date.now();

      if (data?.progress) {
        this._lastProgress = data.progress;
        if (data.progress.runId) this.state.runId = data.progress.runId;
      }
      if (data?.draft) {
        this._lastDraft = data.draft;
        if (data.draft?.mode === 'shadow') this._lastComparison = data.draft;
      }

      const stop = shouldStopWriterAutoContinue(data, { offline: typeof navigator !== 'undefined' && !navigator.onLine });
      if (stop.stop) {
        this.state.autoContinue = false;
        this.state.running = stop.reason !== 'complete' && stop.reason !== 'cancelled';
        if (stop.reason === 'complete') this.markComplete();
        else if (stop.reason === 'cancelled') this.state.running = false;
        if (stop.message) this.state.lastError = new Error(stop.message);
        else if (stop.reason === 'stale' || stop.reason === 'api_error') {
          this.state.lastError = new Error(data?.message || data?.error || 'Run stopped.');
          this.state.paused = true;
        }
        this.state.activityLabel = stop.reason === 'complete' ? 'Complete' : 'Waiting…';
        this._debug({
          stage: data?.progress?.currentStep,
          progress: computeWriterRunProgressPercent(data?.progress, this.runType),
          durationMs: this.state.lastContinueDurationMs,
          cost: data?.progress?.estimatedCostUsd,
          stop: stop.reason,
        });
        this._notify();
        return data;
      }

      if (forceOneStep) this.state.autoContinue = false;
      this.state.activityLabel = 'Saving checkpoint…';
      this._debug({
        stage: data?.progress?.currentStep,
        progress: computeWriterRunProgressPercent(data?.progress, this.runType),
        durationMs: this.state.lastContinueDurationMs,
        cost: data?.progress?.estimatedCostUsd,
      });
      this._notify();

      if (!forceOneStep && this.state.autoContinue && !this.state.paused) {
        this.scheduleAutoContinue();
      } else {
        this.state.activityLabel = 'Waiting…';
      }
      return data;
    } catch (err) {
      this.state.lastError = err instanceof Error ? err : new Error(String(err));
      this.state.autoContinue = false;
      this.state.paused = true;
      this.state.activityLabel = 'Waiting…';
      this._debug({ error: this.state.lastError.message, requestNumber: reqNum });
      this._notify();
      return null;
    } finally {
      this.state.requestInFlight = false;
      this._notify();
    }
  }
}

export function listCompletedSectionSteps(progress) {
  return (progress?.completedStepIds || []).filter((s) => String(s).startsWith('section:'));
}
