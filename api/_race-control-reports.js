import { getSettings, supabase } from './_lib.js';
import { getPointsRaceByNumber } from './_schedule-points-races.js';
import { parseRaceControlPdfBuffer } from './_race-control-pdf-parser.js';
import { enrichRaceControlReport } from './_race-control-validation.js';

// iRaceControl Race Report PDFs — supplemental enrichment, not required for site operation.

export const RACE_CONTROL_BUCKET = 'race-control-pdfs';

export const PARSE_STATUS = {
  NOT_UPLOADED: 'not_uploaded',
  UPLOADED: 'uploaded',
  PARSED: 'parsed',
  PARSE_FAILED: 'parse_failed',
};

const STORAGE_SETUP_SQL = `insert into storage.buckets (id, name, public)
values ('race-control-pdfs', 'race-control-pdfs', true)
on conflict (id) do update set public = true;

create policy if not exists "Public read race control pdfs"
on storage.objects
for select
using (bucket_id = 'race-control-pdfs');`;

function publicStorageUrl(filePath) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('Supabase URL is not configured.');
  return `${base}/storage/v1/object/public/${RACE_CONTROL_BUCKET}/${filePath}`;
}

function buildStoragePath(seasonId, raceNumber) {
  return `season-${seasonId}/race-${raceNumber}/race-control.pdf`;
}

function normalizeReportRow(row) {
  if (!row) return null;

  const parsedJson = row.parsed_json && typeof row.parsed_json === 'object' ? row.parsed_json : null;
  const parseStatus = row.parse_status || PARSE_STATUS.NOT_UPLOADED;

  return {
    id: row.id,
    seasonId: row.season_id,
    raceNumber: row.race_number,
    trackName: row.track_name || parsedJson?.trackName || null,
    raceDate: row.race_date || null,
    fileUrl: row.file_url || null,
    filePath: row.file_path || null,
    originalFilename: row.original_filename || null,
    uploadedAt: row.uploaded_at || null,
    uploadedBy: row.uploaded_by || null,
    parseStatus,
    parseError: row.parse_error || null,
    parsedText: row.parsed_text || null,
    parsedJson,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: buildReportSummary(parsedJson, parseStatus),
    parseStatusLabel: formatParseStatusLabel(parseStatus, parsedJson),
    aiReady: parseStatus === PARSE_STATUS.PARSED && Boolean(parsedJson),
  };
}

export function formatParseStatusLabel(parseStatus, parsedJson = null) {
  switch (parseStatus) {
    case PARSE_STATUS.PARSED:
      return 'Parsed';
    case PARSE_STATUS.UPLOADED:
      return 'Uploaded, parse pending';
    case PARSE_STATUS.PARSE_FAILED:
      return 'Parse failed — needs review';
    case PARSE_STATUS.NOT_UPLOADED:
    default:
      return 'Not uploaded';
  }
}

export function buildReportSummary(parsedJson, parseStatus) {
  if (parseStatus === PARSE_STATUS.NOT_UPLOADED) {
    return { winner: null, sof: null, cautionCount: null, resultCount: 0, eventCount: 0 };
  }

  return {
    winner: parsedJson?.winner || null,
    sof: parsedJson?.sof ?? null,
    cautionCount: parsedJson?.cautionCount ?? null,
    resultCount: Array.isArray(parsedJson?.results) ? parsedJson.results.length : 0,
    totalDrivers:
      parsedJson?.summary?.totalDrivers ??
      (Array.isArray(parsedJson?.results) ? parsedJson.results.length : 0),
    eventCount: Array.isArray(parsedJson?.raceEvents) ? parsedJson.raceEvents.length : 0,
    parseWarnings: Array.isArray(parsedJson?.parseWarnings) ? parsedJson.parseWarnings : [],
  };
}

function readPdfBuffer(body) {
  const raw = body.pdfBase64 || body.pdf || body.fileBase64 || '';
  const base64 = String(raw).replace(/^data:application\/pdf;base64,/, '').trim();
  if (!base64) {
    throw Object.assign(new Error('No PDF data provided. Send pdfBase64 in the request body.'), {
      status: 400,
    });
  }

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw Object.assign(new Error('Invalid PDF data.'), { status: 400 });
  }

  const maxBytes = 8 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw Object.assign(new Error('PDF exceeds 8 MB upload limit.'), { status: 400 });
  }

  return buffer;
}

async function resolveRaceMeta(seasonId, raceNumber, scheduleRaces = null) {
  const race = scheduleRaces
    ? getPointsRaceByNumber(scheduleRaces, Number(raceNumber))
    : null;

  return {
    trackName: race?.track || null,
    raceDate: race?.date || null,
  };
}

export async function getRaceControlReport(seasonId, raceNumber, options = {}) {
  const sb = supabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from('race_control_reports')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber))
    .maybeSingle();

  if (error) throw new Error(error.message);
  const report = normalizeReportRow(data);
  if (!report || options.enrich === false) return report;

  const settings = options.settings || (await getSettings());
  return enrichRaceControlReport(report, { settings });
}

export async function listRaceControlReports(seasonId) {
  const sb = supabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from('race_control_reports')
    .select('*')
    .eq('season_id', String(seasonId))
    .order('race_number', { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []).map(normalizeReportRow);
}

async function enrichReportIfParsed(report, options = {}) {
  if (!report || report.parseStatus !== PARSE_STATUS.PARSED) return report;
  const settings = options.settings || (await getSettings());
  return enrichRaceControlReport(report, { settings });
}

async function uploadPdfToStorage(filePath, buffer) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured.');

  const { error } = await sb.storage.from(RACE_CONTROL_BUCKET).upload(filePath, buffer, {
    contentType: 'application/pdf',
    upsert: true,
  });

  if (error) {
    if (/bucket/i.test(error.message)) {
      const err = new Error(`Storage bucket '${RACE_CONTROL_BUCKET}' was not found.`);
      err.details = { bucket: RACE_CONTROL_BUCKET, setupSql: STORAGE_SETUP_SQL };
      throw err;
    }
    throw new Error(error.message);
  }

  return publicStorageUrl(filePath);
}

async function runParseAndPersist(reportRow, buffer, options = {}) {
  const sb = supabase();
  const now = new Date().toISOString();

  try {
    const parseStarted = Date.now();
    const { parsedText, parsedJson } = await parseRaceControlPdfBuffer(buffer, {
      raceNumber: reportRow.race_number,
      trackName: reportRow.track_name || options.trackName || null,
    });
    parsedJson.parseTimingMs = Date.now() - parseStarted;

    const { data, error } = await sb
      .from('race_control_reports')
      .update({
        parse_status: PARSE_STATUS.PARSED,
        parse_error: null,
        parsed_text: parsedText,
        parsed_json: parsedJson,
        track_name: parsedJson.trackName || reportRow.track_name || null,
        updated_at: now,
      })
      .eq('id', reportRow.id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return enrichReportIfParsed(normalizeReportRow(data), options);
  } catch (parseError) {
    const message = parseError.message || 'PDF parse failed.';
    const { data, error } = await sb
      .from('race_control_reports')
      .update({
        parse_status: PARSE_STATUS.PARSE_FAILED,
        parse_error: message,
        updated_at: now,
      })
      .eq('id', reportRow.id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    const normalized = normalizeReportRow(data);
    normalized.parseError = message;
    return normalized;
  }
}

export async function uploadRaceControlReport(body, options = {}) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured.');

  const settings = options.settings || (await getSettings());
  const seasonId = String(body.seasonId || settings.seasonId || '27987');
  const raceNumber = Number(body.raceNumber ?? body.race_number);
  if (!Number.isInteger(raceNumber) || raceNumber < 1) {
    throw Object.assign(new Error('Valid raceNumber is required.'), { status: 400 });
  }

  const buffer = readPdfBuffer(body);
  const originalFilename = String(body.originalFilename || body.filename || 'race-control.pdf').trim();
  const uploadedBy = String(body.uploadedBy || body.uploaded_by || 'admin').trim();
  const raceMeta = await resolveRaceMeta(seasonId, raceNumber, options.scheduleRaces || null);
  const filePath = buildStoragePath(seasonId, raceNumber);
  const fileUrl = await uploadPdfToStorage(filePath, buffer);
  const now = new Date().toISOString();

  const upsertRow = {
    season_id: seasonId,
    race_number: raceNumber,
    track_name: body.trackName || body.track_name || raceMeta.trackName || null,
    race_date: body.raceDate || body.race_date || raceMeta.raceDate || null,
    file_url: fileUrl,
    file_path: filePath,
    original_filename: originalFilename,
    uploaded_at: now,
    uploaded_by: uploadedBy,
    parse_status: PARSE_STATUS.UPLOADED,
    parse_error: null,
    updated_at: now,
  };

  const { data, error } = await sb
    .from('race_control_reports')
    .upsert(upsertRow, { onConflict: 'season_id,race_number' })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  return runParseAndPersist(data, buffer, {
    trackName: upsertRow.track_name,
    settings,
  });
}

export async function reparseRaceControlReport(body, options = {}) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured.');

  const settings = options.settings || (await getSettings());
  const seasonId = String(body.seasonId || settings.seasonId || '27987');
  const raceNumber = Number(body.raceNumber ?? body.race_number);
  if (!Number.isInteger(raceNumber) || raceNumber < 1) {
    throw Object.assign(new Error('Valid raceNumber is required.'), { status: 400 });
  }

  const report = await getRaceControlReport(seasonId, raceNumber);
  if (!report?.filePath) {
    throw Object.assign(new Error('No Race Control PDF found for this race.'), { status: 404 });
  }

  const { data: fileData, error: downloadError } = await sb.storage
    .from(RACE_CONTROL_BUCKET)
    .download(report.filePath);

  if (downloadError || !fileData) {
    throw new Error(downloadError?.message || 'Failed to download stored PDF.');
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  return runParseAndPersist(
    {
      id: report.id,
      race_number: report.raceNumber,
      track_name: report.trackName,
    },
    buffer,
    { trackName: report.trackName, settings }
  );
}

export async function deleteRaceControlReport(body, options = {}) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured.');

  const settings = options.settings || (await getSettings());
  const seasonId = String(body.seasonId || settings.seasonId || '27987');
  const raceNumber = Number(body.raceNumber ?? body.race_number);
  if (!Number.isInteger(raceNumber) || raceNumber < 1) {
    throw Object.assign(new Error('Valid raceNumber is required.'), { status: 400 });
  }

  const report = await getRaceControlReport(seasonId, raceNumber);
  if (!report) {
    return { ok: true, deleted: false };
  }

  if (report.filePath) {
    await sb.storage.from(RACE_CONTROL_BUCKET).remove([report.filePath]);
  }

  const { error } = await sb
    .from('race_control_reports')
    .delete()
    .eq('season_id', seasonId)
    .eq('race_number', raceNumber);

  if (error) throw new Error(error.message);
  return { ok: true, deleted: true, raceNumber };
}

export async function loadRaceControlReportForRace(seasonId, raceNumber, options = {}) {
  try {
    return await getRaceControlReport(seasonId, raceNumber, options);
  } catch {
    return null;
  }
}
