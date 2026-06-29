(function () {
  const { link: driverLink, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName ?? ''),
    escapeHtml: (v) => String(v ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
  const Insights = window.BPFantasyInsights || {};
  const Auth = window.BPFantasyAuth || {};
  const Optimizer = window.BPFantasyLineupOptimizer || {};

  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');
  const renderActivityStatus = (driver, options) =>
    Pills.renderActivityStatus
      ? Pills.renderActivityStatus(driver, options)
      : escapeHtml(driver.status || 'Active');
  const driverInactiveRowClass = (driver) =>
    Pills.driverInactiveRowClass ? Pills.driverInactiveRowClass(driver) : '';

  const LINEUP_SIZE = 5;

  let cachedDrivers = [];
  let slateMeta = {};
  let salaryCap = 50000;
  let selectedIds = [];
  let lockState = {};
  let savedLineup = null;
  let isLoggedIn = false;
  let submitMessage = '';
  let slatePlayable = true;
  let slatePhase = 'active';
  let raceComplete = false;

  function $(sel) {
    return document.querySelector(sel);
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function driverById(id) {
    return cachedDrivers.find((d) => String(d.driverId) === String(id));
  }

  function selectedDrivers() {
    return selectedIds.map((id) => driverById(id)).filter(Boolean);
  }

  function totalSalary(drivers = selectedDrivers()) {
    return drivers.reduce((sum, d) => sum + Number(d.salary || 0), 0);
  }

  function isLocked() {
    return Boolean(
      raceComplete ||
      lockState.isLocked ||
      lockState.raceComplete ||
      savedLineup?.status === 'locked' ||
      !slatePlayable
    );
  }

  function canPick() {
    return slatePlayable && !raceComplete && !Boolean(lockState.isLocked || lockState.raceComplete);
  }

  function canSubmit() {
    return isLoggedIn && !isLocked();
  }

  function isDriverInactive(driver) {
    return Pills.isDriverInactive ? Pills.isDriverInactive(driver) : String(driver?.status || 'Active') === 'Inactive';
  }

  function renderSalaryMeter() {
    const used = totalSalary();
    const remaining = salaryCap - used;
    const pct = salaryCap > 0 ? Math.min(100, (used / salaryCap) * 100) : 0;
    const overCap = used > salaryCap;
    return `
      <div class="fantasy-lineup-salary-meter">
        <div class="fantasy-lineup-salary-meter__track">
          <div class="fantasy-lineup-salary-meter__fill${overCap ? ' is-over' : ''}" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <div class="fantasy-lineup-salary-meter__label">
          <strong>${formatMoney(used)}</strong> used · <span>${formatMoney(Math.max(0, remaining))} remaining</span> · cap ${formatMoney(salaryCap)}
        </div>
      </div>`;
  }

  function renderSelectedLineup() {
    const drivers = selectedDrivers();
    if (!drivers.length) {
      return `<p class="muted">Select ${LINEUP_SIZE} drivers from the pool below.</p>`;
    }

    return `
      <ol class="fantasy-lineup-pick-list">
        ${drivers
          .map(
            (driver, index) => `
          <li class="fantasy-lineup-pick-row${driverInactiveRowClass(driver) ? ` ${driverInactiveRowClass(driver)}` : ''}">
            <span class="fantasy-lineup-pick-row__slot">${index + 1}</span>
            <span class="fantasy-lineup-pick-row__name">${driverLink(driver, driver.driverName)}</span>
            <span class="fantasy-lineup-pick-row__salary salary">${formatMoney(driver.salary)}</span>
            ${renderFantasyGradePill(driver.valueGrade)}
            ${
              canPick()
                ? `<button type="button" class="fantasy-lineup-pick-row__remove" data-remove-id="${escapeHtml(driver.driverId)}" aria-label="Remove ${escapeHtml(driver.driverName)}">×</button>`
                : ''
            }
          </li>`
          )
          .join('')}
      </ol>`;
  }

  function renderStatusBanner() {
    if (raceComplete || slatePhase === 'race-complete' || slateMeta.isArchived) {
      return `<p class="fantasy-lineup-warning"><strong>Race complete:</strong> This slate is archived. Scoring is pending — lineup submission and editing are closed.</p>`;
    }
    if (!slatePlayable) {
      return `<p class="fantasy-lineup-warning"><strong>Next slate coming soon.</strong> Lineup building opens when the next race slate is published.</p>`;
    }
    if (lockState.lockMessage && !lockState.hasLockSchedule) {
      return `<p class="fantasy-lineup-warning"><strong>Notice:</strong> ${escapeHtml(lockState.lockMessage)} — submissions stay open until an admin sets a lock time.</p>`;
    }
    if (isLocked()) {
      return `<p class="fantasy-lineup-warning"><strong>Locked:</strong> Lineups are closed for this race.</p>`;
    }
    if (savedLineup?.submittedAt) {
      return `<p class="fantasy-lineup-note">Your lineup is saved. You can edit until lock time.</p>`;
    }
    if (!isLoggedIn) {
      return `<p class="fantasy-lineup-warning"><strong>Login required to submit.</strong> <a class="fantasy-driver-link" href="/fantasy/login.html">Log in</a> or <a class="fantasy-driver-link" href="/fantasy/signup.html">sign up</a>.</p>`;
    }
    return '';
  }

  function renderBuilderPanel() {
    const drivers = selectedDrivers();
    const validCount = drivers.length === LINEUP_SIZE;
    const overCap = totalSalary() > salaryCap;
    const dupes = new Set(selectedIds).size !== selectedIds.length;

    return `
      <section class="fantasy-app-section fantasy-lineup-builder fantasy-glass-panel">
        <h2 class="fantasy-app-section-title">Your Lineup</h2>
        ${renderStatusBanner()}
        ${renderSelectedLineup()}
        ${renderSalaryMeter()}
        <div class="fantasy-lineup-builder__actions">
          ${
            canPick()
              ? `<button type="button" id="fantasySuggestLineupBtn" class="fantasy-btn fantasy-btn--secondary">Suggest Lineup</button>
                 <button type="button" id="fantasyClearLineupBtn" class="fantasy-btn fantasy-btn--secondary">Clear</button>
                 ${canSubmit() ? `<button type="button" id="fantasySubmitLineupBtn" class="fantasy-btn fantasy-btn--primary"${!validCount || overCap || dupes ? ' disabled' : ''}>${savedLineup ? 'Update Lineup' : 'Submit Lineup'}</button>` : `<a class="fantasy-btn fantasy-btn--primary" href="/fantasy/login.html">Log In to Submit</a>`}`
              : ''
          }
        </div>
        <p id="fantasyLineupSubmitMessage" class="fantasy-auth-message${submitMessage.startsWith('Saved') ? ' is-success' : ' is-error'}"${submitMessage ? '' : ' hidden'}>${escapeHtml(submitMessage)}</p>
      </section>`;
  }

  function renderPlayerPool() {
    const sorted = [...cachedDrivers].sort(
      (a, b) => Number(a.fantasyRank ?? 999) - Number(b.fantasyRank ?? 999)
    );

    return `
      <section class="fantasy-app-section">
        <h2 class="fantasy-app-section-title">Driver Pool</h2>
        <div class="fantasy-table-wrap">
          <table class="fantasy-slate-table fantasy-lineup-pool-table">
            <thead>
              <tr>
                <th></th>
                <th>Rank</th>
                <th>Driver</th>
                <th>Salary</th>
                <th>Grade</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${sorted
                .map((driver) => {
                  const id = String(driver.driverId);
                  const selected = selectedIds.includes(id);
                  const full = selectedIds.length >= LINEUP_SIZE && !selected;
                  const inactiveClass = driverInactiveRowClass(driver);
                  return `<tr${inactiveClass ? ` class="${inactiveClass}"` : ''}>
                    <td>
                      ${
                        canPick()
                          ? `<button type="button" class="fantasy-lineup-pick-btn${selected ? ' is-selected' : ''}" data-pick-id="${escapeHtml(id)}"${full && !selected ? ' disabled' : ''}>${selected ? 'Selected' : 'Add'}</button>`
                          : '—'
                      }
                    </td>
                    <td>${driver.fantasyRank != null ? `#${escapeHtml(driver.fantasyRank)}` : '—'}</td>
                    <td>${driverLink(driver, driver.driverName)}</td>
                    <td class="salary">${formatMoney(driver.salary)}</td>
                    <td>${renderFantasyGradePill(driver.valueGrade)}</td>
                    <td>${renderActivityStatus(driver, { uppercase: true })}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderPage() {
    const root = $('#fantasyLineupRoot');
    if (!root) return;

    root.innerHTML = `
      <section class="fantasy-app-hero-panel fantasy-glass-panel">
        <p class="fantasy-app-eyebrow">BP Fantasy Lineup Builder</p>
        <h1 class="fantasy-app-page-title">Race ${escapeHtml(slateMeta.raceNumber ?? '—')} — ${escapeHtml(slateMeta.track || 'TBD')}</h1>
        <div class="fantasy-slate-meta-grid">
          <div><span>Lock</span><strong>${escapeHtml(slateMeta.lockTime || lockState.lockMessage || 'TBD')}</strong></div>
          <div><span>Salary Cap</span><strong>${formatMoney(salaryCap)}</strong></div>
          <div><span>Lineup Size</span><strong>${LINEUP_SIZE} drivers</strong></div>
          <div><span>Slate Status</span><strong>${escapeHtml(slatePhase === 'race-complete' ? 'Race complete' : slateMeta.status || '—')}</strong></div>
        </div>
      </section>
      <div id="fantasyLineupBuilder">${renderBuilderPanel()}</div>
      <div id="fantasyLineupPool">${renderPlayerPool()}</div>`;

    bindBuilderEvents();
  }

  function toggleDriver(id) {
    if (!canPick()) return;
    const sid = String(id);
    const driver = driverById(sid);
    if (selectedIds.includes(sid)) {
      selectedIds = selectedIds.filter((x) => x !== sid);
      submitMessage = '';
    } else if (selectedIds.length < LINEUP_SIZE) {
      if (driver && isDriverInactive(driver)) {
        submitMessage = `${driver.driverName} is inactive — high risk they may not race this week.`;
      } else {
        submitMessage = '';
      }
      selectedIds = [...selectedIds, sid];
    }
    refreshBuilder();
  }

  function refreshBuilder() {
    const builder = $('#fantasyLineupBuilder');
    const pool = $('#fantasyLineupPool');
    if (builder) builder.innerHTML = renderBuilderPanel();
    if (pool) pool.innerHTML = renderPlayerPool();
    bindBuilderEvents();
  }

  function bindBuilderEvents() {
    document.querySelectorAll('[data-pick-id]').forEach((btn) => {
      btn.addEventListener('click', () => toggleDriver(btn.getAttribute('data-pick-id')));
    });
    document.querySelectorAll('[data-remove-id]').forEach((btn) => {
      btn.addEventListener('click', () => toggleDriver(btn.getAttribute('data-remove-id')));
    });
    $('#fantasyClearLineupBtn')?.addEventListener('click', () => {
      selectedIds = [];
      submitMessage = '';
      refreshBuilder();
    });
    $('#fantasySuggestLineupBtn')?.addEventListener('click', () => {
      if (!Optimizer.optimizePublicLineup) return;
      const result = Optimizer.optimizePublicLineup(cachedDrivers, {
        salaryCap,
        lineupSize: LINEUP_SIZE,
        strategy: 'balanced',
        maxAlternatives: 0,
      });
      if (result?.ok && result.optimalLineup?.drivers?.length) {
        selectedIds = result.optimalLineup.drivers.map((d) => String(d.driverId));
        submitMessage = '';
        refreshBuilder();
      }
    });
    $('#fantasySubmitLineupBtn')?.addEventListener('click', submitLineup);
  }

  async function submitLineup() {
    if (!canSubmit()) return;
    submitMessage = '';
    const drivers = selectedDrivers();
    if (drivers.length !== LINEUP_SIZE) {
      submitMessage = `Select exactly ${LINEUP_SIZE} drivers.`;
      refreshBuilder();
      return;
    }
    if (new Set(selectedIds).size !== selectedIds.length) {
      submitMessage = 'Duplicate drivers are not allowed.';
      refreshBuilder();
      return;
    }
    const inactive = drivers.filter((d) => isDriverInactive(d));
    if (inactive.length) {
      submitMessage = `${inactive.map((d) => d.driverName).join(', ')} ${inactive.length === 1 ? 'is' : 'are'} inactive and cannot be rostered.`;
      refreshBuilder();
      return;
    }
    if (totalSalary() > salaryCap) {
      submitMessage = 'Lineup is over the salary cap.';
      refreshBuilder();
      return;
    }

    try {
      const res = await Auth.authFetch('/api/settings?action=submitLineup', {
        method: 'POST',
        body: JSON.stringify({
          drivers: drivers.map((d) => ({ driverId: d.driverId })),
          salaryCap,
          lineupSize: LINEUP_SIZE,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed.');
      savedLineup = data.lineup;
      submitMessage = 'Saved — your lineup is submitted for this race.';
      refreshBuilder();
    } catch (error) {
      submitMessage = error.message || 'Could not submit lineup.';
      refreshBuilder();
    }
  }

  async function loadSavedLineup() {
    if (!isLoggedIn) return;
    try {
      const res = await Auth.authFetch('/api/settings?action=getLineup');
      if (!res.ok) return;
      const data = await res.json();
      if (data.lock) lockState = { ...lockState, ...data.lock };
      if (data.lineup?.drivers?.length) {
        savedLineup = data.lineup;
        selectedIds = data.lineup.drivers.map((d) => String(d.driverId));
      }
    } catch {
      /* ignore */
    }
  }

  async function init() {
    const root = $('#fantasyLineupRoot');
    if (!root) return;

    try {
      const slateRes = await fetch('/api/settings?action=getFantasyPublicSlate');
      if (!slateRes.ok) throw new Error('slate');
      const slateData = await slateRes.json();
      cachedDrivers = slateData.drivers || [];
      slateMeta = slateData.slate || {};
      slatePlayable = slateMeta.playable !== false && slateData.progression?.isPlayable !== false;
      slatePhase = slateMeta.slatePhase || slateData.progression?.slatePhase || 'active';
      raceComplete = Boolean(slateMeta.raceComplete || slateMeta.scoringPending || slatePhase === 'race-complete');
      salaryCap = Number(slateMeta.salaryCap) || 50000;
      lockState = {
        lockTime: slateMeta.lockTime,
        lockAt: slateMeta.lockAt,
        lockMessage: slateMeta.lockMessage || lockState.lockMessage || null,
        hasLockSchedule: Boolean(slateMeta.lockAt),
        isLocked: raceComplete || Boolean(slateMeta.lockAt && Date.now() >= new Date(slateMeta.lockAt).getTime()),
        raceComplete,
      };

      try {
        await Auth.init();
        const session = await Auth.getSession();
        isLoggedIn = Boolean(session);
      } catch {
        isLoggedIn = false;
      }

      await loadSavedLineup();
      if (lockState.raceComplete || raceComplete) {
        lockState.isLocked = true;
      }
      renderPage();
    } catch {
      root.innerHTML = '<section class="fantasy-app-empty"><p>Fantasy slate coming soon.</p></section>';
    }
  }

  window.BPFantasyLineupApp = { init };
})();
