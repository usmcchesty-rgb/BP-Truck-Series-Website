const $ = (s) => document.querySelector(s);

const STORAGE_KEY = "bp-streamview-state";
const VOLUME_STORAGE_KEY = "streamviewVolume";
const DEFAULT_VOLUME = 60;
const MAX_SLOTS = 4;

let streamers = [];
let slots = [null, null, null, null];
let selectedSlotIndex = 0;
let activeAudioSlot = 0;
let maximizedSlotIndex = null;
let streamVolume = DEFAULT_VOLUME;
let gridEventsBound = false;
let twitchScriptLoading = null;
const twitchPlayers = new Map();

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

function clampVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VOLUME;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function loadVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw !== null && raw !== "") {
      streamVolume = clampVolume(raw);
    }
  } catch (e) {
    console.warn("StreamView: could not load volume", e);
  }
}

function saveVolume() {
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(streamVolume));
  } catch (e) {
    console.warn("StreamView: could not save volume", e);
  }
}

function isEffectiveMuted(slotIndex) {
  return slotIndex !== activeAudioSlot || streamVolume === 0;
}

function isTwitchParsed(parsed) {
  return parsed?.type === "twitch" || parsed?.type === "twitch-video";
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

function audioControlsHtml(isActive) {
  if (!isActive) {
    return `<span class="streamview-audio" aria-label="Audio muted">🔇 Muted</span>`;
  }

  return `<div class="streamview-audio-group">
    <span class="streamview-audio streamview-audio--on" aria-label="Audio on">🔊 Audio On</span>
    <label class="streamview-volume" title="Stream volume">
      <span class="streamview-sr-only">Stream volume</span>
      <input
        type="range"
        class="streamview-volume-slider"
        min="0"
        max="100"
        value="${streamVolume}"
        title="Stream volume"
        aria-label="Stream volume"
      />
    </label>
  </div>`;
}

function ensureTwitchScript() {
  if (window.Twitch?.Player) return Promise.resolve();
  if (twitchScriptLoading) return twitchScriptLoading;

  twitchScriptLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://player.twitch.tv/js/embed/v1.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Twitch embed script failed to load"));
    document.head.appendChild(script);
  });

  return twitchScriptLoading;
}

function applyEmbedAudioState(slotIndex, driver) {
  if (!driver) return;

  const parsed = parseStreamUrl(driver.stream_url);
  const muted = isEffectiveMuted(slotIndex);

  if (isTwitchParsed(parsed)) {
    const player = twitchPlayers.get(slotIndex);
    if (player?.setMuted && player?.setVolume) {
      player.setMuted(muted);
      if (!muted) {
        player.setVolume(streamVolume / 100);
      }
      return;
    }
  }

  const panel = document.querySelector(`#streamviewGrid [data-slot="${slotIndex}"]`);
  const iframe = panel?.querySelector("iframe");
  if (!iframe) return;

  const nextSrc = buildEmbedSrc(parsed, muted);
  if (nextSrc && iframe.getAttribute("src") !== nextSrc) {
    iframe.setAttribute("src", nextSrc);
  }
}

function applyAllEmbedAudio() {
  slots.forEach((driverId, slotIndex) => {
    if (!driverId) return;
    const driver = getStreamerById(driverId);
    if (driver) applyEmbedAudioState(slotIndex, driver);
  });
}

async function initTwitchEmbeds() {
  const targets = [];

  slots.forEach((driverId, slotIndex) => {
    if (!driverId) return;
    const driver = getStreamerById(driverId);
    if (!driver) return;
    const parsed = parseStreamUrl(driver.stream_url);
    if (!isTwitchParsed(parsed)) return;
    targets.push({ slotIndex, parsed });
  });

  if (!targets.length) return;

  try {
    await ensureTwitchScript();
  } catch (e) {
    console.warn("StreamView: Twitch embed API unavailable", e);
    targets.forEach(({ slotIndex, parsed }) => {
      const container = document.getElementById(`streamview-twitch-${slotIndex}`);
      renderTwitchIframeFallback(container, parsed, slotIndex);
    });
    return;
  }

  if (!window.Twitch?.Player) {
    targets.forEach(({ slotIndex, parsed }) => {
      const container = document.getElementById(`streamview-twitch-${slotIndex}`);
      renderTwitchIframeFallback(container, parsed, slotIndex);
    });
    return;
  }

  targets.forEach(({ slotIndex, parsed }) => {
    const containerId = `streamview-twitch-${slotIndex}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    twitchPlayers.delete(slotIndex);

    const muted = isEffectiveMuted(slotIndex);
    const options = {
      width: "100%",
      height: "100%",
      parent: getEmbedParentHosts(),
      autoplay: true,
      muted,
      volume: streamVolume / 100,
    };

    if (parsed.type === "twitch") {
      options.channel = parsed.channel;
    } else {
      options.video = `v${parsed.videoId}`;
    }

    try {
      const player = new window.Twitch.Player(containerId, options);
      twitchPlayers.set(slotIndex, player);
      player.addEventListener(window.Twitch.Player.READY, () => {
        player.setMuted(isEffectiveMuted(slotIndex));
        if (!isEffectiveMuted(slotIndex)) {
          player.setVolume(streamVolume / 100);
        }
      });
    } catch (e) {
      console.warn(`StreamView: could not init Twitch player for slot ${slotIndex + 1}`, e);
      renderTwitchIframeFallback(container, parsed, slotIndex);
    }
  });
}

function renderTwitchIframeFallback(container, parsed, slotIndex) {
  if (!container) return;
  const src = buildEmbedSrc(parsed, isEffectiveMuted(slotIndex));
  if (!src) return;

  container.innerHTML = `<iframe
    src="${escapeAttr(src)}"
    title="Twitch stream"
    allow="autoplay; fullscreen; picture-in-picture"
    allowfullscreen
    loading="lazy"
  ></iframe>`;
}

function setStreamVolume(value, options = {}) {
  streamVolume = clampVolume(value);
  saveVolume();
  if (!options.skipControlsSync) {
    syncAudioControls();
  }
  applyAllEmbedAudio();
}

function syncAudioControls() {
  const grid = $("#streamviewGrid");
  if (!grid) return;

  slots.forEach((driverId, slotIndex) => {
    const panel = grid.querySelector(`[data-slot="${slotIndex}"]`);
    if (!panel || !driverId) return;

    const audioControls = panel.querySelector("[data-audio-controls]");
    if (!audioControls) return;

    const isActive = slotIndex === activeAudioSlot;
    audioControls.innerHTML = audioControlsHtml(isActive);
  });
}

function renderPlayer(driver, slotIndex) {
  const name = driver.display_name || driver.iracing_name || "Streamer";
  const streamUrl = String(driver.stream_url || "").trim();
  const parsed = parseStreamUrl(streamUrl);
  const muted = isEffectiveMuted(slotIndex);
  const externalUrl = parsed.external || streamUrl;

  if (isTwitchParsed(parsed)) {
    return `<div class="streamview-player streamview-player--twitch">
      <div id="streamview-twitch-${slotIndex}" class="streamview-twitch-target"></div>
    </div>`;
  }

  const embedSrc = buildEmbedSrc(parsed, muted);

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
        <div class="streamview-audio-controls" data-audio-controls>
          ${audioControlsHtml(slotIndex === activeAudioSlot)}
        </div>
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

  twitchPlayers.clear();

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
  initTwitchEmbeds().then(() => applyAllEmbedAudio());
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
  });

  syncAudioControls();
  applyAllEmbedAudio();
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

    if (
      event.target.closest("a") ||
      event.target.closest("iframe") ||
      event.target.closest(".streamview-volume-slider")
    ) {
      return;
    }

    const panel = event.target.closest(".streamview-panel");
    if (!panel) return;
    const slotIndex = Number(panel.dataset.slot);
    if (Number.isFinite(slotIndex)) selectSlot(slotIndex);
  });

  grid.addEventListener("input", (event) => {
    if (!event.target.matches(".streamview-volume-slider")) return;
    event.stopPropagation();
    setStreamVolume(Number(event.target.value), { skipControlsSync: true });
  });

  grid.addEventListener(
    "mousedown",
    (event) => {
      if (event.target.matches(".streamview-volume-slider")) {
        event.stopPropagation();
      }
    },
    true
  );

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
  const page = $(".streamview-page");
  const footer = document.querySelector("footer");

  const topbarH = topbar?.offsetHeight || 0;
  const headH = head?.offsetHeight || 0;
  const navH = nav?.offsetHeight || 0;
  const footerH = footer?.offsetHeight || 0;
  const mainStyles = window.getComputedStyle(main);
  const pageStyles = page ? window.getComputedStyle(page) : null;
  const padTop = parseFloat(mainStyles.paddingTop) || 0;
  const padBottom = parseFloat(mainStyles.paddingBottom) || 0;
  const pagePad =
    (parseFloat(pageStyles?.paddingTop) || 0) + (parseFloat(pageStyles?.paddingBottom) || 0);
  const reserved = topbarH + headH + navH + footerH + padTop + padBottom + pagePad + 4;
  const gridH = Math.max(320, window.innerHeight - reserved);

  document.documentElement.style.setProperty("--streamview-chrome", `${reserved}px`);
  document.documentElement.style.setProperty("--streamview-grid-h", `${gridH}px`);
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
    loadVolume();
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
