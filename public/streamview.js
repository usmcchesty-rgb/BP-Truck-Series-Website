const $ = (s) => document.querySelector(s);

const STORAGE_KEY = "bp-streamview-state";
const MAX_SLOTS = 4;

let streamers = [];
let slots = [null, null, null, null];
let activePanel = 0;
let activeAudio = 0;

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

function streamviewUrl(driverId) {
  return `/streamview?streamer=${encodeURIComponent(String(driverId || ""))}`;
}

function getEmbedParentHosts() {
  const host = String(window.location.hostname || "").toLowerCase();
  const parents = new Set(["blazingpedals.vercel.app", "localhost", "127.0.0.1"]);
  if (host) parents.add(host);
  return [...parents];
}

function parseStreamUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return { type: "none", external: "" };

  let match = raw.match(/twitch\.tv\/videos\/(\d+)/i);
  if (match) {
    return { type: "twitch-video", videoId: match[1], external: raw };
  }

  match = raw.match(/twitch\.tv\/([^/?#]+)/i);
  if (match) {
    return {
      type: "twitch",
      channel: match[1].replace(/^@/, ""),
      external: raw,
    };
  }

  match = raw.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/i
  );
  if (match) {
    return { type: "youtube", videoId: match[1], external: raw };
  }

  match = raw.match(/kick\.com\/([^/?#]+)/i);
  if (match) {
    return { type: "kick", channel: match[1], external: raw };
  }

  if (/^https?:\/\//i.test(raw)) {
    return { type: "external", external: raw };
  }

  return { type: "none", external: raw };
}

function buildEmbedSrc(parsed, muted) {
  if (!parsed || parsed.type === "none" || parsed.type === "external") return "";

  const parentQuery = getEmbedParentHosts()
    .map((host) => `parent=${encodeURIComponent(host)}`)
    .join("&");

  if (parsed.type === "twitch") {
    return `https://player.twitch.tv/?channel=${encodeURIComponent(parsed.channel)}&${parentQuery}&muted=${muted ? "true" : "false"}&autoplay=true`;
  }

  if (parsed.type === "twitch-video") {
    return `https://player.twitch.tv/?video=v${encodeURIComponent(parsed.videoId)}&${parentQuery}&muted=${muted ? "true" : "false"}&autoplay=true`;
  }

  if (parsed.type === "youtube") {
    return `https://www.youtube.com/embed/${encodeURIComponent(parsed.videoId)}?autoplay=1&mute=${muted ? 1 : 0}&rel=0&playsinline=1`;
  }

  if (parsed.type === "kick") {
    return `https://player.kick.com/${encodeURIComponent(parsed.channel)}?muted=${muted ? "true" : "false"}&autoplay=true`;
  }

  return "";
}

function inferPlatform(url) {
  const parsed = parseStreamUrl(url);
  if (parsed.type === "twitch" || parsed.type === "twitch-video") return "Twitch";
  if (parsed.type === "youtube") return "YouTube";
  if (parsed.type === "kick") return "Kick";
  return "Stream";
}

function getStreamerById(driverId) {
  return streamers.find((s) => String(s.driver_id) === String(driverId)) || null;
}

function loadedSlots() {
  return slots
    .map((driverId, slotIndex) => ({ driverId, slotIndex }))
    .filter((entry) => entry.driverId);
}

function compactSlots() {
  const loaded = slots.filter(Boolean);
  slots = [...loaded, ...Array(MAX_SLOTS).fill(null)].slice(0, MAX_SLOTS);
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ slots, activePanel, activeAudio })
    );
  } catch (e) {
    console.warn("StreamView: could not save state", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.slots)) return false;
    slots = [...data.slots, ...Array(MAX_SLOTS).fill(null)].slice(0, MAX_SLOTS);
    activePanel = Number.isFinite(Number(data.activePanel)) ? Number(data.activePanel) : 0;
    activeAudio = Number.isFinite(Number(data.activeAudio)) ? Number(data.activeAudio) : 0;
    return true;
  } catch {
    return false;
  }
}

function setActivePanel(slotIndex) {
  activePanel = slotIndex;
  activeAudio = slotIndex;
  saveState();
  renderGrid();
  renderNav();
}

function removeSlot(slotIndex) {
  if (slotIndex < 0 || slotIndex >= MAX_SLOTS) return;
  slots[slotIndex] = null;
  compactSlots();
  const loaded = loadedSlots();
  if (!loaded.length) {
    activePanel = 0;
    activeAudio = 0;
  } else {
    activePanel = Math.min(activePanel, loaded.length - 1);
    activeAudio = Math.min(activeAudio, loaded.length - 1);
  }
  saveState();
  renderGrid();
  renderNav();
}

function addStreamer(driverId) {
  const id = String(driverId || "").trim();
  if (!id || !getStreamerById(id)) return;

  const existing = slots.findIndex((slot) => String(slot) === id);
  if (existing >= 0) {
    setActivePanel(existing);
    return;
  }

  const emptyIndex = slots.findIndex((slot) => !slot);
  if (emptyIndex >= 0) {
    slots[emptyIndex] = id;
    setActivePanel(emptyIndex);
    return;
  }

  slots[activePanel] = id;
  activeAudio = activePanel;
  saveState();
  renderGrid();
  renderNav();
}

function renderPanelContent(driver, slotIndex) {
  const name = driver.display_name || driver.iracing_name || "Streamer";
  const number = driver.car_number ? `#${driver.car_number} ` : "";
  const streamUrl = String(driver.stream_url || "").trim();
  const parsed = parseStreamUrl(streamUrl);
  const isAudioActive = slotIndex === activeAudio;
  const embedSrc = buildEmbedSrc(parsed, !isAudioActive);
  const canEmbed = Boolean(embedSrc);
  const externalUrl = parsed.external || streamUrl;

  const audioLabel = isAudioActive
    ? `<span class="streamview-audio streamview-audio--on" aria-label="Audio on">🔊 Audio On</span>`
    : `<span class="streamview-audio" aria-label="Audio muted">🔇 Muted</span>`;

  const player = canEmbed
    ? `<div class="streamview-player">
        <iframe
          src="${escapeAttr(embedSrc)}"
          title="${escapeAttr(`${name} stream`)}"
          allow="autoplay; fullscreen; picture-in-picture"
          allowfullscreen
          loading="lazy"
        ></iframe>
      </div>`
    : `<div class="streamview-fallback">
        <p class="streamview-fallback-platform">${escapeHtml(inferPlatform(streamUrl))}</p>
        <p class="muted">This stream opens best in a new tab.</p>
        ${
          externalUrl
            ? `<a class="streamview-open-btn" href="${escapeAttr(externalUrl)}" target="_blank" rel="noopener noreferrer">Open Stream</a>`
            : `<p class="muted">No stream link on file.</p>`
        }
      </div>`;

  return `<article class="streamview-panel${isAudioActive ? " is-audio-active" : ""}${slotIndex === activePanel ? " is-active" : ""}" data-slot="${slotIndex}" tabindex="0" role="button" aria-label="Select ${escapeAttr(name)} stream audio">
    <div class="streamview-panel-head">
      <h3 class="streamview-panel-title">${escapeHtml(number)}${escapeHtml(name)}</h3>
      <div class="streamview-panel-actions">
        ${audioLabel}
        <button type="button" class="streamview-remove-btn" data-remove="${slotIndex}" aria-label="Remove ${escapeAttr(name)}">✕</button>
      </div>
    </div>
    ${player}
  </article>`;
}

function renderGrid() {
  const grid = $("#streamviewGrid");
  if (!grid) return;

  const loaded = loadedSlots();
  grid.className = "streamview-grid";

  if (!loaded.length) {
    grid.classList.add("streamview-grid--empty");
    grid.innerHTML = `<p class="streamview-empty muted">Select a streamer above to begin watching.</p>`;
    return;
  }

  grid.classList.add(`streamview-grid--count-${Math.min(loaded.length, MAX_SLOTS)}`);
  grid.innerHTML = loaded
    .map(({ driverId, slotIndex }) => {
      const driver = getStreamerById(driverId);
      if (!driver) return "";
      return renderPanelContent(driver, slotIndex);
    })
    .join("");

  grid.querySelectorAll(".streamview-panel").forEach((panel) => {
    panel.addEventListener("click", (event) => {
      if (event.target.closest(".streamview-remove-btn") || event.target.closest("a")) return;
      const slotIndex = Number(panel.dataset.slot);
      if (Number.isFinite(slotIndex)) setActivePanel(slotIndex);
    });
  });

  grid.querySelectorAll(".streamview-remove-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      removeSlot(Number(btn.dataset.remove));
    });
  });
}

function renderNav() {
  const nav = $("#streamviewNav");
  if (!nav) return;

  if (!streamers.length) {
    nav.innerHTML = `<p class="muted">No streamers available.</p>`;
    return;
  }

  nav.innerHTML = streamers
    .map((driver) => {
      const id = String(driver.driver_id);
      const name = driver.display_name || driver.iracing_name || "Streamer";
      const number = driver.car_number ? `#${driver.car_number} ` : "";
      const isLoaded = slots.includes(id);
      const classes = ["streamview-nav-btn", isLoaded ? "is-loaded" : ""]
        .filter(Boolean)
        .join(" ");

      return `<button type="button" class="${classes}" data-driver-id="${escapeAttr(id)}">${escapeHtml(number)}${escapeHtml(name)}</button>`;
    })
    .join("");

  nav.querySelectorAll(".streamview-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      addStreamer(btn.dataset.driverId);
    });
  });
}

async function loadStreamers() {
  const nav = $("#streamviewNav");
  const grid = $("#streamviewGrid");
  if (nav) nav.innerHTML = `<p class="muted">Loading streamers...</p>`;
  if (grid) {
    grid.className = "streamview-grid streamview-grid--empty";
    grid.innerHTML = `<p class="streamview-empty muted">Loading...</p>`;
  }

  try {
    const res = await fetch("/api/drivers");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    streamers = (Array.isArray(data) ? data : [])
      .filter((driver) => driver.is_streamer === true)
      .sort((a, b) =>
        String(a.display_name || a.iracing_name || "").localeCompare(
          b.display_name || b.iracing_name || ""
        )
      );

    const restored = loadState();
    const params = new URLSearchParams(window.location.search);
    const urlStreamer = String(params.get("streamer") || params.get("driver_id") || "").trim();

    slots = slots.map((id) => {
      if (!id) return null;
      return getStreamerById(id) ? id : null;
    });
    compactSlots();

    if (urlStreamer && getStreamerById(urlStreamer)) {
      addStreamer(urlStreamer);
    } else if (!restored) {
      saveState();
    }

    renderNav();
    renderGrid();
  } catch (e) {
    console.error("Failed to load StreamView:", e);
    if (nav) nav.innerHTML = `<p class="muted">Failed to load streamers.</p>`;
    if (grid) {
      grid.innerHTML = `<p class="streamview-empty muted">Failed to load StreamView.</p>`;
    }
  }
}

loadStreamers();
