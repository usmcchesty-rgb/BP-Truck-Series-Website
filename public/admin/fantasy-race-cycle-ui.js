import {
  PHASES,
  STEP_STATUS,
  buildFantasyRaceCycleModel,
  getActionDisabledReason,
  isStepComplete,
} from './fantasy-race-cycle-state.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusIcon(status) {
  switch (status) {
    case STEP_STATUS.COMPLETE:
      return '✓';
    case STEP_STATUS.BLOCKED:
      return '⛔';
    case STEP_STATUS.NEEDS_REVIEW:
      return '!';
    case STEP_STATUS.READY:
      return '→';
    default:
      return '○';
  }
}

const SAFE_REFRESH = [
  'Refresh Results',
  'Recalculate Preview',
  'Review Exclusions',
  'Review Salary Details',
];

const uiState = {
  model: null,
  busy: false,
  manualExpanded: {},
  lastFocused: null,
  validationVisible: false,
};

function sessionKey(prefix, context) {
  const season = context?.adminStats?.slate?.season_id || 'season';
  return `${prefix}:${season}`;
}

function loadManualExpanded(context) {
  try {
    const raw = sessionStorage.getItem(sessionKey('frc_manual_expand', context));
    uiState.manualExpanded = raw ? JSON.parse(raw) : {};
  } catch {
    uiState.manualExpanded = {};
  }
}

function saveManualExpanded(context) {
  try {
    sessionStorage.setItem(sessionKey('frc_manual_expand', context), JSON.stringify(uiState.manualExpanded));
  } catch {
    /* ignore */
  }
}

function isExpanded(step, model) {
  if (uiState.manualExpanded[step.id] === true) return true;
  if (uiState.manualExpanded[step.id] === false) return false;
  if (isStepComplete(step)) return false;
  return step.id === model.autoExpandedStepId;
}

function focusStep(stepId, context) {
  if (stepId) {
    uiState.manualExpanded[stepId] = true;
    if (context) saveManualExpanded(context);
    render(context || window.FantasyRaceCycle._lastContext);
  }
  requestAnimationFrame(() => {
    const button = document.querySelector(`#frc-step-toggle-${stepId}`);
    const panel = document.getElementById(`frc-step-panel-${stepId}`);
    if (button) {
      uiState.lastFocused = button;
      button.focus();
    }
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function renderDashboard(model) {
  const cards = [
    ['Season', model.summary.season, model.summary.stepLinks.season],
    ['Previous Race', model.summary.previousRace, model.summary.stepLinks.previousRace],
    ['Contest', model.summary.previousContest, 'finalize_contest'],
    ['Scoring', model.summary.scoring, model.summary.stepLinks.scoring],
    ['Standings', model.summary.standings, model.summary.stepLinks.standings],
    ['Next Race', model.summary.nextRace, model.summary.stepLinks.nextRace],
    ['Slate', model.summary.slate, model.summary.stepLinks.slate],
    ['Drivers', model.summary.drivers, model.summary.stepLinks.drivers],
    ['Salaries', model.summary.salaries, model.summary.stepLinks.salaries],
    ['Published', model.summary.published, model.summary.stepLinks.published],
    ['Entries', model.summary.entries, model.summary.stepLinks.entries],
    ['Lock', model.summary.lock, model.summary.stepLinks.lock],
  ];
  return `<div class="frc-dashboard" role="region" aria-label="Race cycle summary dashboard">
    ${cards
      .map(
        ([label, value, stepId]) =>
          `<button type="button" class="frc-dashboard-card" data-frc-scroll="${escapeHtml(stepId || '')}">
            <span class="frc-k">${escapeHtml(label)}</span>
            <strong class="frc-v">${escapeHtml(value)}</strong>
          </button>`
      )
      .join('')}
  </div>`;
}

function renderProgressHeader(model) {
  const { progress, currentStep, nextRecommendedAction, overallState } = model;
  return `<div class="frc-progress-header" role="region" aria-label="Workflow progress">
    <div class="frc-progress-top">
      <div>
        <p class="frc-progress-count">${progress.completedRequired} of ${progress.totalRequired} Steps Complete</p>
        <p class="frc-overall-state">Overall: ${escapeHtml(overallState)}</p>
      </div>
      <button type="button" class="btn btn-secondary frc-validate-btn" id="frcValidateTopBtn">Run Full Validation</button>
    </div>
    <div class="frc-progress-bar-wrap">
      <div class="frc-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.totalRequired}" aria-valuenow="${progress.completedRequired}" aria-label="Required workflow steps complete">
        <div class="frc-progress-bar-fill" style="width:${progress.percentage}%"></div>
      </div>
    </div>
    <div class="frc-progress-meta">
      <div><span class="frc-k">Current Step</span><strong class="frc-v">${currentStep.number}. ${escapeHtml(currentStep.title)}</strong></div>
      <div><span class="frc-k">Next Recommended Action</span><strong class="frc-v">${escapeHtml(nextRecommendedAction.label)}</strong></div>
    </div>
    <div class="frc-next-action">
      <button type="button" class="btn" id="frcContinueBtn">Continue Race Cycle</button>
    </div>
  </div>`;
}

function renderReadyBanner(model) {
  if (model.readiness.ready) {
    return `<div class="frc-ready-banner" role="status">
      <strong>${escapeHtml(model.readiness.title)}</strong>
      <span>${escapeHtml(model.readiness.fields.race)} · ${escapeHtml(model.readiness.fields.entries)}</span>
      <button type="button" class="btn btn-secondary frc-ready-link" id="frcReadyBannerLink">View readiness details</button>
    </div>`;
  }
  if (!model.readiness.issues.length) return '';
  return `<div class="frc-action-required-banner" role="alert">
    <strong>ACTION REQUIRED</strong>
    <ul class="frc-issue-list">${model.readiness.issues
      .map(
        (issue) =>
          `<li><span>${escapeHtml(issue.message)}</span> <button type="button" class="frc-issue-link" data-frc-scroll="${escapeHtml(issue.stepId)}">Go to Step ${issue.stepNumber}</button></li>`
      )
      .join('')}</ul>
  </div>`;
}

function renderActionButton(step, steps) {
  if (!step.actionLabel) return '';
  const disabled = !step.actionEnabled;
  const reason = disabled ? getActionDisabledReason(step, steps) : '';
  const label = disabled ? `${step.actionLabel} — Disabled` : step.actionLabel;
  return `<div class="frc-step-actions">
    <button type="button" class="btn frc-step-action" data-frc-step="${escapeHtml(step.id)}" ${disabled ? 'disabled aria-disabled="true"' : ''}>${escapeHtml(label)}</button>
    ${disabled && reason ? `<p class="frc-disabled-reason" id="frc-disabled-${escapeHtml(step.id)}">${escapeHtml(reason)}</p>` : ''}
  </div>`;
}

function renderStepPanel(step, model) {
  const expanded = isExpanded(step, model);
  const summary = step.completionSummary || `${step.status}${step.completedAt ? ` — ${step.completedAt}` : ''}`;
  const warnings =
    step.warnings?.length || step.blockedReason
      ? `<div class="frc-warning-wrap">${(step.warnings || [])
          .map((w) => `<p class="frc-warning" role="alert">${escapeHtml(w)}</p>`)
          .join('')}${step.blockedReason ? `<p class="frc-warning" role="alert">${escapeHtml(step.blockedReason)}</p>` : ''}</div>`
      : '';
  const panelId = `frc-step-panel-${step.id}`;
  return `<article class="frc-step ${expanded ? 'is-expanded' : 'is-collapsed'}" id="frc-step-${escapeHtml(step.id)}" data-status="${escapeHtml(step.status)}">
    <button type="button" class="frc-step-toggle" id="frc-step-toggle-${escapeHtml(step.id)}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="${panelId}">
      <span class="frc-step-icon" aria-hidden="true">${statusIcon(step.status)}</span>
      <span class="frc-step-toggle-text">
        <span class="frc-step-title">${step.number}. ${escapeHtml(step.title)}</span>
        <span class="frc-step-status">${escapeHtml(step.status)}${step.status === STEP_STATUS.COMPLETE && step.warnings?.length ? ' — Complete with Warning' : ''}</span>
        <span class="frc-step-collapsed-summary">${escapeHtml(summary)}</span>
      </span>
    </button>
    <div class="frc-step-panel" id="${panelId}" ${expanded ? '' : 'hidden'}>
      <p class="frc-step-explainer">${escapeHtml(step.explanation)}</p>
      ${warnings}
      ${renderActionButton(step, model.steps)}
      ${
        step.id === 'readiness_check'
          ? `<div id="frcReadinessDetailHost">${renderReadinessDetail(model)}</div>`
          : ''
      }
    </div>
  </article>`;
}

function renderPhase(phaseKey, model) {
  const phase = model.phases[phaseKey];
  const steps = model.steps.filter((step) => step.phaseId === phaseKey);
  return `<section class="frc-phase frc-phase--${phaseKey}" aria-labelledby="frc-phase-${phaseKey}">
    <header class="frc-phase-header">
      <h3 class="frc-phase-title" id="frc-phase-${phaseKey}">${escapeHtml(phase.title)}</h3>
      <p class="frc-phase-status">${escapeHtml(phase.status)}</p>
      <p class="frc-phase-explainer">${escapeHtml(phase.explanation)}</p>
    </header>
    <div class="frc-steps">${steps.map((step) => renderStepPanel(step, model)).join('')}</div>
  </section>`;
}

function renderReadinessDetail(model) {
  const card = model.readiness;
  const validationBtn = `<button type="button" class="btn btn-secondary frc-validate-btn" id="frcValidateStepBtn">Run Full Validation</button>`;
  if (card.ready) {
    return `<div class="frc-ready-card" role="status">
      <h4>${escapeHtml(card.title)}</h4>
      <dl class="frc-ready-fields">
        ${Object.entries(card.fields)
          .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`)
          .join('')}
      </dl>
      ${validationBtn}
    </div>`;
  }
  return `<div class="frc-ready-card frc-ready-card--action" role="alert">
    <h4>${escapeHtml(card.title)}</h4>
    <ul class="frc-issue-list">${card.issues
      .map(
        (issue) =>
          `<li><span>${escapeHtml(issue.message)}</span> <button type="button" class="frc-issue-link" data-frc-scroll="${escapeHtml(issue.stepId)}">Go to Step ${issue.stepNumber}</button></li>`
      )
      .join('')}</ul>
    ${validationBtn}
  </div>`;
}

function renderValidationResults(model) {
  if (!uiState.validationVisible) return '';
  const validation = model.validation;
  const renderGroup = (title, checks) =>
    `<div class="frc-validation-group"><h4>${escapeHtml(title)}</h4><ul>${checks
      .map(
        (row) =>
          `<li><span class="frc-validation-state frc-validation-state--${row.state.toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(row.state)}</span> ${escapeHtml(row.label)}</li>`
      )
      .join('')}</ul></div>`;
  const summary = validation.passed
    ? '<p class="frc-validation-summary ok">No blocking issues found. The next Fantasy contest is ready.</p>'
    : `<p class="frc-validation-summary error">${validation.blockingCount} blocking issue${validation.blockingCount === 1 ? '' : 's'} found.</p>`;
  return `<div class="frc-validation-results" id="frcValidationResults" role="region" aria-live="polite">
    ${summary}
    ${renderGroup('Post-Race Checks', validation.postRaceChecks)}
    ${renderGroup('Next-Race Checks', validation.nextRaceChecks)}
  </div>`;
}

function renderHistory(context) {
  const postRace = context.postRace || {};
  const scoring = context.scoring || postRace.scoring || {};
  const meta = scoring.scoringMeta || {};
  const rows = [
    ['Race', postRace.completedRace ? `Race ${postRace.completedRace.raceNumber}` : 'Not available'],
    ['Results imported', scoring.resultsReady ? 'Yes' : 'No'],
    ['Scoring calculated', meta.scoredAt || 'Not available'],
    ['Contest finalized', meta.status === 'scored' ? meta.scoredAt || 'Yes' : 'No'],
    ['Standings updated', meta.status === 'scored' ? 'Yes' : 'Pending'],
    ['Next slate generated', postRace.salaryDraft?.draft ? 'Yes' : 'No'],
    ['Next slate published', postRace.salaryDraft?.published ? 'Yes' : 'No'],
  ];
  return `<section class="frc-history" aria-label="Race cycle history">
    <h3 class="frc-history-title">Race Cycle History</h3>
    <table class="frc-history-table"><tbody>${rows
      .map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
      .join('')}</tbody></table>
  </section>`;
}

async function runStepAction(stepId) {
  const bridge = window.FantasyAdminBridge;
  if (!bridge?.actions || uiState.busy) return;
  if (stepId === 'readiness_check') {
    uiState.validationVisible = true;
    render(window.FantasyRaceCycle._lastContext);
    focusStep('readiness_check', window.FantasyRaceCycle._lastContext);
    return;
  }
  const step = uiState.model?.steps?.find((row) => row.id === stepId);
  const refreshOnly = step && !step.actionEnabled && SAFE_REFRESH.includes(step.actionLabel);
  if (step && step.status === STEP_STATUS.COMPLETE && !step.actionEnabled && !refreshOnly) {
    if (step.actionLabel === 'Review Exclusions') {
      document.getElementById('fantasyDriverPoolHealthCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (step.actionLabel === 'Review Salary Details') {
      document.getElementById('fantasySalaryTableWrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  }
  uiState.busy = true;
  try {
    const actions = {
      import_official_results: bridge.actions.loadOfficialResults,
      calculate_fantasy_scoring: () =>
        step?.actionLabel === 'Recalculate Preview'
          ? bridge.actions.recalculateScoring?.()
          : bridge.actions.calculateScoring?.(),
      review_fantasy_scoring: bridge.actions.approveScoringReview,
      finalize_contest: bridge.actions.finalizeContest,
      update_season_standings: bridge.actions.updateStandings,
      select_next_race: bridge.actions.selectNextRace,
      build_driver_pool: bridge.actions.buildDriverPool,
      generate_salaries: bridge.actions.generateSalaries,
      review_next_slate: bridge.actions.approveSlate,
      publish_next_slate: bridge.actions.publishSlate,
    };
    await actions[stepId]?.();
    await bridge.refresh?.();
  } finally {
    uiState.busy = false;
  }
}

function bindPanelEvents(root, context) {
  root.querySelector('#frcContinueBtn')?.addEventListener('click', () => {
    const stepId = uiState.model?.nextRecommendedAction?.stepId;
    if (stepId) focusStep(stepId, context);
  });
  root.querySelector('#frcReadyBannerLink')?.addEventListener('click', () => focusStep('readiness_check', context));
  root.querySelectorAll('.frc-validate-btn, #frcValidateTopBtn, #frcValidateStepBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.validationVisible = true;
      render(context);
      const results = document.getElementById('frcValidationResults');
      results?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  root.querySelectorAll('[data-frc-scroll]').forEach((el) => {
    el.addEventListener('click', () => focusStep(el.getAttribute('data-frc-scroll'), context));
  });
  root.querySelectorAll('.frc-step-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const stepId = button.id.replace('frc-step-toggle-', '');
      const expanded = button.getAttribute('aria-expanded') === 'true';
      uiState.manualExpanded[stepId] = !expanded;
      saveManualExpanded(context);
      render(context);
    });
  });
  root.querySelectorAll('.frc-step-action:not([disabled])').forEach((button) => {
    button.addEventListener('click', () => runStepAction(button.getAttribute('data-frc-step')));
  });
}

function render(context) {
  loadManualExpanded(context);
  const model = buildFantasyRaceCycleModel(context);
  uiState.model = model;
  window.FantasyRaceCycle._lastContext = context;
  const root = document.getElementById('fantasyRaceCycleRoot');
  if (!root) return;

  root.innerHTML = `<section class="frc-panel admin-card admin-card--full" aria-labelledby="frc-title">
    <div class="frc-sticky">
      <div class="admin-card-title" id="frc-title">Fantasy Race Cycle</div>
      ${renderReadyBanner(model)}
      ${renderDashboard(model)}
      ${renderProgressHeader(model)}
    </div>
    ${renderValidationResults(model)}
    ${renderPhase('postRace', model)}
    ${renderPhase('nextRace', model)}
    ${renderHistory(context)}
  </section>`;

  bindPanelEvents(root, context);
}

async function refresh(context) {
  if (context) {
    render(context);
    return context;
  }
  const bridge = window.FantasyAdminBridge;
  if (!bridge?.fetchState) return null;
  const loaded = await bridge.fetchState();
  render(loaded);
  return loaded;
}

window.FantasyRaceCycle = {
  refresh,
  render,
  buildModel: buildFantasyRaceCycleModel,
  STEP_STATUS,
  PHASES,
  _lastContext: null,
};
