export { buildFactualGroundingContext } from './_power-rankings-factual-grounding.js';

export function buildNewsFactualContext(generationContext, options = {}) {
  const spotlightDriverId = options.spotlightDriverId || null;
  return {
    ...generationContext,
    spotlightDriverId,
    spotlightDriver:
      generationContext.standings?.find(
        (row) => String(row.driverId) === String(spotlightDriverId)
      ) || null,
  };
}
