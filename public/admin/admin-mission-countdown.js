(function () {
  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function formatCountdownParts(targetAt, now = new Date()) {
    if (!targetAt) return null;
    const target = new Date(targetAt);
    if (!Number.isFinite(target.getTime())) return null;
    const diffMs = target.getTime() - now.getTime();
    if (diffMs <= 0) return { expired: true, label: 'Now', days: 0, hours: 0, minutes: 0 };

    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    const parts = [];
    if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
    if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (days === 0 && minutes > 0) parts.push(`${minutes} min`);

    return {
      expired: false,
      label: parts.join('\n') || '< 1 min',
      days,
      hours,
      minutes,
      totalMinutes,
    };
  }

  function formatCountdownHtml(targetAt, now = new Date()) {
    const parts = formatCountdownParts(targetAt, now);
    if (!parts) return '—';
    if (parts.expired) return 'Now';
    const lines = [];
    if (parts.days > 0) lines.push(`<span class="mc-countdown__unit"><strong>${parts.days}</strong> day${parts.days === 1 ? '' : 's'}</span>`);
    if (parts.hours > 0) lines.push(`<span class="mc-countdown__unit"><strong>${parts.hours}</strong> hour${parts.hours === 1 ? '' : 's'}</span>`);
    if (parts.days === 0 && parts.minutes > 0) {
      lines.push(`<span class="mc-countdown__unit"><strong>${parts.minutes}</strong> min</span>`);
    }
    return lines.join('') || '<span class="mc-countdown__unit"><strong>&lt;1</strong> min</span>';
  }

  const timers = new Set();

  function startMinuteTicker(callback) {
    const tick = () => callback(new Date());
    tick();
    const id = window.setInterval(tick, 60000);
    timers.add(id);
    return () => {
      window.clearInterval(id);
      timers.delete(id);
    };
  }

  window.AdminMissionCountdown = {
    formatCountdownParts,
    formatCountdownHtml,
    startMinuteTicker,
    stopAll() {
      for (const id of timers) window.clearInterval(id);
      timers.clear();
    },
  };
})();
