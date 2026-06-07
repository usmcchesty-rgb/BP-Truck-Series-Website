import { fetchHtml, getSettings, guessSchedule } from './_lib.js';
export default async function handler(req, res) {
  try {
    const settings = await getSettings();
    const html = await fetchHtml(settings.scheduleUrl);
    const schedule = guessSchedule(html);
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json({ settings, ...schedule, updatedAt: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
