import { generateNewsArticle, parseBody } from './_news-generator.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = parseBody(req);
    if (body.password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Bad password' });
    }

    const raceNumber = Number(body.raceNumber ?? body.race_number ?? 1);
    if (!Number.isInteger(raceNumber) || raceNumber < 1) {
      return res.status(400).json({ error: 'Valid race number is required.' });
    }

    const result = await generateNewsArticle({
      articleType: body.articleType ?? body.article_type,
      raceNumber,
      manualNotes: body.manualNotes ?? body.manualRaceNotes ?? body.manual_notes,
      transcript: body.transcript,
      headlineOverride: body.headlineOverride ?? body.headline_override,
      spotlightDriverId: body.spotlightDriverId ?? body.spotlight_driver_id ?? body.driverId,
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'News generation failed.' });
  }
}
