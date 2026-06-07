export default async function handler(req, res) {
  try {
    const response = await fetch(
      'https://www.simracerhub.com/scoring/get_standings.php?season_id=27987&schedule_id=346493'
    );

    const data = await response.json();

    return res.status(200).json({
      success: true,
      keys: Object.keys(data),
      sampleDrivers: Object.keys(data.rps || {}).slice(0, 10)
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message
    });
  }
}