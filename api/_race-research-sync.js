import { getSettings, fetchHtml, supabase } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import { enrichScheduleRaces, getPointsRaceByNumber, buildRaceNumberDebug } from './_schedule-points-races.js';
import { fetchStandingsRows } from './power-rankings-generate.js';
import { findScheduleEntryByScheduleId, extractOfficialRaceField } from './_simracerhub-schedule-results.js';
import { getRaceControlReport } from './_race-control-reports.js';
import { loadRaceTranscript } from './_race-transcripts.js';
import {
  fetchYouTubeTranscript,
  fetchGreenFlagPlaylistVideos,
  selectBroadcastVideoForRankings,
} from './_youtube-transcript.js';
import { ingestRaceResearchSource } from './_race-research-ingest.js';
import { hashContent } from './_race-research-hash.js';

async function loadPreviousArticles(raceNumber) {
  const sb = supabase();
  if (!sb) return [];
  const { data } = await sb
    .from('news_articles')
    .select('id, headline, summary, slug, race_number, published_at')
    .eq('published', true)
    .eq('race_number', Number(raceNumber))
    .order('published_at', { ascending: false })
    .limit(3);
  return data || [];
}

export async function loadRaceResearchBootstrapContext(seasonId, raceNumber, options = {}) {
  const settings = options.settings || (await getSettings());
  const html = await fetchHtml(settings.scheduleUrl);
  const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(html));
  const raceNumberDebug = buildRaceNumberDebug(scheduleRaces, raceNumber, { settings });
  const standingsResult = await fetchStandingsRows(settings, raceNumberDebug.standingsScheduleId);
  const scheduleId = standingsResult.scheduleId || raceNumberDebug.standingsScheduleId;
  const scheduleEntry = findScheduleEntryByScheduleId(standingsResult.schedules, scheduleId);
  const officialField = scheduleEntry ? extractOfficialRaceField(scheduleEntry) : null;
  const scheduleRace = getPointsRaceByNumber(scheduleRaces, raceNumber);

  const profiles = standingsResult.rows.map((row) => ({
    driverId: row.driverId,
    driverName: row.driverName,
    carNumber: row.carNumber,
  }));
  const driverLookup = new Map(profiles.map((p) => [String(p.driverId), p]));

  return {
    settings,
    seasonId: String(seasonId || settings.seasonId),
    raceNumber: Number(raceNumber),
    scheduleRaces,
    scheduleRace,
    scheduleId,
    scheduleEntry: scheduleEntry
      ? { driverResults: officialField?.driverResults || {}, meta: officialField?.meta }
      : null,
    standingsResult,
    standings: standingsResult.rows,
    driverLookup,
    raceNumberDebug,
  };
}

/**
 * Pull existing project sources into race_research_sources (idempotent via content hash).
 */
export async function syncAutomaticRaceResearchSources(seasonId, raceNumber, options = {}) {
  const ctx = await loadRaceResearchBootstrapContext(seasonId, raceNumber, options);
  const warnings = [];
  const ingested = [];
  const processContext = {
    driverLookup: ctx.driverLookup,
    forceLargeSource: options.forceLargeSource === true,
    transcriptExtractor: options.transcriptExtractor,
    autoProcess: options.autoProcess !== false,
    allowAi: options.allowAi === true,
  };

  if (ctx.scheduleRace) {
    ingested.push(
      await ingestRaceResearchSource(
        {
          seasonId: ctx.seasonId,
          raceNumber: ctx.raceNumber,
          sourceType: 'schedule',
          sourceKey: 'points_race',
          title: `Race ${ctx.raceNumber} schedule`,
          rawText: JSON.stringify(ctx.scheduleRace),
          metadata: { scheduleId: ctx.scheduleId },
        },
        processContext
      )
    );
  }

  if (ctx.scheduleEntry?.driverResults) {
    ingested.push(
      await ingestRaceResearchSource(
        {
          seasonId: ctx.seasonId,
          raceNumber: ctx.raceNumber,
          sourceType: 'official_results',
          sourceKey: String(ctx.scheduleId || 'srh'),
          title: 'SimRacerHub official results',
          rawText: JSON.stringify(ctx.scheduleEntry),
          metadata: { scheduleId: ctx.scheduleId },
        },
        processContext
      )
    );
  }

  if (ctx.standings?.length) {
    ingested.push(
      await ingestRaceResearchSource(
        {
          seasonId: ctx.seasonId,
          raceNumber: ctx.raceNumber,
          sourceType: 'standings',
          sourceKey: String(ctx.scheduleId || 'srh'),
          title: 'Standings snapshot',
          rawText: JSON.stringify({ rows: ctx.standings, scheduleId: ctx.scheduleId }),
        },
        processContext
      )
    );
  }

  const report = await getRaceControlReport(ctx.seasonId, ctx.raceNumber, { enrich: false });
  if (report?.parsedJson) {
    ingested.push(
      await ingestRaceResearchSource(
        {
          seasonId: ctx.seasonId,
          raceNumber: ctx.raceNumber,
          sourceType: 'race_control',
          sourceKey: 'pdf_parsed',
          title: report.originalFilename || 'Race Control report',
          rawText: JSON.stringify({ parsedJson: report.parsedJson }),
          metadata: { parseStatus: report.parseStatus },
        },
        processContext
      )
    );
  } else {
    warnings.push('race_control_missing');
  }

  const savedTranscript = await loadRaceTranscript(ctx.raceNumber);
  if (savedTranscript?.transcript) {
    ingested.push(
      await ingestRaceResearchSource(
        {
          seasonId: ctx.seasonId,
          raceNumber: ctx.raceNumber,
          sourceType: 'saved_transcript',
          sourceKey: 'race_transcripts_table',
          title: savedTranscript.raceName || 'Saved transcript',
          rawText: savedTranscript.transcript,
          sourceUrl: savedTranscript.sourceUrl,
        },
        processContext
      )
    );
  } else if (options.includeYoutube !== false) {
    try {
      const videos = await fetchGreenFlagPlaylistVideos();
      const selection = selectBroadcastVideoForRankings(videos, ctx.raceNumber);
      if (selection.video?.videoId) {
        const fetchResult = await fetchYouTubeTranscript(selection.video.videoId);
        if (fetchResult.transcript) {
          ingested.push(
            await ingestRaceResearchSource(
              {
                seasonId: ctx.seasonId,
                raceNumber: ctx.raceNumber,
                sourceType: 'youtube_transcript',
                sourceKey: selection.video.videoId,
                title: selection.selectedVideoTitle,
                rawText: fetchResult.transcript,
                sourceUrl: `https://www.youtube.com/watch?v=${selection.video.videoId}`,
                metadata: {
                  videoId: selection.video.videoId,
                  transcriptLength: fetchResult.transcriptLength,
                  autoGenerated: true,
                },
              },
              processContext
            )
          );
        }
      }
    } catch (error) {
      warnings.push(`youtube_sync_failed: ${error.message}`);
    }
  }

  const articles = await loadPreviousArticles(ctx.raceNumber);
  for (const article of articles) {
    ingested.push(
      await ingestRaceResearchSource(
        {
          seasonId: ctx.seasonId,
          raceNumber: ctx.raceNumber,
          sourceType: 'previous_article',
          sourceKey: String(article.id),
          title: article.headline,
          rawText: JSON.stringify(article),
        },
        processContext
      )
    );
  }

  if (options.manualNotes) {
    ingested.push(
      await ingestRaceResearchSource(
        {
          seasonId: ctx.seasonId,
          raceNumber: ctx.raceNumber,
          sourceType: 'manual_notes',
          sourceKey: hashContent(options.manualNotes).slice(0, 16),
          title: 'Manual notes',
          rawText: String(options.manualNotes),
        },
        processContext
      )
    );
  }

  return { ingested, warnings, context: ctx };
}
