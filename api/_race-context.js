import { getSettings, fetchHtml, supabase } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import { enrichScheduleRaces, getPointsRaceByNumber } from './_schedule-points-races.js';
import { hasRaceResults } from './_race-date-status.js';
import { loadRaceTranscript } from './_race-transcripts.js';
import { loadRaceControlReportForRace } from './_race-control-reports.js';

async function loadNewsArticleForRace(raceNumber) {
  const sb = supabase();
  if (!sb || raceNumber == null) return null;

  const { data } = await sb
    .from('news_articles')
    .select('id, headline, article_type, race_number, published_at, summary')
    .eq('published', true)
    .eq('race_number', Number(raceNumber))
    .order('published_at', { ascending: false })
    .limit(3);

  return Array.isArray(data) ? data : [];
}

async function loadPowerRankingWeekForRace(raceNumber) {
  const sb = supabase();
  if (!sb || raceNumber == null) return null;

  const { data } = await sb
    .from('power_rankings_weeks')
    .select('id, race_number, published, published_date, updated_at')
    .eq('race_number', Number(raceNumber))
    .eq('published', true)
    .maybeSingle();

  return data || null;
}

function buildScheduleRaceContext(race) {
  if (!race) return null;
  return {
    raceNumber: race.officialPointsRaceNumber ?? race.raceNumber ?? null,
    track: race.track || null,
    date: race.date || null,
    winner: race.winner || null,
    hasOfficialResults: hasRaceResults(race),
    source: 'schedule_scraper',
    authoritative: true,
  };
}

function buildRaceControlSupplement(report) {
  if (!report) return null;
  return {
    source: 'race_control_pdf',
    authoritative: false,
    supplemental: true,
    parseStatus: report.parseStatus,
    fileUrl: report.fileUrl,
    uploadedAt: report.uploadedAt,
    parsedJson: report.parsedJson,
    parsedText: report.parsedText,
    summary: report.summary,
    warnings: report.summary?.parseWarnings || [],
  };
}

function buildTranscriptSupplement(transcript) {
  if (!transcript?.transcript) return null;
  return {
    source: 'broadcast_transcript',
    authoritative: false,
    supplemental: true,
    raceName: transcript.raceName || null,
    transcriptLength: transcript.transcript.length,
    transcript: transcript.transcript,
    updatedAt: transcript.updatedAt || null,
  };
}

function compareOfficialVsRaceControl(scheduleRace, raceControl) {
  const warnings = [];
  if (!scheduleRace || !raceControl?.parsedJson) return warnings;

  const officialWinner = scheduleRace.winner || null;
  const pdfWinner = raceControl.parsedJson.winner || null;

  if (officialWinner && pdfWinner && officialWinner.toLowerCase() !== pdfWinner.toLowerCase()) {
    warnings.push(
      `Race Control PDF winner (${pdfWinner}) differs from official schedule winner (${officialWinner}). Official schedule results take precedence.`
    );
  }

  return warnings;
}

function buildContextForAi(payload) {
  const sections = [];

  sections.push(
    'OFFICIAL PRIMARY SOURCES (authoritative — use these for standings, results, and factual claims):'
  );

  if (payload.primarySources.scheduleRace) {
    sections.push(
      `Schedule/Results: Race ${payload.primarySources.scheduleRace.raceNumber} at ${payload.primarySources.scheduleRace.track || 'TBD'} on ${payload.primarySources.scheduleRace.date || 'TBD'}. Winner: ${payload.primarySources.scheduleRace.winner || 'pending'}.`
    );
  }

  if (payload.primarySources.powerRankingWeek) {
    sections.push(
      `Power Rankings week published for Race ${payload.primarySources.powerRankingWeek.race_number}.`
    );
  }

  if (payload.primarySources.newsArticles?.length) {
    sections.push(
      `News articles: ${payload.primarySources.newsArticles.map((row) => row.headline).join('; ')}`
    );
  }

  sections.push('');
  sections.push('SUPPLEMENTAL SOURCES (enrichment only — do not override official results):');

  if (payload.supplementalSources.raceControl) {
    const rc = payload.supplementalSources.raceControl;
    const parsed = rc.parsedJson || {};
    sections.push(
      `[Race Control PDF — supplemental] Status: ${rc.parseStatus}. Winner (PDF): ${parsed.winner || 'unknown'}. SOF: ${parsed.sof ?? 'unknown'}. Cautions: ${parsed.cautionCount ?? 'unknown'}.`
    );
    if (Array.isArray(parsed.raceEvents) && parsed.raceEvents.length) {
      sections.push(
        `Race events (supplemental): ${parsed.raceEvents
          .slice(0, 12)
          .map((event) => event.text)
          .join(' | ')}`
      );
    }
  } else {
    sections.push('[Race Control PDF — supplemental] Not available for this race.');
  }

  if (payload.supplementalSources.transcript) {
    sections.push(
      `[Broadcast transcript — supplemental] ${payload.supplementalSources.transcript.transcriptLength} characters available.`
    );
  }

  if (payload.warnings.length) {
    sections.push('');
    sections.push('WARNINGS:');
    payload.warnings.forEach((warning) => sections.push(`- ${warning}`));
  }

  return sections.join('\n');
}

function computeConfidence(payload) {
  let score = 0;
  if (payload.primarySources.scheduleRace?.hasOfficialResults) score += 40;
  if (payload.primarySources.powerRankingWeek) score += 15;
  if (payload.primarySources.newsArticles?.length) score += 10;
  if (payload.supplementalSources.raceControl?.parseStatus === 'parsed') score += 20;
  if (payload.supplementalSources.transcript) score += 15;
  return Math.min(100, score);
}

export async function assembleRaceContext(options = {}) {
  const settings = options.settings || (await getSettings());
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const raceNumber = Number(options.raceNumber ?? options.race_number);
  if (!Number.isInteger(raceNumber) || raceNumber < 1) {
    throw new Error('Valid raceNumber is required.');
  }

  let scheduleRaces = options.scheduleRaces || null;
  if (!scheduleRaces) {
    const html = await fetchHtml(settings.scheduleUrl);
    scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(html));
  }

  const scheduleRaceRow = getPointsRaceByNumber(scheduleRaces, raceNumber);
  const scheduleRace = buildScheduleRaceContext(scheduleRaceRow);

  const [raceControlReport, transcript, newsArticles, powerRankingWeek] = await Promise.all([
    loadRaceControlReportForRace(seasonId, raceNumber),
    loadRaceTranscript(raceNumber),
    loadNewsArticleForRace(raceNumber),
    loadPowerRankingWeekForRace(raceNumber),
  ]);

  const primarySources = {
    scheduleRace,
    newsArticles: newsArticles || [],
    powerRankingWeek,
  };

  const supplementalSources = {
    raceControl: buildRaceControlSupplement(raceControlReport),
    transcript: buildTranscriptSupplement(transcript),
    broadcast: null,
  };

  const missingSources = [];
  if (!scheduleRace?.hasOfficialResults) missingSources.push('official_results');
  if (!raceControlReport) missingSources.push('race_control_pdf');
  if (!transcript) missingSources.push('broadcast_transcript');
  if (!powerRankingWeek) missingSources.push('power_rankings_week');
  if (!newsArticles?.length) missingSources.push('news_articles');

  const warnings = [];
  if (!raceControlReport) {
    warnings.push('Race Control PDF not uploaded — analysis will use official results and other primary sources only.');
  } else if (raceControlReport.parseStatus === 'parse_failed') {
    warnings.push('Race Control PDF parse failed — supplemental lap/event detail may be unavailable.');
  }

  warnings.push(...compareOfficialVsRaceControl(scheduleRace, supplementalSources.raceControl));

  const race = {
    seasonId,
    raceNumber,
    track: scheduleRace?.track || raceControlReport?.trackName || null,
    date: scheduleRace?.date || raceControlReport?.raceDate || null,
    winner: scheduleRace?.winner || raceControlReport?.parsedJson?.winner || null,
  };

  const payload = {
    race,
    primarySources,
    supplementalSources,
    confidence: 0,
    missingSources,
    warnings,
    contextForAi: '',
  };

  payload.confidence = computeConfidence(payload);
  payload.contextForAi = buildContextForAi(payload);

  return payload;
}
