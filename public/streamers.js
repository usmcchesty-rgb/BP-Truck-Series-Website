const $ = (s) => document.querySelector(s);

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function streamerBadgeHtml() {
  return `<span class="streamer-badge">STREAMER</span>`;
}

function renderStreamers(streamers) {
  const grid = $("#streamersGrid");
  if (!grid) return;

  if (!streamers.length) {
    grid.innerHTML = `<p class="muted">No streamers listed yet.</p>`;
    return;
  }

  grid.innerHTML = streamers
    .map((s) => {
      const name = s.driver || "Unknown";
      const photo = s.photo || "/assets/drivers/placeholder.png";
      const number = s.carNumber
        ? `<span class="num">${escapeHtml(s.carNumber)}</span>`
        : "";
      const platform = escapeHtml(s.platform || "Stream");
      const streamUrl = escapeHtml(s.streamUrl || "#");

      return `<article class="streamer-card">
        <div class="streamer-card-media">
          ${streamerBadgeHtml()}
          <img src="${escapeHtml(photo)}" alt="" onerror="this.onerror=null;this.src='/assets/drivers/placeholder.png'" />
        </div>
        <div class="streamer-card-body">
          <h2>${number}${escapeHtml(name)}</h2>
          <p class="streamer-platform">${platform}</p>
          <a class="streamer-link-btn" href="${streamUrl}" target="_blank" rel="noopener noreferrer">WATCH STREAM</a>
        </div>
      </article>`;
    })
    .join("");
}

function loadStreamers() {
  const grid = $("#streamersGrid");
  if (!grid) return;

  const streamers = window.BP_STREAMERS_DATA?.STREAMERS || [];
  renderStreamers(streamers);
}

loadStreamers();
