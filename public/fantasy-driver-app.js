(function () {
  const { link: driverLink, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    escapeHtml: (v) => String(v ?? ''),
  };

  const PLACEHOLDER_PHOTO = '/assets/drivers/placeholder.png';

  function $(selector) {
    return document.querySelector(selector);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function changeClass(direction) {
    if (direction === 'up') return 'is-up';
    if (direction === 'down') return 'is-down';
    if (direction === 'new') return 'is-new';
    return 'is-same';
  }

  function driverImage(name) {
    const slug = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `/assets/drivers/${slug}.png`;
  }

  function normalizeLookupName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findProfileByName(profiles, name, driverId) {
    if (!Array.isArray(profiles) || !profiles.length) return null;

    if (driverId) {
      const match = profiles.find((row) => String(row.driver_id) === String(driverId));
      if (match) return match;
    }

    const lookupName = normalizeLookupName(name);
    if (!lookupName) return null;

    return (
      profiles.find((row) => {
        const names = [row.display_name, row.iracing_name, row.driver_name].map(normalizeLookupName);
        return names.includes(lookupName);
      }) || null
    );
  }

  async function resolveDriverProfile(fantasyDriver = {}, queryId = '', queryName = '') {
    const name = fantasyDriver.driverName || queryName || '';
    const id = fantasyDriver.driverId || queryId || '';

    if (id) {
      try {
        const res = await fetch(`/api/drivers?driver_id=${encodeURIComponent(id)}`);
        if (res.ok) {
          const profile = await res.json();
          if (profile?.driver_id) return profile;
        }
      } catch {
        /* fall through to list lookup */
      }
    }

    if (name || id) {
      try {
        const res = await fetch('/api/drivers');
        if (res.ok) {
          const profiles = await res.json();
          return findProfileByName(Array.isArray(profiles) ? profiles : [], name, id);
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  function renderHeroPhoto(profile, name) {
    const standing = window.BPDriverStandingPhoto;
    if (standing?.hasStandingPhoto(profile)) {
      const url = standing.displayUrl(profile);
      const style = standing.cropStyle(profile);
      return `<div class="fantasy-driver-hero-media fantasy-driver-hero-media--standing">
        <div class="fantasy-driver-standing-wrap" style="${escapeAttr(style)}">
          <img
            class="fantasy-driver-standing-photo"
            src="${escapeAttr(url)}"
            alt="${escapeAttr(name)}"
            onerror="this.onerror=null;this.src='${PLACEHOLDER_PHOTO}'"
          />
        </div>
      </div>`;
    }

    const photo = profile?.photoUrl || profile?.photo_url || driverImage(name);
    return `<div class="fantasy-driver-hero-media">
      <img
        class="fantasy-driver-hero-photo"
        src="${escapeHtml(photo)}"
        alt="${escapeHtml(name)}"
        onerror="this.onerror=null;this.src='${PLACEHOLDER_PHOTO}'"
      />
    </div>`;
  }

  function renderHeroBadges(driver = {}) {
    const badges = [
      driver.tier ? { label: 'Tier', value: driver.tier } : null,
      driver.fantasyRank != null ? { label: 'Fantasy Rank', value: `#${driver.fantasyRank}` } : null,
      driver.trackRankLabel && driver.trackRankLabel !== '—'
        ? { label: 'Track Rank', value: driver.trackRankLabel }
        : null,
    ].filter(Boolean);

    if (!badges.length) return '';

    return `<div class="fantasy-driver-hero-badges">
      ${badges
        .map(
          (badge) => `<span class="fantasy-driver-hero-badge">
            <span class="fantasy-driver-hero-badge__label">${escapeHtml(badge.label)}</span>
            <span class="fantasy-driver-hero-badge__value">${escapeHtml(badge.value)}</span>
          </span>`
        )
        .join('')}
    </div>`;
  }

  function renderHero(driver = {}, slate = {}, profile = null) {
    const name = driver.driverName || 'Driver';
    const photoHtml = renderHeroPhoto(profile, name);

    return `
      <section class="fantasy-driver-hero fantasy-app-hero-panel fantasy-glass-panel">
        <div class="fantasy-driver-hero__content">
          <p class="fantasy-app-eyebrow">Driver Detail</p>
          <h1 class="fantasy-app-page-title">${escapeHtml(name)}${driver.carNumber ? ` <span class="muted">#${escapeHtml(driver.carNumber)}</span>` : ''}</h1>
          ${renderHeroBadges(driver)}
          <p class="fantasy-app-readonly-note">Race ${escapeHtml(slate.raceNumber ?? '—')} · ${escapeHtml(slate.track || 'TBD')} · Read-only preview</p>
        </div>
        ${photoHtml}
      </section>
    `;
  }

  function queryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      id: params.get('id') || params.get('driverId') || '',
      driver: params.get('driver') || params.get('driverName') || '',
    };
  }

  function renderEmpty(message) {
    const root = $('#fantasyDriverRoot');
    if (!root) return;
    root.innerHTML = `
      <section class="fantasy-app-empty">
        <p>${escapeHtml(message)}</p>
        <a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/slate.html">Back to Race Slate</a>
      </section>
    `;
  }

  function renderReasons(reasons = []) {
    if (!reasons.length) return '<p class="muted">No breakdown reasons available.</p>';
    return `<ul class="fantasy-driver-reasons">${reasons.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
  }

  function renderHistoryTable(history = []) {
    if (!history.length) {
      return '<p class="muted">No salary history rows for this driver yet.</p>';
    }
    return `
      <div class="fantasy-table-wrap">
        <table class="fantasy-slate-table fantasy-slate-table--compact">
          <thead><tr><th>Race</th><th>Track</th><th>Salary</th><th>Tier</th><th>Score</th></tr></thead>
          <tbody>
            ${history
              .map(
                (row) => `<tr>
                <td>${escapeHtml(row.raceNumber)}</td>
                <td>${escapeHtml(row.track)}</td>
                <td class="salary">${formatMoney(row.salary)}</td>
                <td>${escapeHtml(row.tier)}</td>
                <td>${Number(row.fantasyScore).toFixed(1)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderDriverPage(data, profile = null) {
    const root = $('#fantasyDriverRoot');
    if (!root) return;

    const driver = data.driver || {};
    const slate = data.slate || {};

    root.innerHTML = `
      ${renderHero(driver, slate, profile)}

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Slate Profile</h2>
        <div class="fantasy-driver-detail-grid">
          <div><span>Current Salary</span><strong class="salary">${formatMoney(driver.salary)}</strong></div>
          <div><span>Previous Salary</span><strong>${formatMoney(driver.previousSalary)}</strong></div>
          <div><span>Salary Change</span><strong><span class="fantasy-change ${changeClass(driver.salaryChangeDirection)}">${escapeHtml(driver.salaryChangeLabel || '—')}</span></strong></div>
          <div><span>Value Grade</span><strong>${driver.valueGrade ? `<span class="fantasy-grade-pill">${escapeHtml(driver.valueGrade)}</span>` : '—'}</strong></div>
          <div><span>Value Score</span><strong>${driver.valueScore != null ? Number(driver.valueScore).toFixed(2) : '—'}</strong></div>
          <div><span>Fantasy Rank</span><strong>${driver.fantasyRank != null ? `#${escapeHtml(driver.fantasyRank)}` : '—'}</strong></div>
          <div><span>Tier</span><strong>${escapeHtml(driver.tier || '—')}</strong></div>
          <div><span>Track Rank</span><strong>${escapeHtml(driver.trackRankLabel || '—')}</strong></div>
          <div><span>Proven Track Rank</span><strong>${driver.provenTrackHistoryRank != null ? `#${escapeHtml(driver.provenTrackHistoryRank)}` : '—'}</strong></div>
          <div><span>Projected Ownership</span><strong>${driver.projectedOwnershipPct != null ? `${driver.projectedOwnershipPct}% (${escapeHtml(driver.ownershipLabel || '')})` : '—'}</strong></div>
          <div><span>Fantasy Tier Score</span><strong>${driver.fantasyTierScore != null ? Number(driver.fantasyTierScore).toFixed(1) : '—'}</strong></div>
          <div><span>Recent Form</span><strong>${escapeHtml(driver.recentFormSummary || '—')}</strong></div>
        </div>
      </section>

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Salary History</h2>
        ${renderHistoryTable(data.salaryHistory || [])}
      </section>

      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Breakdown Summary</h2>
        ${renderReasons(driver.breakdownSummary || [])}
      </section>

      <p><a class="fantasy-btn fantasy-btn--secondary" href="/fantasy/slate.html">Back to Race Slate</a></p>
    `;
  }

  async function loadDriverDetail() {
    const { id, driver } = queryParams();
    if (!id && !driver) {
      renderEmpty('Driver not found in current fantasy slate.');
      return;
    }

    const query = id
      ? `id=${encodeURIComponent(id)}`
      : `driver=${encodeURIComponent(driver)}`;

    try {
      const [detailRes, profile] = await Promise.all([
        fetch(`/api/settings?action=getFantasyDriverDetail&${query}`),
        resolveDriverProfile({ driverId: id, driverName: driver }, id, driver),
      ]);

      if (!detailRes.ok) {
        renderEmpty('Driver not found in current fantasy slate.');
        return;
      }

      const data = await detailRes.json();
      const resolvedProfile =
        profile || (await resolveDriverProfile(data.driver || {}, id, driver));
      renderDriverPage(data, resolvedProfile);
    } catch {
      renderEmpty('Driver not found in current fantasy slate.');
    }
  }

  window.BPFantasyDriverApp = {
    init() {
      loadDriverDetail();
    },
  };
})();
