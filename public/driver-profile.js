const $ = (s) => document.querySelector(s);

const PLACEHOLDER_PHOTO = "/assets/drivers/placeholder.png";
const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getDriverIdFromPath() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("driverId") || params.get("id");
  if (fromQuery) return decodeURIComponent(fromQuery);

  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "drivers" && parts[1]) {
    return decodeURIComponent(parts[1]);
  }
  return "";
}

function driverImage(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `/assets/drivers/${slug}.png`;
}

function formatStatValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value).trim();
  return text || null;
}

function statItem(label, value, options = {}) {
  const formatted = formatStatValue(value);
  if (formatted === null && !options.allowZero) return "";
  if (formatted === null && options.allowZero && value !== 0) return "";
  const display = formatted ?? "0";
  return `<div class="driver-profile-stat">
    <span class="driver-profile-stat-label">${escapeHtml(label)}</span>
    <strong class="driver-profile-stat-value">${escapeHtml(display)}</strong>
  </div>`;
}

function optionalHeroField(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `<div class="driver-profile-field">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(text)}</strong>
  </div>`;
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

function formatFinish(value) {
  const finish = Number(value);
  if (!Number.isFinite(finish) || finish < 1) return "—";
  return formatOrdinal(finish);
}

function parseFinish(value) {
  const finish = Number(value);
  return Number.isFinite(finish) && finish >= 1 ? finish : null;
}

function sampleResultFromBucket(bucket) {
  if (!bucket || typeof bucket !== "object") return null;
  return Object.values(bucket).find((result) => result?.finish_pos != null) || null;
}

function pickOfficialRaceBucket(schedule) {
  const buckets = [];

  for (const [bucketKey, bucket] of Object.entries(schedule?.drivers || {})) {
    const sample = sampleResultFromBucket(bucket);
    if (!sample) continue;
    buckets.push({
      bucketKey,
      bucket,
      sample,
      session: String(sample.session || "").toUpperCase(),
      countStats: String(sample.count_stats || "").toUpperCase(),
      sessionNum: Number(sample.session_num ?? -999),
    });
  }

  if (!buckets.length) return null;

  const raceSession = buckets.find((entry) => entry.session === "RACE");
  if (raceSession) return raceSession;

  const countedSession = buckets.find((entry) => entry.countStats === "Y");
  if (countedSession) return countedSession;

  return buckets.sort((a, b) => b.sessionNum - a.sessionNum)[0];
}

function normalizeDriverRaceResult(result) {
  if (!result || typeof result !== "object") return null;

  const finish = parseFinish(result.finish_pos ?? result.finish);
  if (!finish) return null;

  const startingPos = Number(result.qualify_pos);
  const lapsLed = Number(result.laps_led);
  const incidents = Number(result.incidents);

  return {
    finish,
    startingPos: Number.isFinite(startingPos) && startingPos > 0 ? startingPos : null,
    lapsLed: Number.isFinite(lapsLed) ? lapsLed : null,
    incidents: Number.isFinite(incidents) ? incidents : null,
  };
}

function extractFinishRacesFromSchedules(schedules) {
  const races = [];

  for (const [scheduleKey, schedule] of Object.entries(schedules || {})) {
    const official = pickOfficialRaceBucket(schedule);
    if (!official) continue;

    const finishes = {};
    const driverResults = {};

    for (const [driverId, result] of Object.entries(official.bucket)) {
      const normalized = normalizeDriverRaceResult(result);
      if (!normalized) continue;
      finishes[String(driverId)] = normalized.finish;
      driverResults[String(driverId)] = normalized;
    }

    if (!Object.keys(finishes).length) continue;

    const winnerEntry = Object.entries(finishes).find(([, finish]) => finish === 1);

    races.push({
      scheduleKey,
      scheduleId: schedule.schedule_id ?? null,
      raceDate: schedule.race_date ?? null,
      finishes,
      driverResults,
      winnerDriverId: winnerEntry?.[0] ?? null,
    });
  }

  return races.sort((a, b) => {
    const ad = Number(a.raceDate) || 0;
    const bd = Number(b.raceDate) || 0;
    if (ad !== bd) return ad - bd;
    return Number(a.scheduleKey) - Number(b.scheduleKey);
  });
}

function isNonPointsRace(race) {
  const points = String(race?.points ?? "")
    .trim()
    .toLowerCase();
  const status = String(race?.status ?? "")
    .trim()
    .toLowerCase();
  const label = String(race?.track ?? "");
  if (points === "no" || status === "non-points") return true;
  return NON_POINTS_LABEL_PATTERN.test(label);
}

function enrichScheduleRaces(races) {
  let officialPointsRaceNumber = 0;

  return (races || []).map((race) => {
    const scheduleRow = Number(race?.raceNumber ?? race?.scheduleRow);
    const nonPoints = isNonPointsRace(race);

    if (nonPoints) {
      return {
        ...race,
        scheduleRow: Number.isFinite(scheduleRow) ? scheduleRow : null,
        nonPoints: true,
        officialPointsRaceNumber: null,
      };
    }

    officialPointsRaceNumber += 1;
    return {
      ...race,
      scheduleRow: Number.isFinite(scheduleRow) ? scheduleRow : null,
      nonPoints: false,
      officialPointsRaceNumber,
    };
  });
}

function extractScheduleIdFromLink(link) {
  const match = String(link || "").match(/schedule_id=(\d+)/i);
  return match?.[1] ? String(match[1]) : null;
}

function buildCompletedPointsRaces(scheduleRaces) {
  return enrichScheduleRaces(scheduleRaces).filter(
    (race) => !race.nonPoints && race.winner && race.officialPointsRaceNumber != null
  );
}

function alignDriverRaceHistory(driverId, schedules, scheduleRaces) {
  const finishRaces = extractFinishRacesFromSchedules(schedules);
  const completedPoints = buildCompletedPointsRaces(scheduleRaces);
  const finishByScheduleId = new Map(
    finishRaces
      .filter((race) => race.scheduleId != null)
      .map((race) => [String(race.scheduleId), race])
  );
  const usedFinishKeys = new Set();
  const aligned = [];

  for (const race of completedPoints) {
    const scheduleId =
      race.scheduleId != null
        ? String(race.scheduleId)
        : extractScheduleIdFromLink(race.link);
    let finishRace = scheduleId ? finishByScheduleId.get(scheduleId) : null;

    if (finishRace) {
      usedFinishKeys.add(String(finishRace.scheduleKey));
    } else {
      const remaining = finishRaces.filter(
        (entry) => !usedFinishKeys.has(String(entry.scheduleKey))
      );
      finishRace = remaining[0] || null;
      if (finishRace) usedFinishKeys.add(String(finishRace.scheduleKey));
    }

    const finish = finishRace?.finishes?.[String(driverId)];
    if (!Number.isFinite(finish)) continue;

    const result = finishRace?.driverResults?.[String(driverId)] || null;
    aligned.push({
      raceNumber: race.officialPointsRaceNumber,
      track: race.track,
      date: race.date,
      finish,
      startingPos: result?.startingPos ?? null,
      lapsLed: result?.lapsLed ?? null,
      incidents: result?.incidents ?? null,
    });
  }

  return aligned;
}

function computeBestFinish(driverId, schedules) {
  const finishRaces = extractFinishRacesFromSchedules(schedules);
  let best = null;

  for (const race of finishRaces) {
    const finish = race.finishes?.[String(driverId)];
    if (!Number.isFinite(finish)) continue;
    if (best === null || finish < best) best = finish;
  }

  return best;
}

function formatLast3Finishes(recentRaces) {
  const last3 = (recentRaces || []).slice(-3);
  if (!last3.length) return null;
  return last3.map((race) => formatOrdinal(race.finish)).join(" · ");
}

function buildStats(profile, standingsRow, schedules, scheduleRaces) {
  const leader = standingsRow?.leader || null;
  const pointsBehind =
    leader && standingsRow?.points != null
      ? Math.max(0, Number(leader.points) - Number(standingsRow.points))
      : null;
  const recentRaces = alignDriverRaceHistory(
    profile.driver_id,
    schedules,
    scheduleRaces
  );
  const bestFinish = computeBestFinish(profile.driver_id, schedules);

  return {
    position: standingsRow?.position ?? null,
    points: standingsRow?.points ?? null,
    pointsBehind,
    races: standingsRow?.races ?? null,
    wins: standingsRow?.wins ?? null,
    top5: standingsRow?.top5 ?? null,
    top10: standingsRow?.top10 ?? null,
    avgFinish: standingsRow?.avgFinish ?? null,
    lapsLed: standingsRow?.lapsLed ?? null,
    incidents: standingsRow?.incidents ?? null,
    bestFinish,
    last3Finishes: formatLast3Finishes(recentRaces),
    recentRaces: [...recentRaces].reverse(),
  };
}

function renderStatsGrid(stats) {
  const items = [
    statItem("Points Position", stats.position ? formatOrdinal(stats.position) : null),
    statItem("Points", stats.points, { allowZero: true }),
    statItem("Points Behind Leader", stats.pointsBehind, { allowZero: true }),
    statItem("Races", stats.races, { allowZero: true }),
    statItem("Wins", stats.wins, { allowZero: true }),
    statItem("Top 5s", stats.top5, { allowZero: true }),
    statItem("Top 10s", stats.top10, { allowZero: true }),
    statItem("Average Finish", stats.avgFinish),
    statItem("Laps Led", stats.lapsLed, { allowZero: true }),
    statItem("Incidents", stats.incidents, { allowZero: true }),
    statItem("Best Finish", stats.bestFinish ? formatOrdinal(stats.bestFinish) : null),
    statItem("Last 3 Finishes", stats.last3Finishes),
  ].filter(Boolean);

  if (!items.length) {
    return `<p class="muted">Season stats are not available yet.</p>`;
  }

  return `<div class="driver-profile-stats-grid">${items.join("")}</div>`;
}

function renderRecentResults(recentRaces) {
  if (!recentRaces?.length) {
    return `<p class="muted">No completed race results yet.</p>`;
  }

  const rows = recentRaces
    .map((race) => {
      const detailParts = [
        race.startingPos ? `Start ${formatOrdinal(race.startingPos)}` : "",
        race.lapsLed != null ? `Led ${race.lapsLed}` : "",
        race.incidents != null ? `${race.incidents} inc.` : "",
      ].filter(Boolean);

      return `<tr>
        <td>Race ${escapeHtml(race.raceNumber)}</td>
        <td>${escapeHtml(race.track || "—")}</td>
        <td class="driver-profile-finish">${formatFinish(race.finish)}</td>
        <td>${detailParts.length ? escapeHtml(detailParts.join(" · ")) : "—"}</td>
      </tr>`;
    })
    .join("");

  return `<div class="table-wrap">
    <table class="driver-profile-results-table">
      <thead>
        <tr>
          <th>Race</th>
          <th>Track</th>
          <th>Finish</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderProfile(profile, stats) {
  const panel = $("#driverProfilePanel");
  if (!panel || !profile) return;

  const name = profile.display_name || profile.iracing_name || "Driver";
  const photo =
    profile.photoUrl || profile.photo_url || driverImage(name);
  const number = String(profile.car_number || "").trim();

  document.title = `${name} — Blazing Pedals Truck Series`;

  panel.innerHTML = `
    <a class="driver-profile-back" href="/drivers.html">← Back to Drivers</a>

    <section class="driver-profile-hero">
      <div class="driver-profile-photo-wrap">
        <img
          class="driver-profile-photo"
          src="${escapeHtml(photo)}"
          alt="${escapeHtml(name)}"
          onerror="this.onerror=null;this.src='${PLACEHOLDER_PHOTO}'"
        />
      </div>
      <div class="driver-profile-hero-copy">
        ${number ? `<div class="driver-profile-number">#${escapeHtml(number)}</div>` : ""}
        <h1 class="driver-profile-name">${escapeHtml(name)}</h1>
        ${
          profile.iracing_name && profile.iracing_name !== name
            ? `<p class="driver-profile-alias">${escapeHtml(profile.iracing_name)}</p>`
            : ""
        }
        <div class="driver-profile-meta-grid">
          ${optionalHeroField("Date of Birth", profile.dateOfBirth || profile.date_of_birth)}
          ${optionalHeroField("Hometown", profile.hometown)}
          ${optionalHeroField("Team", profile.team)}
        </div>
      </div>
    </section>

    <section class="driver-profile-section">
      <h2>Season Stats</h2>
      ${renderStatsGrid(stats)}
    </section>

    <section class="driver-profile-section">
      <h2>Recent Results</h2>
      ${renderRecentResults(stats.recentRaces)}
    </section>
  `;
}

function renderNotFound() {
  const panel = $("#driverProfilePanel");
  if (!panel) return;
  panel.innerHTML = `
    <a class="driver-profile-back" href="/drivers.html">← Back to Drivers</a>
    <p class="muted">Driver profile not found.</p>
  `;
}

async function loadDriverProfile() {
  const panel = $("#driverProfilePanel");
  const driverId = getDriverIdFromPath();
  if (!panel) return;

  if (!driverId) {
    renderNotFound();
    return;
  }

  try {
    const [profileRes, standingsRes, scheduleRes] = await Promise.all([
      fetch(`/api/drivers?driver_id=${encodeURIComponent(driverId)}`),
      fetch("/api/standings"),
      fetch("/api/schedule"),
    ]);

    const profile = await profileRes.json();
    if (!profileRes.ok || !profile?.driver_id) {
      renderNotFound();
      return;
    }

    const standingsData = standingsRes.ok ? await standingsRes.json() : { rows: [], schedules: {} };
    const scheduleData = scheduleRes.ok ? await scheduleRes.json() : { races: [] };
    const rows = Array.isArray(standingsData.rows) ? standingsData.rows : [];
    const standingsRow =
      rows.find((row) => String(row.driverId) === String(driverId)) || null;
    const leader = rows.find((row) => Number(row.position) === 1) || null;

    const stats = buildStats(
      profile,
      standingsRow ? { ...standingsRow, leader } : null,
      standingsData.schedules || {},
      scheduleData.races || []
    );

    renderProfile(profile, stats);
  } catch (e) {
    console.error("Failed to load driver profile:", e);
    panel.innerHTML = `
      <a class="driver-profile-back" href="/drivers.html">← Back to Drivers</a>
      <p class="muted">Failed to load driver profile.</p>
    `;
  }
}

loadDriverProfile();
