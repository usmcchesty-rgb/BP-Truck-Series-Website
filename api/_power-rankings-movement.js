export const MOVEMENT_NEW_SENTINEL = 100;

export const MOVEMENT_TYPE = {
  UP: 'up',
  DOWN: 'down',
  UNCHANGED: 'unchanged',
  NEW: 'new',
  DEFAULTED: 'defaulted',
};

export function movementTypeFromStored(movement) {
  if (Number(movement) === MOVEMENT_NEW_SENTINEL) {
    return MOVEMENT_TYPE.NEW;
  }

  const value = Number(movement);
  if (!Number.isFinite(value) || value === 0) return MOVEMENT_TYPE.UNCHANGED;
  if (value > 0) return MOVEMENT_TYPE.UP;
  return MOVEMENT_TYPE.DOWN;
}

export function formatMovementDisplay(movement, movementType = null) {
  const type = movementType || movementTypeFromStored(movement);

  if (type === MOVEMENT_TYPE.NEW) {
    return { text: 'NEW', class: 'new' };
  }

  const value = Number(movement);
  if (!Number.isFinite(value) || value === MOVEMENT_NEW_SENTINEL || value === 0) {
    return { text: '—', class: '' };
  }
  if (value > 0) return { text: `▲${value}`, class: 'positive' };
  return { text: `▼${Math.abs(value)}`, class: 'negative' };
}

export function computeMovement({
  previousRank,
  currentRank,
  hasPreviousRankings = false,
}) {
  const current = Number(currentRank);
  const previous = Number(previousRank);

  if (Number.isFinite(previous) && previous >= 1) {
    const movement = previous - current;
    const movementType =
      movement > 0
        ? MOVEMENT_TYPE.UP
        : movement < 0
          ? MOVEMENT_TYPE.DOWN
          : MOVEMENT_TYPE.UNCHANGED;
    const formatted = formatMovementDisplay(movement, movementType);

    return {
      movement,
      movementType,
      movementText: formatted.text,
      movementClass: formatted.class,
      movementSource: 'previous rankings',
      previousRank: previous,
      currentRank: current,
    };
  }

  if (hasPreviousRankings) {
    const formatted = formatMovementDisplay(MOVEMENT_NEW_SENTINEL, MOVEMENT_TYPE.NEW);
    return {
      movement: MOVEMENT_NEW_SENTINEL,
      movementType: MOVEMENT_TYPE.NEW,
      movementText: formatted.text,
      movementClass: formatted.class,
      movementSource: 'previous rankings',
      previousRank: null,
      currentRank: current,
    };
  }

  const formatted = formatMovementDisplay(0, MOVEMENT_TYPE.UNCHANGED);
  return {
    movement: 0,
    movementType: MOVEMENT_TYPE.DEFAULTED,
    movementText: formatted.text,
    movementClass: formatted.class,
    movementSource: 'defaulted',
    previousRank: null,
    currentRank: current,
  };
}

export function parseMovementInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return {
      movement: 0,
      movementType: MOVEMENT_TYPE.UNCHANGED,
    };
  }

  const upper = raw.toUpperCase();
  if (upper === 'NEW' || upper === 'NR') {
    return {
      movement: MOVEMENT_NEW_SENTINEL,
      movementType: MOVEMENT_TYPE.NEW,
    };
  }

  if (upper === '—' || upper === '-' || upper === '0') {
    return {
      movement: 0,
      movementType: MOVEMENT_TYPE.UNCHANGED,
    };
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;

  return {
    movement: numeric,
    movementType:
      numeric === MOVEMENT_NEW_SENTINEL
        ? MOVEMENT_TYPE.NEW
        : numeric > 0
          ? MOVEMENT_TYPE.UP
          : numeric < 0
            ? MOVEMENT_TYPE.DOWN
            : MOVEMENT_TYPE.UNCHANGED,
  };
}

export function movementInputValue(entry = {}) {
  if (
    entry.movementType === MOVEMENT_TYPE.NEW ||
    Number(entry.movement) === MOVEMENT_NEW_SENTINEL
  ) {
    return 'NEW';
  }

  const movement = Number(entry.movement);
  if (!Number.isFinite(movement)) return '0';
  return String(movement);
}

export function formatMovementForRepair(entry = {}, previousRank) {
  if (
    entry.movementType === MOVEMENT_TYPE.NEW ||
    Number(entry.movement) === MOVEMENT_NEW_SENTINEL
  ) {
    return 'Movement: NEW (not ranked in previous Top 10)';
  }

  const movement = Number(entry.movement);
  if (!Number.isFinite(movement) || movement === 0) return 'Movement: unchanged';
  if (movement > 0) return `Movement: up ${movement}`;
  return `Movement: down ${Math.abs(movement)}`;
}
