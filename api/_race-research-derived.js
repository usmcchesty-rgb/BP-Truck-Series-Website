/**
 * Deterministic derived facts from official structured data already stored as facts.
 */

function factsByType(facts, type) {
  return facts.filter((f) => f.factType === type);
}

function parseStructured(fact) {
  return fact.structuredData || {};
}

export function buildDerivedRaceFacts({ seasonId, raceNumber, facts = [] }) {
  const derived = [];
  const resultFacts = factsByType(facts, 'result').filter((f) => f.category === 'official_finish');
  const qualifyingFacts = factsByType(facts, 'qualifying');

  if (!resultFacts.length) {
    return { derivedFacts: derived, calculationVersion: '1.0' };
  }

  let order = 0;
  const rows = resultFacts.map((fact) => {
    const data = parseStructured(fact);
    return {
      driverId: data.driverId || fact.driverIds?.[0],
      driverName: fact.driverNames?.[0] || 'Driver',
      finish: data.finishPosition,
      start: data.startPosition,
      positionsGained: data.positionsGained,
      lapsLed: data.lapsLed,
    };
  });

  const winner = rows.find((r) => r.finish === 1);
  if (winner) {
    derived.push({
      seasonId,
      raceNumber,
      factType: 'milestone',
      category: 'winner',
      summary: `${winner.driverName} won the race${Number.isFinite(winner.start) ? ` from P${winner.start}` : ''}.`,
      driverIds: winner.driverId ? [String(winner.driverId)] : [],
      driverNames: [winner.driverName],
      importanceScore: 100,
      confidence: 'derived',
      structuredData: {
        derivationType: 'winner',
        sourceFields: ['finishPosition'],
        calculationVersion: '1.0',
        calculatedValue: 1,
        explanation: 'Driver with finish position 1.',
      },
      sequenceOrder: order++,
    });
  }

  const withMovement = rows.filter((r) => Number.isFinite(r.positionsGained));
  if (withMovement.length) {
    const gainer = [...withMovement].sort((a, b) => b.positionsGained - a.positionsGained)[0];
    const loser = [...withMovement].sort((a, b) => a.positionsGained - b.positionsGained)[0];

    if (gainer.positionsGained > 0) {
      derived.push({
        seasonId,
        raceNumber,
        factType: 'trend',
        category: 'biggest_gainer',
        summary: `${gainer.driverName} gained ${gainer.positionsGained} positions (P${gainer.start} to P${gainer.finish}).`,
        driverIds: gainer.driverId ? [String(gainer.driverId)] : [],
        driverNames: [gainer.driverName],
        importanceScore: 70,
        confidence: 'derived',
        structuredData: {
          derivationType: 'biggest_gainer',
          calculationVersion: '1.0',
          positionsGained: gainer.positionsGained,
        },
        sequenceOrder: order++,
      });
    }

    if (loser.positionsGained < 0) {
      derived.push({
        seasonId,
        raceNumber,
        factType: 'trend',
        category: 'biggest_loser',
        summary: `${loser.driverName} lost ${Math.abs(loser.positionsGained)} positions (P${loser.start} to P${loser.finish}).`,
        driverIds: loser.driverId ? [String(loser.driverId)] : [],
        driverNames: [loser.driverName],
        importanceScore: 65,
        confidence: 'derived',
        structuredData: {
          derivationType: 'biggest_loser',
          calculationVersion: '1.0',
          positionsGained: loser.positionsGained,
        },
        sequenceOrder: order++,
      });
    }
  }

  const lapsLedRows = rows.filter((r) => Number.isFinite(r.lapsLed) && r.lapsLed > 0);
  if (lapsLedRows.length) {
    const leader = [...lapsLedRows].sort((a, b) => b.lapsLed - a.lapsLed)[0];
    derived.push({
      seasonId,
      raceNumber,
      factType: 'driver_stat',
      category: 'laps_led',
      summary: `${leader.driverName} led ${leader.lapsLed} lap(s).`,
      driverIds: leader.driverId ? [String(leader.driverId)] : [],
      driverNames: [leader.driverName],
      importanceScore: 60,
      confidence: 'derived',
      structuredData: {
        derivationType: 'most_laps_led',
        lapsLed: leader.lapsLed,
        calculationVersion: '1.0',
      },
      sequenceOrder: order++,
    });
  }

  const championshipFacts = factsByType(facts, 'championship');
  const leader = championshipFacts
    .map((f) => ({ name: f.driverNames?.[0], pos: parseStructured(f).position, points: parseStructured(f).points }))
    .filter((r) => r.pos === 1)[0];
  if (leader) {
    derived.push({
      seasonId,
      raceNumber,
      factType: 'championship',
      category: 'points_leader',
      summary: `${leader.name} leads the standings with ${leader.points} points.`,
      importanceScore: 55,
      confidence: 'derived',
      structuredData: { derivationType: 'points_leader', calculationVersion: '1.0' },
      sequenceOrder: order++,
    });
  }

  void qualifyingFacts;
  return { derivedFacts: derived, calculationVersion: '1.0' };
}
