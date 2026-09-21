(function () {
  const EASTERN_TIMEZONE = 'America/New_York';
  const MONTH_NAMES = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    sept: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12,
  };

  function isUsableDateLabel(value) {
    const text = String(value || '').trim();
    return Boolean(text) && !/invalid/i.test(text) && text !== 'undefined';
  }

  function parseScheduleDateParts(dateStr) {
    const raw = String(dateStr || '').trim();
    if (!raw) return null;
    const match = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (!match) return null;
    const month = MONTH_NAMES[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (!month || !Number.isFinite(day) || !Number.isFinite(year)) return null;
    return { year, month, day };
  }

  function parseTimeToMinutes(value) {
    const raw = String(value || '').replace(/\b(EST|EDT|ET|Eastern)\b/gi, '').trim();
    if (!raw) return null;
    const match12 = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
    if (match12) {
      let hour = Number(match12[1]);
      const minute = Number(match12[2] || 0);
      const ampm = match12[3].toUpperCase();
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
      if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
      if (hour === 12) hour = ampm === 'AM' ? 0 : 12;
      else if (ampm === 'PM') hour += 12;
      return hour * 60 + minute;
    }
    const match24 = raw.match(/\b(\d{1,2}):(\d{2})\b/);
    if (!match24) return null;
    const hour = Number(match24[1]);
    const minute = Number(match24[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  function formatCalendarDateWeekdayShort(year, month, day) {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || y < 1000 || m < 1 || m > 12 || d < 1 || d > 31) {
      return '';
    }
    const utcDate = new Date(Date.UTC(y, m - 1, d));
    if (Number.isNaN(utcDate.getTime())) return '';
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(utcDate);
    const monthShort = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(utcDate);
    if (!isUsableDateLabel(weekday) || !isUsableDateLabel(monthShort)) return '';
    return `${weekday}, ${monthShort} ${d}`;
  }

  function formatEasternWeekdayShortDate(value) {
    if (value == null || value === '') return '';
    const raw = value instanceof Date ? value.toISOString() : String(value).trim();
    if (!raw || /invalid/i.test(raw) || raw === 'undefined') return '';

    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return formatCalendarDateWeekdayShort(dateOnly[1], dateOnly[2], dateOnly[3]);

    const scheduleParts = parseScheduleDateParts(raw);
    if (scheduleParts) {
      return formatCalendarDateWeekdayShort(scheduleParts.year, scheduleParts.month, scheduleParts.day);
    }

    const date = value instanceof Date ? value : new Date(raw);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';

    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: EASTERN_TIMEZONE,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }).formatToParts(date);
      const weekday = parts.find((part) => part.type === 'weekday')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;
      if (!isUsableDateLabel(weekday) || !isUsableDateLabel(month) || !day) return '';
      return `${weekday}, ${month} ${Number(day)}`;
    } catch {
      return '';
    }
  }

  function formatPublicLockDateLabel({ lockAt, raceDate } = {}) {
    const fromRaceDate = formatEasternWeekdayShortDate(raceDate);
    if (fromRaceDate) return fromRaceDate;
    return formatEasternWeekdayShortDate(lockAt);
  }

  function formatPublicLockTimeEt(lockTimeDisplay = '') {
    const raw = String(lockTimeDisplay || '').trim();
    if (!raw) return '';
    const minutes = parseTimeToMinutes(raw);
    if (minutes == null) {
      const labeled = raw.replace(/\b(EST|EDT|EASTERN)\b/gi, 'ET');
      return /invalid/i.test(labeled) || labeled === 'undefined' ? '' : labeled;
    }
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const hour12 = hour24 % 12 || 12;
    const ampm = hour24 >= 12 ? 'PM' : 'AM';
    return `${hour12}:${String(minute).padStart(2, '0')} ${ampm} ET`;
  }

  function formatPublicFantasyLockDisplay({ lockTime, lockAt, raceDate, lockDisplay } = {}) {
    const provided = String(lockDisplay || '').trim();
    if (isUsableDateLabel(provided) && provided !== 'TBD') return provided;
    const dateLabel = formatPublicLockDateLabel({ lockAt, raceDate });
    const timeLabel = formatPublicLockTimeEt(lockTime);
    if (dateLabel && timeLabel) return `${dateLabel} · ${timeLabel}`;
    if (dateLabel) return dateLabel;
    return timeLabel;
  }

  function isLockedState(slate = {}, lock = {}) {
    if (
      lock?.isLocked ||
      slate?.isLocked ||
      lock?.raceComplete ||
      slate?.raceComplete ||
      slate?.status === 'locked'
    ) {
      return true;
    }
    const lockAt = slate.lockAt || lock.lockAt;
    if (!lockAt) return false;
    const date = new Date(lockAt);
    return !Number.isNaN(date.getTime()) && Date.now() >= date.getTime();
  }

  function formatLockField(slate = {}, lock = {}, fallback = 'TBD') {
    const display = formatPublicFantasyLockDisplay({
      lockTime: slate.lockTime || lock.lockTime,
      lockAt: slate.lockAt || lock.lockAt,
      raceDate: slate.raceDate || lock.raceDate,
      lockDisplay: slate.lockDisplay || lock.lockDisplay,
    });
    if (isUsableDateLabel(display)) return display;
    const existing = String(slate.lockTime || lock.lockTime || lock.lockMessage || '').trim();
    if (isUsableDateLabel(existing)) {
      return existing.replace(/\b(EST|EDT|EASTERN)\b/gi, 'ET');
    }
    return fallback;
  }

  function lockLabel(slate = {}, lock = {}) {
    return isLockedState(slate, lock) ? 'Locked' : 'Lock';
  }

  window.BPFantasyLockDisplay = {
    formatPublicFantasyLockDisplay,
    formatPublicLockDateLabel,
    formatPublicLockTimeEt,
    formatLockField,
    lockLabel,
    isLockedState,
  };
})();
