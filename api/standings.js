import { getSettings, getDriverProfiles, slugify, withPhotoCacheBust, photoCacheVersion, supabase, fetchHtml } from './_lib.js';
import { computeSeasonCautionStatsFromScheduleHtml, parseScheduleRacesFromHtml } from './_caution-stats.js';
import { enrichScheduleRaces } from './_schedule-points-races.js';
import { buildDriverActivityMap } from './_driver-activity.js';
import {
  attachBpNumber,
  extractStandingsCarNumber,
  loadBpNumberContext,
} from './_bp-driver-number.js';
import {
  attachNumberArtwork,
  loadNumberArtworkCatalog,
  loadNumberArtworkOverrides,
} from './_number-artwork-catalog.js';
import {
  driverProfilePublicUrl,
  resolveProfileForStandingsRow,
} from './_driver-profile-resolve.js';
import {
  resolveSeasonPhaseFromSchedule,
  formatStandingsSidebarPhase,
} from './_championship-season.js';
import {
  buildStandingsCacheKey,
  getCachedStandings,
  setCachedStandings,
} from './_fantasy-srh-cache.js';
import * as cheerio from "cheerio";


export default async function handler(req, res) {
  try {
    const settings = await getSettings();
    const seasonId = settings.seasonId || '27987';
    const fallbackScheduleId = settings.scheduleId || '346493';

    // Auto-detect the latest completed schedule_id by re-parsing the schedule page.
    // This avoids the API being pinned to an older schedule snapshot.
    let detectedScheduleId = null;
    let scheduleHtml = '';
    let scheduleDetectionDebug = {
      scheduleRowsFound: 0,
      completedScheduleIds: [],
      failureReason: null,
    };

    try {
      scheduleHtml = await fetchHtml(settings.scheduleUrl);

      if (!scheduleHtml) {
        scheduleDetectionDebug.failureReason = 'Failed to fetch schedule html';
      } else {
        const $ = cheerio.load(scheduleHtml);
        const scheduleRows = $('table').find('tr');
        scheduleDetectionDebug.scheduleRowsFound = scheduleRows.length;

        // Completed race = winner text non-empty.
        // Extract schedule_id from ANY race link in that completed row.
        const completedScheduleIds = [];
        scheduleRows.each((_i, tr) => {
          const tds = $(tr).find('td');
          if (!tds || tds.length < 7) return;

          const winnerCell = tds.eq(6);
          const winnerLink = winnerCell.find('a').first();
          const winnerText = String(
            winnerLink.text() || winnerCell.text() || ''
          ).trim();
          if (!winnerText) return;

          const raceHrefs = $(tr)
            .find("a[href*='race']")
            .map((_idx, a) => String($(a).attr('href') || ''))
            .get();

          for (const href of raceHrefs) {
            const m = String(href).match(/schedule_id=(\d+)/);
            if (m && m[1]) completedScheduleIds.push(String(m[1]));
          }
        });

        // Deduplicate while preserving order.
        const seen = new Set();
        const orderedUnique = completedScheduleIds.filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });

        scheduleDetectionDebug.completedScheduleIds = orderedUnique;

        if (orderedUnique.length) {
          detectedScheduleId = orderedUnique[orderedUnique.length - 1];
        } else {
          scheduleDetectionDebug.failureReason =
            'No completed rows had any race href containing schedule_id=';
        }
      }
    } catch (e) {
      scheduleDetectionDebug.failureReason = e?.message || String(e);
    }

    const scheduleId = detectedScheduleId || fallbackScheduleId;
    console.log('[standings] settings.scheduleId:', settings.scheduleId);
    console.log(
      '[standings] schedule detection debug:',
      JSON.stringify(scheduleDetectionDebug)
    );
    console.log('[standings] detectedScheduleId:', detectedScheduleId);
    console.log('[standings] final scheduleId used:', scheduleId);

    const cautionPromise =
      req.query?.omitCautionStats === '1' ||
      req.query?.omitCautionStats === 'true' ||
      req.query?.skipCautionStats === '1'
        ? Promise.resolve({
            cautionDataAvailable: false,
            cautionDataSource: 'omitted-by-request',
            cautionRacesCounted: 0,
            totalCautions: null,
            averageCautionsPerRace: null,
          })
        : scheduleHtml
          ? computeSeasonCautionStatsFromScheduleHtml(scheduleHtml, {
              now: new Date(),
              settings,
            })
          : Promise.resolve({
              cautionDataAvailable: false,
              cautionDataSource: 'schedule-html-unavailable',
              cautionRacesCounted: 0,
              totalCautions: null,
              averageCautionsPerRace: null,
            });

    const standingsPromise = (async () => {
      const cacheKey = buildStandingsCacheKey(seasonId, scheduleId);
      const cached = getCachedStandings(cacheKey);
      if (cached) return cached;
      const response = await fetch(
        `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${scheduleId}`
      );
      const json = await response.json();
      setCachedStandings(cacheKey, json);
      return json;
    })();

    const [data, cautionStats, profiles, bpContext, numberOverrides] = await Promise.all([
      standingsPromise,
      cautionPromise,
      getDriverProfiles(),
      loadBpNumberContext(supabase()),
      loadNumberArtworkOverrides(),
    ]);
    const numberCatalog = loadNumberArtworkCatalog();

    const scheduleRaces = scheduleHtml
      ? enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml))
      : [];
    const activityMap = buildDriverActivityMap({
      scheduleRaces,
      srhSchedules: data.schedules || {},
      settings,
      now: new Date(),
    });

    const rows = Object.values(data.rps || {})
      .map(r => {
        const driver = data.drivers?.[r.drid] || {};
        const rawName = driver.name || r.name || `Driver ${r.drid}`;
        const name = rawName.includes(',')
          ? rawName.split(',').reverse().map(s => s.trim()).join(' ')
          : rawName;

        const srhDriverId = String(r.drid);
        const resolution = resolveProfileForStandingsRow(
          { driverId: srhDriverId, driverName: name },
          profiles,
        );
        const profile = resolution.profile;
        const displayName = profile?.display_name || name;
        const slug = slugify(displayName || name);
        const profileDriverId = resolution.profileDriverId || null;
        const standingsCarNumber = extractStandingsCarNumber(r, driver);
        const bp_number = attachBpNumber(
          { driver_id: srhDriverId },
          profile || { driver_id: srhDriverId },
          bpContext,
          standingsCarNumber,
        ).bp_number;
        const finishes = [];

for (const schedule of Object.values(data.schedules || {})) {
  const drivers = schedule?.drivers || {};

  for (const race of Object.values(drivers)) {
    const result = race?.[r.drid];

    if (result?.finish_pos) {
      finishes.push(Number(result.finish_pos));
    }
  }
}

const avgFinish =
  finishes.length > 0
    ? Number(
        (finishes.reduce((a, b) => a + b, 0) / finishes.length).toFixed(1)
      )
    : null;

        return {
          position: Number(r.pos2),
          previousPosition: Number(r.pos1),
          gainLoss: Number(r.chg ?? (r.pos1 || r.pos2) - (r.pos2 || r.pos1)),

          driver: displayName,
          driverId: r.drid,
          profileDriverId,
          profileUrl: driverProfilePublicUrl(profileDriverId || srhDriverId),
          identityMatchMethod: resolution.matchMethod || null,
          carNumber: bp_number,
          bp_number,
          standingsCarNumber:
            standingsCarNumber && standingsCarNumber !== bp_number
              ? standingsCarNumber
              : '',
          points: Number(r.tpts || 0),
          races: Number(r.counted || r.starts || 0),
          starts: Number(r.starts || 0),
          wins: Number(r.wins || 0),
          top5: Number(r.t5 || 0),
          top10: Number(r.t10 || 0),
          poles: Number(r.poles || 0),
          lapsLed: Number(r.led || 0),
          incidents: Number(r.inc || 0),
          avgFinish,
          profile,
          photoUrl: profile?.photo_url
            ? withPhotoCacheBust(
                profile.photo_url,
                photoCacheVersion(profile.updated_at)
              )
            : `/assets/drivers/${slug}.png`,
          active: profile?.active ?? true,
          recentActivity: activityMap.getForDriverId(r.drid),
          iracingCustomerId: profile?.iracing_customer_id || '',
          numberArtwork: attachNumberArtwork(
            {
              driverId: profileDriverId || r.drid,
              driverName: displayName,
              iracing_customer_id: profile?.iracing_customer_id,
              iracing_name: profile?.iracing_name,
              display_name: displayName,
              carNumber: bp_number,
            },
            numberCatalog,
            numberOverrides,
          ),
        };
      })
      .filter(r => r.position >= 1)
      .sort((a, b) => a.position - b.position);

    const enrichedSchedule = scheduleRaces;
    const seasonState = resolveSeasonPhaseFromSchedule(enrichedSchedule, {
      now: new Date(),
      settings,
    });
    const sidebarPhase = formatStandingsSidebarPhase(
      seasonState.phase,
      seasonState.counts
    );
    const playoffCut =
      seasonState.phase?.cutPosition != null
        ? seasonState.phase.cutPosition
        : seasonState.phase?.isFinalRound
          ? null
          : 16;

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json({
      settings: {
        seriesName: 'Blazing Pedals Truck Series',
        seasonName: data.lss?.season_name || 'Season 11',
        playoffCut: playoffCut ?? 16,
      },
      rows,
      schedules: data.schedules || [],
      cautionStats,
      seasonCounts: seasonState.counts,
      playoffPhase: seasonState.phase,
      sidebarPhase,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}