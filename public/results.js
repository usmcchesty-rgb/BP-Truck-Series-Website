const $ = (s) => document.querySelector(s);

const PLACEHOLDER_PHOTO = "/assets/drivers/placeholder.png";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function formatOrdinal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return "—";
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function driverProfileUrl(driverId) {
  return `/drivers/${encodeURIComponent(String(driverId || ""))}`;
}

function renderRaceSelector(completedRaces, selectedRaceNumber) {
  if (!completedRaces?.length) return "";

  const options = completedRaces
    .map((race) => {
      const label = `Race ${race.raceNumber} — ${race.track || "TBD"}`;
      const selected =
        Number(race.raceNumber) === Number(selectedRaceNumber) ? " selected" : "";
      return `<option value="${escapeAttr(race.raceNumber)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");

  return `<label class="results-selector-label" for="raceSelector">Select Race</label>
    <select id="raceSelector" class="results-selector">${options}</select>`;
}

function renderFeaturedHeader(raceResults) {
  const raceNumber = raceResults.selectedRaceNumber;
  const track = raceResults.selectedRaceName || "TBD";
  const date = raceResults.selectedRaceDate || "";
  const winner = raceResults.selectedRaceWinner || "—";
  const isLatest =
    Number(raceResults.selectedRaceNumber) ===
    Number(raceResults.latestCompletedRaceNumber);
  const kicker = isLatest ? "Latest Race Results" : "Race Results";

  return `<section class="results-featured">
    <div class="results-featured-head">
      <span class="results-kicker">${escapeHtml(kicker)}</span>
      <h1 class="results-featured-title">Race ${escapeHtml(raceNumber)} — ${escapeHtml(track)}</h1>
      <div class="results-featured-meta">
        ${date ? `<span>${escapeHtml(date)}</span>` : ""}
        <span class="results-featured-winner">Winner: <strong>${escapeHtml(winner)}</strong></span>
      </div>
    </div>
    <div class="results-selector-wrap">
      ${renderRaceSelector(raceResults.completedRaces, raceResults.selectedRaceNumber)}
    </div>
  </section>`;
}

function renderResultsTable(rows) {
  if (!rows?.length) {
    return `<p class="results-empty">Detailed results are not available for this race.</p>`;
  }

  const body = rows
    .map((row) => {
      const rowClass = row.isWinner ? "results-row is-winner" : "results-row";
      return `<tr class="${rowClass}">
        <td class="results-pos">${escapeHtml(String(row.position))}</td>
        <td class="results-driver">
          <a class="results-driver-link" href="${driverProfileUrl(row.driverId)}">
            <img
              class="results-driver-photo"
              src="${escapeHtml(row.photoUrl || PLACEHOLDER_PHOTO)}"
              alt=""
              loading="lazy"
              onerror="this.onerror=null;this.src='${PLACEHOLDER_PHOTO}'"
            />
            <span>${escapeHtml(row.driverName)}</span>
          </a>
        </td>
        <td>${escapeHtml(formatCell(row.carNumber))}</td>
        <td>${row.startingPos ? escapeHtml(formatOrdinal(row.startingPos)) : "—"}</td>
        <td class="results-finish">${escapeHtml(formatOrdinal(row.finish))}</td>
        <td>${formatCell(row.lapsLed)}</td>
        <td>${formatCell(row.incidents)}</td>
        <td>${formatCell(row.points)}</td>
      </tr>`;
    })
    .join("");

  return `<div class="results-table-wrap">
    <table class="results-table">
      <thead>
        <tr>
          <th>Pos</th>
          <th>Driver</th>
          <th>Car #</th>
          <th>Start</th>
          <th>Finish</th>
          <th>Laps Led</th>
          <th>Incidents</th>
          <th>Points</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

function renderPage(raceResults) {
  const page = $("#resultsPage");
  if (!page) return;

  if (!raceResults?.completedRaces?.length) {
    page.innerHTML = `
      <section class="results-featured results-featured--empty">
        <span class="results-kicker">Race Results</span>
        <h1 class="results-featured-title">No Completed Races Yet</h1>
        <p class="results-empty">Race results will appear here after the first points race is completed.</p>
      </section>
    `;
    return;
  }

  page.innerHTML = `
    ${renderFeaturedHeader(raceResults)}
    <section class="results-table-section">
      ${renderResultsTable(raceResults.rows)}
    </section>
  `;

  $("#raceSelector")?.addEventListener("change", (event) => {
    const raceNumber = event.target.value;
    loadResults(raceNumber);
  });
}

async function loadResults(raceNumber) {
  const page = $("#resultsPage");
  if (!page) return;

  try {
    const url = raceNumber
      ? `/api/schedule?raceNumber=${encodeURIComponent(raceNumber)}`
      : "/api/schedule";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderPage(data.raceResults || {});
  } catch (e) {
    console.error("Failed to load race results:", e);
    page.innerHTML = `<p class="results-empty">Failed to load race results.</p>`;
  }
}

loadResults();
