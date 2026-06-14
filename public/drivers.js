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

function isMarkedStreamer(driver) {
  return driver?.is_streamer === true;
}

function streamerBadgeHtml(streamUrl) {
  const badge = `<span class="streamer-badge">STREAMER</span>`;
  const url = String(streamUrl || "").trim();
  if (!url) return badge;

  return `<a class="streamer-badge-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" aria-label="Watch stream">${badge}</a>`;
}

function renderDrivers(drivers) {
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
      const number = d.car_number
        ? `<span class="num">${escapeHtml(d.car_number)}</span>`
        : "";
      const showStreamerBadge = isMarkedStreamer(d);
      const badge = showStreamerBadge ? streamerBadgeHtml(d.stream_url) : "";

      return `<article class="driver-card${showStreamerBadge ? " is-streamer" : ""}">
        <div class="driver-card-media">
          ${badge}
          <img src="${escapeHtml(photo)}" alt="" onerror="this.onerror=null;this.src='/assets/drivers/placeholder.png'" />
        </div>
        <div class="driver-card-body">
          <h2>${number}${escapeHtml(name)}</h2>
          ${d.iracing_name && d.iracing_name !== name ? `<p class="muted">${escapeHtml(d.iracing_name)}</p>` : ""}
        </div>
      </article>`;
    })
    .join("");
}

async function loadDrivers() {
  const grid = $("#driversGrid");
  if (!grid) return;

  grid.innerHTML = `<p class="muted">Loading drivers...</p>`;

  try {
    const res = await fetch("/api/drivers");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data.filter((d) => d.active !== false) : [];
    renderDrivers(list);
  } catch (e) {
    console.error("Failed to load drivers:", e);
    grid.innerHTML = `<p class="muted">Failed to load drivers.</p>`;
  }
}

loadDrivers();
