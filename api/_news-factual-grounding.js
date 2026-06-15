import { enrichSpotlightDriverCareerStats } from './_driver-career-history.js';

export { buildFactualGroundingContext } from './_power-rankings-factual-grounding.js';

export async function buildNewsFactualContext(generationContext, options = {}) {
  const spotlightDriverId = options.spotlightDriverId || null;
  const base = {
    ...generationContext,
    spotlightDriverId,
    spotlightDriver:
      generationContext.standings?.find(
        (row) => String(row.driverId) === String(spotlightDriverId)
      ) || null,
  };

  if (!spotlightDriverId) return base;

  return enrichSpotlightDriverCareerStats(base, spotlightDriverId);
}
