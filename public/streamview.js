const $ = (s) => document.querySelector(s);

const STORAGE_KEY = "bp-streamview-state";
const MAX_SLOTS = 4;

let streamers = [];
let slots = [null, null, null, null];
let selectedSlotIndex = 0;
let activeAudioSlot = 0;
let maximizedSlotIndex = null;
let gridEventsBound = false;

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
  if (match) return { type: "twitch-video", videoId: match[1], external: raw };

  match = raw.match(/twitch\.tv\/([^/?#]+)/i);
  if (match) {
    return { type: "twitch", channel: match[1].replace(/^@/, ""), external: raw };
  }

  match = raw.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/i
  );
  if (match) return { type: "youtube", videoId: match[1], external: raw };

  match = raw.match(/kick\.com\/([^/?#]+)/i);
  if (match) return { type: "kick", channel: match[1], external: raw };

  if (/^https?:\/\//i.test(raw)) return { type: "external", external: raw };
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

function clampSlot(index, fallback = 0) {
  const n = Number(index);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(MAX_SLOTS - 1, n));
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        slots,
        selectedSlotIndex,
        activeAudioSlot,
        maximizedSlotIndex,
      })
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

    if (Array.isArray(data.slots)) {
      slots = [...data.slots, ...Array(MAX_SLOTS).fill(null)].slice(0, MAX_SLOTS);
    }

    selectedSlotIndex = clampSlot(
      data.selectedSlotIndex ?? data.activePanel ?? data.selectedSlot ?? 0
    );
    activeAudioSlot = clampSlot(
      data.activeAudioSlot ?? data.activeAudio ?? data.activePanel ?? selectedSlotIndex
    );

    const max = data.maximizedSlotIndex;
    maximizedSlotIndex =
      max === null || max === undefined || max === ""
        ? null
        : clampSlot(max, null);

    if (maximizedSlotIndex !== null && !slots[maximizedSlotIndex]) {
      maximizedSlotIndex = null;
    }

    return true;
  } catch {
    return false;
  }
}

function sanitizeSlots() {
  slots = slots.map((id) => {
    if (!id) return null;
    return getStreamerById(id) ? String(id) : null;
  });
}

function selectSlot(slotIndex) {
  selectedSlotIndex = clampSlot(slotIndex);
  activeAudioSlot = selectedSlotIndex;
  saveState();
  syncPanelState();
  renderNav();
}

function removeSlot(slotIndex) {
  const index = clampSlot(slotIndex);
  slots[index] = null;
  if (maximizedSlotIndex === index) maximizedSlotIndex = null;
  if (selectedSlotIndex === index) {
    selectedSlotIndex = clampSlot(index);
  }
  if (activeAudioSlot === index) {
    const fallback = slots.findIndex(Boolean);
    activeAudioSlot = fallback >= 0 ? fallback : selectedSlotIndex;
  }
  saveState();
  renderGrid();
  renderNav();
}

function assignStreamer(driverId) {
  const id = String(driverId || "").trim();
  const driver = getStreamerById(id);
  if (!driver) return;

  const existing = slots.findIndex((slot) => String(slot) === id);
  if (existing >= 0) {
    selectSlot(existing);
    return;
  }

  let target;

  if (slots.every(Boolean)) {
    target = clampSlot(selectedSlotIndex, 0);
  } else if (Number.isFinite(selectedSlotIndex)) {
    target = clampSlot(selectedSlotIndex);
  } else {
    target = slots.findIndex((slot) => !slot);
    if (target < 0) target = 0;
  }

  slots[target] = id;
  selectedSlotIndex = target;
  activeAudioSlot = target;
  saveState();
  renderGrid();
  renderNav();
}

function setMaximized(slotIndex) {
  if (slotIndex === null || slotIndex === undefined) {
    maximizedSlotIndex = null;
  } else {
    const index = clampSlot(slotIndex);
    if (!slots[index]) return;
    maximizedSlotIndex = index;
  }
  saveState();
  renderGrid();
}

function audioLabelHtml(isActive) {
  return isActive
    ? `<span class="streamview-audio streamview-audio--on" aria-label="Audio on">🔊 Audio On</span>`
    : `<span class="streamview-audio" aria-label="Audio muted">🔇 Muted</span>`;
}

function renderPlayer(driver, slotIndex) {
  const name = driver.display_name || driver.iracing_name || "Streamer";
  const streamUrl = String(driver.stream_url || "").trim();
  const parsed = parseStreamUrl(streamUrl);
  const isAudioActive = slotIndex === activeAudioSlot;
  const embedSrc = buildEmbedSrc(parsed, !isAudioActive);
  const externalUrl = parsed.external || streamUrl;

  if (embedSrc) {
    return `<div class="streamview-player">
      <iframe
        src="${escapeAttr(embedSrc)}"
        title="${escapeAttr(`${name} stream`)}"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        loading="lazy"
      ></iframe>
    </div>`;
  }

  return `<div class="streamview-fallback">
    <p class="streamview-fallback-platform">${escapeHtml(inferPlatform(streamUrl))}</p>
    <p class="muted">This stream opens best in a new tab.</p>
    ${
      externalUrl
        ? `<a class="streamview-open-btn" href="${escapeAttr(externalUrl)}" target="_blank" rel="noopener noreferrer">Open Stream</a>`
        : `<p class="muted">No stream link on file.</p>`
    }
  </div>`;
}

function panelClasses(slotIndex, hasDriver) {
  return [
    "streamview-panel",
    hasDriver ? "streamview-panel--loaded" : "streamview-panel--empty",
    slotIndex === selectedSlotIndex ? "is-selected" : "",
    slotIndex === activeAudioSlot && hasDriver ? "is-audio-active" : "",
    maximizedSlotIndex === slotIndex ? "is-maximized" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function renderLoadedPanel(driver, slotIndex) {
  const name = driver.display_name || driver.iracing_name || "Streamer";
  const number = driver.car_number ? `#${driver.car_number} ` : "";
  const isMaximized = maximizedSlotIndex === slotIndex;

  return `<article class="${panelClasses(slotIndex, true)}" data-slot="${slotIndex}" tabindex="0">
    <div class="streamview-panel-head">
      <h3 class="streamview-panel-title"><span class="streamview-slot-label">Slot ${slotIndex + 1}</span> ${escapeHtml(number)}${escapeHtml(name)}</h3>
      <div class="streamview-panel-actions">
        ${audioLabelHtml(slotIndex === activeAudioSlot)}
        ${
          isMaximized
            ? `<button type="button" class="streamview-icon-btn" data-minimize="${slotIndex}" aria-label="Minimize stream">Minimize</button>`
            : `<button type="button" class="streamview-icon-btn" data-maximize="${slotIndex}" aria-label="Maximize stream">Maximize</button>`
        }
        <button type="button" class="streamview-remove-btn" data-remove="${slotIndex}" aria-label="Remove ${escapeAttr(name)}">✕</button>
      </div>
    </div>
    ${renderPlayer(driver, slotIndex)}
  </article>`;
}

function renderEmptyPanel(slotIndex) {
  return `<article class="${panelClasses(slotIndex, false)}" data-slot="${slotIndex}" tabindex="0">
    <div class="streamview-panel-head">
      <h3 class="streamview-panel-title"><span class="streamview-slot-label">Slot ${slotIndex + 1}</span></h3>
      <div class="streamview-panel-actions">
        <span class="streamview-audio streamview-audio--idle">Empty</span>
      </div>
    </div>
    <div class="streamview-panel-empty">
      <p>Select a streamer above</p>
    </div>
  </article>`;
}

function renderGrid() {
  const grid = $("#streamviewGrid");
  if (!grid) return;

  grid.className = "streamview-grid streamview-grid--quad";
  if (maximizedSlotIndex !== null) {
    grid.classList.add("streamview-grid--maximized");
  }

  grid.innerHTML = slots
    .map((driverId, slotIndex) => {
      if (!driverId) return renderEmptyPanel(slotIndex);
      const driver = getStreamerById(driverId);
      if (!driver) return renderEmptyPanel(slotIndex);
      return renderLoadedPanel(driver, slotIndex);
    })
    .join("");

  bindGridEvents();
  updateViewportHeight();
}

function syncPanelState() {
  const grid = $("#streamviewGrid");
  if (!grid) return;

  slots.forEach((driverId, slotIndex) => {
    const panel = grid.querySelector(`[data-slot="${slotIndex}"]`);
    if (!panel) return;

    const hasDriver = Boolean(driverId && getStreamerById(driverId));
    panel.classList.toggle("is-selected", slotIndex === selectedSlotIndex);
    panel.classList.toggle("is-audio-active", hasDriver && slotIndex === activeAudioSlot);

    const audioEl = panel.querySelector(".streamview-audio");
    if (audioEl && hasDriver) {
      const isActive = slotIndex === activeAudioSlot;
      audioEl.className = isActive
        ? "streamview-audio streamview-audio--on"
        : "streamview-audio";
      audioEl.setAttribute("aria-label", isActive ? "Audio on" : "Audio muted");
      audioEl.textContent = isActive ? "🔊 Audio On" : "🔇 Muted";
    }

    if (hasDriver) {
      const driver = getStreamerById(driverId);
      const iframe = panel.querySelector("iframe");
      if (iframe && driver) {
        const parsed = parseStreamUrl(driver.stream_url);
        const muted = slotIndex !== activeAudioSlot;
        const nextSrc = buildEmbedSrc(parsed, muted);
        if (nextSrc && iframe.getAttribute("src") !== nextSrc) {
          iframe.setAttribute("src", nextSrc);
        }
      }
    }
  });

  renderNav();
}

function bindGridEvents() {
  const grid = $("#streamviewGrid");
  if (!grid || gridEventsBound) return;

  grid.addEventListener("click", (event) => {
    const removeBtn = event.target.closest("[data-remove]");
    if (removeBtn) {
      event.stopPropagation();
      removeSlot(Number(removeBtn.dataset.remove));
      return;
    }

    const maximizeBtn = event.target.closest("[data-maximize]");
    if (maximizeBtn) {
      event.stopPropagation();
      setMaximized(Number(maximizeBtn.dataset.maximize));
      return;
    }

    const minimizeBtn = event.target.closest("[data-minimize]");
    if (minimizeBtn) {
      event.stopPropagation();
      setMaximized(null);
      return;
    }

    if (event.target.closest("a") || event.target.closest("iframe")) return;

    const panel = event.target.closest(".streamview-panel");
    if (!panel) return;
    const slotIndex = Number(panel.dataset.slot);
    if (Number.isFinite(slotIndex)) selectSlot(slotIndex);
  });

  gridEventsBound = true;
}

function renderNav() {
  const nav = $("#streamviewNav");
  if (!nav) return;

  if (!streamers.length) {
    nav.innerHTML = `<p class="muted">No streamers available.</p>`;
    return;
  }

  const selectedLabel = `Slot ${selectedSlotIndex + 1} selected`;

  nav.innerHTML = `<div class="streamview-nav-status">${escapeHtml(selectedLabel)}</div>${streamers
    .map((driver) => {
      const id = String(driver.driver_id);
      const name = driver.display_name || driver.iracing_name || "Streamer";
      const number = driver.car_number ? `#${driver.car_number} ` : "";
      const loadedIndex = slots.findIndex((slot) => String(slot) === id);
      const classes = [
        "streamview-nav-btn",
        loadedIndex >= 0 ? "is-loaded" : "",
        loadedIndex === selectedSlotIndex ? "is-focused" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `<button type="button" class="${classes}" data-driver-id="${escapeAttr(id)}">${escapeHtml(number)}${escapeHtml(name)}</button>`;
    })
    .join("")}`;

  nav.querySelectorAll(".streamview-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => assignStreamer(btn.dataset.driverId));
  });
}

function updateViewportHeight() {
  const main = $(".streamview-main");
  if (!main) return;

  const topbar = $(".topbar");
  const head = $(".streamview-head");
  const nav = $("#streamviewNav");
  const footer = document.querySelector("footer");

  const topbarH = topbar?.offsetHeight || 0;
  const headH = head?.offsetHeight || 0;
  const navH = nav?.offsetHeight || 0;
  const footerH = footer?.offsetHeight || 0;
  const mainStyles = window.getComputedStyle(main);
  const padTop = parseFloat(mainStyles.paddingTop) || 0;
  const padBottom = parseFloat(mainStyles.paddingBottom) || 0;
  const reserved = topbarH + headH + navH + footerH + padTop + padBottom + 12;

  document.documentElement.style.setProperty("--streamview-chrome", `${reserved}px`);
}

function bindGlobalEvents() {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && maximizedSlotIndex !== null) {
      setMaximized(null);
    }
  });

  window.addEventListener("resize", updateViewportHeight);
}

async function loadStreamers() {
  const nav = $("#streamviewNav");
  const grid = $("#streamviewGrid");

  if (nav) nav.innerHTML = `<p class="muted">Loading streamers...</p>`;
  if (grid) {
    grid.className = "streamview-grid streamview-grid--quad";
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
          b.display_name || a.iracing_name || ""
        )
      );

    loadState();
    sanitizeSlots();

    const params = new URLSearchParams(window.location.search);
    const urlStreamer = String(params.get("streamer") || params.get("driver_id") || "").trim();

    if (urlStreamer && getStreamerById(urlStreamer)) {
      const existing = slots.findIndex((slot) => String(slot) === urlStreamer);
      if (existing >= 0) {
        selectSlot(existing);
      } else {
        slots[selectedSlotIndex] = urlStreamer;
        activeAudioSlot = selectedSlotIndex;
        saveState();
      }
    } else {
      saveState();
    }

    bindGlobalEvents();
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

document.body.classList.add("streamview-page-body");
loadStreamers();
