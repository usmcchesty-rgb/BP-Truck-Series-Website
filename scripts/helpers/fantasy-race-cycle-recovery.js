/**
 * Recovery-tool confirmation helpers (client-side; no API writes).
 */

export const TYPED_CONFIRMATION_ACTIONS = {
  reopen_finalized_contest: 'REOPEN CONTEST',
  full_regenerate_published_slate: (raceNumber) =>
    raceNumber != null ? `REGENERATE RACE ${raceNumber}` : 'REGENERATE SLATE',
  force_standings_rebuild: 'REBUILD STANDINGS',
  change_completed_race: 'CHANGE COMPLETED RACE',
};

export function requiresTypedConfirmation(actionId) {
  return Object.prototype.hasOwnProperty.call(TYPED_CONFIRMATION_ACTIONS, actionId);
}

export function expectedConfirmationPhrase(actionId, context = {}) {
  const template = TYPED_CONFIRMATION_ACTIONS[actionId];
  if (typeof template === 'function') return template(context.raceNumber);
  return template || '';
}

export function confirmationMatches(actionId, typedValue, context = {}) {
  const expected = expectedConfirmationPhrase(actionId, context);
  return String(typedValue || '').trim().toUpperCase() === String(expected || '').trim().toUpperCase();
}

export function buildRecoveryActionMeta(actionId) {
  const catalog = {
    reopen_finalized_contest: {
      title: 'Reopen finalized contest',
      changes: 'Contest scoring status returns to review; leaderboard may no longer be official.',
      notChanges: 'Does not delete submitted lineups or historical score rows.',
      participantVisible: true,
      reversible: true,
      destructive: true,
    },
    recalculate_finalized_scoring: {
      title: 'Recalculate finalized scoring',
      changes: 'Recomputes lineup points from current official results.',
      notChanges: 'Does not change lineup submissions or salary slates.',
      participantVisible: true,
      reversible: true,
      destructive: false,
    },
    manual_score_adjustment: {
      title: 'Apply manual score adjustment',
      changes: 'Opens race scoring tools for manual correction workflows.',
      notChanges: 'Does not publish a slate or regenerate salaries automatically.',
      participantVisible: true,
      reversible: false,
      destructive: false,
    },
    force_standings_rebuild: {
      title: 'Force standings rebuild',
      changes: 'Rebuilds season standings from finalized race outputs.',
      notChanges: 'Does not modify driver salaries or slate publication state.',
      participantVisible: true,
      reversible: false,
      destructive: true,
    },
    add_missing_eligible_drivers: {
      title: 'Add missing eligible drivers',
      changes: 'Adds eligible roster drivers missing from the published slate.',
      notChanges: 'Does not remove drivers or change existing lineup submissions.',
      participantVisible: true,
      reversible: true,
      destructive: false,
    },
    full_regenerate_published_slate: {
      title: 'Full regenerate published slate',
      changes: 'Rebuilds every eligible driver salary on the published slate.',
      notChanges: 'Does not delete existing lineup submissions.',
      participantVisible: true,
      reversible: false,
      destructive: true,
    },
    remove_driver_from_published_slate: {
      title: 'Remove driver from published slate',
      changes: 'Use slate correction tools to exclude a driver from the published pool.',
      notChanges: 'Does not alter finalized scoring for the previous race.',
      participantVisible: true,
      reversible: false,
      destructive: true,
    },
    change_next_race: {
      title: 'Change next race',
      changes: 'Updates which upcoming race the draft slate targets.',
      notChanges: 'Does not finalize scoring for the completed race.',
      participantVisible: true,
      reversible: false,
      destructive: true,
    },
    change_completed_race: {
      title: 'Change completed race',
      changes: 'Re-targets post-race scoring to a different completed official race.',
      notChanges: 'Does not automatically publish the next slate.',
      participantVisible: true,
      reversible: false,
      destructive: true,
    },
    reimport_official_results: {
      title: 'Re-import official results',
      changes: 'Reloads official finish order and identity matches for the selected race.',
      notChanges: 'Does not publish slates or open entries.',
      participantVisible: false,
      reversible: true,
      destructive: false,
    },
  };
  return catalog[actionId] || null;
}

export function recordRecoveryAudit(actionId, storage = null) {
  const store = storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  if (!store) return null;
  const stamp = new Date().toISOString();
  try {
    store.setItem(`frc_recovery_audit_${actionId}`, stamp);
    const logRaw = store.getItem('frc_recovery_audit_log');
    const log = logRaw ? JSON.parse(logRaw) : [];
    log.unshift({ actionId, at: stamp });
    store.setItem('frc_recovery_audit_log', JSON.stringify(log.slice(0, 50)));
  } catch {
    return stamp;
  }
  return stamp;
}
