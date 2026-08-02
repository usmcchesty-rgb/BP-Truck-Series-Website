/**
 * Deterministic driver story packages from stored facts.
 */

export function buildRaceDriverStoryPackages({ racePackage, driverLookup }) {
  const facts = racePackage?.facts || [];
  const lookup =
    driverLookup instanceof Map
      ? driverLookup
      : new Map((driverLookup || []).map((d) => [String(d.driverId), d]));

  const byDriver = new Map();

  function ensureDriver(driverId, name) {
    const key = driverId ? String(driverId) : normalizeNameKey(name);
    if (!byDriver.has(key)) {
      byDriver.set(key, {
        driverId: driverId ? String(driverId) : null,
        canonicalName: name || 'Unknown driver',
        carNumber: lookup.get(String(driverId))?.carNumber || null,
        startingPosition: null,
        finishingPosition: null,
        positionsChanged: null,
        lapsLed: null,
        incidents: null,
        averageRunningPosition: null,
        qualifyingSummary: null,
        raceSummary: [],
        timelineFactIds: [],
        strategyFactIds: [],
        incidentFactIds: [],
        quoteIds: [],
        standingsBefore: null,
        standingsAfter: null,
        standingsMovement: null,
        pointsAfter: null,
        recentResults: [],
        seasonAverageFinish: null,
        performanceVsAverage: null,
        milestones: [],
        historicalContext: [],
        storyImportanceScore: 0,
        availableEvidenceCount: 0,
      });
    }
    return byDriver.get(key);
  }

  for (const fact of facts) {
    const ids = fact.driverIds?.length ? fact.driverIds : [null];
    const names = fact.driverNames?.length ? fact.driverNames : ['Unknown driver'];

    ids.forEach((driverId, idx) => {
      const name = names[idx] || names[0] || lookup.get(String(driverId))?.driverName;
      const pkg = ensureDriver(driverId, name);

      if (fact.category === 'official_finish' && fact.structuredData) {
        pkg.finishingPosition = fact.structuredData.finishPosition ?? pkg.finishingPosition;
        pkg.startingPosition = fact.structuredData.startPosition ?? pkg.startingPosition;
        pkg.positionsChanged = fact.structuredData.positionsGained ?? pkg.positionsChanged;
        pkg.lapsLed = fact.structuredData.lapsLed ?? pkg.lapsLed;
        pkg.incidents = fact.structuredData.incidents ?? pkg.incidents;
        pkg.averageRunningPosition =
          fact.structuredData.averageRunningPosition ?? pkg.averageRunningPosition;
        if (fact.summary) pkg.raceSummary.push(fact.summary);
      }

      if (fact.category === 'starting_grid' && fact.structuredData?.startPosition != null) {
        pkg.startingPosition = fact.structuredData.startPosition;
        pkg.qualifyingSummary = fact.summary;
      }

      if (fact.factType === 'championship' && fact.category === 'standings_snapshot') {
        pkg.standingsAfter = fact.structuredData?.position ?? pkg.standingsAfter;
        pkg.pointsAfter = fact.structuredData?.points ?? pkg.pointsAfter;
        pkg.standingsMovement = fact.structuredData?.movement ?? pkg.standingsMovement;
      }

      if (['lead_change', 'caution', 'incident', 'penalty', 'race_event'].includes(fact.factType)) {
        pkg.timelineFactIds.push(fact.id);
      }
      if (fact.factType === 'strategy') pkg.strategyFactIds.push(fact.id);
      if (fact.factType === 'incident' || fact.factType === 'penalty') pkg.incidentFactIds.push(fact.id);
      if (fact.factType === 'quote') pkg.quoteIds.push(fact.id);
      if (fact.factType === 'milestone') pkg.milestones.push(fact.summary);
      if (fact.factType === 'historical') pkg.historicalContext.push(fact.summary);

      pkg.availableEvidenceCount += 1;
      pkg.storyImportanceScore += Number(fact.importanceScore) || 0;
    });
  }

  return [...byDriver.values()]
    .map((pkg) => ({
      ...pkg,
      raceSummary: [...new Set(pkg.raceSummary)].slice(0, 8),
      storyImportanceScore: Math.round(pkg.storyImportanceScore),
    }))
    .sort((a, b) => b.storyImportanceScore - a.storyImportanceScore);
}

function normalizeNameKey(name) {
  return String(name || 'unknown').toLowerCase().replace(/\s+/g, ' ');
}
