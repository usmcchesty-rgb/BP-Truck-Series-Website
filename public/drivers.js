const $ = (s) => document.querySelector(s);

const SORT_DEFAULT = "active-first";

const pageState = {
  drivers: [],
  standingsLookup: null,
  activityLookup: null,
  sort: SORT_DEFAULT,
  searchQuery: "",
};

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

function isDriverInactive(driver, activityLookup) {
  const activity = activityLookup?.get(String(driver.driver_id));
  return isRecentlyInactive(activity);
}

function driverDisplayName(driver) {
  return String(driver.display_name || driver.iracing_name || "").trim();
}

function driverBpNumber(driver) {
  return String(driver?.bp_number || driver?.car_number || "").trim();
}

function parseCarNumber(driver) {
  const raw = String(driverBpNumber(driver)).replace(/[^\d.]/g, "");
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function compareDriverName(a, b) {
  return driverDisplayName(a).localeCompare(driverDisplayName(b));
}

function sortDrivers(drivers, sortKey, activityLookup) {
  const list = [...drivers];

  switch (sortKey) {
    case "inactive-first":
      return list.sort((a, b) => {
        const aInactive = isDriverInactive(a, activityLookup) ? 0 : 1;
        const bInactive = isDriverInactive(b, activityLookup) ? 0 : 1;
        if (aInactive !== bInactive) return aInactive - bInactive;
        return compareDriverName(a, b);
      });
    case "name-az":
      return list.sort(compareDriverName);
    case "name-za":
      return list.sort((a, b) => compareDriverName(b, a));
    case "car-asc":
      return list.sort((a, b) => {
        const aNum = parseCarNumber(a);
        const bNum = parseCarNumber(b);
        if (aNum == null && bNum == null) return compareDriverName(a, b);
        if (aNum == null) return 1;
        if (bNum == null) return -1;
        if (aNum !== bNum) return aNum - bNum;
        return compareDriverName(a, b);
      });
    case "car-desc":
      return list.sort((a, b) => {
        const aNum = parseCarNumber(a);
        const bNum = parseCarNumber(b);
        if (aNum == null && bNum == null) return compareDriverName(a, b);
        if (aNum == null) return 1;
        if (bNum == null) return -1;
        if (aNum !== bNum) return bNum - aNum;
        return compareDriverName(a, b);
      });
    case "active-first":
    default:
      return list.sort((a, b) => {
        const aInactive = isDriverInactive(a, activityLookup) ? 1 : 0;
        const bInactive = isDriverInactive(b, activityLookup) ? 1 : 0;
        if (aInactive !== bInactive) return aInactive - bInactive;
        return compareDriverName(a, b);
      });
  }
}

function buildDriverCards(rawDrivers, standingsLookup) {
  return rawDrivers
    .map((driver) => {
      const driverId = resolveDriverCardId(driver, standingsLookup);
      if (!driverId) return null;
      return { ...driver, driver_id: driverId };
    })
    .filter(Boolean);
}

function getVisibleDrivers() {
  const query = pageState.searchQuery.trim().toLowerCase();
  if (!query) return pageState.drivers;

  return pageState.drivers.filter((driver) => {
    const name = driverDisplayName(driver).toLowerCase();
    const iracing = String(driver.iracing_name || "").toLowerCase();
    const carNumber = driverBpNumber(driver).toLowerCase();
    const iracingCustomerId = String(driver.iracing_customer_id || driver.iracingCustomerId || "").toLowerCase();
    return (
      name.includes(query) ||
      iracing.includes(query) ||
      carNumber.includes(query) ||
      iracingCustomerId.includes(query)
    );
  });
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

function renderDriverGrid(drivers) {
  const grid = $("#driversGrid");
  if (!grid) return;

  if (!drivers.length) {
    grid.innerHTML = `<p class="muted">No driver profiles available yet.</p>`;
    return;
  }

  grid.innerHTML = drivers
    .map((d) => {
      const name = d.display_name || d.iracing_name || "Unknown";
      const photo = d.photoUrl || d.photo_url || driverImage(name);
      const displayNumber = driverBpNumber(d);
      const number = displayNumber
        ? `<span class="num">${escapeHtml(displayNumber)}</span>`
        : "";
      const showStreamerBadge = isMarkedStreamer(d);
      const badge = showStreamerBadge ? streamerBadgeHtml(d.stream_url) : "";
      const activity = pageState.activityLookup?.get(String(d.driver_id)) || null;
      const inactive = isRecentlyInactive(activity);
      const inactiveBadge = inactiveBadgeHtml(activity);
      const profileUrl = driverProfileUrl(d.driver_id);
      const iracingCustomerId = d.iracing_customer_id || d.iracingCustomerId || "";

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
            ${iracingCustomerId ? `<p class="muted">iRacing ID: ${escapeHtml(iracingCustomerId)}</p>` : ""}
          </div>
        </a>
      </article>`;
    })
    .join("");
}

function refreshDriversView() {
  const visible = getVisibleDrivers();
  const sorted = sortDrivers(visible, pageState.sort, pageState.activityLookup);
  renderDriverGrid(sorted);
}

function bindDriversToolbar() {
  const sortSelect = $("#driversSortSelect");
  if (!sortSelect) return;

  sortSelect.value = pageState.sort;
  sortSelect.addEventListener("change", () => {
    pageState.sort = sortSelect.value || SORT_DEFAULT;
    refreshDriversView();
  });
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

    pageState.standingsLookup = buildStandingsIdLookup(standingsRows);
    pageState.activityLookup = buildActivityLookup(standingsRows);
    pageState.drivers = buildDriverCards(list, pageState.standingsLookup);
    pageState.sort = SORT_DEFAULT;

    bindDriversToolbar();
    refreshDriversView();
  } catch (e) {
    console.error("Failed to load drivers:", e);
    grid.innerHTML = `<p class="muted">Failed to load drivers.</p>`;
  }
}

loadDrivers();
