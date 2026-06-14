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

Use prompt version ${POWER_RANKING_PROMPT_VERSION} rules: ranking justifications with at least two evidence points, no season summaries, no generic filler, NASCAR.com editorial tone.

Standings and driver stats in this payload are frozen to standingsSnapshot.raceNumber. Do not reference wins, points, or results from races after Race ${contextPayload.raceNumber}.
Only use recentResults and transcript/manual notes for race context through Race ${contextPayload.raceNumber}.

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
  'shows promise',
  'one to watch',
  'could surprise people',
  'has potential',
  'looking for a breakthrough',
  'remains competitive',
  'continues to improve',
  'steady performer',
  'consistent contender',
];

const REPAIRABLE_WRITEUP_ERROR_TYPES = new Set([
  'name-first-opening',
  'insufficient-evidence',
  'generic-language',
  'season-summary',
  'too-generic',
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

function validateWriteup(writeup, driver, context = {}) {
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

  const evidenceCount = countWriteupEvidencePoints(text);
  if (evidenceCount < 2) {
    return {
      error: `Writeup needs at least two concrete evidence points (found ${evidenceCount}).`,
      errorType: 'insufficient-evidence',
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

  return { error: null, errorType: null, warnings };
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

function formatDriverStatsForRepair(driver, entry, previousRank) {
  const parts = [];
  if (entry?.rank) parts.push(`Power rank: ${entry.rank}`);
  if (previousRank) parts.push(`Previous power rank: ${previousRank}`);
  if (Number.isFinite(entry?.movement)) {
    if (entry.movement > 0) parts.push(`Movement: up ${entry.movement}`);
    else if (entry.movement < 0) parts.push(`Movement: down ${Math.abs(entry.movement)}`);
    else parts.push('Movement: unchanged');
  }
  if (driver?.position) parts.push(`Points position: ${driver.position}`);
  if (driver?.previousPosition && driver.previousPosition !== driver.position) {
    parts.push(`Previous points position: ${driver.previousPosition}`);
  }
  if (Number.isFinite(driver?.wins)) parts.push(`Wins: ${driver.wins}`);
  if (Number.isFinite(driver?.top5)) parts.push(`Top 5s: ${driver.top5}`);
  if (Number.isFinite(driver?.top10)) parts.push(`Top 10s: ${driver.top10}`);
  if (Number.isFinite(driver?.points)) parts.push(`Points: ${driver.points}`);
  return parts.join('\n');
}

async function callOpenAiWriteupRepair({
  writeup,
  driverName,
  rank,
  subtitle,
  repairReason,
  driverStats,
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
- Include at least TWO concrete evidence points (stats, finishes, movement, race context).
- Avoid generic filler unless immediately backed by specific evidence.
- Do not use unsupported phrases like "shows promise" or "steady performer".
${transcriptUsed ? '- Transcript/manual race notes were available — include race-specific context.' : ''}

Driver: ${driverName}
Rank: ${rank}
Subtitle: ${subtitle}
Repair reason: ${repairReason}

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

async function repairWriteupQuality(entry, driver, context = {}) {
  let writeup = String(entry.writeup || '').trim();
  let repairAttempts = 0;
  let repairAttempted = false;
  const repairReasons = [];
  let writeupResult = validateWriteup(writeup, driver, context);

  while (
    writeupResult.error &&
    isRepairableWriteupError(writeupResult.errorType) &&
    repairAttempts < 2
  ) {
    repairAttempted = true;
    repairReasons.push(writeupResult.errorType);
    writeup = await callOpenAiWriteupRepair({
      writeup,
      driverName: driver.driverName,
      rank: entry.rank,
      subtitle: entry.subtitle,
      repairReason: writeupResult.error,
      driverStats: formatDriverStatsForRepair(driver, entry, context.previousRank),
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
    repairedWriteupsCount: draft.repairedWriteupsCount ?? 0,
    repairedRanks: draft.repairedRanks ?? [],
    repairAttempted: draft.repairAttempted === true,
    repairFailedRanks: draft.repairFailedRanks ?? [],
    repairFailureReasons: draft.repairFailureReasons ?? {},
    repairedWriteupReasons: draft.repairedWriteupReasons ?? {},
    confidenceScore: sourceQuality.confidenceScore,
    confidenceReason: sourceQuality.confidenceReason,
    dataQualityScore: sourceQuality.dataQualityScore,
    raceNumberDebug: raceNumberDebug ?? buildRaceNumberDebug(scheduleRaces, raceNumber),
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
  let repairAttempted = false;

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
    let movement = Number(raw?.movement);
    if (!Number.isFinite(movement)) movement = 0;

    if (previousRank) {
      movement = previousRank - expectedRank;
    } else if (previousRankings) {
      movement = movement || 0;
    }

    normalizedEntries.push({
      rank: expectedRank,
      driverId,
      driverName: driver.driverName,
      movement,
      subtitle: String(raw?.subtitle || '').trim(),
      writeup: String(raw?.writeup || '').trim(),
    });
  }

  for (const entry of normalizedEntries) {
    const driver = driverLookup.get(entry.driverId);
    const previousRank = previousRankByDriver[entry.driverId];
    const writeupContext = {
      transcriptUsed: generationContext.transcriptUsed === true,
      transcriptMode: generationContext.transcriptMode || 'none',
      previousRank,
    };

    const repaired = await repairWriteupQuality(entry, driver, writeupContext);
    entry.writeup = repaired.writeup;

    if (repaired.repairAttempted) {
      repairAttempted = true;
    }

    if (repaired.writeupResult.error) {
      if (repaired.repairAttempted && isRepairableWriteupError(repaired.writeupResult.errorType)) {
        repairFailedRanks.push(entry.rank);
        repairFailureReasons[String(entry.rank)] = repaired.writeupResult.error;
        const repairError = new Error(
          `Rank ${entry.rank} writeup repair failed after ${repaired.repairAttempts} attempts.`
        );
        repairError.repairDiagnostics = {
          repairAttempted: true,
          repairedWriteupsCount: repairedRanks.length,
          repairedRanks: [...repairedRanks],
          repairFailedRanks: [...repairFailedRanks],
          repairFailureReasons: { ...repairFailureReasons },
          repairedWriteupReasons: { ...repairedWriteupReasons },
        };
        throw repairError;
      }
      throw new Error(
        `AI draft rank ${entry.rank} writeup rejected: ${repaired.writeupResult.error}`
      );
    }

    if (repaired.repairAttempts > 0) {
      repairedRanks.push(entry.rank);
      repairedWriteupReasons[String(entry.rank)] = repaired.repairReasons;
    }

    for (const warning of repaired.writeupResult.warnings) {
      warnings.push(`Rank ${entry.rank}: ${warning}`);
    }

    const subtitleError = validateSubtitle(entry.subtitle, driver, usedSubtitles);
    if (subtitleError) {
      throw new Error(`AI draft rank ${entry.rank} subtitle rejected: ${subtitleError}`);
    }
    usedSubtitles.add(entry.subtitle.toLowerCase());
  }

  const honorableMentions = (Array.isArray(aiDraft?.honorableMentions)
    ? aiDraft.honorableMentions
    : []
  )
    .slice(0, 3)
    .map((mention) => {
      const driverId = String(mention?.driverId || mention?.driver_id || '').trim();
      if (!driverId || !driverLookup.has(driverId) || usedDrivers.has(driverId)) {
        return null;
      }
      return {
        driverId,
        driverName: driverLookup.get(driverId).driverName,
        writeup: String(mention?.writeup || '').trim(),
      };
    })
    .filter(Boolean);

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

    const settings = await getSettings();
    const [scheduleHtml, previousRankings, profiles, existingWeek] = await Promise.all([
      fetchHtml(settings.scheduleUrl),
      loadPreviousPowerRankings(raceNumber),
      getDriverProfiles(),
      loadExistingWeekForRace(raceNumber),
    ]);

    const scheduleRaces = parseScheduleRaces(scheduleHtml);
    const raceNumberDebug = buildRaceNumberDebug(scheduleRaces, raceNumber);

    const standingsResult = await fetchStandingsRows(
      settings,
      raceNumberDebug.standingsScheduleId
    );
    const standings = standingsResult.rows;

    if (!standings.length) {
      return res.status(400).json({ error: 'No standings data available for AI generation.' });
    }

    raceNumberDebug.standingsScheduleIdUsed =
      standingsResult.scheduleId || raceNumberDebug.standingsScheduleId;
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

    const manualRaceNotes = normalizeManualRaceNotes(
      body.manualRaceNotes ?? body.manual_race_notes
    );

    const contextMeta = manualRaceNotes
      ? buildManualRaceContextMeta(manualRaceNotes, raceNumber)
      : applyYoutubeContextMeta(await loadBroadcastContext(raceNumber, drivers));

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
    });

    const aiDraft = await callOpenAi(contextPayload);
    const driverLookup = buildDriverLookup(standings, profiles);
    const draft = await normalizeDraft(aiDraft, driverLookup, previousRankings, {
      transcriptUsed: contextMeta.transcriptUsed,
      transcriptMode: contextMeta.transcriptMode,
    });
    const generationSources = buildGenerationSources({
      raceNumber,
      standings,
      profiles,
      previousRankings,
      scheduleRaces,
      contextMeta,
      draft,
      raceNumberDebug,
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
      raceNumberDebug,
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
