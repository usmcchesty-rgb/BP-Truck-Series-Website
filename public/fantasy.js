// BP Fantasy (Phase 2) — front-end only landing page mock.
// - No backend calls
// - No auth
// - No lineup submission
// - No scoring backend
// Uses placeholder/demo data only.

window.BPFantasyLanding = {
  init() {
    const root = document.querySelector('.fantasy-main');
    if (!root) return;

    // Scoring preview table: demo values (placeholder labels only).
    // The page design will be updated later when scoring connects.
    const table = root.querySelector('.fantasy-table');
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

    const renderCell = (value) => {
      const td = document.createElement('td');
      td.textContent = value;
      return td;
    };

    // Keep first two rows structure but ensure consistent demo text.
    // If rows already exist, rewrite them.
    const existingRows = Array.from(tbody.querySelectorAll('tr'));
    if (existingRows.length >= demoRows.length) {
      existingRows.slice(0, demoRows.length).forEach((row, idx) => {
        const d = demoRows[idx];
        const cells = row.querySelectorAll('td');
        const values = [d.finish, d.diff, d.lapsCompleted, d.lapsLed];

        cells.forEach((cell, cIdx) => {
          const v = values[cIdx];
          cell.textContent = v;
          cell.classList.toggle('fantasy-muted', idx === 1);
        });
      });
      return;
    }

    tbody.innerHTML = '';
    for (let i = 0; i < demoRows.length; i++) {
      const d = demoRows[i];
      const tr = document.createElement('tr');

      const values = [d.finish, d.diff, d.lapsCompleted, d.lapsLed];
      values.forEach((val) => {
        const td = document.createElement('td');
        td.textContent = val;
        if (i === 1) td.classList.add('fantasy-muted');
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }
  },
};

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.BPFantasyLanding?.init?.();
  } catch {
    // no-op
  }
});


