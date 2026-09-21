import { authorizeVercelCron, runMondayFantasySafetyCheck } from './_fantasy-lifecycle.js';

export default async function handler(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = authorizeVercelCron(req);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  try {
    const result = await runMondayFantasySafetyCheck({ trigger: 'monday_safety' });
    return res.status(200).json({
      ok: true,
      trigger: 'monday_safety',
      once: true,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      trigger: 'monday_safety',
      error: error.message || 'Monday fantasy safety check failed.',
    });
  }
}
