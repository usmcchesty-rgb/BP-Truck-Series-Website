import { fetchHtml, getSettings } from './_lib.js';

export default async function handler(req, res) {
  const settings = await getSettings();

  const url =
    req.query.type === 'schedule'
      ? settings.scheduleUrl
      : settings.standingsUrl;

  const html = await fetchHtml(url);

  res.setHeader('Content-Type', 'text/plain');
  res.status(200).send(html.slice(0, 12000));
}