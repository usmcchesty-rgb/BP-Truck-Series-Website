import { formatVerifiedFactsForRepair } from './_power-rankings-factual-grounding.js';
import {
  buildWriteupContextForEntry,
  buildWriteupWarnings,
  callOpenAiSingleWriteup,
  formatDriverStatsForRepair,
  loadPowerRankingsGenerationContext,
  repairWriteupQuality,
} from './power-rankings-generate.js';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = parseBody(req);
    const password = body.password ?? body.adminPassword;

    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Bad password' });
    }

    const raceNumber = Number(body.raceNumber ?? body.race_number);
    const rank = Number(body.rank);
    const driverId = String(body.driverId ?? body.driver_id ?? '').trim();
    const subtitle = String(body.subtitle || '').trim();
    const currentWriteup = String(body.currentWriteup ?? body.current_writeup ?? '').trim();
    const manualRaceNotes = String(body.manualRaceNotes ?? body.manual_race_notes ?? '');

    if (!Number.isInteger(raceNumber) || raceNumber < 1) {
      return res.status(400).json({ error: 'Valid race number is required.' });
    }
    if (!Number.isInteger(rank) || rank < 1 || rank > 10) {
      return res.status(400).json({ error: 'Valid rank (1-10) is required.' });
    }
    if (!driverId) {
      return res.status(400).json({ error: 'driverId is required.' });
    }

    const generationContext = await loadPowerRankingsGenerationContext(
      raceNumber,
      manualRaceNotes
    );

    const driver = generationContext.driverLookup.get(driverId);
    if (!driver) {
      return res.status(400).json({ error: 'Invalid driverId for this race week.' });
    }

    const previousRank = generationContext.previousRankByDriver[driverId];
    const entry = {
      rank,
      driverId,
      subtitle,
      writeup: currentWriteup,
    };
    const writeupContext = buildWriteupContextForEntry(
      entry,
      driver,
      generationContext,
      previousRank
    );

    const verifiedFacts = formatVerifiedFactsForRepair(writeupContext.driverGrounding, rank);
    const driverStats = formatDriverStatsForRepair(driver, entry, previousRank);

    let generatedWriteup = await callOpenAiSingleWriteup({
      driverName: driver.driverName,
      rank,
      subtitle,
      verifiedFacts,
      driverStats,
      manualRaceNotes: generationContext.manualRaceNotes,
      transcriptUsed: generationContext.contextMeta?.transcriptUsed === true,
      raceNumber,
    });

    entry.writeup = String(generatedWriteup || '').trim();
    const repaired = await repairWriteupQuality(entry, driver, writeupContext);
    const warnings = buildWriteupWarnings(repaired);

    return res.status(200).json({
      raceNumber,
      rank,
      driverId,
      writeup: repaired.writeup,
      warnings,
      verifiedFactsUsed: repaired.writeupResult.verifiedFactsUsed || [],
      verifiedFactsUsedCount: repaired.writeupResult.verifiedFactsUsedCount ?? 0,
      repaired: repaired.repairAttempted === true,
      repairAttempts: repaired.repairAttempts,
      repairReasons: repaired.repairReasons,
    });
  } catch (error) {
    console.error('[power-rankings-generate-writeup]', error);
    return res.status(500).json({ error: error.message || 'Writeup regeneration failed.' });
  }
}
