import { getSettings, supabase } from './_lib.js';
import { enrichFantasyDraftPayload, normalizeSlateDriver } from './_fantasy-slate.js';
import { MIN_BEST_VALUE_SALARY } from './_fantasy-admin-analytics.js';

const SALARY_CAP = 50000;

function publicDriverStatus(driver) {
  if (driver.trackHistoryLimitedSample) return 'Limited sample';
  return 'Active';
}

function formatSalaryChange(driver) {
  if (driver.salaryChangeDirection === 'new') return 'New';
  if (driver.salaryChange == null || !Number.isFinite(Number(driver.salaryChange))) return '—';
  if (Number(driver.salaryChange) === 0) return 'Same';
  const change = Number(driver.salaryChange);
  return `${change > 0 ? '+' : ''}$${Math.abs(change).toLocaleString('en-US')}`;
}

function toPublicDriver(driver) {
  return {
    driverId: driver.driverId,
    driverName: driver.driverName,
    carNumber: driver.carNumber || null,
    tier: driver.computedTier || '',
    salary: driver.finalSalary ?? driver.generatedSalary ?? null,
    previousSalary: driver.previousSalary ?? null,
    salaryChange: driver.salaryChange ?? null,
    salaryChangeLabel: formatSalaryChange(driver),
    salaryChangeDirection: driver.salaryChangeDirection ?? null,
    valueGrade: driver.valueGrade ?? null,
    valueScore: driver.valueScore ?? null,
    trackRank: driver.provenTrackHistoryRank ?? driver.trackHistoryRank ?? null,
    trackRankLabel:
      driver.provenTrackHistoryRank != null
        ? `#${driver.provenTrackHistoryRank}`
        : driver.trackHistoryRank != null
          ? `#${driver.trackHistoryRank}`
          : '—',
    status: publicDriverStatus(driver),
  };
}

function topDrivers(drivers, predicate, sortFn, limit = 3) {
  return drivers
    .filter(predicate)
    .sort(sortFn)
    .slice(0, limit)
    .map(toPublicDriver);
}

export function buildPublicSlateCards(drivers = [], meta = null) {
  const bestValuePicks = topDrivers(
    drivers,
    (driver) => {
      const salary = Number(driver.finalSalary ?? driver.generatedSalary);
      return driver.valueScore != null && Number.isFinite(salary) && salary >= MIN_BEST_VALUE_SALARY;
    },
    (a, b) => Number(b.valueScore) - Number(a.valueScore),
    3
  );

  const biggestRisers = topDrivers(
    drivers,
    (driver) => Number(driver.salaryChange) > 0,
    (a, b) => Number(b.salaryChange) - Number(a.salaryChange),
    3
  );

  const biggestFallers = topDrivers(
    drivers,
    (driver) => Number(driver.salaryChange) < 0,
    (a, b) => Number(a.salaryChange) - Number(b.salaryChange),
    3
  );

  const highestSalaries = topDrivers(
    drivers,
    (driver) => Number.isFinite(Number(driver.finalSalary ?? driver.generatedSalary)),
    (a, b) =>
      Number(b.finalSalary ?? b.generatedSalary) - Number(a.finalSalary ?? a.generatedSalary),
    3
  );

  const topTrackHistory = [...drivers]
    .filter((driver) => driver.provenTrackHistoryRank != null)
    .sort((a, b) => Number(a.provenTrackHistoryRank) - Number(b.provenTrackHistoryRank))
    .slice(0, 5)
    .map(toPublicDriver);

  const metaTrackHistory =
    meta?.topProvenTrackHistoryDrivers?.slice(0, 5)?.map((row) => ({
      driverName: row.driverName,
      trackRankLabel: `#${row.provenTrackHistoryRank ?? row.rank}`,
      tier: row.computedTier || null,
      trackHistoryScore: row.trackHistoryScore ?? null,
    })) ?? [];

  return {
    bestValuePicks,
    biggestRisers,
    biggestFallers,
    highestSalaries,
    topTrackHistory: topTrackHistory.length ? topTrackHistory : metaTrackHistory,
  };
}

async function loadLatestSlateRow(seasonId) {
  const sb = supabase();
  if (!sb) return null;

  const base = sb.from('fantasy_slates').select('*').eq('season_id', String(seasonId));

  const { data: published } = await base
    .eq('status', 'published')
    .order('race_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (published) return published;

  const { data: draft } = await sb
    .from('fantasy_slates')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('status', 'draft')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return draft || null;
}

export async function loadLatestFantasySlate(seasonId) {
  const slate = await loadLatestSlateRow(seasonId);
  if (!slate) return null;

  const sb = supabase();
  const { data: drivers } = await sb
    .from('fantasy_slate_drivers')
    .select('*')
    .eq('slate_id', slate.id)
    .order('fantasy_tier_score', { ascending: false });

  return enrichFantasyDraftPayload({
    slate,
    drivers: (drivers || []).map(normalizeSlateDriver),
  });
}

export async function buildFantasyPublicSlateResponse(seasonId) {
  const payload = await loadLatestFantasySlate(seasonId);
  if (!payload?.slate) return null;

  const drivers = payload.drivers || [];
  const cards = buildPublicSlateCards(drivers, payload.slate.meta || payload.meta || null);

  return {
    slate: {
      raceNumber: payload.slate.race_number,
      track: payload.slate.track || 'TBD',
      lockTime: payload.slate.lock_time || null,
      status: payload.slate.status,
      modelVersion: payload.slate.model_version || null,
      generatedAt: payload.slate.generated_at || null,
      salaryCap: SALARY_CAP,
      lineupSize: 5,
    },
    drivers: drivers.map(toPublicDriver),
    cards,
    analytics: payload.analytics || null,
    readOnly: true,
  };
}

export async function buildFantasySalaryHistoryResponse(seasonId) {
  const sb = supabase();
  if (!sb) return { movers: null, slates: [], drivers: [] };

  const latest = await buildFantasyPublicSlateResponse(seasonId);
  if (!latest) return { movers: null, slates: [], drivers: [] };

  const { data: slateRows } = await sb
    .from('fantasy_slates')
    .select('id, race_number, track, status, model_version, generated_at')
    .eq('season_id', String(seasonId))
    .order('race_number', { ascending: false })
    .limit(12);

  const slates = [];
  for (const row of slateRows || []) {
    const { data: driverRows } = await sb
      .from('fantasy_slate_drivers')
      .select('driver_id, driver_name, car_number, computed_tier, final_salary, fantasy_tier_score')
      .eq('slate_id', row.id);

    slates.push({
      raceNumber: row.race_number,
      track: row.track || 'TBD',
      status: row.status,
      modelVersion: row.model_version || null,
      generatedAt: row.generated_at || null,
      drivers: (driverRows || []).map((driver) => ({
        driverId: String(driver.driver_id),
        driverName: driver.driver_name,
        carNumber: driver.car_number || null,
        tier: driver.computed_tier || '',
        salary: Number(driver.final_salary),
        fantasyScore: Number(driver.fantasy_tier_score),
      })),
    });
  }

  const drivers = (latest.drivers || []).map((driver) => {
    const history = slates
      .map((slate) => {
        const row = slate.drivers.find((entry) => entry.driverId === driver.driverId);
        if (!row) return null;
        return {
          raceNumber: slate.raceNumber,
          track: slate.track,
          salary: row.salary,
          tier: row.tier,
          fantasyScore: row.fantasyScore,
        };
      })
      .filter(Boolean);

    return {
      ...driver,
      history,
    };
  });

  const newDrivers = latest.drivers.filter((driver) => driver.salaryChangeDirection === 'new');

  return {
    latestSlate: latest.slate,
    movers: {
      biggestRisers: latest.cards.biggestRisers,
      biggestFallers: latest.cards.biggestFallers,
      newDrivers,
      highestSalaries: latest.cards.highestSalaries,
    },
    slates,
    drivers,
    readOnly: true,
  };
}

export async function runFantasyLineupOptimizerForLatestSlate(options = {}) {
  const settings = await getSettings();
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const payload = await loadLatestFantasySlate(seasonId);
  if (!payload?.drivers?.length) {
    throw new Error('No fantasy slate available for lineup optimization.');
  }

  const { optimizeFantasyLineup } = await import('./_fantasy-lineup-optimizer.js');
  return optimizeFantasyLineup(payload.drivers, options);
}
