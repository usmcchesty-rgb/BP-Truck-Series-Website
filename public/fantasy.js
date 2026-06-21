// BP Fantasy (Phase 2.5) — front-end only landing page mock.
// - No backend calls
// - No auth
// - No lineup submission
// - No scoring backend
// Uses placeholder/demo data only.

const DEMO_FEATURED_DRIVERS = [
  { name: 'Mark Arthur', carNumber: '12', salary: 12500, form: 'hot' },
  { name: 'Cody Gibson', carNumber: '7', salary: 11200, form: 'up' },
  { name: 'Mike Massengill', carNumber: '20', salary: 10800, form: 'stable' },
  { name: 'Dalton Kilroe', carNumber: '41', salary: 9400, form: 'up' },
  { name: 'Larry Bell', carNumber: '43', salary: 8750, form: 'down' },
  { name: 'Michael Boone', carNumber: '15', salary: 8200, form: 'hot' },
];

const DEMO_STANDINGS = [
  { rank: 1, team: 'Pedal Pushers', points: 412 },
  { rank: 2, team: 'Checkered Chasers', points: 398 },
  { rank: 3, team: 'Red Line Racing', points: 385 },
  { rank: 4, team: 'Pit Row Prophets', points: 371 },
  { rank: 5, team: 'Draft Day Heroes', points: 364 },
];

const FORM_LABELS = {
  hot: 'Hot',
  up: 'Up',
  stable: 'Stable',
  down: 'Down',
};

function resolveServerOpenTime(settings = {}) {
  return String(settings.serverOpenTime ?? settings.raceStartTime ?? '').trim();
}

function formatSalary(value) {
  return `$${Number(value).toLocaleString('en-US')}`;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.BPFantasyLanding = {
  init() {
    const root = document.querySelector('.fantasy-main');
    if (!root) return;

    this.renderFeaturedDrivers(root);
    this.renderStandingsPreview(root);
    this.renderScoringPreview(root);
    this.loadServerOpenSettings(root);
  },

  async loadServerOpenSettings(root) {
    const display = root.querySelector('#serverOpenTimeDisplay');
    if (!display) return;

    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;

      const settings = await res.json();
      const serverOpenTime = resolveServerOpenTime(settings);
      if (serverOpenTime) {
        display.textContent = serverOpenTime;
      }
    } catch {
      // Demo page remains usable without settings.
    }
  },

  renderFeaturedDrivers(root) {
    const grid = root.querySelector('#featuredDriversGrid');
    if (!grid) return;

    grid.innerHTML = DEMO_FEATURED_DRIVERS.map((driver) => {
      const formKey = driver.form in FORM_LABELS ? driver.form : 'stable';
      const formLabel = FORM_LABELS[formKey];

      return `
        <article class="fantasy-driver-card">
          <div class="fantasy-driver-photo" aria-hidden="true">
            <span>Driver Photo</span>
          </div>
          <div class="fantasy-driver-meta">
            <div class="fantasy-driver-name">${escapeHtml(driver.name)}</div>
            <div class="fantasy-driver-number">#${escapeHtml(driver.carNumber)}</div>
          </div>
          <div class="fantasy-driver-row">
            <span class="fantasy-driver-salary">${formatSalary(driver.salary)}</span>
            <span class="fantasy-form fantasy-form--${formKey}">${formLabel}</span>
          </div>
        </article>
      `;
    }).join('');
  },

  renderStandingsPreview(root) {
    const tbody = root.querySelector('#standingsPreviewBody');
    if (!tbody) return;

    tbody.innerHTML = DEMO_STANDINGS.map((entry) => {
      const rankClass =
        entry.rank === 1 ? 'fantasy-rank--gold' :
        entry.rank === 2 ? 'fantasy-rank--silver' :
        entry.rank === 3 ? 'fantasy-rank--bronze' : '';

      return `
        <tr>
          <td class="fantasy-rank ${rankClass}">${entry.rank}</td>
          <td>${escapeHtml(entry.team)}</td>
          <td class="fantasy-points">${entry.points.toLocaleString('en-US')}</td>
        </tr>
      `;
    }).join('');
  },

  renderScoringPreview(root) {
    const table = root.querySelector('.fantasy-table:not(.fantasy-standings-table)');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const demoRows = [
      {
        finish: 'Earned by finish',
        diff: 'Position changes',
        lapsCompleted: 'Completion credit',
        lapsLed: 'Leader credit',
      },
      {
        finish: 'Example: 30 pts',
        diff: 'Example: ±10 pts',
        lapsCompleted: 'Example: 5 laps = 5 pts',
        lapsLed: 'Example: 3 laps = 6 pts',
      },
    ];

    const existingRows = Array.from(tbody.querySelectorAll('tr'));
    if (existingRows.length >= demoRows.length) {
      existingRows.slice(0, demoRows.length).forEach((row, idx) => {
        const d = demoRows[idx];
        const cells = row.querySelectorAll('td');
        const values = [d.finish, d.diff, d.lapsCompleted, d.lapsLed];

        cells.forEach((cell, cIdx) => {
          cell.textContent = values[cIdx];
          cell.classList.toggle('fantasy-muted', idx === 1);
        });
      });
      return;
    }

    tbody.innerHTML = '';
    demoRows.forEach((d, i) => {
      const tr = document.createElement('tr');
      [d.finish, d.diff, d.lapsCompleted, d.lapsLed].forEach((val) => {
        const td = document.createElement('td');
        td.textContent = val;
        if (i === 1) td.classList.add('fantasy-muted');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  },
};

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.BPFantasyLanding?.init?.();
  } catch {
    // no-op
  }
});
