const $ = (s) => document.querySelector(s);

function driverImage(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `/assets/drivers/${slug}.png`;
}

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

function isNumericDriverId(value) {
  return /^\d+$/.test(String(value ?? "").trim());
}

function normalizeDriverName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildStandingsIdLookup(rows) {
  const byId = new Map();
  const byName = new Map();

  for (const row of rows) {
    const id = String(row.driverId ?? "").trim();
    if (!isNumericDriverId(id)) continue;
    byId.set(id, id);
    const name = normalizeDriverName(row.driver);
    if (name) byName.set(name, id);
  }

  return { byId, byName };
}

function resolveDriverCardId(profile, standingsLookup) {
  const rawId = String(profile?.driver_id ?? "").trim();
  if (isNumericDriverId(rawId)) return rawId;

  const displayName = normalizeDriverName(profile?.display_name || profile?.iracing_name);
  if (displayName && standingsLookup.byName.has(displayName)) {
    return standingsLookup.byName.get(displayName);
  }

  return isNumericDriverId(rawId) ? rawId : "";
}

function buildActivityLookup(rows) {
  const byId = new Map();

  for (const row of rows) {
    const id = String(row.driverId ?? "").trim();
    if (!isNumericDriverId(id)) continue;
    if (row.recentActivity) byId.set(id, row.recentActivity);
  }

  return byId;
}

function inactiveTooltip(activity) {
  if (!activity || activity.status !== "Inactive") return "";
  const raceNumber = Number(activity.lastStartRaceNumber);
  if (Number.isFinite(raceNumber) && raceNumber > 0) {
    return `Last start: Race ${raceNumber}`;
  }
  return "No starts in the last 5 races";
}

function inactiveBadgeHtml(activity) {
  if (!activity || activity.status !== "Inactive") return "";
  return `<span class="driver-inactive-badge" title="${escapeAttr(inactiveTooltip(activity))}">INACTIVE</span>`;
}

function isRecentlyInactive(activity) {
  return activity?.status === "Inactive";
}

function isMarkedStreamer(driver) {
  return driver?.is_streamer === true;
}

function streamerBadgeHtml(streamUrl) {
  const badge = `<span class="streamer-badge">STREAMER</span>`;
  const url = String(streamUrl || "").trim();
  if (!url) return badge;

  return `<a class="streamer-badge-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" aria-label="Watch stream">${badge}</a>`;
}

function driverProfileUrl(driverId) {
  const id = String(driverId || "").trim();
  if (!id) return "/drivers.html";
  return `/drivers/${encodeURIComponent(id)}`;
}

function renderDrivers(drivers, standingsLookup, activityLookup) {
  const grid = $("#driversGrid");
  if (!grid) return;

  const cards = drivers
    .map((driver) => {
      const driverId = resolveDriverCardId(driver, standingsLookup);
      if (!driverId) return null;
      return { ...driver, driver_id: driverId };
    })
    .filter(Boolean)
    .sort((a, b) =>
      String(a.display_name || a.iracing_name || "").localeCompare(
        b.display_name || b.iracing_name || ""
      )
    );

  if (!cards.length) {
    grid.innerHTML = `<p class="muted">No driver profiles available yet.</p>`;
    return;
  }

  grid.innerHTML = cards
    .map((d) => {
      const name = d.display_name || d.iracing_name || "Unknown";
      const photo = d.photoUrl || d.photo_url || driverImage(name);
      const number = d.car_number
        ? `<span class="num">${escapeHtml(d.car_number)}</span>`
        : "";
      const showStreamerBadge = isMarkedStreamer(d);
      const badge = showStreamerBadge ? streamerBadgeHtml(d.stream_url) : "";
      const activity = activityLookup?.get(String(d.driver_id)) || null;
      const inactive = isRecentlyInactive(activity);
      const inactiveBadge = inactiveBadgeHtml(activity);
      const profileUrl = driverProfileUrl(d.driver_id);

      return `<article class="driver-card${showStreamerBadge ? " is-streamer" : ""}${inactive ? " is-inactive-driver" : ""}">
        ${badge}
        ${inactiveBadge}
        <a class="driver-card-link" href="${escapeAttr(profileUrl)}">
          <div class="driver-card-media">
            <img src="${escapeHtml(photo)}" alt="" onerror="this.onerror=null;this.src='/assets/drivers/placeholder.png'" />
          </div>
          <div class="driver-card-body">
            <h2>${number}${escapeHtml(name)}</h2>
            ${d.iracing_name && d.iracing_name !== name ? `<p class="muted">${escapeHtml(d.iracing_name)}</p>` : ""}
          </div>
        </a>
      </article>`;
    })
    .join("");
}

async function loadDrivers() {
  const grid = $("#driversGrid");
  if (!grid) return;

  grid.innerHTML = `<p class="muted">Loading drivers...</p>`;

  try {
    const [driversRes, standingsRes] = await Promise.all([
      fetch("/api/drivers"),
      fetch("/api/standings"),
    ]);

    if (!driversRes.ok) throw new Error(`Drivers HTTP ${driversRes.status}`);

    const data = await driversRes.json();
    const list = Array.isArray(data) ? data.filter((d) => d.active !== false) : [];
    const standingsData = standingsRes.ok ? await standingsRes.json() : { rows: [] };
    const standingsRows = Array.isArray(standingsData.rows) ? standingsData.rows : [];
    const standingsLookup = buildStandingsIdLookup(standingsRows);
    const activityLookup = buildActivityLookup(standingsRows);

    renderDrivers(list, standingsLookup, activityLookup);
  } catch (e) {
    console.error("Failed to load drivers:", e);
    grid.innerHTML = `<p class="muted">Failed to load drivers.</p>`;
  }
}

loadDrivers();
