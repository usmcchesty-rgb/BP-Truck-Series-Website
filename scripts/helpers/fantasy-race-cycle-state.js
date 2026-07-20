/**
 * Central Fantasy Race Cycle workflow state.
 * Tests import from here. Browser runtime mirrors in public/admin/fantasy-race-cycle-state.js.
 */

export const STEP_STATUS = {
  NOT_STARTED: 'Not Started',
  READY: 'Ready',
  IN_PROGRESS: 'In Progress',
  NEEDS_REVIEW: 'Needs Review',
  COMPLETE: 'Complete',
  BLOCKED: 'Blocked',
  OPTIONAL: 'Optional',
  SKIPPED: 'Skipped',
};

export const PHASES = {
  postRace: {
    id: 'postRace',
    title: 'Post-Race Completion',
    explanation: 'Finish scoring and update Fantasy standings for the race that just ended.',
    stepIds: [
      'select_completed_race',
      'import_official_results',
      'calculate_fantasy_scoring',
      'review_fantasy_scoring',
      'finalize_contest',
      'update_season_standings',
    ],
  },
  nextRace: {
    id: 'nextRace',
    title: 'Next-Race Preparation',
    explanation: 'Prepare and publish the upcoming Fantasy contest.',
    stepIds: [
      'select_next_race',
      'build_driver_pool',
      'generate_salaries',
      'review_next_slate',
      'publish_next_slate',
      'readiness_check',
    ],
  },
};

const DISPLAY_NA = 'Not available';

export function raceLabel(race) {
  if (!race?.raceNumber) return DISPLAY_NA;
  const track = race.track ? ` — ${race.track}` : '';
  return `Race ${race.raceNumber}${track}`;
}

export function displayValue(value) {
  if (value == null || value === '') return DISPLAY_NA;
  return String(value);
}

function unresolvedCount(scoring = {}) {
  return Array.isArray(scoring.unresolvedDrivers) ? scoring.unresolvedDrivers.length : 0;
}

function hasPreviewScores(postRace = {}, scoring = {}) {
  const meta = scoring.scoringMeta || {};
  return (
    meta.scoredAt ||
    meta.status === 'scored' ||
    meta.status === 'needs_review' ||
    (Array.isArray(postRace.lineupScores) && postRace.lineupScores.length > 0)
  );
}

export function isContestFinalized(scoring = {}) {
  return scoring.status === 'scored' || scoring.scoringMeta?.status === 'scored';
}

export function isScoringReviewApproved(context = {}) {
  if (context.manualApprovals?.scoringReview) return true;
  const scoring = context.scoring || context.postRace?.scoring || {};
  if (scoring.status === 'scored' || scoring.scoringMeta?.status === 'scored') return true;
  return (context.missionControlCompletedTaskIds || []).includes('sun-score-fantasy-lineups');
}

export function isSlateReviewApproved(context = {}) {
  if (context.manualApprovals?.slateReview) return true;
  return (context.missionControlCompletedTaskIds || []).includes('wed-review-fantasy-salaries');
}

export function draftSlateReady(adminStats = {}, postRace = {}) {
  const draft = postRace.salaryDraft?.draft || adminStats.slate;
  const drivers = draft?.driver_count ?? draft?.drivers?.length;
  return Boolean(draft?.id) && Number(drivers) > 0;
}

export function salariesReady(adminStats = {}, postRace = {}) {
  const draft = postRace.salaryDraft?.draft || adminStats.slate;
  if (!draft?.id) return false;
  const drivers = adminStats.slate?.drivers || draft.drivers || [];
  if (Array.isArray(drivers) && drivers.length) {
    return drivers.every((row) => Number.isFinite(Number(row.salary ?? row.salary_amount)));
  }
  return Boolean(draft.id);
}

function duplicateDriverCount(adminStats = {}) {
  const drivers = adminStats.slate?.drivers || [];
  if (!Array.isArray(drivers) || !drivers.length) return 0;
  const ids = drivers.map((row) => String(row.driver_id || row.driverId || '')).filter(Boolean);
  return ids.length - new Set(ids).size;
}

function driversMissingSalary(adminStats = {}) {
  const drivers = adminStats.slate?.drivers || [];
  if (!Array.isArray(drivers)) return 0;
  return drivers.filter((row) => !Number.isFinite(Number(row.salary ?? row.salary_amount))).length;
}

function buildStepBase(id, number, title, explanation, phaseId) {
  return {
    id,
    number,
    title,
    explanation,
    phaseId,
    status: STEP_STATUS.NOT_STARTED,
    actionLabel: null,
    actionEnabled: false,
    disabledReason: null,
    blockedReason: null,
    completedAt: null,
    completionSummary: null,
    warnings: [],
    details: {},
    required: true,
  };
}

function isRequiredStep(step) {
  return step.required !== false && step.status !== STEP_STATUS.OPTIONAL && step.status !== STEP_STATUS.SKIPPED;
}

export function isStepComplete(step) {
  return step.status === STEP_STATUS.COMPLETE;
}

export function getActionDisabledReason(step, steps = []) {
  if (step.actionEnabled) return null;
  if (step.disabledReason) return step.disabledReason;
  if (step.blockedReason) return step.blockedReason;
  const byId = new Map(steps.map((row) => [row.id, row]));

  const messages = {
    calculate_fantasy_scoring: 'Waiting for official results to be verified in Step 2.',
    finalize_contest: 'Approve the scoring review in Step 4 before finalizing.',
    generate_salaries: 'Build the eligible driver pool in Step 8 first.',
    publish_next_slate: 'Approve the slate review in Step 10 before publishing.',
    readiness_check: 'Publish the next slate in Step 11 before running the final readiness check.',
  };
  if (messages[step.id]) return messages[step.id];

  if (step.id === 'import_official_results' && step.status === STEP_STATUS.BLOCKED) {
    return byId.get('select_completed_race')?.blockedReason || 'Complete Step 1 first.';
  }
  return step.blockedReason || 'This action is not available yet.';
}

const SAFE_REFRESH_LABELS = new Set([
  'Refresh Results',
  'Recalculate Preview',
  'Review Exclusions',
  'Review Salary Details',
  'Run Full Validation',
]);

function attachActionState(step, steps = []) {
  const isValidation = step.id === 'readiness_check';
  const isSafeRefresh = SAFE_REFRESH_LABELS.has(step.actionLabel);
  let canRun = Boolean(step.actionLabel);
  if (isValidation) {
    canRun = true;
  } else if (step.status === STEP_STATUS.BLOCKED) {
    canRun = false;
  } else if (step.status === STEP_STATUS.COMPLETE) {
    canRun = isSafeRefresh;
  }
  step.actionEnabled = canRun;
  if (!canRun && step.actionLabel) {
    step.disabledReason = getActionDisabledReason(step, steps);
  } else {
    step.disabledReason = null;
  }
  return step;
}

function completionSummaryForStep(step) {
  if (step.status === STEP_STATUS.COMPLETE && step.warnings?.length) {
    return `Complete with Warning — ${step.warnings[0]}`;
  }
  if (step.status !== STEP_STATUS.COMPLETE) return null;
  switch (step.id) {
    case 'select_completed_race':
      return `Complete — ${raceLabel(step.details)} selected`;
    case 'import_official_results':
      return 'Complete — Official results verified';
    case 'calculate_fantasy_scoring':
      return 'Complete — Fantasy points calculated';
    case 'review_fantasy_scoring':
      return 'Complete — Scoring review approved';
    case 'finalize_contest':
      return 'Complete — Contest finalized';
    case 'update_season_standings':
      return 'Complete — Fantasy standings updated';
    case 'select_next_race':
      return `Complete — ${raceLabel(step.details)} selected`;
    case 'build_driver_pool':
      return 'Complete — Driver pool built';
    case 'generate_salaries':
      return 'Complete — Salaries generated';
    case 'review_next_slate':
      return 'Complete — Slate review approved';
    case 'publish_next_slate':
      return 'Complete — Slate published';
    case 'readiness_check':
      return 'Complete — READY FOR NEXT RACE';
    default:
      return 'Complete';
  }
}

export function buildFantasyRaceCycleSteps(context = {}) {
  const adminStats = context.adminStats || {};
  const postRace = context.postRace || {};
  const scoring = context.scoring || postRace.scoring || {};
  const completedRace = postRace.completedRace || context.completedRace || null;
  const nextRace = postRace.nextRace || adminStats.nextRace || context.nextRace || null;
  const salaryDraft = postRace.salaryDraft || {};
  const publishedNext = salaryDraft.published === true;
  const poolHealth = adminStats.driverPoolHealth || {};
  const unresolved = unresolvedCount(scoring);
  const resultsReady = scoring.resultsReady === true;
  const previewScores = hasPreviewScores(postRace, scoring);
  const finalized = isContestFinalized(scoring);
  const scoringApproved = isScoringReviewApproved(context);
  const slateApproved = isSlateReviewApproved(context);
  const poolBlocking = Number(poolHealth.counts?.unresolvedIdentity ?? 0) > 0;

  const steps = [];

  const step1 = buildStepBase(
    'select_completed_race',
    1,
    'Select the Race That Just Finished',
    'Choose the official points race that has completed and needs Fantasy scoring.',
    'postRace'
  );
  if (completedRace?.raceNumber) {
    step1.status = STEP_STATUS.COMPLETE;
    step1.completedAt = scoring.scoringMeta?.scoredAt || null;
    step1.details = { ...completedRace, officialPointsRaceNumber: completedRace.raceNumber };
  } else {
    step1.status = STEP_STATUS.BLOCKED;
    step1.blockedReason = 'No completed official points race was detected on the schedule.';
  }
  steps.push(step1);

  const step2 = buildStepBase(
    'import_official_results',
    2,
    'Import Official Race Results',
    'Load the official race finishing order and verify that every participating driver is matched correctly.',
    'postRace'
  );
  if (!completedRace?.raceNumber) {
    step2.status = STEP_STATUS.BLOCKED;
    step2.blockedReason = 'Step 2 is blocked because no completed race is selected in Step 1.';
  } else if (resultsReady && unresolved === 0) {
    step2.status = STEP_STATUS.COMPLETE;
    step2.actionLabel = 'Refresh Results';
    step2.details = {
      officialStarters: scoring.officialStarterCount,
      dnpCount: scoring.dnpCount ?? 0,
      provisionalCount: scoring.provisionalCount ?? 0,
      unresolvedDrivers: 0,
    };
  } else if (resultsReady && unresolved > 0) {
    step2.status = STEP_STATUS.NEEDS_REVIEW;
    step2.actionLabel = 'Review Unmatched Drivers';
    step2.blockedReason = `Fantasy scoring cannot continue because ${unresolved} race finishers are not linked to BP driver profiles. Resolve the unmatched drivers in Step 2.`;
    step2.warnings = [`${unresolved} unmatched driver${unresolved === 1 ? '' : 's'} remain.`];
    step2.details = { unresolvedDrivers: unresolved };
  } else {
    step2.status = STEP_STATUS.READY;
    step2.actionLabel = 'Load Official Results';
  }
  steps.push(step2);

  const step3 = buildStepBase(
    'calculate_fantasy_scoring',
    3,
    'Calculate Fantasy Points',
    'Apply the existing Fantasy scoring rules to every submitted lineup using the verified official results.',
    'postRace'
  );
  if (step2.status !== STEP_STATUS.COMPLETE) {
    step3.status = STEP_STATUS.BLOCKED;
    step3.blockedReason = 'Waiting for official results to be verified in Step 2.';
  } else if (previewScores) {
    step3.status = STEP_STATUS.COMPLETE;
    step3.actionLabel = 'Recalculate Preview';
    step3.details = { entryCount: scoring.lineupCount ?? 0 };
  } else {
    step3.status = STEP_STATUS.READY;
    step3.actionLabel = 'Calculate Fantasy Points';
  }
  steps.push(step3);

  const step4 = buildStepBase(
    'review_fantasy_scoring',
    4,
    'Review Fantasy Results',
    'Review the calculated leaderboard before making it official.',
    'postRace'
  );
  if (step3.status === STEP_STATUS.BLOCKED) {
    step4.status = STEP_STATUS.BLOCKED;
    step4.blockedReason = 'Step 4 is blocked because Fantasy points have not been calculated yet.';
  } else if (!previewScores) {
    step4.status = STEP_STATUS.BLOCKED;
    step4.blockedReason = 'Step 4 is blocked because no scoring preview exists. Calculate Fantasy points in Step 3.';
  } else if (scoringApproved || finalized) {
    step4.status = STEP_STATUS.COMPLETE;
  } else {
    step4.status = STEP_STATUS.NEEDS_REVIEW;
    step4.actionLabel = 'Approve Scoring Review';
  }
  steps.push(step4);

  const step5 = buildStepBase(
    'finalize_contest',
    5,
    'Finalize the Completed Contest',
    'Lock the scoring results for this race and publish the official Fantasy leaderboard.',
    'postRace'
  );
  if (step4.status !== STEP_STATUS.COMPLETE) {
    step5.status = STEP_STATUS.BLOCKED;
    step5.blockedReason = 'Approve the scoring review in Step 4 before finalizing.';
  } else if (finalized) {
    step5.status = STEP_STATUS.COMPLETE;
    step5.completedAt = scoring.scoringMeta?.scoredAt || null;
  } else if (unresolved > 0) {
    step5.status = STEP_STATUS.BLOCKED;
    step5.blockedReason = `Step 5 is blocked because ${unresolved} drivers remain unmatched. Resolve them in Step 2.`;
  } else {
    step5.status = STEP_STATUS.READY;
    step5.actionLabel = 'Finalize Fantasy Contest';
  }
  steps.push(step5);

  const step6 = buildStepBase(
    'update_season_standings',
    6,
    'Update Season Standings',
    'Apply the finalized race result to the overall Fantasy season standings.',
    'postRace'
  );
  if (!finalized) {
    step6.status = STEP_STATUS.BLOCKED;
    step6.blockedReason = 'Step 6 is blocked because the contest has not been finalized in Step 5.';
  } else {
    step6.status = STEP_STATUS.COMPLETE;
    step6.details = { participantsUpdated: postRace.lineupScores?.length ?? scoring.lineupCount ?? 0 };
  }
  steps.push(step6);

  const step7 = buildStepBase(
    'select_next_race',
    7,
    'Select the Next Scheduled Race',
    'Identify the next official points race that will receive a Fantasy contest.',
    'nextRace'
  );
  if (!finalized) {
    step7.status = STEP_STATUS.BLOCKED;
    step7.blockedReason = 'Step 7 is blocked until the previous contest is finalized.';
  } else if (nextRace?.raceNumber) {
    step7.status = STEP_STATUS.COMPLETE;
    step7.details = { ...nextRace };
  } else {
    step7.status = STEP_STATUS.BLOCKED;
    step7.blockedReason = 'No upcoming official points race was found on the schedule.';
    step7.actionLabel = 'Use Suggested Next Race';
  }
  steps.push(step7);

  const step8 = buildStepBase(
    'build_driver_pool',
    8,
    'Build the Eligible Driver Pool',
    'Create the list of drivers eligible for the next Fantasy contest.',
    'nextRace'
  );
  if (step7.status !== STEP_STATUS.COMPLETE) {
    step8.status = STEP_STATUS.BLOCKED;
    step8.blockedReason = 'Step 8 is blocked because the next race has not been selected in Step 7.';
  } else if (poolBlocking) {
    step8.status = STEP_STATUS.BLOCKED;
    step8.blockedReason = 'Step 8 is blocked because one or more eligible drivers have unresolved identity matches.';
  } else if (draftSlateReady(adminStats, postRace)) {
    step8.status = STEP_STATUS.COMPLETE;
    step8.actionLabel = 'Review Exclusions';
  } else {
    step8.status = STEP_STATUS.READY;
    step8.actionLabel = 'Build Driver Pool';
  }
  steps.push(step8);

  const step9 = buildStepBase(
    'generate_salaries',
    9,
    'Generate Driver Salaries',
    'Calculate salaries for the eligible driver pool using the existing salary formula.',
    'nextRace'
  );
  if (step8.status !== STEP_STATUS.COMPLETE && step8.status !== STEP_STATUS.READY) {
    step9.status = STEP_STATUS.BLOCKED;
    step9.blockedReason = 'Build the eligible driver pool in Step 8 first.';
  } else if (salariesReady(adminStats, postRace)) {
    step9.status = STEP_STATUS.COMPLETE;
    step9.actionLabel = 'Review Salary Details';
  } else {
    step9.status = STEP_STATUS.READY;
    step9.actionLabel = 'Generate Salaries';
  }
  steps.push(step9);

  const step10 = buildStepBase(
    'review_next_slate',
    10,
    'Review the Next Race Slate',
    'Review the driver list, salaries, eligibility, and race settings before publishing.',
    'nextRace'
  );
  if (step9.status !== STEP_STATUS.COMPLETE) {
    step10.status = STEP_STATUS.BLOCKED;
    step10.blockedReason = 'Step 10 is blocked because salaries have not been generated in Step 9.';
  } else if (publishedNext || slateApproved) {
    step10.status = STEP_STATUS.COMPLETE;
  } else if (salariesReady(adminStats, postRace)) {
    step10.status = STEP_STATUS.NEEDS_REVIEW;
    step10.actionLabel = 'Approve Slate';
  } else {
    step10.status = STEP_STATUS.BLOCKED;
    step10.blockedReason = 'Step 10 is blocked because the draft slate is missing salaries or eligible drivers.';
  }
  steps.push(step10);

  const step11 = buildStepBase(
    'publish_next_slate',
    11,
    'Publish the Next Fantasy Slate',
    'Make the next contest available to Fantasy participants.',
    'nextRace'
  );
  if (step10.status !== STEP_STATUS.COMPLETE) {
    step11.status = STEP_STATUS.BLOCKED;
    step11.blockedReason = 'Approve the slate review in Step 10 before publishing.';
  } else if (publishedNext) {
    step11.status = STEP_STATUS.COMPLETE;
    step11.completedAt = adminStats.publishedSlate?.published_at || null;
  } else {
    step11.status = STEP_STATUS.READY;
    step11.actionLabel = 'Publish Fantasy Slate';
  }
  steps.push(step11);

  const step12 = buildStepBase(
    'readiness_check',
    12,
    'Confirm the Next Contest Is Ready',
    'Verify that participants can access the contest and that all required settings are valid.',
    'nextRace'
  );
  const readiness = evaluateReadiness(context, steps);
  step12.details = { ...readiness.checks, summary: readiness.ready ? 'READY FOR NEXT RACE' : 'ACTION REQUIRED' };
  if (readiness.ready) {
    step12.status = STEP_STATUS.COMPLETE;
    step12.actionLabel = 'Run Full Validation';
  } else if (publishedNext || finalized) {
    step12.status = STEP_STATUS.NEEDS_REVIEW;
    step12.actionLabel = 'Run Full Validation';
    step12.blockedReason = readiness.message;
  } else {
    step12.status = STEP_STATUS.BLOCKED;
    step12.blockedReason = 'Publish the next slate in Step 11 before running the final readiness check.';
    step12.actionLabel = 'Run Full Validation';
  }
  steps.push(step12);

  for (const step of steps) {
    step.completionSummary = completionSummaryForStep(step);
    attachActionState(step, steps);
  }
  return steps;
}

export function evaluateReadiness(context = {}, steps = []) {
  const adminStats = context.adminStats || {};
  const postRace = context.postRace || {};
  const progression = adminStats.progression || {};
  const lockPreview = adminStats.lockPreview || {};
  const checks = {
    nextRaceSelected: Boolean(postRace.nextRace?.raceNumber),
    slatePublished: postRace.salaryDraft?.published === true,
    driverPoolPopulated: draftSlateReady(adminStats, postRace),
    salariesPopulated: salariesReady(adminStats, postRace),
    lockTimeValid: Boolean(lockPreview.valid !== false || adminStats.publishedSlate?.lock_at),
    lineupSizeFive: true,
    salaryCap50000: true,
    previousRaceFinalized: isContestFinalized(postRace.scoring || context.scoring || {}),
    standingsCurrent: isContestFinalized(postRace.scoring || context.scoring || {}),
    noUnresolvedIdentity: Number(adminStats.driverPoolHealth?.counts?.unresolvedIdentity ?? 0) === 0,
    entriesOpen: progression.isPlayable === true,
  };
  const issues = buildBlockingIssues(context, steps, checks);
  return {
    ready: issues.length === 0,
    checks,
    issues,
    message: issues.length ? `${issues.length} blocking issue${issues.length === 1 ? '' : 's'} found.` : null,
  };
}

export function buildBlockingIssues(context = {}, steps = [], checks = null) {
  const adminStats = context.adminStats || {};
  const postRace = context.postRace || {};
  const readinessChecks = checks || evaluateReadiness(context, steps).checks;
  const issues = [];

  const add = (message, stepId, stepNumber) => issues.push({ message, stepId, stepNumber });

  if (!readinessChecks.previousRaceFinalized) {
    add('Previous contest has not been finalized.', 'finalize_contest', 5);
  }
  if (!readinessChecks.standingsCurrent) {
    add('Fantasy season standings are not current.', 'update_season_standings', 6);
  }
  if (!readinessChecks.nextRaceSelected) {
    add('Next race has not been selected.', 'select_next_race', 7);
  }
  if (!readinessChecks.driverPoolPopulated) {
    add('Eligible driver pool has not been built.', 'build_driver_pool', 8);
  }
  if (!readinessChecks.salariesPopulated || driversMissingSalary(adminStats) > 0) {
    add(
      driversMissingSalary(adminStats) > 0
        ? `${driversMissingSalary(adminStats)} eligible driver${driversMissingSalary(adminStats) === 1 ? ' has' : 's have'} no salary.`
        : 'Driver salaries have not been generated.',
      'generate_salaries',
      9
    );
  }
  if (duplicateDriverCount(adminStats) > 0) {
    add('Duplicate drivers exist in the slate.', 'review_next_slate', 10);
  }
  if (!readinessChecks.noUnresolvedIdentity) {
    add('Unresolved driver identity errors remain.', 'build_driver_pool', 8);
  }
  if (!readinessChecks.lockTimeValid) {
    add('Contest lock time is missing or invalid.', 'select_next_race', 7);
  }
  if (!readinessChecks.slatePublished) {
    add('Slate has not been published.', 'publish_next_slate', 11);
  }
  if (!readinessChecks.entriesOpen && readinessChecks.slatePublished) {
    add('Entries are not open yet.', 'publish_next_slate', 11);
  }
  return issues;
}

export function runFullValidation(context = {}, steps = []) {
  const postRace = context.postRace || {};
  const scoring = context.scoring || postRace.scoring || {};
  const adminStats = context.adminStats || {};
  const progression = adminStats.progression || {};
  const finalized = isContestFinalized(scoring);
  const publishedNext = postRace.salaryDraft?.published === true;

  const postRaceChecks = [
    {
      label: 'Completed race selected',
      state: postRace.completedRace?.raceNumber ? 'Passed' : 'Failed',
      stepId: 'select_completed_race',
      stepNumber: 1,
    },
    {
      label: 'Official results available',
      state: scoring.resultsReady ? 'Passed' : 'Failed',
      stepId: 'import_official_results',
      stepNumber: 2,
    },
    {
      label: 'Required result identities matched',
      state: unresolvedCount(scoring) === 0 ? 'Passed' : 'Failed',
      stepId: 'import_official_results',
      stepNumber: 2,
    },
    {
      label: 'Fantasy scoring calculated',
      state: hasPreviewScores(postRace, scoring) ? 'Passed' : 'Failed',
      stepId: 'calculate_fantasy_scoring',
      stepNumber: 3,
    },
    {
      label: 'Scoring review approved',
      state: isScoringReviewApproved(context) || finalized ? 'Passed' : 'Warning',
      stepId: 'review_fantasy_scoring',
      stepNumber: 4,
    },
    {
      label: 'Contest finalized',
      state: finalized ? 'Passed' : 'Failed',
      stepId: 'finalize_contest',
      stepNumber: 5,
    },
    {
      label: 'Fantasy standings updated',
      state: finalized ? 'Passed' : 'Not Applicable',
      stepId: 'update_season_standings',
      stepNumber: 6,
    },
  ];

  const nextRaceApplicable = finalized;
  const nextRaceChecks = [
    {
      label: 'Next race selected',
      state: !nextRaceApplicable ? 'Not Applicable' : postRace.nextRace?.raceNumber ? 'Passed' : 'Failed',
      stepId: 'select_next_race',
      stepNumber: 7,
    },
    {
      label: 'Driver pool exists',
      state: !nextRaceApplicable ? 'Not Applicable' : draftSlateReady(adminStats, postRace) ? 'Passed' : 'Failed',
      stepId: 'build_driver_pool',
      stepNumber: 8,
    },
    {
      label: 'No duplicate drivers',
      state: !nextRaceApplicable
        ? 'Not Applicable'
        : duplicateDriverCount(adminStats) === 0
          ? 'Passed'
          : 'Failed',
      stepId: 'review_next_slate',
      stepNumber: 10,
    },
    {
      label: 'No unresolved identity errors',
      state: !nextRaceApplicable
        ? 'Not Applicable'
        : Number(adminStats.driverPoolHealth?.counts?.unresolvedIdentity ?? 0) === 0
          ? 'Passed'
          : 'Failed',
      stepId: 'build_driver_pool',
      stepNumber: 8,
    },
    {
      label: 'Every eligible driver has a salary',
      state: !nextRaceApplicable
        ? 'Not Applicable'
        : salariesReady(adminStats, postRace) && driversMissingSalary(adminStats) === 0
          ? 'Passed'
          : 'Failed',
      stepId: 'generate_salaries',
      stepNumber: 9,
    },
    {
      label: 'Salary cap is valid',
      state: !nextRaceApplicable ? 'Not Applicable' : 'Passed',
      stepId: 'generate_salaries',
      stepNumber: 9,
    },
    {
      label: 'Lineup size is 5',
      state: !nextRaceApplicable ? 'Not Applicable' : 'Passed',
      stepId: 'review_next_slate',
      stepNumber: 10,
    },
    {
      label: 'Lock time is valid',
      state: !nextRaceApplicable
        ? 'Not Applicable'
        : Boolean(adminStats.lockPreview?.valid !== false || adminStats.publishedSlate?.lock_at)
          ? 'Passed'
          : 'Failed',
      stepId: 'select_next_race',
      stepNumber: 7,
    },
    {
      label: 'Slate review approved',
      state: !nextRaceApplicable ? 'Not Applicable' : isSlateReviewApproved(context) || publishedNext ? 'Passed' : 'Warning',
      stepId: 'review_next_slate',
      stepNumber: 10,
    },
    {
      label: 'Slate published',
      state: !nextRaceApplicable ? 'Not Applicable' : publishedNext ? 'Passed' : 'Failed',
      stepId: 'publish_next_slate',
      stepNumber: 11,
    },
    {
      label: 'Public contest data is available',
      state: !nextRaceApplicable ? 'Not Applicable' : publishedNext ? 'Passed' : 'Failed',
      stepId: 'publish_next_slate',
      stepNumber: 11,
    },
    {
      label: 'Entries are open when expected',
      state: !nextRaceApplicable
        ? 'Not Applicable'
        : progression.isPlayable === true
          ? 'Passed'
          : publishedNext
            ? 'Warning'
            : 'Failed',
      stepId: 'readiness_check',
      stepNumber: 12,
    },
  ];

  const allChecks = [...postRaceChecks, ...nextRaceChecks];
  const blocking = allChecks.filter((row) => row.state === 'Failed');
  const warnings = allChecks.filter((row) => row.state === 'Warning');
  return {
    postRaceChecks,
    nextRaceChecks,
    allChecks,
    blockingCount: blocking.length,
    warningCount: warnings.length,
    passed: blocking.length === 0,
    blocking,
    warnings,
  };
}

export function buildPhaseSummary(steps, phaseId) {
  const phase = PHASES[phaseId];
  const phaseSteps = steps.filter((step) => step.phaseId === phaseId && isRequiredStep(step));
  const completedCount = phaseSteps.filter(isStepComplete).length;
  const requiredCount = phaseSteps.length;
  let status = 'In progress';
  if (completedCount === requiredCount && requiredCount > 0) status = 'Complete';
  else if (completedCount === 0) status = 'Not started';
  else status = `${completedCount} of ${requiredCount} steps complete`;
  return { ...phase, status, completedCount, requiredCount };
}

export function buildProgress(steps = []) {
  const required = steps.filter(isRequiredStep);
  const completedRequired = required.filter(isStepComplete).length;
  const totalRequired = required.length;
  const percentage = totalRequired ? Math.round((completedRequired / totalRequired) * 100) : 0;
  return { completedRequired, totalRequired, percentage };
}

export function getNextRecommendedAction(steps = []) {
  const pending = steps.find(
    (step) =>
      isRequiredStep(step) &&
      step.status !== STEP_STATUS.COMPLETE &&
      step.status !== STEP_STATUS.SKIPPED &&
      step.status !== STEP_STATUS.OPTIONAL
  );
  if (!pending) {
    return {
      label: 'Race cycle complete — next contest is ready.',
      stepId: 'readiness_check',
      stepNumber: 12,
      actionLabel: null,
    };
  }
  return {
    label: pending.actionLabel || pending.title,
    stepId: pending.id,
    stepNumber: pending.number,
    actionLabel: pending.actionLabel,
  };
}

export function getCurrentStep(steps = [], nextAction = null) {
  const targetId = nextAction?.stepId;
  return steps.find((step) => step.id === targetId) || steps.find((step) => isRequiredStep(step) && !isStepComplete(step)) || steps[0];
}

export function getAutoExpandedStepId(steps = [], nextAction = null) {
  const blocked = steps.find((step) => isRequiredStep(step) && step.status === STEP_STATUS.BLOCKED);
  if (blocked) return blocked.id;
  return nextAction?.stepId || steps.find((step) => isRequiredStep(step) && !isStepComplete(step))?.id || null;
}

export function shouldStepExpand(step, autoExpandedId, manualExpanded = {}) {
  if (manualExpanded[step.id] === true) return true;
  if (manualExpanded[step.id] === false) return false;
  if (step.id === autoExpandedId) return true;
  if (isStepComplete(step)) return false;
  return step.id === autoExpandedId;
}

export function buildSummaryDashboard(context = {}, steps = []) {
  const adminStats = context.adminStats || {};
  const postRace = context.postRace || {};
  const scoring = context.scoring || postRace.scoring || {};
  const progression = adminStats.progression || {};
  const poolHealth = adminStats.driverPoolHealth || {};
  const finalized = isContestFinalized(scoring);
  const publishedNext = postRace.salaryDraft?.published === true;
  const eligibleCount = poolHealth.counts?.eligibleRosterDrivers ?? poolHealth.diagnostics?.eligibleDriverCount;

  return {
    season: displayValue(context.seasonName),
    previousRace: raceLabel(postRace.completedRace),
    previousContest: finalized ? 'Finalized' : scoring.resultsReady ? 'In progress' : DISPLAY_NA,
    scoring: scoring.status === 'scored' ? 'Complete' : hasPreviewScores(postRace, scoring) ? 'Calculated' : DISPLAY_NA,
    standings: finalized ? 'Updated' : 'Pending',
    nextRace: raceLabel(postRace.nextRace || adminStats.nextRace),
    slate: publishedNext ? 'Published' : postRace.salaryDraft?.draft ? 'Draft' : 'Not generated',
    drivers:
      eligibleCount == null ? DISPLAY_NA : `${eligibleCount} Eligible`,
    salaries: salariesReady(adminStats, postRace) ? 'Generated' : 'Not generated',
    published: publishedNext ? 'Yes' : 'No',
    entries: progression.isPlayable ? 'Open' : publishedNext ? 'Closed' : 'Not Open',
    lock: displayValue(
      adminStats.publishedSlate?.lock_time ||
        adminStats.lockPreview?.lockTimeDisplay ||
        adminStats.publishedSlate?.lock_at
    ),
    stepLinks: {
      season: 'select_completed_race',
      previousRace: 'select_completed_race',
      scoring: 'calculate_fantasy_scoring',
      standings: 'update_season_standings',
      nextRace: 'select_next_race',
      slate: 'publish_next_slate',
      drivers: 'build_driver_pool',
      salaries: 'generate_salaries',
      published: 'publish_next_slate',
      entries: 'readiness_check',
      lock: 'select_next_race',
    },
  };
}

export function buildReadinessCard(context = {}, steps = []) {
  const adminStats = context.adminStats || {};
  const postRace = context.postRace || {};
  const progression = adminStats.progression || {};
  const poolHealth = adminStats.driverPoolHealth || {};
  const readiness = evaluateReadiness(context, steps);
  const nextRace = postRace.nextRace || adminStats.nextRace || {};
  const eligibleCount = poolHealth.counts?.eligibleRosterDrivers ?? poolHealth.diagnostics?.eligibleDriverCount;
  const scoring = context.scoring || postRace.scoring || {};

  return {
    ready: readiness.ready,
    title: readiness.ready ? 'READY FOR NEXT RACE' : 'ACTION REQUIRED',
    fields: {
      race: raceLabel(nextRace),
      lock: displayValue(
        adminStats.publishedSlate?.lock_time ||
          adminStats.lockPreview?.lockTimeDisplay ||
          adminStats.publishedSlate?.lock_at
      ),
      drivers: eligibleCount == null ? DISPLAY_NA : `${eligibleCount} Eligible`,
      salaryCap: '$50,000',
      lineupSize: '5 Drivers',
      slate: postRace.salaryDraft?.published ? 'Published' : postRace.salaryDraft?.draft ? 'Draft' : DISPLAY_NA,
      entries: progression.isPlayable ? 'Open' : 'Not Open',
      previousRace: isContestFinalized(scoring) ? 'Finalized' : DISPLAY_NA,
      standings: isContestFinalized(scoring) ? 'Current' : 'Pending',
    },
    issues: readiness.issues,
  };
}

export function summarizeWorkflowStatus(context = {}, steps = []) {
  const postRace = context.postRace || {};
  const scoring = context.scoring || postRace.scoring || {};
  const nextAction = getNextRecommendedAction(steps);
  const progress = buildProgress(steps);
  let headline = 'In progress';
  if (progress.completedRequired === progress.totalRequired && progress.totalRequired > 0) {
    headline = 'Ready for next race';
  } else if (!scoring.resultsReady) headline = 'Waiting for official results';
  else if (scoring.status === 'needs_review') headline = 'Scoring needs review';
  else if (postRace.salaryDraft?.published) headline = 'Next slate published';
  else if (postRace.salaryDraft?.draft) headline = 'Next slate draft ready';
  return { headline, nextAction };
}

export function buildFantasyRaceCycleModel(context = {}) {
  const steps = buildFantasyRaceCycleSteps(context);
  const progress = buildProgress(steps);
  const nextRecommendedAction = getNextRecommendedAction(steps);
  const currentStep = getCurrentStep(steps, nextRecommendedAction);
  const phases = {
    postRace: buildPhaseSummary(steps, 'postRace'),
    nextRace: buildPhaseSummary(steps, 'nextRace'),
  };
  const summary = buildSummaryDashboard(context, steps);
  const readiness = buildReadinessCard(context, steps);
  const validation = runFullValidation(context, steps);
  const workflow = summarizeWorkflowStatus(context, steps);
  return {
    phases,
    steps,
    progress,
    currentStep,
    nextRecommendedAction,
    overallState: workflow.headline,
    summary,
    readiness,
    validation,
    autoExpandedStepId: getAutoExpandedStepId(steps, nextRecommendedAction),
  };
}

export function extractMissionCompletedTaskIds(missionControl = {}, completedRaceNumber = null) {
  const ids = new Set();
  const workflows = missionControl.workflows || {};
  for (const bucket of [workflows.postRace, workflows.nextRace]) {
    if (!bucket) continue;
    for (const taskId of bucket.completedTaskIds || []) ids.add(taskId);
    for (const task of bucket.tasks || []) {
      if (task.complete) ids.add(task.id);
    }
  }
  if (completedRaceNumber != null && missionControl.adminMissionControl) {
    const store = missionControl.adminMissionControl;
    const season = missionControl.seasonId;
    const raceStore = store?.[season]?.[String(completedRaceNumber)] || {};
    for (const wf of ['postRace', 'nextRace']) {
      for (const taskId of Object.keys(raceStore[wf] || {})) ids.add(taskId);
    }
  }
  return [...ids];
}
