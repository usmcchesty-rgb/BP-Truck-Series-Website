/**
 * Structured timing logs for rebuild-package (Vercel log analysis).
 * No transcript text or secrets.
 */
export function createRebuildTiming({ opId, seasonId, raceNumber }) {
  const rebuildStartedAt = Date.now();
  const totals = {
    sourcesIngestStarted: 0,
    sourcesIngestFinished: 0,
    chunksProcessed: 0,
    factsGenerated: 0,
    transcriptChunkIterations: 0,
    canonicalPersistenceRuns: 0,
    packageSaveRuns: 0,
    derivedRefreshRuns: 0,
    racesTouched: new Set([Number(raceNumber)]),
  };

  function cumulativeElapsedMs() {
    return Date.now() - rebuildStartedAt;
  }

  function emit(stage, fields = {}) {
    const payload = {
      component: 'race-research-rebuild',
      stage,
      operationId: opId,
      seasonId: seasonId != null ? String(seasonId) : undefined,
      raceNumber: raceNumber != null ? Number(raceNumber) : undefined,
      cumulativeElapsedMs: cumulativeElapsedMs(),
      ...fields,
    };
    if (fields.raceNumber != null && fields.raceNumber !== raceNumber) {
      totals.racesTouched.add(Number(fields.raceNumber));
      payload.unexpectedRace = true;
    }
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    console.log(JSON.stringify(payload));
  }

  function startStage(stage, extra = {}) {
    const t0 = Date.now();
    emit(`${stage}.start`, extra);
    return {
      finish(extraFinish = {}) {
        const elapsedMs = Date.now() - t0;
        emit(`${stage}.finish`, { elapsedMs, ...extraFinish });
        return elapsedMs;
      },
    };
  }

  return {
    opId,
    seasonId,
    raceNumber,
    totals,
    emit,
    startStage,
    logStart(extra) {
      emit('START rebuild', extra);
    },
    logEnd(extra) {
      emit('END rebuild', {
        racesTouched: [...totals.racesTouched].sort((a, b) => a - b),
        multipleRacesProcessed: totals.racesTouched.size > 1,
        ...extra,
      });
    },
  };
}
