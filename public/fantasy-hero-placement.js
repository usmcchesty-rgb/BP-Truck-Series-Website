// Fantasy header logo placement helpers — admin only (not used on public landing).

const FANTASY_HERO_DESIGN_WIDTH = 1920;

const FANTASY_LOGO_PLACEMENT_DEFAULTS = {
  topPercent: 21,
  widthPercent: 32,
  maxWidthPx: 560,
};

function clampFantasyLogoPlacement(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function logoMaxWidthPercent(maxWidthPx) {
  const px = Number(maxWidthPx);
  if (!Number.isFinite(px)) {
    return (FANTASY_LOGO_PLACEMENT_DEFAULTS.maxWidthPx / FANTASY_HERO_DESIGN_WIDTH) * 100;
  }
  return (px / FANTASY_HERO_DESIGN_WIDTH) * 100;
}

function resolveFantasyHeaderLogoPlacement(settings = {}) {
  return {
    topPercent: clampFantasyLogoPlacement(
      settings.fantasyHeaderLogoTopPercent,
      8,
      45,
      FANTASY_LOGO_PLACEMENT_DEFAULTS.topPercent,
    ),
    widthPercent: clampFantasyLogoPlacement(
      settings.fantasyHeaderLogoWidthVw,
      15,
      60,
      FANTASY_LOGO_PLACEMENT_DEFAULTS.widthPercent,
    ),
    maxWidthPx: clampFantasyLogoPlacement(
      settings.fantasyHeaderLogoMaxWidthPx,
      240,
      900,
      FANTASY_LOGO_PLACEMENT_DEFAULTS.maxWidthPx,
    ),
  };
}

window.BPFantasyHeroPlacement = {
  resolve: resolveFantasyHeaderLogoPlacement,
  defaults: FANTASY_LOGO_PLACEMENT_DEFAULTS,
  designWidth: FANTASY_HERO_DESIGN_WIDTH,
};
