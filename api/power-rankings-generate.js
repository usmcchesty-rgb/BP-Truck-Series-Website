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

        const winner = cleanText(
          cells.eq(6).find('a').first().text() || cells.eq(6).text()
        );

        races.push({
          raceNumber: Number(raceNumber),
          date: cleanText(cells.eq(1).text()),
          track: cleanText(cells.eq(4).find('a').first().text() || cells.eq(4).text()),
          winner: winner || null,
        });
      });
  });

  return races;
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

async function fetchStandingsRows(settings) {
  const seasonId = settings.seasonId || '27987';
  const scheduleId = await detectLatestScheduleId(settings);

  const response = await fetch(
    `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${scheduleId}`,
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

  return Object.values(data.rps || {})
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
}) {
  const completedRaces = scheduleRaces
    .filter((race) => race.winner && race.raceNumber <= raceNumber)
    .slice(-3);

  const recentResults = completedRaces.map((race) => ({
    raceNumber: race.raceNumber,
    date: race.date,
    track: race.track,
    winner: race.winner,
  }));

  return {
    raceNumber,
    season: 'Blazing Pedals Truck Series',
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
    transcriptUsed: transcriptUsed === true,
    transcriptMode: transcriptUsed
      ? 'transcript_available'
      : 'no_transcript_use_stats_only',
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

transcriptUsed: ${contextPayload.transcriptUsed === true}
If transcriptUsed is false, follow the No-Transcript Fallback rules. Do not invent race incidents or broadcast storylines.

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

function validateWriteup(writeup, driver) {
  const text = String(writeup || '').trim();
  const warnings = [];

  if (!text) {
    return { error: 'Writeup is required.', warnings };
  }

  const words = countWords(text);
  if (words < 30) {
    return {
      error: `Writeup is too short (${words} words; minimum 30).`,
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
      warnings,
    };
  }

  for (const token of getDriverNameTokens(driver?.driverName)) {
    if (new RegExp(`^${token}\\b`, 'i').test(firstLower.replace(/[^a-z0-9\s']/g, ' '))) {
      return { error: 'Writeup should not start with the driver\'s name.', warnings };
    }
    if (
      new RegExp(`\\b${token}\\s+(is|continues|has|remains|sits|enters)\\b`, 'i').test(
        firstSentence
      )
    ) {
      return {
        error: 'Writeup cannot open with "[Name] is/continues/has/remains/sits/enters".',
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

  return { error: null, warnings };
}

function normalizeDraft(aiDraft, driverLookup, previousRankings) {
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

    const writeupResult = validateWriteup(entry.writeup, driver);
    if (writeupResult.error) {
      throw new Error(`AI draft rank ${entry.rank} writeup rejected: ${writeupResult.error}`);
    }
    for (const warning of writeupResult.warnings) {
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
    const [standings, scheduleHtml, previousRankings, profiles, existingWeek] = await Promise.all([
      fetchStandingsRows(settings),
      fetchHtml(settings.scheduleUrl),
      loadPreviousPowerRankings(raceNumber),
      getDriverProfiles(),
      loadExistingWeekForRace(raceNumber),
    ]);

    if (!standings.length) {
      return res.status(400).json({ error: 'No standings data available for AI generation.' });
    }

    const drivers = standings.map((row) => ({
      driverId: row.driverId,
      driverName: row.driverName,
      carNumber: row.carNumber,
    }));

    const scheduleRaces = parseScheduleRaces(scheduleHtml);
    const transcriptMeta = await loadBroadcastContext(raceNumber, drivers);
    const contextPayload = buildContextPayload({
      raceNumber,
      standings,
      scheduleRaces,
      previousRankings,
      profiles,
      broadcastContext: transcriptMeta.broadcastContext,
      transcriptUsed: transcriptMeta.transcriptUsed,
    });

    const aiDraft = await callOpenAi(contextPayload);
    const driverLookup = buildDriverLookup(standings, profiles);
    const draft = normalizeDraft(aiDraft, driverLookup, previousRankings);

    console.log(
      '[power-rankings-generate] transcript diagnostics',
      JSON.stringify(transcriptMeta.transcriptDiagnostics || {
        transcriptDebugReason: transcriptMeta.transcriptDebugReason ?? null,
        transcriptUsed: transcriptMeta.transcriptUsed === true,
        selectedVideoTitle: transcriptMeta.selectedVideoTitle ?? null,
        selectedVideoRaceNumber: transcriptMeta.selectedVideoRaceNumber ?? null,
        selectionMethod: transcriptMeta.selectionMethod ?? null,
        transcriptLength: transcriptMeta.transcriptLength ?? 0,
        requestedRaceNumber: transcriptMeta.requestedRaceNumber ?? raceNumber,
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
      transcriptDiagnostics: transcriptMeta.transcriptDiagnostics,
      transcriptUsed: transcriptMeta.transcriptUsed,
      transcriptDebugReason: transcriptMeta.transcriptDebugReason ?? null,
      transcriptVideoTitle: transcriptMeta.transcriptVideoTitle,
      transcriptLength: transcriptMeta.transcriptLength,
      requestedRaceNumber: transcriptMeta.requestedRaceNumber,
      selectedVideoRaceNumber: transcriptMeta.selectedVideoRaceNumber,
      selectedVideoTitle: transcriptMeta.selectedVideoTitle,
      selectionMethod: transcriptMeta.selectionMethod,
      nonPointsAdjustmentApplied: transcriptMeta.nonPointsAdjustmentApplied,
    });
  } catch (error) {
    console.error('[power-rankings-generate]', error);
    return res.status(500).json({ error: error.message || 'AI draft generation failed.' });
  }
}
