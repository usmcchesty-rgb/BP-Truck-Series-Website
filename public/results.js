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

function driverProfileUrl(row) {
  if (row?.profileUrl) return String(row.profileUrl);
  const id = row?.profileDriverId || row?.driverId || "";
  return `/drivers/${encodeURIComponent(String(id || ""))}`;
}

function raceDisplayLabel(raceOrResults) {
  return (
    raceOrResults?.displayRaceLabel ||
    raceOrResults?.selectedDisplayRaceLabel ||
    (raceOrResults?.raceNumber != null ? String(raceOrResults.raceNumber) : "") ||
    (raceOrResults?.selectedRaceNumber != null
      ? String(raceOrResults.selectedRaceNumber)
      : "")
  );
}

function raceOptionValue(race) {
  if (race?.scheduleId) return `sid:${race.scheduleId}`;
  if (race?.displayRaceLabel) return `label:${race.displayRaceLabel}`;
  return `n:${race?.raceNumber ?? ""}`;
}

function parseResultsQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    scheduleId: params.get("scheduleId") || params.get("schedule_id") || "",
    race:
      params.get("race") ||
      params.get("raceLabel") ||
      params.get("raceNumber") ||
      "",
  };
}

function buildResultsApiUrl({ scheduleId = "", race = "" } = {}) {
  const params = new URLSearchParams();
  // Results page only needs raceResults — skip season-wide caution scraping.
  params.set("omitCautionStats", "1");
  if (scheduleId) params.set("scheduleId", scheduleId);
  if (race) {
    if (/^\d+[A-Za-z]$/i.test(race)) params.set("race", race);
    else if (/^\d+$/.test(String(race))) params.set("raceNumber", String(race));
    else params.set("race", race);
  }
  return `/api/schedule?${params.toString()}`;
}

function renderRaceSelector(completedRaces, selected) {
  if (!completedRaces?.length) return "";

  const selectedSid = selected?.selectedScheduleId
    ? String(selected.selectedScheduleId)
    : "";
  const selectedLabel = raceDisplayLabel(selected);

  const options = completedRaces
    .map((race) => {
      const label =
        race.displayTitle ||
        `Race ${race.displayRaceLabel || race.raceNumber} — ${race.track || "TBD"}`;
      const value = raceOptionValue(race);
      const selectedAttr =
        (selectedSid && String(race.scheduleId) === selectedSid) ||
        (!selectedSid &&
          String(race.displayRaceLabel || race.raceNumber) === String(selectedLabel))
          ? " selected"
          : "";
      return `<option value="${escapeAttr(value)}"${selectedAttr}>${escapeHtml(label)}</option>`;
    })
    .join("");

  return `<label class="results-selector-label" for="raceSelector">Select Race</label>
    <select id="raceSelector" class="results-selector">${options}</select>`;
}

function formatResultsMeta(raceResults) {
  const parts = [];
  if (raceResults.selectedRaceDate) {
    parts.push(`<span>${escapeHtml(raceResults.selectedRaceDate)}</span>`);
  }
  parts.push(
    `<span class="results-featured-winner">Winner: <strong>${escapeHtml(
      raceResults.selectedRaceWinner || "—"
    )}</strong></span>`
  );
  if (
    raceResults.cautionCount != null &&
    Number.isFinite(Number(raceResults.cautionCount))
  ) {
    parts.push(
      `<span class="results-featured-cautions">Cautions: <strong>${escapeHtml(
        String(Number(raceResults.cautionCount))
      )}</strong></span>`
    );
  }
  return parts.join('<span class="results-featured-meta-sep" aria-hidden="true"> · </span>');
}

function renderFeaturedHeader(raceResults) {
  const label = raceDisplayLabel(raceResults);
  const track = raceResults.selectedRaceName || "";
  const latestLabel =
    raceResults.latestCompletedDisplayRaceLabel ||
    raceResults.latestCompletedRaceNumber;
  const isLatest =
    label &&
    latestLabel != null &&
    String(label) === String(latestLabel);
  const kicker = isLatest ? "Latest Race Results" : "Race Results";
  // Display label only — track comes from scheduleId-selected selectedRaceName.
  const title =
    raceResults.selectedDisplayTitle ||
    (label ? `Race ${label}` : "Race Results");

  return `<section class="results-featured">
    <div class="results-featured-head">
      <span class="results-kicker">${escapeHtml(kicker)}</span>
      <h1 class="results-featured-title">${escapeHtml(title)}</h1>
      ${
        track
          ? `<p class="results-featured-track">${escapeHtml(track)}</p>`
          : ""
      }
      <div class="results-featured-meta">
        ${formatResultsMeta(raceResults)}
      </div>
    </div>
    <div class="results-featured-tools">
      <div class="results-selector-wrap">
        ${renderRaceSelector(raceResults.completedRaces, raceResults)}
      </div>
      <div id="resultsShareHost"></div>
    </div>
  </section>`;
}

function renderResultsTable(rows, raceResults = {}) {
  if (!rows?.length) {
    return `<p class="results-empty">Detailed results are not available for this race.</p>`;
  }

  const fieldSummary =
    raceResults.officialStarterCount != null
      ? `<p class="results-field-summary">Official starters: ${raceResults.officialStarterCount}${
          raceResults.provisionalCount
            ? ` · Provisionals: ${raceResults.provisionalCount}`
            : ""
        } · Total scored field: ${raceResults.totalScoredFieldCount ?? rows.length}</p>`
      : "";

  const body = rows
    .map((row) => {
      const rowClass = row.isWinner
        ? "results-row is-winner"
        : row.isProvisional
          ? "results-row is-provisional"
          : "results-row";
      const statusLabel = row.isProvisional ? "Provisional" : row.status || "Finished";
      return `<tr class="${rowClass}">
        <td class="results-pos">${escapeHtml(String(row.position))}</td>
        <td class="results-driver">
          <a class="results-driver-link" href="${driverProfileUrl(row)}">
            <img
              class="results-driver-photo"
              src="${escapeHtml(row.photoUrl || PLACEHOLDER_PHOTO)}"
              alt=""
              loading="lazy"
              decoding="async"
              onerror="this.onerror=null;this.src='${PLACEHOLDER_PHOTO}'"
            />
            <span>${escapeHtml(row.driverName)}</span>
          </a>
        </td>
        <td>${escapeHtml(formatCell(row.carNumber))}</td>
        <td>${escapeHtml(statusLabel)}</td>
        <td>${row.startingPos ? escapeHtml(formatOrdinal(row.startingPos)) : "—"}</td>
        <td class="results-finish">${escapeHtml(formatOrdinal(row.finish))}</td>
        <td>${formatCell(row.lapsLed)}</td>
        <td>${formatCell(row.incidents)}</td>
        <td>${formatCell(row.points)}</td>
      </tr>`;
    })
    .join("");

  return `${fieldSummary}<div class="results-table-wrap">
    <table class="results-table">
      <thead>
        <tr>
          <th>Pos</th>
          <th>Driver</th>
          <th>Car #</th>
          <th>Status</th>
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
        <p class="results-empty">Race results will appear here after the first race is completed.</p>
      </section>
    `;
    return;
  }

  page.innerHTML = `
    ${renderFeaturedHeader(raceResults)}
    <section class="results-table-section">
      ${renderResultsTable(raceResults.rows, raceResults)}
    </section>
  `;

  $("#raceSelector")?.addEventListener("change", (event) => {
    const value = String(event.target.value || "");
    if (value.startsWith("sid:")) {
      loadResults({ scheduleId: value.slice(4) });
      return;
    }
    if (value.startsWith("label:")) {
      loadResults({ race: value.slice(6) });
      return;
    }
    if (value.startsWith("n:")) {
      loadResults({ race: value.slice(2) });
    }
  });

  mountResultsShare(raceResults);
}

function mountResultsShare(raceResults) {
  if (!window.BPShare?.initPageShare) return;
  const label = raceDisplayLabel(raceResults);
  if (!label && !raceResults?.selectedScheduleId) return;
  const track = raceResults.selectedRaceName || "TBD";
  const winner = raceResults.selectedRaceWinner || "";
  const raceTitle =
    raceResults.selectedDisplayTitle ||
    (label ? `Race ${label}` : "Race Results");
  const title = track ? `${raceTitle} — ${track}` : raceTitle;
  const cautionPart =
    raceResults.cautionCount != null &&
    Number.isFinite(Number(raceResults.cautionCount))
      ? ` Cautions: ${Number(raceResults.cautionCount)}.`
      : "";
  const text = winner
    ? `${title}. Winner: ${winner}.${cautionPart}`
    : `${title}.${cautionPart}`;
  const shareParams = new URLSearchParams();
  if (raceResults.selectedScheduleId) {
    shareParams.set("scheduleId", String(raceResults.selectedScheduleId));
  } else if (label) {
    shareParams.set("race", String(label));
  }
  window.BPShare.initPageShare("#resultsShareHost", {
    title,
    text,
    description: text,
    url: `${window.location.origin}/results.html?${shareParams.toString()}`,
    image: window.BPShare.DEFAULT_IMAGE,
    type: "website",
  });
}

async function loadResults(query = null) {
  const page = $("#resultsPage");
  if (!page) return;

  const resolved = query || parseResultsQuery();

  try {
    const url = buildResultsApiUrl(resolved);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderPage(data.raceResults || {});

    const params = new URLSearchParams();
    if (resolved.scheduleId) params.set("scheduleId", resolved.scheduleId);
    else if (resolved.race) params.set("race", resolved.race);
    const next = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState({}, "", next);
    }
  } catch (e) {
    console.error("Failed to load race results:", e);
    page.innerHTML = `<p class="results-empty">Failed to load race results.</p>`;
  }
}

loadResults();
