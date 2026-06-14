const $ = (s) => document.querySelector(s);

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

function driverImage(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `/assets/drivers/${slug}.png`;
}

function inferPlatform(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes("twitch.tv")) return "Twitch";
  if (value.includes("youtube.com") || value.includes("youtu.be")) return "YouTube";
  if (value.includes("kick.com")) return "Kick";
  return "Live Stream";
}

function streamerBadgeHtml() {
  return `<span class="streamer-badge">STREAMER</span>`;
}

function renderStreamers(streamers) {
  const grid = $("#streamersGrid");
  if (!grid) return;

  if (!streamers.length) {
    grid.innerHTML = `<p class="muted">No streamers have been added yet.</p>`;
    return;
  }

  grid.innerHTML = streamers
    .map((driver) => {
      const name = driver.display_name || driver.iracing_name || "Unknown";
      const photo =
        driver.photoUrl || driver.photo_url || driverImage(name);
      const number = driver.car_number
        ? `<span class="num">${escapeHtml(driver.car_number)}</span>`
        : "";
      const streamUrl = String(driver.stream_url || "").trim();
      const platform = streamUrl ? inferPlatform(streamUrl) : "Stream link pending";
      const watchBtn = streamUrl
        ? `<a class="streamer-link-btn" href="${escapeAttr(streamUrl)}" target="_blank" rel="noopener noreferrer">WATCH STREAM</a>`
        : "";

      return `<article class="streamer-card">
        <div class="streamer-card-media">
          ${streamerBadgeHtml()}
          <img src="${escapeHtml(photo)}" alt="" onerror="this.onerror=null;this.src='/assets/drivers/placeholder.png'" />
        </div>
        <div class="streamer-card-body">
          <h2>${number}${escapeHtml(name)}</h2>
          <p class="streamer-platform">${escapeHtml(platform)}</p>
          ${watchBtn}
        </div>
      </article>`;
    })
    .join("");
}

async function loadStreamers() {
  const grid = $("#streamersGrid");
  if (!grid) return;

  grid.innerHTML = `<p class="muted">Loading streamers...</p>`;

  try {
    const res = await fetch("/api/drivers");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const streamers = (Array.isArray(data) ? data : [])
      .filter((driver) => driver.is_streamer === true)
      .sort((a, b) =>
        String(a.display_name || a.iracing_name || "").localeCompare(
          b.display_name || b.iracing_name || ""
        )
      );

    renderStreamers(streamers);
  } catch (e) {
    console.error("Failed to load streamers:", e);
    grid.innerHTML = `<p class="muted">Failed to load streamers.</p>`;
  }
}

loadStreamers();
