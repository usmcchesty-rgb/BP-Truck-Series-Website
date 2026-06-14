import { supabase } from './_lib.js';

export function normalizeTranscriptRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    raceNumber: row.race_number,
    raceName: row.race_name || '',
    transcript: row.transcript || '',
    sourceUrl: row.source_url || '',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadRaceTranscript(raceNumber) {
  const sb = supabase();
  if (!sb) return null;

  const num = Number(raceNumber);
  if (!Number.isInteger(num) || num < 1) return null;

  const { data, error } = await sb
    .from('race_transcripts')
    .select('*')
    .eq('race_number', num)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeTranscriptRow(data);
}

export async function listRaceTranscripts() {
  const sb = supabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from('race_transcripts')
    .select('id, race_number, race_name, source_url, notes, created_at, updated_at, transcript')
    .order('race_number', { ascending: true });

  if (error || !Array.isArray(data)) return [];

  return data.map((row) => ({
    id: row.id,
    raceNumber: row.race_number,
    raceName: row.race_name || '',
    sourceUrl: row.source_url || '',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    transcriptLength: String(row.transcript || '').length,
  }));
}

export async function saveRaceTranscript(body) {
  const sb = supabase();
  if (!sb) return { error: 'Supabase not configured yet.', status: 400 };

  const raceNumber = Number(body.raceNumber ?? body.race_number);
  if (!Number.isInteger(raceNumber) || raceNumber < 1) {
    return { error: 'Valid race number is required.', status: 400 };
  }

  const transcript = String(body.transcript || '').trim();
  if (!transcript) {
    return { error: 'Transcript text is required.', status: 400 };
  }

  const now = new Date().toISOString();
  const row = {
    race_number: raceNumber,
    race_name: String(body.raceName ?? body.race_name ?? '').trim() || null,
    transcript,
    source_url: String(body.sourceUrl ?? body.source_url ?? '').trim() || null,
    notes: String(body.notes || '').trim() || null,
    updated_at: now,
  };

  const { data, error } = await sb
    .from('race_transcripts')
    .upsert(row, { onConflict: 'race_number' })
    .select('*')
    .single();

  if (error) {
    return { error: `Supabase error: ${error.message}`, status: 500 };
  }

  return { data: normalizeTranscriptRow(data), status: 200 };
}

export async function deleteRaceTranscript(raceNumber) {
  const sb = supabase();
  if (!sb) return { error: 'Supabase not configured yet.', status: 400 };

  const num = Number(raceNumber);
  if (!Number.isInteger(num) || num < 1) {
    return { error: 'Valid race number is required.', status: 400 };
  }

  const { error } = await sb.from('race_transcripts').delete().eq('race_number', num);
  if (error) {
    return { error: `Supabase error: ${error.message}`, status: 500 };
  }

  return { ok: true, status: 200 };
}
