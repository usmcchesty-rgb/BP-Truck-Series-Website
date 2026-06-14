import * as cheerio from 'cheerio';
import { fetchHtml, getDriverProfiles, getSettings, supabase } from './_lib.js';
import POWER_RANKING_SYSTEM_PROMPT, {
  POWER_RANKING_PROMPT_VERSION,
} from '../server/config/power-ranking-system-prompt.js';
import {  fetchGreenFlagPlaylistVideos,
  fetchYouTubeTranscript,
  selectBroadcastVideoForRankings,
  summarizeTranscriptForRankings,
} from './_youtube-transcript.js';
import {
  buildRaceNumberDebug,
  enrichScheduleRaces,
  getPointsRaceByScheduleId,
  getRecentPointsRaceResults,
} from './_schedule-points-races.js';
import {
  buildRecentFormAnalysis,
  validateRecentFormCoverage,
} from './_power-rankings-recent-form.js';
import {
  buildRankedDriverFinishTrace,
  buildRecentResultsAudit,
  getAlignedRaceFinishes,
} from './_power-rankings-results-audit.js';
import {
  analyzeRecentFormReferences,
  buildFactualGroundingContext,
  buildRecentRaceFinishDiagnostics,
  formatVerifiedFactsForRepair,
  validateWriteupFactualGrounding,
  validateWriteupVerifiedEvidence,
} from './_power-rankings-factual-grounding.js';
import {
  computeMovement,
  formatMovementForRepair,
} from './_power-rankings-movement.js';
import { generateProphetTake } from './_power-rankings-prophet-take.js';

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function parseScheduleRaces(html) {
  const $ = cheerio.load(html);
  const races = [];

  $('table').each((_tableIndex, table) => {
    $(table)
      .find('tr')
      .each((_rowIndex, row) => {
        const cells = $(row).find('td');
        if (cells.length < 7) return;

        const raceNumber = cleanText(cells.eq(0).text());
        if (!/^\d+$/.test(raceNumber)) return;

        const points = cleanText(cells.eq(2).text());
        const winner = cleanText(
          cells.eq(6).find('a').first().text() || cells.eq(6).text()
        );

        let scheduleId = null;
        $(row)
          .find("a[href*='race']")
          .each((_idx, anchor) => {
            const href = String($(anchor).attr('href') || '');
            const match = href.match(/schedule_id=(\d+)/);
            if (match?.[1]) scheduleId = match[1];
          });

        races.push({
          scheduleRow: Number(raceNumber),
          scheduleId,
          date: cleanText(cells.eq(1).text()),
          points,
          status: points?.toLowerCase() === 'yes' ? 'points' : 'non-points',
          track: cleanText(cells.eq(4).find('a').first().text() || cells.eq(4).text()),
          winner: winner || null,
        });
      });
  });

  return enrichScheduleRaces(races);
}

async function detectLatestScheduleId(settings) {
  const fallbackScheduleId = settings.scheduleId || '346493';

  try {
    const scheduleHtml = await fetch(settings.scheduleUrl, {
      headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' },
    }).then((r) => (r.ok ? r.text() : ''));

    if (!scheduleHtml) return fallbackScheduleId;

    const $ = cheerio.load(scheduleHtml);
    const completedScheduleIds = [];

    $('table')
      .find('tr')
      .each((_i, tr) => {
        const tds = $(tr).find('td');
        if (!tds || tds.length < 7) return;

        const winnerText = cleanText(
          tds.eq(6).find('a').first().text() || tds.eq(6).text()
        );
        if (!winnerText) return;

        $(tr)
          .find("a[href*='race']")
          .each((_idx, a) => {
            const href = String($(a).attr('href') || '');
            const match = href.match(/schedule_id=(\d+)/);
            if (match?.[1]) completedScheduleIds.push(String(match[1]));
          });
      });

    const seen = new Set();
    const orderedUnique = completedScheduleIds.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return orderedUnique.length
      ? orderedUnique[orderedUnique.length - 1]
      : fallbackScheduleId;
  } catch {
    return fallbackScheduleId;
  }
}

async function fetchStandingsRows(settings, scheduleId = null) {
  const seasonId = settings.seasonId || '27987';
  const resolvedScheduleId = scheduleId || (await detectLatestScheduleId(settings));

  const response = await fetch(
    `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${resolvedScheduleId}`,
    { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } }
  );

  if (!response.ok) {
    throw new Error(`Standings fetch failed (${response.status})`);
  }

  const data = await response.json();
  const profiles = await getDriverProfiles();
  const byDriverId = Object.fromEntries(
    profiles.map((p) => [String(p.driver_id), p])
  );

  const rows = Object.values(data.rps || {})
    .map((r) => {
      const driver = data.drivers?.[r.drid] || {};
      const rawName = driver.name || r.name || `Driver ${r.drid}`;
      const name = rawName.includes(',')
        ? rawName
            .split(',')
            .reverse()
            .map((s) => s.trim())
            .join(' ')
        : rawName;

      const profile = byDriverId[String(r.drid)] || null;
      const displayName = profile?.display_name || name;

      return {
        driverId: String(r.drid),
        driverName: displayName,
        carNumber: profile?.car_number || '',
        position: Number(r.pos2),
        previousPosition: Number(r.pos1),
        points: Number(r.tpts || 0),
        wins: Number(r.wins || 0),
        top5: Number(r.t5 || 0),
        top10: Number(r.t10 || 0),
        races: Number(r.counted || r.starts || 0),
      };
    })
    .filter((r) => r.position >= 1)
    .sort((a, b) => a.position - b.position);

  return {
    rows,
    scheduleId: resolvedScheduleId,
    seasonName: data.lss?.season_name || null,
    schedules: data.schedules || {},
  };
}

async function loadPreviousPowerRankings(beforeRaceNumber) {
  const sb = supabase();
  if (!sb) return null;

  const { data: weeks, error } = await sb
    .from('power_rankings_weeks')
    .select('*')
    .eq('published', true)
    .lt('race_number', beforeRaceNumber)
    .order('race_number', { ascending: false })
    .limit(1);

  if (error || !weeks?.length) return null;

  const week = weeks[0];
  const { data: entries } = await sb
    .from('power_rankings_entries')
    .select('*')
    .eq('week_id', week.id)
    .order('rank');

  const profiles = await getDriverProfiles();
  const byId = Object.fromEntries(profiles.map((p) => [String(p.driver_id), p]));

  return {
    raceNumber: week.race_number,
    entries: (entries || []).map((entry) => ({
      rank: entry.rank,
      driverId: String(entry.driver_id),
      driverName:
        byId[String(entry.driver_id)]?.display_name ||
        byId[String(entry.driver_id)]?.iracing_name ||
        entry.driver_id,
      subtitle: entry.subtitle || '',
    })),
  };
}

async function loadExistingWeekForRace(raceNumber) {
  const sb = supabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from('power_rankings_weeks')
    .select('id, race_number, published_date, published')
    .eq('race_number', raceNumber)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

const MANUAL_RACE_NOTES_MAX_LENGTH = 15000;
const MANUAL_RACE_NOTES_MIN_LENGTH = 100;

function normalizeManualRaceNotes(value) {
  const text = String(value || '').trim();
  if (text.length < MANUAL_RACE_NOTES_MIN_LENGTH) {
    return '';
  }
  return text.slice(0, MANUAL_RACE_NOTES_MAX_LENGTH);
}

function buildManualRaceContextMeta(manualRaceNotes, raceNumber) {
  return withTranscriptDiagnostics({
    requestedRaceNumber: raceNumber,
    selectedVideoRaceNumber: null,
    selectedVideoTitle: null,
    selectionMethod: null,
    nonPointsAdjustmentApplied: false,
    transcriptUsed: true,
    transcriptDebugReason: null,
    transcriptVideoTitle: null,
    transcriptLength: manualRaceNotes.length,
    transcriptMode: 'manual',
    manualRaceNotesUsed: true,
    manualRaceNotesLength: manualRaceNotes.length,
    broadcastContext: {
      source: 'manual',
      summary: manualRaceNotes,
      note: 'Manual race notes provided by admin.',
    },
  });
}

function applyYoutubeContextMeta(transcriptMeta) {
  return withTranscriptDiagnostics({
    ...transcriptMeta,
    transcriptMode: transcriptMeta.transcriptUsed ? 'youtube' : 'none',
    manualRaceNotesUsed: false,
    manualRaceNotesLength: 0,
  });
}

function buildTranscriptDiagnostics(meta) {
  const transcriptUsed = meta.transcriptUsed === true;
  let transcriptDebugReason = meta.transcriptDebugReason ?? null;

  if (!transcriptUsed && !transcriptDebugReason) {
    transcriptDebugReason = meta.summaryEmptyDespiteRawTranscript
      ? 'transcript-summary-empty'
      : 'transcript-unavailable';
  }

  return {
    transcriptDebugReason,
    transcriptUsed,
    selectedVideoTitle: meta.selectedVideoTitle ?? null,
    selectedVideoRaceNumber: meta.selectedVideoRaceNumber ?? null,
    selectionMethod: meta.selectionMethod ?? null,
    transcriptLength: meta.transcriptLength ?? 0,
    requestedRaceNumber: meta.requestedRaceNumber ?? null,
    videoId: meta.videoId ?? meta.broadcastContext?.videoId ?? null,
    transcriptFetchAttempted: meta.transcriptFetchAttempted ?? false,
    transcriptFetchFailureReason: meta.transcriptFetchFailureReason ?? null,
    playlistVideoCount: meta.playlistVideoCount ?? null,
    captionTrackCount: meta.captionTrackCount ?? 0,
    captionTrackLanguages: meta.captionTrackLanguages ?? [],
    autoGeneratedTracksFound: meta.autoGeneratedTracksFound ?? 0,
    manualTracksFound: meta.manualTracksFound ?? 0,
    captionTracks: meta.captionTracks ?? [],
    selectedTrackSource: meta.selectedTrackSource ?? null,
    selectedTrackIsAutoGenerated: meta.selectedTrackIsAutoGenerated ?? null,
    requiresPoToken: meta.requiresPoToken ?? false,
    captionSourcesAttempted: meta.captionSourcesAttempted ?? [],
    transcriptFetcherVersion: meta.transcriptFetcherVersion ?? null,
    captionDiscoverySource: meta.captionDiscoverySource ?? null,
    attemptedANDROID: meta.attemptedANDROID ?? false,
    attemptedIOS: meta.attemptedIOS ?? false,
    attemptedWEB: meta.attemptedWEB ?? false,
    playerResponseSource: meta.playerResponseSource ?? null,
    innertubeRequestSucceeded: meta.innertubeRequestSucceeded ?? false,
    innertubeRequestStatus: meta.innertubeRequestStatus ?? null,
    loginRequiredSeen: meta.loginRequiredSeen ?? false,
    loginRequiredTrackCount: meta.loginRequiredTrackCount ?? 0,
    androidClientName: meta.androidClientName ?? null,
    androidClientVersion: meta.androidClientVersion ?? null,
    iosClientName: meta.iosClientName ?? null,
    iosClientVersion: meta.iosClientVersion ?? null,
    attemptedTVHTML5: meta.attemptedTVHTML5 ?? false,
    attemptedMWEB: meta.attemptedMWEB ?? false,
    transcriptMode: meta.transcriptMode ?? null,
    manualRaceNotesUsed: meta.manualRaceNotesUsed === true,
    manualRaceNotesLength: meta.manualRaceNotesLength ?? 0,
  };
}

function withTranscriptDiagnostics(meta) {
  const transcriptDiagnostics = buildTranscriptDiagnostics(meta);
  return {
    ...meta,
    transcriptUsed: transcriptDiagnostics.transcriptUsed,
    transcriptDebugReason: transcriptDiagnostics.transcriptDebugReason,
    transcriptDiagnostics,
  };
}

function captionFieldsFromFetchResult(fetchResult = {}) {
  return {
    captionTrackCount: fetchResult.captionTrackCount ?? 0,
    captionTrackLanguages: fetchResult.captionTrackLanguages ?? [],
    autoGeneratedTracksFound: fetchResult.autoGeneratedTracksFound ?? 0,
    manualTracksFound: fetchResult.manualTracksFound ?? 0,
    captionTracks: fetchResult.captionTracks ?? [],
    selectedTrackSource: fetchResult.selectedTrackSource ?? null,
    selectedTrackIsAutoGenerated: fetchResult.selectedTrackIsAutoGenerated ?? null,
    requiresPoToken: fetchResult.requiresPoToken ?? false,
    captionSourcesAttempted: fetchResult.captionSourcesAttempted ?? [],
    transcriptFetcherVersion: fetchResult.transcriptFetcherVersion ?? null,
    captionDiscoverySource: fetchResult.captionDiscoverySource ?? null,
    attemptedANDROID: fetchResult.attemptedANDROID ?? false,
    attemptedIOS: fetchResult.attemptedIOS ?? false,
    attemptedWEB: fetchResult.attemptedWEB ?? false,
    playerResponseSource: fetchResult.playerResponseSource ?? null,
    innertubeRequestSucceeded: fetchResult.innertubeRequestSucceeded ?? false,
    innertubeRequestStatus: fetchResult.innertubeRequestStatus ?? null,
    loginRequiredSeen: fetchResult.loginRequiredSeen ?? false,
    loginRequiredTrackCount: fetchResult.loginRequiredTrackCount ?? 0,
    androidClientName: fetchResult.androidClientName ?? null,
    androidClientVersion: fetchResult.androidClientVersion ?? null,
    iosClientName: fetchResult.iosClientName ?? null,
    iosClientVersion: fetchResult.iosClientVersion ?? null,
    attemptedTVHTML5: fetchResult.attemptedTVHTML5 ?? false,
    attemptedMWEB: fetchResult.attemptedMWEB ?? false,
  };
}

async function loadBroadcastContext(raceNumber, drivers) {
  const requestedRaceNumber = Number(raceNumber);
  const logTag = '[power-rankings-transcript]';
  const videos = await fetchGreenFlagPlaylistVideos();
  const playlistVideos = videos.map((video) => ({
    videoId: video.videoId,
    title: video.title || null,
    parsedRaceNumber: video.raceNumber ?? null,
    published: video.published || null,
  }));

  console.log(logTag, 'transcript retrieval started', {
    requestedRaceNumber,
    playlistVideoCount: playlistVideos.length,
    playlistVideos,
  });

  if (!videos.length) {
    const diagnostics = {
      requestedRaceNumber,
      playlistVideoCount: 0,
      playlistVideos: [],
      selectedVideoTitle: null,
      selectedVideoRaceNumber: null,
      selectionMethod: 'not-found',
      videoId: null,
      transcriptFetchAttempted: false,
      transcriptFetchFailureReason: null,
      transcriptLength: 0,
      transcriptUsed: false,
      transcriptDebugReason: 'playlist-empty',
    };
    console.warn(logTag, 'transcript retrieval failed', diagnostics);
    return withTranscriptDiagnostics({
      requestedRaceNumber,
      selectedVideoRaceNumber: null,
      selectedVideoTitle: null,
      selectionMethod: 'not-found',
      nonPointsAdjustmentApplied: false,
      transcriptUsed: false,
      transcriptVideoTitle: null,
      transcriptLength: 0,
      transcriptDebugReason: 'playlist-empty',
      playlistVideoCount: 0,
      broadcastContext: null,
    });
  }

  const selection = selectBroadcastVideoForRankings(videos, raceNumber);
  const video = selection.video;

  console.log(logTag, 'video selection', {
    requestedRaceNumber,
    selectedVideoTitle: selection.selectedVideoTitle,
    selectedVideoRaceNumber: selection.selectedVideoRaceNumber,
    selectionMethod: selection.selectionMethod,
    videoId: video?.videoId || null,
  });

  if (!video?.videoId) {
    const hasParsedRaceNumbers = videos.some((item) => item.raceNumber != null);
    const transcriptDebugReason = hasParsedRaceNumbers ? 'race-not-found' : 'title-parse-failed';
    const diagnostics = {
      requestedRaceNumber,
      playlistVideoCount: playlistVideos.length,
      parsedRaceNumbers: playlistVideos.map((item) => item.parsedRaceNumber),
      selectedVideoTitle: null,
      selectedVideoRaceNumber: null,
      selectionMethod: selection.selectionMethod,
      videoId: null,
      transcriptFetchAttempted: false,
      transcriptFetchFailureReason: null,
      transcriptLength: 0,
      transcriptUsed: false,
      transcriptDebugReason,
    };
    console.warn(logTag, 'transcript retrieval failed', diagnostics);

    return withTranscriptDiagnostics({
      requestedRaceNumber: selection.requestedRaceNumber,
      selectedVideoRaceNumber: selection.selectedVideoRaceNumber,
      selectedVideoTitle: selection.selectedVideoTitle,
      selectionMethod: selection.selectionMethod,
      nonPointsAdjustmentApplied: selection.nonPointsAdjustmentApplied,
      transcriptUsed: false,
      transcriptVideoTitle: null,
      transcriptLength: 0,
      transcriptDebugReason,
      playlistVideoCount: playlistVideos.length,
      broadcastContext: null,
    });
  }

  console.log(logTag, 'transcript fetch attempt', {
    requestedRaceNumber,
    videoId: video.videoId,
    selectedVideoTitle: selection.selectedVideoTitle,
  });

  let fetchResult;
  try {
    fetchResult = await fetchYouTubeTranscript(video.videoId);
  } catch (error) {
    fetchResult = {
      transcript: null,
      transcriptLength: 0,
      fetchAttempted: true,
      failureReason: `unexpected-error: ${error?.message || error}`,
      debugReason: 'transcript-fetch-failed',
      captionTrackCount: 0,
      hasEnglishTrack: false,
      selectedLanguageCode: null,
    };
    console.warn(logTag, 'transcript fetch threw', {
      requestedRaceNumber,
      videoId: video.videoId,
      error: error?.message || String(error),
    });
  }

  console.log(logTag, 'transcript fetch result', {
    requestedRaceNumber,
    videoId: video.videoId,
    fetchAttempted: fetchResult.fetchAttempted,
    fetchSuccess: Boolean(fetchResult.transcript),
    failureReason: fetchResult.failureReason,
    debugReason: fetchResult.debugReason,
    transcriptLength: fetchResult.transcriptLength,
    ...captionFieldsFromFetchResult(fetchResult),
  });

  if (!fetchResult.transcript) {
    const diagnostics = {
      requestedRaceNumber,
      selectedVideoTitle: selection.selectedVideoTitle,
      selectedVideoRaceNumber: selection.selectedVideoRaceNumber,
      selectionMethod: selection.selectionMethod,
      videoId: video.videoId,
      transcriptFetchAttempted: fetchResult.fetchAttempted,
      transcriptFetchFailureReason: fetchResult.failureReason,
      transcriptLength: fetchResult.transcriptLength,
      transcriptUsed: false,
      transcriptDebugReason: fetchResult.debugReason || 'transcript-fetch-failed',
    };
    console.warn(logTag, 'transcript retrieval failed', diagnostics);

    return withTranscriptDiagnostics({
      requestedRaceNumber: selection.requestedRaceNumber,
      selectedVideoRaceNumber: selection.selectedVideoRaceNumber,
      selectedVideoTitle: selection.selectedVideoTitle,
      selectionMethod: selection.selectionMethod,
      nonPointsAdjustmentApplied: selection.nonPointsAdjustmentApplied,
      transcriptUsed: false,
      transcriptVideoTitle: selection.selectedVideoTitle,
      transcriptLength: fetchResult.transcriptLength,
      transcriptDebugReason: fetchResult.debugReason || 'transcript-fetch-failed',
      videoId: video.videoId,
      transcriptFetchAttempted: fetchResult.fetchAttempted,
      transcriptFetchFailureReason: fetchResult.failureReason,
      ...captionFieldsFromFetchResult(fetchResult),
      broadcastContext: {
        videoId: video.videoId,
        videoTitle: video.title || null,
        videoRaceNumber: selection.selectedVideoRaceNumber,
        summary: null,
        note: 'Transcript unavailable — follow No-Transcript Fallback rules. Use standings, schedule, results, and stats only.',
      },
    });
  }

  const trimmed = summarizeTranscriptForRankings(fetchResult.transcript, drivers);
  const transcriptUsed = Boolean(trimmed.summary);
  let transcriptDebugReason = null;

  if (!transcriptUsed && fetchResult.transcriptLength < 100) {
    transcriptDebugReason = 'transcript-too-short';
  }

  const diagnostics = {
    requestedRaceNumber,
    selectedVideoTitle: selection.selectedVideoTitle,
    selectedVideoRaceNumber: selection.selectedVideoRaceNumber,
    selectionMethod: selection.selectionMethod,
    videoId: video.videoId,
    transcriptFetchAttempted: fetchResult.fetchAttempted,
    transcriptFetchFailureReason: fetchResult.failureReason,
    transcriptLength: trimmed.fullLength,
    summaryLength: trimmed.summary?.length || 0,
    highlightCount: trimmed.highlightCount,
    transcriptUsed,
    transcriptDebugReason,
    summaryEmptyDespiteRawTranscript: !transcriptUsed && fetchResult.transcriptLength >= 100,
  };

  if (transcriptUsed) {
    console.log(logTag, 'transcript retrieval succeeded', diagnostics);
  } else {
    console.warn(logTag, 'transcript retrieval incomplete', diagnostics);
  }

  return withTranscriptDiagnostics({
    requestedRaceNumber: selection.requestedRaceNumber,
    selectedVideoRaceNumber: selection.selectedVideoRaceNumber,
    selectedVideoTitle: selection.selectedVideoTitle,
    selectionMethod: selection.selectionMethod,
    nonPointsAdjustmentApplied: selection.nonPointsAdjustmentApplied,
    transcriptUsed,
    transcriptVideoTitle: selection.selectedVideoTitle,
    transcriptLength: trimmed.fullLength,
    transcriptDebugReason,
    videoId: video.videoId,
    transcriptFetchAttempted: fetchResult.fetchAttempted,
    transcriptFetchFailureReason: fetchResult.failureReason,
    summaryEmptyDespiteRawTranscript: !transcriptUsed && fetchResult.transcriptLength >= 100,
    ...captionFieldsFromFetchResult(fetchResult),
    broadcastContext: {
      videoId: video.videoId,
      videoTitle: video.title || null,
      videoRaceNumber: selection.selectedVideoRaceNumber,
      highlightCount: trimmed.highlightCount,
      summary: trimmed.summary,
    },
  });
}
function buildContextPayload({
  raceNumber,
  standings,
  scheduleRaces,
  previousRankings,
  profiles,
  broadcastContext,
  transcriptUsed,
  transcriptMode,
  manualRaceNotes,
  standingsSnapshot,
  recentFormAnalysis,
  factualGrounding,
}) {
  const completedRaces = getRecentPointsRaceResults(scheduleRaces, raceNumber, 3);

  const recentResults = completedRaces.map((race) => ({
    raceNumber: race.officialPointsRaceNumber,
    scheduleRow: race.scheduleRow,
    date: race.date,
    track: race.track,
    winner: race.winner,
  }));

  return {
    raceNumber,
    season: 'Blazing Pedals Truck Series',
    standingsSnapshot: standingsSnapshot || null,
    standings: standings.slice(0, 20).map((row) => ({
      driverId: row.driverId,
      driverName: row.driverName,
      carNumber: row.carNumber,
      pointsPosition: row.position,
      points: row.points,
      wins: row.wins,
      top5: row.top5,
      top10: row.top10,
      races: row.races,
    })),
    recentResults,
    recentFormAnalysis: recentFormAnalysis || null,
    factualGrounding: factualGrounding || null,
    previousPowerRankings: previousRankings,
    drivers: standings.map((row) => ({
      driverId: row.driverId,
      driverName: row.driverName,
      carNumber: row.carNumber,
    })),
    savedProfiles: profiles.slice(0, 40).map((p) => ({
      driverId: String(p.driver_id),
      driverName: p.display_name || p.iracing_name,
      carNumber: p.car_number || '',
    })),
    broadcastContext,
    manualRaceNotes: manualRaceNotes || null,
    transcriptUsed: transcriptUsed === true,
    transcriptMode: transcriptMode || (transcriptUsed ? 'youtube' : 'none'),
  };
}

async function callOpenAi(contextPayload) {  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured in Vercel environment variables.');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.85,
      max_tokens: 4500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: POWER_RANKING_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Generate Race ${contextPayload.raceNumber} power rankings using this data.

Use prompt version ${POWER_RANKING_PROMPT_VERSION} rules: ranking justifications with 1-3 verified facts, recent form heavily weighted, no season summaries, no generic filler, NASCAR.com editorial tone.

Standings and driver stats in this payload are frozen to standingsSnapshot.raceNumber. Do not reference wins, points, or results from races after Race ${contextPayload.raceNumber}.
Only use recentResults and transcript/manual notes for race context through Race ${contextPayload.raceNumber}.

Power Rankings are NOT points standings. Recent form is one of the strongest ranking factors — use factualGrounding.recentRaceFinishes, last3RaceAverageFinish, and recentFormAnalysis. Do not simply mirror points order.
A driver on P1, P1, P3 may outrank a higher-points driver on P8, P9, P11.
Back-to-back winners should almost always be Top 10. Recent winners and hot drivers left out of the Top 10 should usually appear in honorableMentions (0-3).
For ranks 1-5, writeups should cite recent-race finishes or last-3 average when recentRaceFinishes are available.

Use factualGrounding only for verified facts. Do not invent exact race finishes, podiums, wins, incidents, laps led, strategy, or points totals unless listed in factualGrounding or manualRaceNotes.

transcriptMode: ${contextPayload.transcriptMode || 'none'}
transcriptUsed: ${contextPayload.transcriptUsed === true}
If transcriptMode is "manual", treat manualRaceNotes as trusted race context provided by the admin.
If transcriptMode is "none", follow the No-Transcript Fallback rules. Do not invent race incidents or broadcast storylines.

${JSON.stringify(contextPayload, null, 2)}`,
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned an empty response.');
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error('OpenAI returned invalid JSON.');
  }
}

function buildDriverLookup(standings, profiles) {
  const lookup = new Map();

  for (const row of standings) {
    lookup.set(String(row.driverId), row);
  }

  for (const profile of profiles) {
    const id = String(profile.driver_id);
    if (!lookup.has(id)) {
      lookup.set(id, {
        driverId: id,
        driverName: profile.display_name || profile.iracing_name,
        carNumber: profile.car_number || '',
      });
    }
  }

  return lookup;
}

function normalizeNameToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getDriverNameTokens(driverName) {
  return String(driverName || '')
    .trim()
    .split(/\s+/)
    .map(normalizeNameToken)
    .filter((token) => token.length > 2);
}

function subtitleWordCount(subtitle) {
  return String(subtitle || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function subtitleContainsToken(subtitle, token) {
  if (!token) return false;
  const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return pattern.test(String(subtitle || ''));
}

function validateSubtitle(subtitle, driver, usedSubtitles) {
  const text = String(subtitle || '').trim();
  if (!text) {
    return 'Subtitle is required.';
  }

  const words = subtitleWordCount(text);
  if (words < 2) {
    return 'Subtitle must be at least 2 words.';
  }
  if (words > 6) {
    return 'Subtitle must be 6 words or fewer.';
  }

  const normalized = text.toLowerCase();
  if (usedSubtitles.has(normalized)) {
    return 'Subtitle must be unique within the Top 10.';
  }

  if (/\bdriver'?s\b/i.test(text)) {
    return 'Subtitle cannot use "Driver\'s" format.';
  }

  if (/'s\b/i.test(text)) {
    return 'Subtitle cannot use possessive forms.';
  }

  const carNumber = String(driver?.carNumber || '').trim();
  if (carNumber && subtitleContainsToken(text, carNumber)) {
    return 'Subtitle cannot include a car number.';
  }

  for (const token of getDriverNameTokens(driver?.driverName)) {
    if (subtitleContainsToken(text, token)) {
      return `Subtitle cannot include driver name text ("${token}").`;
    }
  }

  const genericSubtitles = [
    'consistent contender',
    'steady performer',
    'on the edge',
    'catching up',
    'finding speed',
    'holding strong',
    'quietly climbing',
    'pressure building',
    'making every finish count',
    'finding another gear',
  ];
  if (genericSubtitles.includes(normalized)) {
    return 'Subtitle is too generic — use a specific storyline.';
  }

  return null;
}

function countSentences(text) {
  return String(text || '')
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function getFirstSentence(text) {
  const match = String(text || '').match(/^[^.!?]+[.!?]?/);
  return (match?.[0] || String(text || '')).trim();
}

function getSentenceContaining(text, phrase) {
  const lower = String(text || '').toLowerCase();
  const index = lower.indexOf(String(phrase || '').toLowerCase());
  if (index < 0) return String(text || '');

  const before = lower.slice(0, index);
  const after = lower.slice(index);
  const delimiterIndexes = [
    before.lastIndexOf('.'),
    before.lastIndexOf('!'),
    before.lastIndexOf('?'),
  ].filter((position) => position >= 0);
  const start = (delimiterIndexes.length ? Math.max(...delimiterIndexes) : -1) + 1;
  const endMatch = after.match(/[.!?]/);
  const end = endMatch ? index + endMatch.index + 1 : text.length;
  return String(text || '').slice(start, end).trim();
}

const WRITEUP_EVIDENCE_PATTERNS = [
  {
    id: 'championship-position',
    patterns: [
      /\b(\d+(?:st|nd|rd|th)\s+in\s+points|top\s+\d+\s+in\s+points|points\s+position|championship\s+(lead|standings|position|picture)|\b\d+\s+in\s+the\s+points)\b/i,
      /\b(leader|leads)\s+the\s+(points|standings|championship)\b/i,
    ],
  },
  {
    id: 'championship-position-change',
    patterns: [
      /\b(moved|climbed|gained|dropped|fell|lost)\s+\d+\s+(spots?|positions?)\s+in\s+(the\s+)?points\b/i,
      /\bpoints\s+position\s+(improved|dropped|changed)\b/i,
    ],
  },
  {
    id: 'power-ranking-movement',
    patterns: [
      /\b(moved|climbed|jumped|dropped|fell|slid)\s+\d+\s+(spots?|positions?)\b/i,
      /\b(up|down)\s+\d+\s+(spots?|positions?)\b/i,
      /\b(holds?|held|stays?|remains?)\s+(at|in)\s+(the\s+)?(no\.?\s*)?#?\d+\b/i,
      /\bpower\s+rank(ing|ings)?\b/i,
      /\bunchanged\s+(at|in)\s+(the\s+)?(no\.?\s*)?#?\d+\b/i,
    ],
  },
  {
    id: 'recent-finishing-positions',
    patterns: [
      /\bP?\d+\s+(finish|finishes|at|in)\b/i,
      /\bfinish(ed|es|ing)?\s+(in\s+)?(the\s+)?\d+\b/i,
      /\btop\s*-?\s*(five|ten|5|10)\b/i,
      /\b\d+(?:st|nd|rd|th)\s+place\b/i,
    ],
  },
  {
    id: 'top5-count',
    patterns: [/\b\d+\s+top\s*-?\s*(five|5)s?\b/i, /\btop\s*-?\s*(five|5)s?\b/i],
  },
  {
    id: 'top10-count',
    patterns: [/\b\d+\s+top\s*-?\s*(ten|10)s?\b/i, /\btop\s*-?\s*(ten|10)s?\b/i],
  },
  {
    id: 'wins',
    patterns: [/\b\d+\s+win(s)?\b/i, /\bwin(ning|ner|s)?\b/i, /\bvictory\b/i, /\bcheckered\b/i],
  },
  {
    id: 'average-finish',
    patterns: [/\baverage\s+finish\b/i, /\bavg\.?\s+finish\b/i],
  },
  {
    id: 'recent-streak',
    patterns: [
      /\b(streak|consecutive|back-to-back|in\s+a\s+row|straight)\b/i,
      /\blast\s+\d+\s+(races?|starts?|weeks?)\b/i,
    ],
  },
  {
    id: 'momentum-trend',
    patterns: [
      /\b(momentum|trending|surging|building|heating\s+up|cooling\s+off|on\s+the\s+rise|sliding|trend)\b/i,
    ],
  },
  {
    id: 'most-recent-race',
    patterns: [
      /\b(last|latest|most\s+recent)\s+(race|start|week| outing)\b/i,
      /\brace\s+\d+\b/i,
      /\b(at|in)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/,
    ],
  },
  {
    id: 'significant-incident',
    patterns: [
      /\b(wreck|crash|spin|contact|incident|trouble|penalty|caution|brought\s+out|cut\s+tire|mechanical)\b/i,
    ],
  },
  {
    id: 'bad-luck',
    patterns: [
      /\b(bad\s+luck|despite\s+the\s+speed|speed\s+was|faster\s+than|should\s+have|ruined|cost\s+(him|her|them))\b/i,
    ],
  },
  {
    id: 'transcript-performance',
    patterns: [
      /\b(lead\s+change|dominant|led\s+\d+|laps\s+led|recovery\s+drive|strategy|green\s+flag|commentary|broadcast|charge\s+through)\b/i,
    ],
  },
  {
    id: 'previous-ranking-comparison',
    patterns: [
      /\b(last\s+week|previous|from\s+#?\d+\s+to|compared\s+to\s+last|unchanged\s+from|same\s+spot)\b/i,
      /\bwas\s+#?\d+\s+(last\s+week|previously)\b/i,
    ],
  },
];

const GENERIC_WRITEUP_PHRASES = [
  'building momentum',
  'showing momentum',
  'building confidence',
  'finding speed',
  'showing promise',
  'staying competitive',
  'looking for a breakthrough',
  'room to grow',
  'remains in contention',
  'shows promise',
  'one to watch',
  'could surprise people',
  'has potential',
  'remains competitive',
  'continues to improve',
  'steady performer',
  'consistent contender',
];

const EVIDENCE_REPAIR_ERROR_TYPES = new Set([
  'insufficient-verified-facts',
  'too-many-verified-facts',
  'weak-ranking-explanation',
  'generic-language',
  'too-generic',
  'missing-recent-finish-evidence',
  'misleading-last3-average-wording',
  'unsupported-missed-race-mention',
]);

const REPAIRABLE_WRITEUP_ERROR_TYPES = new Set([
  'name-first-opening',
  'insufficient-verified-facts',
  'too-many-verified-facts',
  'weak-ranking-explanation',
  'generic-language',
  'season-summary',
  'too-generic',
  'unsupported-facts',
  'missing-recent-finish-evidence',
  'misleading-last3-average-wording',
  'unsupported-missed-race-mention',
]);

function countWriteupEvidencePoints(text) {
  let count = 0;
  for (const group of WRITEUP_EVIDENCE_PATTERNS) {
    if (group.patterns.some((pattern) => pattern.test(text))) {
      count += 1;
    }
  }
  return count;
}

function sentenceHasSpecificEvidence(sentence) {
  const text = String(sentence || '');
  if (/\b\d+\b/.test(text)) return true;
  if (countWriteupEvidencePoints(text) >= 1) return true;
  return /\b(P\d+|top\s*-?\s*(five|ten|5|10)|win|wins|points|finish)\b/i.test(text);
}

function findUnsupportedGenericPhrase(text) {
  const lower = String(text || '').toLowerCase();
  for (const phrase of GENERIC_WRITEUP_PHRASES) {
    if (!lower.includes(phrase)) continue;
    const sentence = getSentenceContaining(text, phrase);
    if (!sentenceHasSpecificEvidence(sentence)) {
      return phrase;
    }
  }
  return null;
}

function looksLikeSeasonSummary(text) {
  const hasSeasonWide =
    /\b(this season|all season|throughout the season|season-long|full season|entire season)\b/i.test(
      text
    ) ||
    /\b(has|have)\s+been\s+(a|an)\s+(consistent|solid|strong|reliable|steady)\b/i.test(text);

  if (!hasSeasonWide) return false;

  const hasRecentAnchor =
    /\b(last|recent|latest|race|week|finish|P\d|top\s*-?\s*\d+|moved|ranked|ranking)\b/i.test(
      text
    );
  return !hasRecentAnchor;
}

function looksTooGenericForDriver(text) {
  const evidenceCount = countWriteupEvidencePoints(text);
  const numberCount = (String(text || '').match(/\b\d+\b/g) || []).length;

  if (evidenceCount >= 3 && numberCount >= 1) return false;
  if (evidenceCount < 2) return false;

  const vaguePraise =
    /\b(competitive|improving|potential|promising|contender|consistent|dangerous|threat|talented)\b/i.test(
      text
    );
  const hasSpecificFinish =
    /\b(P\d+|top\s*-?\s*(five|ten|5|10)|win|wins|\d+\s+top)\b/i.test(text) || numberCount >= 2;

  return vaguePraise && !hasSpecificFinish;
}

export function validateWriteup(writeup, driver, context = {}) {
  const text = String(writeup || '').trim();
  const warnings = [];

  if (!text) {
    return { error: 'Writeup is required.', errorType: 'required', warnings };
  }

  const words = countWords(text);
  if (words < 30) {
    return {
      error: `Writeup is too short (${words} words; minimum 30).`,
      errorType: 'too-short',
      warnings,
    };
  }

  if (words < 50) {
    warnings.push(`Below preferred length (50–100 words, got ${words}).`);
  }
  if (words > 100) {
    warnings.push(`Above preferred length (50–100 words, got ${words}).`);
  }

  const sentences = countSentences(text);
  if (sentences < 2 || sentences > 4) {
    warnings.push(`Outside preferred sentence count (2–4 sentences, got ${sentences}).`);
  }

  const firstSentence = getFirstSentence(text);
  const firstLower = firstSentence.toLowerCase();

  if (/^driver\s+\w+\s+(is|continues|has|remains|sits|enters)\b/i.test(firstSentence)) {
    return {
      error: 'Writeup cannot start with "Driver X is/continues/has/remains/sits/enters".',
      errorType: 'name-first-opening',
      warnings,
    };
  }

  for (const token of getDriverNameTokens(driver?.driverName)) {
    if (new RegExp(`^${token}\\b`, 'i').test(firstLower.replace(/[^a-z0-9\s']/g, ' '))) {
      return {
        error: 'Writeup should not start with the driver\'s name.',
        errorType: 'name-first-opening',
        warnings,
      };
    }
    if (
      new RegExp(`\\b${token}\\s+(is|continues|has|remains|sits|enters)\\b`, 'i').test(
        firstSentence
      )
    ) {
      return {
        error: 'Writeup cannot open with "[Name] is/continues/has/remains/sits/enters".',
        errorType: 'name-first-opening',
        warnings,
      };
    }
  }

  const genericPatterns = [
    /^steadily climbing the ranks\b/i,
    /^continues to impress\b/i,
    /^has shown speed\b/i,
    /^remains a threat\b/i,
    /^has been consistent\b/i,
  ];
  if (genericPatterns.some((pattern) => pattern.test(firstLower))) {
    warnings.push('Writeup opening is generic.');
  }

  const unsupportedGeneric = findUnsupportedGenericPhrase(text);
  if (unsupportedGeneric) {
    return {
      error: `Writeup uses generic phrase "${unsupportedGeneric}" without specific evidence.`,
      errorType: 'generic-language',
      warnings,
    };
  }

  const evidenceValidation = validateWriteupVerifiedEvidence(text, {
    ...context,
    rank: context.rank ?? context.entry?.rank,
  });
  if (evidenceValidation.error) {
    return {
      error: evidenceValidation.error,
      errorType: evidenceValidation.errorType,
      verifiedFactsUsed: evidenceValidation.verifiedFactsUsed,
      verifiedFactsUsedCount: evidenceValidation.verifiedFactsUsedCount,
      warnings,
    };
  }

  if (looksLikeSeasonSummary(text)) {
    return {
      error: 'Writeup reads like a season summary instead of a ranking justification.',
      errorType: 'season-summary',
      warnings,
    };
  }

  if (looksTooGenericForDriver(text)) {
    return {
      error: 'Writeup is too generic and could apply to multiple drivers.',
      errorType: 'too-generic',
      warnings,
    };
  }

  if (
    context.transcriptUsed === true &&
    !WRITEUP_EVIDENCE_PATTERNS.find((group) => group.id === 'transcript-performance')?.patterns.some(
      (pattern) => pattern.test(text)
    ) &&
    !/\b(incident|wreck|contact|lead|dominant|strategy|recovery|caution|speed\s+was|bad\s+luck)\b/i.test(
      text
    )
  ) {
    warnings.push('Transcript/manual notes were available but writeup lacks race-specific context.');
  }

  const factual = validateWriteupFactualGrounding(text, context);
  if (factual.unsupported.length) {
    return {
      error: `Writeup contains unsupported factual claims: ${factual.unsupported
        .map((item) => item.message)
        .join('; ')}`,
      errorType: 'unsupported-facts',
      unsupportedFacts: factual.unsupported,
      warnings,
    };
  }

  return {
    error: null,
    errorType: null,
    warnings,
    unsupportedFacts: [],
    verifiedFactsUsed: evidenceValidation.verifiedFactsUsed,
    verifiedFactsUsedCount: evidenceValidation.verifiedFactsUsedCount,
  };
}

function isNameFirstOpeningError(error, errorType) {
  if (errorType === 'name-first-opening') return true;
  const text = String(error || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('should not start with the driver') ||
    text.includes('cannot start with "driver x') ||
    text.includes('cannot open with')
  );
}

function isRepairableWriteupError(errorType) {
  return REPAIRABLE_WRITEUP_ERROR_TYPES.has(errorType);
}

export function formatDriverStatsForRepair(driver, entry, previousRank) {
  const parts = [];
  if (entry?.rank) parts.push(`Power rank: ${entry.rank}`);
  if (previousRank) parts.push(`Previous power rank: ${previousRank}`);
  parts.push(formatMovementForRepair(entry, previousRank));
  if (driver?.position) parts.push(`Points position: ${driver.position}`);
  if (driver?.previousPosition && driver.previousPosition !== driver.position) {
    parts.push(`Previous points position: ${driver.previousPosition}`);
  }
  if (Number.isFinite(driver?.wins)) parts.push(`Wins: ${driver.wins}`);
  if (Number.isFinite(driver?.top5)) parts.push(`Top 5s: ${driver.top5}`);
  if (Number.isFinite(driver?.top10)) parts.push(`Top 10s: ${driver.top10}`);
  if (Number.isFinite(driver?.points)) parts.push(`Points: ${driver.points}`);
  parts.push(formatMovementForRepair(entry, previousRank));
  return parts.join('\n');
}

async function callOpenAiWriteupRepair({
  writeup,
  driverName,
  rank,
  subtitle,
  repairReason,
  driverStats,
  verifiedFacts,
  transcriptUsed,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured in Vercel environment variables.');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 280,
      messages: [
        {
          role: 'user',
          content: `Rewrite this Power Rankings writeup as NASCAR.com editorial analysis.

Rules:
- Do NOT start with the driver's name.
- 50-100 words, 2-4 sentences.
- Explain WHY this driver is ranked here THIS week (not a season summary or biography).
- Use 1-3 verified facts from the list below (rank tier limits apply).
- Use those facts to explain WHY this driver is ranked here THIS week — do not simply list statistics.
- When recentRaceFinishes are available, prefer citing them or last3RaceAverageFinish over generic momentum language.
- Avoid generic filler like "building momentum", "showing momentum", "building confidence", or "finding speed" unless immediately backed by verified facts in the same paragraph.
- Do not use unsupported phrases like "shows promise" or "steady performer".
- Do NOT invent race facts. Only use verified facts listed below or manual/transcript notes.
${transcriptUsed ? '- Transcript/manual race notes were available — use only facts supported by those notes or verified facts below.' : ''}

Driver: ${driverName}
Rank: ${rank}
Subtitle: ${subtitle}
Repair reason: ${repairReason}

Verified facts only:
${verifiedFacts}

Driver stats:
${driverStats}

Original writeup:
${writeup}

Return only the rewritten paragraph.`,
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI writeup repair failed (${response.status})`);
  }

  const content = String(data?.choices?.[0]?.message?.content || '')
    .trim()
    .replace(/^["']|["']$/g, '');

  if (!content) {
    throw new Error('OpenAI writeup repair returned an empty response.');
  }

  return content;
}

export function buildWriteupWarnings(repaired) {
  const warnings = [];

  for (const message of repaired.writeupResult?.warnings || []) {
    warnings.push({ type: 'informational', message });
  }

  if (repaired.writeupResult?.error) {
    warnings.push({
      type: repaired.writeupResult.errorType || 'validation-error',
      message: repaired.writeupResult.error,
    });
  }

  if (repaired.unsupportedFactsDetected?.length) {
    warnings.push({
      type: 'unsupported-facts-repaired',
      message: `Unsupported factual claims were detected during repair (${repaired.unsupportedFactsDetected
        .map((fact) => fact.type)
        .join(', ')}). Review carefully.`,
    });
  }

  return warnings;
}

export async function callOpenAiSingleWriteup({
  driverName,
  rank,
  subtitle,
  verifiedFacts,
  driverStats,
  manualRaceNotes,
  transcriptUsed,
  raceNumber,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured in Vercel environment variables.');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const notesExcerpt = String(manualRaceNotes || '').trim().slice(0, 2500);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.65,
      max_tokens: 280,
      messages: [
        { role: 'system', content: POWER_RANKING_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Write ONE Power Rankings writeup paragraph for Race ${raceNumber}.

Rules (prompt version ${POWER_RANKING_PROMPT_VERSION}):
- 50-100 words, 2-4 sentences
- Do NOT start with the driver's name
- Use 1-3 verified facts from the list below
- Prefer recentRaceFinishes and last3RaceAverageFinish when available
- Explain WHY this driver is ranked here THIS week — not a season summary
- Avoid generic filler like "showing momentum" or "building confidence" without verified facts
- Do NOT invent race facts not listed below
${transcriptUsed ? '- Manual notes or transcript were available — only use supported facts.' : ''}

Driver: ${driverName}
Rank: ${rank}
Subtitle: ${subtitle}

Verified facts only:
${verifiedFacts}

Driver stats:
${driverStats}
${notesExcerpt ? `\nManual race notes:\n${notesExcerpt}` : ''}

Return only the writeup paragraph.`,
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI writeup generation failed (${response.status})`);
  }

  const content = String(data?.choices?.[0]?.message?.content || '')
    .trim()
    .replace(/^["']|["']$/g, '');

  if (!content) {
    throw new Error('OpenAI writeup generation returned an empty response.');
  }

  return content;
}

export async function loadPowerRankingsGenerationContext(raceNumber, manualRaceNotesRaw = '') {
  const settings = await getSettings();
  const [scheduleHtml, previousRankings, profiles] = await Promise.all([
    fetchHtml(settings.scheduleUrl),
    loadPreviousPowerRankings(raceNumber),
    getDriverProfiles(),
  ]);

  const scheduleRaces = parseScheduleRaces(scheduleHtml);
  const raceNumberDebug = buildRaceNumberDebug(scheduleRaces, raceNumber);
  const standingsResult = await fetchStandingsRows(settings, raceNumberDebug.standingsScheduleId);
  const standings = standingsResult.rows;

  if (!standings.length) {
    throw new Error('No standings data available for AI generation.');
  }

  raceNumberDebug.standingsScheduleIdUsed =
    standingsResult.scheduleId || raceNumberDebug.standingsScheduleId;

  const manualRaceNotes = normalizeManualRaceNotes(manualRaceNotesRaw);
  const driverLookup = buildDriverLookup(standings, profiles);
  const recentFormAnalysis = buildRecentFormAnalysis({
    scheduleRaces,
    raceNumber,
    standings,
    schedules: standingsResult.schedules,
    driverLookup,
  });

  const contextMeta = manualRaceNotes
    ? buildManualRaceContextMeta(manualRaceNotes, raceNumber)
    : applyYoutubeContextMeta(await loadBroadcastContext(raceNumber, standings.map((row) => ({
        driverId: row.driverId,
        driverName: row.driverName,
        carNumber: row.carNumber,
      }))));

  const recentResultsForGrounding = getRecentPointsRaceResults(scheduleRaces, raceNumber, 3).map(
    (race) => ({
      raceNumber: race.officialPointsRaceNumber,
      scheduleRow: race.scheduleRow,
      date: race.date,
      track: race.track,
      winner: race.winner,
    })
  );

  const factualGrounding = buildFactualGroundingContext({
    standings,
    scheduleRaces,
    raceNumber,
    schedules: standingsResult.schedules,
    driverLookup,
    recentResults: recentResultsForGrounding,
    manualRaceNotes,
    transcriptSummary: contextMeta.broadcastContext?.summary || '',
  });

  const alignedRaces = getAlignedRaceFinishes(
    scheduleRaces,
    raceNumber,
    standingsResult.schedules,
    driverLookup
  );

  const previousRankByDriver = Object.fromEntries(
    (previousRankings?.entries || []).map((entry) => [
      String(entry.driverId),
      Number(entry.rank),
    ])
  );

  return {
    raceNumber,
    settings,
    scheduleRaces,
    raceNumberDebug,
    standings,
    standingsResult,
    profiles,
    driverLookup,
    previousRankings,
    previousRankByDriver,
    recentFormAnalysis,
    contextMeta,
    factualGrounding,
    alignedRaces,
    recentResultsForGrounding,
    manualRaceNotes,
  };
}

export function buildWriteupContextForEntry(entry, driver, generationContext, previousRank) {
  return {
    transcriptUsed: generationContext.contextMeta?.transcriptUsed === true,
    transcriptMode: generationContext.contextMeta?.transcriptMode || 'none',
    previousRank,
    rank: entry.rank,
    entry,
    driverId: entry.driverId,
    driverGrounding: generationContext.factualGrounding?.drivers?.[String(entry.driverId)],
    factualGrounding: generationContext.factualGrounding?.drivers?.[String(entry.driverId)],
    alignedRaces: generationContext.alignedRaces || [],
    manualRaceNotes: generationContext.manualRaceNotes || '',
    transcriptSummary: generationContext.contextMeta?.broadcastContext?.summary || '',
    recentResults: generationContext.recentResultsForGrounding || [],
    driverLookup: generationContext.driverLookup,
  };
}

export async function repairWriteupQuality(entry, driver, context = {}) {
  let writeup = String(entry.writeup || '').trim();
  let repairAttempts = 0;
  let repairAttempted = false;
  const repairReasons = [];
  const unsupportedFactsDetected = [];
  let writeupResult = validateWriteup(writeup, driver, context);
  const verifiedFacts = formatVerifiedFactsForRepair(context.driverGrounding, entry.rank);

  while (
    writeupResult.error &&
    isRepairableWriteupError(writeupResult.errorType) &&
    repairAttempts < 2
  ) {
    repairAttempted = true;
    repairReasons.push(writeupResult.errorType);
    if (writeupResult.unsupportedFacts?.length) {
      unsupportedFactsDetected.push(...writeupResult.unsupportedFacts);
    }
    writeup = await callOpenAiWriteupRepair({
      writeup,
      driverName: driver.driverName,
      rank: entry.rank,
      subtitle: entry.subtitle,
      repairReason: writeupResult.error,
      driverStats: formatDriverStatsForRepair(driver, entry, context.previousRank),
      verifiedFacts,
      transcriptUsed: context.transcriptUsed === true,
    });
    writeup = String(writeup || '').trim();
    repairAttempts += 1;
    writeupResult = validateWriteup(writeup, driver, context);
  }

  return {
    writeup,
    writeupResult,
    repairAttempts,
    repairAttempted,
    repairReasons,
    unsupportedFactsDetected,
  };
}

function buildSourceQuality({
  standings,
  profiles,
  previousRankings,
  recentResultsRaceNumbers,
  contextMeta,
}) {
  const standingsUsed = standings.length > 0;
  const profilesUsed = profiles.length > 0;
  const previousRankingsUsed = Boolean(previousRankings?.entries?.length);
  const recentResultsUsed = recentResultsRaceNumbers.length > 0;
  const manualRaceNotesUsed = contextMeta.manualRaceNotesUsed === true;
  const youtubeTranscriptUsed =
    contextMeta.transcriptMode === 'youtube' && contextMeta.transcriptUsed === true;
  const hasTranscriptContext = manualRaceNotesUsed || youtubeTranscriptUsed;

  let dataQualityScore = 0;
  if (standingsUsed) dataQualityScore += 40;
  if (recentResultsUsed) dataQualityScore += 15;
  if (previousRankingsUsed) dataQualityScore += 15;
  if (profilesUsed) dataQualityScore += 5;
  if (manualRaceNotesUsed) dataQualityScore += 25;
  else if (youtubeTranscriptUsed) dataQualityScore += 20;
  dataQualityScore = Math.min(100, dataQualityScore);

  let confidenceScore = 'LOW';
  let confidenceReason = 'Limited source data available for generation.';

  if (hasTranscriptContext && standingsUsed && recentResultsUsed && previousRankingsUsed) {
    confidenceScore = 'HIGH';
    confidenceReason = manualRaceNotesUsed
      ? 'Standings, recent results, previous rankings, and manual race notes available.'
      : 'Standings, recent results, previous rankings, and YouTube transcript available.';
  } else if (standingsUsed && recentResultsUsed && previousRankingsUsed) {
    confidenceScore = 'MEDIUM';
    confidenceReason =
      'Standings, recent results, and previous rankings available. No transcript or manual notes.';
  } else if (standingsUsed && !recentResultsUsed && !previousRankingsUsed && !hasTranscriptContext) {
    confidenceScore = 'LOW';
    confidenceReason = 'Standings only — no recent results, previous rankings, or transcript context.';
  } else if (standingsUsed) {
    confidenceScore = 'LOW';
    const parts = ['Standings'];
    if (recentResultsUsed) parts.push('recent results');
    if (previousRankingsUsed) parts.push('previous rankings');
    if (hasTranscriptContext) parts.push('transcript/manual notes');
    confidenceReason = `${parts.join(', ')} available, but key sources are missing for high-confidence analysis.`;
  }

  return {
    confidenceScore,
    confidenceReason,
    dataQualityScore,
  };
}

function buildGenerationSources({
  raceNumber,
  standings,
  profiles,
  previousRankings,
  scheduleRaces,
  contextMeta,
  draft,
  raceNumberDebug,
  recentFormAnalysis,
  resultsAudit,
  recentRaceFinishDiagnostics,
}) {
  const recentResultsRaceNumbers = getRecentPointsRaceResults(
    scheduleRaces,
    raceNumber,
    3
  ).map((race) => race.officialPointsRaceNumber);

  const sourceQuality = buildSourceQuality({
    standings,
    profiles,
    previousRankings,
    recentResultsRaceNumbers,
    contextMeta,
  });

  return {
    promptVersion: POWER_RANKING_PROMPT_VERSION,
    standingsUsed: standings.length > 0,
    driverProfilesUsed: profiles.length > 0,
    previousRankingsUsed: Boolean(previousRankings?.entries?.length),
    previousRankingsRaceNumber: previousRankings?.raceNumber ?? null,
    recentResultsUsed: recentResultsRaceNumbers.length > 0,
    recentResultsRaceNumbers,
    manualRaceNotesUsed: contextMeta.manualRaceNotesUsed === true,
    manualRaceNotesLength: contextMeta.manualRaceNotesLength ?? 0,
    youtubeTranscriptUsed:
      contextMeta.transcriptMode === 'youtube' && contextMeta.transcriptUsed === true,
    transcriptMode: contextMeta.transcriptMode ?? 'none',
    selectedVideoTitle: contextMeta.selectedVideoTitle ?? null,
    selectedVideoRaceNumber: contextMeta.selectedVideoRaceNumber ?? null,
    transcriptDebugReason: contextMeta.transcriptDebugReason ?? null,
    movementSource: previousRankings?.entries?.length ? 'previous rankings' : 'defaulted',
    movementDiagnostics: draft.movementDiagnostics ?? {},
    repairedWriteupsCount: draft.repairedWriteupsCount ?? 0,
    repairedRanks: draft.repairedRanks ?? [],
    repairAttempted: draft.repairAttempted === true,
    repairFailedRanks: draft.repairFailedRanks ?? [],
    repairFailureReasons: draft.repairFailureReasons ?? {},
    repairedWriteupReasons: draft.repairedWriteupReasons ?? {},
    repairAttemptDetails: draft.repairAttemptDetails ?? {},
    writeupWarnings: draft.writeupWarnings ?? {},
    confidenceScore: sourceQuality.confidenceScore,
    confidenceReason: sourceQuality.confidenceReason,
    dataQualityScore: sourceQuality.dataQualityScore,
    raceNumberDebug: raceNumberDebug ?? buildRaceNumberDebug(scheduleRaces, raceNumber),
    recentWinners: (recentFormAnalysis?.last3RaceWinners || []).map(
      (driver) => driver?.driverName || driver
    ),
    backToBackWinners: (recentFormAnalysis?.backToBackWinners || []).map(
      (driver) => driver.driverName
    ),
    backToBackPodiumDrivers: (recentFormAnalysis?.backToBackPodiumDrivers || []).map(
      (driver) => driver.driverName
    ),
    multipleTop5Last3Drivers: (recentFormAnalysis?.multipleTop5Last3Drivers || []).map(
      (driver) => driver.driverName
    ),
    recentWinnersOutsideTop10: (recentFormAnalysis?.recentWinnersOutsideTop10 || []).map(
      (driver) => driver.driverName
    ),
    hotDriversOutsideTop10: (recentFormAnalysis?.hotDriversOutsideTop10 || []).map(
      (driver) => driver.driverName
    ),
    honorableMentionsGeneratedCount: draft.honorableMentions?.length ?? 0,
    recentResultsSentToModel: resultsAudit?.recentResultsSentToModel ?? null,
    recentRaceResultsUsed: resultsAudit?.recentRaceResultsUsed ?? [],
    auditDriverTrace: resultsAudit?.auditDriverTrace ?? [],
    rankedDriverFinishTrace: resultsAudit?.rankedDriverFinishTrace ?? [],
    promptDataGap: resultsAudit?.promptDataGap ?? null,
    alignedRaceTrace: resultsAudit?.alignedRaceTrace ?? [],
    unsupportedFactWarnings: draft.unsupportedFactWarnings ?? [],
    unsupportedFactRanks: draft.unsupportedFactRanks ?? [],
    unsupportedFactDetails: draft.unsupportedFactDetails ?? {},
    verifiedFactsUsed: draft.verifiedFactsUsed ?? {},
    verifiedFactsUsedCount: draft.verifiedFactsUsedCount ?? {},
    evidenceBasedWriteupsCount: draft.evidenceBasedWriteupsCount ?? 0,
    evidenceRepairRanks: draft.evidenceRepairRanks ?? [],
    recentRaceFinishesUsed: recentRaceFinishDiagnostics?.recentRaceFinishesUsed === true,
    last3RaceAverageFinish: recentRaceFinishDiagnostics?.last3RaceAverageFinish ?? {},
    recentRaceFinishCoverage: recentRaceFinishDiagnostics?.coverage ?? null,
    schedulesResultsSummary: recentRaceFinishDiagnostics?.schedulesResultsSummary ?? null,
    simRacerHubDataAudit: recentRaceFinishDiagnostics?.simRacerHubDataAudit ?? null,
    recentFormReferencedRanks: draft.recentFormReferencedRanks ?? [],
    averageFinishReferencedRanks: draft.averageFinishReferencedRanks ?? [],
    recentFinishReferencedRanks: draft.recentFinishReferencedRanks ?? [],
    prophetTakeGenerated: draft.prophetTakeGenerated === true,
    prophetTakeValidationError: draft.prophetTakeValidationError ?? null,
    prophetTakeValidationErrorType: draft.prophetTakeValidationErrorType ?? null,
    prophetTakeWarnings: draft.prophetTakeWarnings ?? [],
    prophetTakeRepairAttempted: draft.prophetTakeRepairAttempted === true,
    prophetTakeRepairAttempts: draft.prophetTakeRepairAttempts ?? 0,
    prophetTakeRepairReasons: draft.prophetTakeRepairReasons ?? [],
    prophetTakeVerifiedFactsUsed: draft.prophetTakeVerifiedFactsUsed ?? [],
    prophetTakeVerifiedFactsUsedCount: draft.prophetTakeVerifiedFactsUsedCount ?? 0,
    prophetTakeWordCount: draft.prophetTakeWordCount ?? null,
    prophetTakeParagraphCount: draft.prophetTakeParagraphCount ?? null,
    currentEasternTime: raceNumberDebug?.currentEasternTime ?? null,
    raceDate: raceNumberDebug?.raceDate ?? null,
    raceStatus: raceNumberDebug?.raceStatus ?? null,
    canAdvanceToNextRace: raceNumberDebug?.canAdvanceToNextRace ?? null,
    advanceReason: raceNumberDebug?.advanceReason ?? null,
  };
}

async function normalizeDraft(aiDraft, driverLookup, previousRankings, generationContext = {}) {
  const previousRankByDriver = Object.fromEntries(
    (previousRankings?.entries || []).map((entry) => [
      String(entry.driverId),
      Number(entry.rank),
    ])
  );

  const entries = Array.isArray(aiDraft?.entries) ? aiDraft.entries : [];
  if (entries.length !== 10) {
    throw new Error('AI draft must include exactly 10 ranked drivers.');
  }

  const usedDrivers = new Set();
  const usedSubtitles = new Set();
  const normalizedEntries = [];
  const warnings = [];
  const repairedRanks = [];
  const repairFailedRanks = [];
  const repairFailureReasons = {};
  const repairedWriteupReasons = {};
  const unsupportedFactWarnings = [];
  const unsupportedFactRanks = [];
  const unsupportedFactDetails = {};
  let repairAttempted = false;
  const writeupWarnings = {};
  const repairAttemptDetails = {};

  for (let rank = 1; rank <= 10; rank += 1) {
    writeupWarnings[String(rank)] = [];
  }

  const verifiedFactsUsed = {};
  const verifiedFactsUsedCount = {};
  const evidenceRepairRanks = [];
  const recentFormReferencedRanks = [];
  const averageFinishReferencedRanks = [];
  const recentFinishReferencedRanks = [];
  let evidenceBasedWriteupsCount = 0;

  const buildWriteupContext = (entry, driver, previousRank) => ({
    transcriptUsed: generationContext.transcriptUsed === true,
    transcriptMode: generationContext.transcriptMode || 'none',
    previousRank,
    rank: entry.rank,
    entry,
    driverId: entry.driverId,
    driverGrounding: generationContext.factualGrounding?.drivers?.[String(entry.driverId)],
    factualGrounding: generationContext.factualGrounding?.drivers?.[String(entry.driverId)],
    alignedRaces: generationContext.alignedRaces || [],
    manualRaceNotes: generationContext.manualRaceNotes || '',
    transcriptSummary: generationContext.transcriptSummary || '',
    recentResults: generationContext.recentResults || [],
    driverLookup: generationContext.driverLookup,
  });

  const hasPreviousRankings = Boolean(previousRankings?.entries?.length);
  const movementDiagnostics = {};

  for (let expectedRank = 1; expectedRank <= 10; expectedRank += 1) {
    const raw =
      entries.find((entry) => Number(entry.rank) === expectedRank) || entries[expectedRank - 1];

    const driverId = String(raw?.driverId || raw?.driver_id || '').trim();
    if (!driverId || !driverLookup.has(driverId)) {
      throw new Error(`AI draft rank ${expectedRank} has an invalid driverId.`);
    }
    if (usedDrivers.has(driverId)) {
      throw new Error(`AI draft duplicate driver at rank ${expectedRank}.`);
    }

    usedDrivers.add(driverId);
    const driver = driverLookup.get(driverId);
    const previousRank = previousRankByDriver[driverId];
    const movementResult = computeMovement({
      previousRank,
      currentRank: expectedRank,
      hasPreviousRankings,
    });

    movementDiagnostics[String(expectedRank)] = {
      movementSource: movementResult.movementSource,
      previousRank: movementResult.previousRank,
      currentRank: movementResult.currentRank,
      movementType: movementResult.movementType,
    };

    normalizedEntries.push({
      rank: expectedRank,
      driverId,
      driverName: driver.driverName,
      movement: movementResult.movement,
      movementType: movementResult.movementType,
      movementText: movementResult.movementText,
      movementClass: movementResult.movementClass,
      subtitle: String(raw?.subtitle || '').trim(),
      writeup: String(raw?.writeup || '').trim(),
    });
  }

  for (const entry of normalizedEntries) {
    const driver = driverLookup.get(entry.driverId);
    const previousRank = previousRankByDriver[entry.driverId];
    const writeupContext = buildWriteupContext(entry, driver, previousRank);

    const repaired = await repairWriteupQuality(entry, driver, writeupContext);
    entry.writeup = repaired.writeup;

    if (repaired.repairAttempted) {
      repairAttempted = true;
    }

    if (repaired.unsupportedFactsDetected?.length) {
      unsupportedFactRanks.push(entry.rank);
      unsupportedFactDetails[String(entry.rank)] = repaired.unsupportedFactsDetected;
      unsupportedFactWarnings.push(
        `Rank ${entry.rank}: unsupported factual claims repaired (${repaired.unsupportedFactsDetected
          .map((fact) => fact.type)
          .join(', ')}).`
      );
    }

    if (repaired.writeupResult.error) {
      repairFailedRanks.push(entry.rank);
      repairFailureReasons[String(entry.rank)] = repaired.writeupResult.error;
      repairAttemptDetails[String(entry.rank)] = {
        repairAttempted: repaired.repairAttempted === true,
        repairAttempts: repaired.repairAttempts,
        repairReasons: [...(repaired.repairReasons || [])],
        finalErrorType: repaired.writeupResult.errorType || null,
        finalError: repaired.writeupResult.error,
      };
      writeupWarnings[String(entry.rank)] = buildWriteupWarnings(repaired);
      warnings.push(
        `Rank ${entry.rank}: writeup has validation warnings — review or use Regenerate Writeup.`
      );
    } else {
      writeupWarnings[String(entry.rank)] = buildWriteupWarnings(repaired);
    }

    if (repaired.repairAttempts > 0) {
      repairedRanks.push(entry.rank);
      repairedWriteupReasons[String(entry.rank)] = repaired.repairReasons;
      repairAttemptDetails[String(entry.rank)] = {
        ...(repairAttemptDetails[String(entry.rank)] || {}),
        repairAttempted: true,
        repairAttempts: repaired.repairAttempts,
        repairReasons: [...(repaired.repairReasons || [])],
        repairedSuccessfully: !repaired.writeupResult.error,
      };
    }

    if (
      repaired.repairReasons.some((reason) => EVIDENCE_REPAIR_ERROR_TYPES.has(reason))
    ) {
      evidenceRepairRanks.push(entry.rank);
    }

    const rankKey = String(entry.rank);
    verifiedFactsUsed[rankKey] = repaired.writeupResult.verifiedFactsUsed || [];
    verifiedFactsUsedCount[rankKey] = repaired.writeupResult.verifiedFactsUsedCount ?? 0;
    if ((repaired.writeupResult.verifiedFactsUsedCount ?? 0) >= 1) {
      evidenceBasedWriteupsCount += 1;
    }

    const recentFormRefs = analyzeRecentFormReferences(entry.writeup, writeupContext);
    if (recentFormRefs.recentFormReferenced) recentFormReferencedRanks.push(entry.rank);
    if (recentFormRefs.averageFinishReferenced) averageFinishReferencedRanks.push(entry.rank);
    if (recentFormRefs.recentFinishReferenced) recentFinishReferencedRanks.push(entry.rank);

    for (const warning of repaired.writeupResult.warnings) {
      warnings.push(`Rank ${entry.rank}: ${warning}`);
    }

    const subtitleError = validateSubtitle(entry.subtitle, driver, usedSubtitles);
    if (subtitleError) {
      throw new Error(`AI draft rank ${entry.rank} subtitle rejected: ${subtitleError}`);
    }
    usedSubtitles.add(entry.subtitle.toLowerCase());
  }

  const honorableMentions = [];
  for (const mention of (Array.isArray(aiDraft?.honorableMentions) ? aiDraft.honorableMentions : []).slice(0, 3)) {
    const driverId = String(mention?.driverId || mention?.driver_id || '').trim();
    if (!driverId || !driverLookup.has(driverId) || usedDrivers.has(driverId)) {
      continue;
    }

    const driver = driverLookup.get(driverId);
    const mentionEntry = {
      rank: 'HM',
      driverId,
      subtitle: '',
      writeup: String(mention?.writeup || '').trim(),
    };
    const repairedMention = await repairWriteupQuality(
      mentionEntry,
      driver,
      buildWriteupContext(mentionEntry, driver, previousRankByDriver[driverId])
    );

    if (repairedMention.unsupportedFactsDetected?.length) {
      unsupportedFactRanks.push('HM');
      unsupportedFactDetails.HM = [
        ...(unsupportedFactDetails.HM || []),
        ...repairedMention.unsupportedFactsDetected.map((fact) => ({
          ...fact,
          driverName: driver.driverName,
        })),
      ];
      unsupportedFactWarnings.push(
        `Honorable mention (${driver.driverName}): unsupported factual claims repaired.`
      );
    }

    if (repairedMention.writeupResult.error) {
      const hmKey = `HM:${driverId}`;
      repairFailedRanks.push(hmKey);
      repairFailureReasons[hmKey] = repairedMention.writeupResult.error;
      repairAttemptDetails[hmKey] = {
        repairAttempted: repairedMention.repairAttempted === true,
        repairAttempts: repairedMention.repairAttempts,
        repairReasons: [...(repairedMention.repairReasons || [])],
        finalErrorType: repairedMention.writeupResult.errorType || null,
        finalError: repairedMention.writeupResult.error,
      };
      writeupWarnings[hmKey] = buildWriteupWarnings(repairedMention);
      warnings.push(
        `Honorable mention (${driver.driverName}): writeup has validation warnings — review or edit manually.`
      );
    } else {
      writeupWarnings[`HM:${driverId}`] = buildWriteupWarnings(repairedMention);
    }

    const hmKey = `HM:${driverId}`;
    verifiedFactsUsed[hmKey] = repairedMention.writeupResult.verifiedFactsUsed || [];
    verifiedFactsUsedCount[hmKey] = repairedMention.writeupResult.verifiedFactsUsedCount ?? 0;
    if ((repairedMention.writeupResult.verifiedFactsUsedCount ?? 0) >= 1) {
      evidenceBasedWriteupsCount += 1;
    }
    if (
      repairedMention.repairReasons.some((reason) => EVIDENCE_REPAIR_ERROR_TYPES.has(reason))
    ) {
      evidenceRepairRanks.push(hmKey);
    }

    honorableMentions.push({
      driverId,
      driverName: driver.driverName,
      writeup: repairedMention.writeup,
    });
  }

  warnings.push(...validateRecentFormCoverage(normalizedEntries, honorableMentions, generationContext.recentFormAnalysis));

  return {
    entries: normalizedEntries,
    honorableMentions,
    warnings,
    repairAttempted,
    repairedWriteupsCount: repairedRanks.length,
    repairedRanks,
    repairFailedRanks,
    repairFailureReasons,
    repairedWriteupReasons,
    repairAttemptDetails,
    writeupWarnings,
    unsupportedFactWarnings,
    unsupportedFactRanks,
    unsupportedFactDetails,
    verifiedFactsUsed,
    verifiedFactsUsedCount,
    evidenceBasedWriteupsCount,
    evidenceRepairRanks,
    recentFormReferencedRanks,
    averageFinishReferencedRanks,
    recentFinishReferencedRanks,
    movementDiagnostics,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = parseBody(req);

    if (body.password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Bad password' });
    }

    const raceNumber = Number(body.raceNumber ?? body.race_number);
    if (!Number.isInteger(raceNumber) || raceNumber < 1) {
      return res.status(400).json({ error: 'Valid race number is required.' });
    }

    const manualRaceNotes = normalizeManualRaceNotes(
      body.manualRaceNotes ?? body.manual_race_notes
    );

    const generationContext = await loadPowerRankingsGenerationContext(
      raceNumber,
      manualRaceNotes
    );
    const {
      settings,
      scheduleRaces,
      raceNumberDebug,
      standings,
      standingsResult,
      profiles,
      driverLookup,
      previousRankings,
      recentFormAnalysis,
      contextMeta,
      factualGrounding,
      alignedRaces,
      recentResultsForGrounding,
    } = generationContext;

    raceNumberDebug.standingsUsedLatestCompletedFallback =
      !raceNumberDebug.standingsScheduleId && Boolean(standingsResult.scheduleId);

    const actualStandingsRace = getPointsRaceByScheduleId(
      scheduleRaces,
      raceNumberDebug.standingsScheduleIdUsed
    );
    raceNumberDebug.standingsDataRaceNumber =
      actualStandingsRace?.officialPointsRaceNumber ?? null;
    raceNumberDebug.usingFutureStandings =
      raceNumberDebug.standingsDataRaceNumber != null &&
      raceNumberDebug.standingsDataRaceNumber > raceNumber;

    if (raceNumberDebug.usingFutureStandings) {
      console.warn(
        '[power-rankings-generate] standings snapshot includes future race data',
        JSON.stringify({
          requestedRaceNumber: raceNumberDebug.requestedRaceNumber,
          standingsRaceNumber: raceNumberDebug.standingsRaceNumber,
          standingsDataRaceNumber: raceNumberDebug.standingsDataRaceNumber,
          latestCompletedRaceNumber: raceNumberDebug.latestCompletedRaceNumber,
          standingsScheduleIdUsed: raceNumberDebug.standingsScheduleIdUsed,
        })
      );
    }

    const drivers = standings.map((row) => ({
      driverId: row.driverId,
      driverName: row.driverName,
      carNumber: row.carNumber,
    }));

    const contextPayload = buildContextPayload({
      raceNumber,
      standings,
      scheduleRaces,
      previousRankings,
      profiles,
      broadcastContext: contextMeta.broadcastContext,
      transcriptUsed: contextMeta.transcriptUsed,
      transcriptMode: contextMeta.transcriptMode,
      manualRaceNotes: manualRaceNotes || null,
      standingsSnapshot: {
        raceNumber: raceNumberDebug.standingsRaceNumber,
        snapshotDate: raceNumberDebug.standingsSnapshotDate,
        scheduleId: raceNumberDebug.standingsScheduleIdUsed,
        track: raceNumberDebug.standingsTrack,
        frozenToRequestedRace: raceNumberDebug.standingsFrozenToRequestedRace === true,
      },
      recentFormAnalysis,
      factualGrounding,
    });

    const resultsAudit = buildRecentResultsAudit({
      scheduleRaces,
      raceNumber,
      standings,
      schedules: standingsResult.schedules,
      driverLookup,
      recentResults: contextPayload.recentResults,
      recentFormAnalysis,
      contextPayload,
      standingsScheduleId: raceNumberDebug.standingsScheduleIdUsed,
    });

    console.log(
      '[power-rankings-generate] recent-results payload sent to model',
      JSON.stringify(resultsAudit.recentResultsSentToModel)
    );
    console.log(
      '[power-rankings-generate] recent-results audit summary',
      JSON.stringify({
        standingsScheduleIdUsed: resultsAudit.standingsScheduleIdUsed,
        schedulesApiRaceCount: resultsAudit.schedulesApiRaceCount,
        alignedRaceTrace: resultsAudit.alignedRaceTrace,
        promptDataGap: resultsAudit.promptDataGap,
        auditDriverTrace: resultsAudit.auditDriverTrace,
      })
    );

    const aiDraft = await callOpenAi(contextPayload);
    const existingWeek = await loadExistingWeekForRace(raceNumber);
    const draft = await normalizeDraft(aiDraft, driverLookup, previousRankings, {
      transcriptUsed: contextMeta.transcriptUsed,
      transcriptMode: contextMeta.transcriptMode,
      recentFormAnalysis,
      factualGrounding,
      alignedRaces,
      manualRaceNotes,
      transcriptSummary: contextMeta.broadcastContext?.summary || '',
      recentResults: recentResultsForGrounding,
      driverLookup,
    });

    const prophetTakeResult = await generateProphetTake(
      {
        raceNumber,
        standings,
        recentFormAnalysis,
        factualGrounding,
        alignedRaces,
        manualRaceNotes,
        transcriptSummary: contextMeta.broadcastContext?.summary || '',
        recentResultsForGrounding,
        driverLookup,
        transcriptUsed: contextMeta.transcriptUsed,
      },
      draft.entries
    );

    Object.assign(draft, prophetTakeResult);

    if (prophetTakeResult.prophetTakeValidationError) {
      console.log(
        '[power-rankings-generate] prophet take validation',
        JSON.stringify({
          error: prophetTakeResult.prophetTakeValidationError,
          errorType: prophetTakeResult.prophetTakeValidationErrorType,
          repairAttempts: prophetTakeResult.prophetTakeRepairAttempts,
          verifiedFactsUsedCount: prophetTakeResult.prophetTakeVerifiedFactsUsedCount,
        })
      );
    }

    resultsAudit.rankedDriverFinishTrace = buildRankedDriverFinishTrace(
      draft.entries,
      draft.honorableMentions,
      resultsAudit
    );

    console.log(
      '[power-rankings-generate] ranked driver finish trace',
      JSON.stringify(resultsAudit.rankedDriverFinishTrace)
    );

    if (draft.unsupportedFactWarnings?.length) {
      console.log(
        '[power-rankings-generate] unsupported factual claims diagnostics',
        JSON.stringify({
          unsupportedFactWarnings: draft.unsupportedFactWarnings,
          unsupportedFactRanks: draft.unsupportedFactRanks,
          unsupportedFactDetails: draft.unsupportedFactDetails,
        })
      );
    }

    console.log(
      '[power-rankings-generate] verified evidence diagnostics',
      JSON.stringify({
        evidenceBasedWriteupsCount: draft.evidenceBasedWriteupsCount,
        evidenceRepairRanks: draft.evidenceRepairRanks,
        verifiedFactsUsedCount: draft.verifiedFactsUsedCount,
      })
    );

    const recentRaceFinishDiagnostics = buildRecentRaceFinishDiagnostics(
      factualGrounding,
      draft.entries
    );

    console.log(
      '[power-rankings-generate] recent race finish diagnostics',
      JSON.stringify({
        recentRaceFinishesUsed: recentRaceFinishDiagnostics.recentRaceFinishesUsed,
        coverage: recentRaceFinishDiagnostics.coverage,
        schedulesResultsSummary: recentRaceFinishDiagnostics.schedulesResultsSummary,
      })
    );

    const generationSources = buildGenerationSources({
      raceNumber,
      standings,
      profiles,
      previousRankings,
      scheduleRaces,
      contextMeta,
      draft,
      raceNumberDebug,
      recentFormAnalysis,
      resultsAudit,
      recentRaceFinishDiagnostics,
    });

    console.log(
      '[power-rankings-generate] race number debug',
      JSON.stringify(raceNumberDebug)
    );

    console.log(
      '[power-rankings-generate] standings snapshot debug',
      JSON.stringify({
        requestedRaceNumber: raceNumberDebug.requestedRaceNumber,
        standingsRaceNumber: raceNumberDebug.standingsRaceNumber,
        standingsSnapshotDate: raceNumberDebug.standingsSnapshotDate,
        statsRaceNumber: raceNumberDebug.statsRaceNumber,
        latestCompletedRaceNumber: raceNumberDebug.latestCompletedRaceNumber,
        currentRaceName: raceNumberDebug.currentRaceName,
        standingsScheduleId: raceNumberDebug.standingsScheduleIdUsed,
        standingsFrozenToRequestedRace: raceNumberDebug.standingsFrozenToRequestedRace === true,
        standingsDataRaceNumber: raceNumberDebug.standingsDataRaceNumber,
        usingFutureStandings: raceNumberDebug.usingFutureStandings === true,
      })
    );

    console.log(
      '[power-rankings-generate] transcript diagnostics',
      JSON.stringify(contextMeta.transcriptDiagnostics || {
        transcriptDebugReason: contextMeta.transcriptDebugReason ?? null,
        transcriptUsed: contextMeta.transcriptUsed === true,
        transcriptMode: contextMeta.transcriptMode ?? null,
        manualRaceNotesUsed: contextMeta.manualRaceNotesUsed === true,
        manualRaceNotesLength: contextMeta.manualRaceNotesLength ?? 0,
        selectedVideoTitle: contextMeta.selectedVideoTitle ?? null,
        selectedVideoRaceNumber: contextMeta.selectedVideoRaceNumber ?? null,
        selectionMethod: contextMeta.selectionMethod ?? null,
        transcriptLength: contextMeta.transcriptLength ?? 0,
        requestedRaceNumber: contextMeta.requestedRaceNumber ?? raceNumber,
      })
    );

    return res.status(200).json({
      promptVersion: POWER_RANKING_PROMPT_VERSION,
      raceNumber,
      generatedAt: new Date().toISOString(),
      previousRaceNumber: previousRankings?.raceNumber || null,
      existingWeekId: existingWeek?.id || null,
      existingPublishedDate: existingWeek?.published_date || null,
      existingPublished: existingWeek?.published === true,
      ...draft,
      generationSources,
      recentRaceFinishesUsed: recentRaceFinishDiagnostics.recentRaceFinishesUsed,
      last3RaceAverageFinish: recentRaceFinishDiagnostics.last3RaceAverageFinish,
      raceNumberDebug,
      resultsAudit,
      confidenceScore: generationSources.confidenceScore,
      confidenceReason: generationSources.confidenceReason,
      dataQualityScore: generationSources.dataQualityScore,
      transcriptDiagnostics: contextMeta.transcriptDiagnostics,
      transcriptUsed: contextMeta.transcriptUsed,
      transcriptMode: contextMeta.transcriptMode ?? null,
      manualRaceNotesUsed: contextMeta.manualRaceNotesUsed === true,
      manualRaceNotesLength: contextMeta.manualRaceNotesLength ?? 0,
      transcriptDebugReason: contextMeta.transcriptDebugReason ?? null,
      transcriptVideoTitle: contextMeta.transcriptVideoTitle,
      transcriptLength: contextMeta.transcriptLength,
      requestedRaceNumber: contextMeta.requestedRaceNumber,
      selectedVideoRaceNumber: contextMeta.selectedVideoRaceNumber,
      selectedVideoTitle: contextMeta.selectedVideoTitle,
      selectionMethod: contextMeta.selectionMethod,
      nonPointsAdjustmentApplied: contextMeta.nonPointsAdjustmentApplied,
    });
  } catch (error) {
    console.error('[power-rankings-generate]', error);
    const payload = { error: error.message || 'AI draft generation failed.' };
    if (error.repairDiagnostics) {
      Object.assign(payload, error.repairDiagnostics);
    }
    return res.status(500).json(payload);
  }
}
