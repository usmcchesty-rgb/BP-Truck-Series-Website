const DEFAULT_PLAYOFF_CUT = 16;
const $ = (s) => document.querySelector(s);
let standings = [];
let standingsTableView = "top16";
let latestCautionStats = null;
let playoffCut = DEFAULT_PLAYOFF_CUT;
let playoffPhase = null;
let sidebarPhase = null;
let seasonCounts = null;

// Secondary lookups used only if the slug-based image fails to load.
const TRACK_IMAGE_ALIASES = {
  "charlotte-motor-speedway-oval": "/assets/tracks/charlotte-motor-speedway-oval-night.png",
  "charlotte-oval": "/assets/tracks/charlotte-motor-speedway-oval-night.png",
  indianapolis: "/assets/tracks/indianapolis-motor-speedway-nascar-oval.png",
};

const SPONSOR_FILES = [
  "Flying Pig Logo Transparent.png",
  "OIRoofing_Logo_White_Transparent.png",
  "Short Stop Logo Transparent.png",
];

function driverImage(driver) {
  const slug = String(driver || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `assets/drivers/${slug}.png`;
}

function changeClass(v) {
  const n = Number(v);
  return n > 0 ? "positive" : n < 0 ? "negative" : "";
}

function changeText(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n > 0 ? `▲ ${n}` : n < 0 ? `▼ ${Math.abs(n)}` : "—";
}

function podiumClass(place) {
  if (place === 1) return "first";
  if (place === 2) return "second";
  if (place === 3) return "third";
  return "";
}

function gapHtml(r) {
  if (r.place === 1) {
    return `<div class="gap"><span class="leader-label">LEADER</span></div>`;
  }
  return `<div class="gap"><b class="gap-value">${r.behindLeader}</b><span class="behind-label">BEHIND LEADER</span></div>`;
}

function head() {
  return `<tr><th>POS</th><th>DRIVER</th><th>CHANGE</th><th>POINTS</th><th>BEHIND LEADER</th><th>BEHIND NEXT</th><th>RACES</th><th>WINS</th><th>TOP 5s</th><th>TOP 10s</th></tr>`;
}

function row(r) {
  const numPlate = r.carNumber ? `<span class="num">${r.carNumber}</span>` : "";
  return `<tr>
    <td class="pos">${r.place}</td>
    <td><span class="driver-cell">${numPlate}${r.driver}</span></td>
    <td class="${changeClass(r.change)}">${changeText(r.change)}</td>
    <td class="points">${r.points}</td>
    <td class="negative">${r.behindLeader}</td>
    <td class="negative">${r.behindNext}</td>
    <td>${r.races}</td>
    <td>${r.wins ?? 0}</td>
    <td>${r.top5 ?? 0}</td>
    <td>${r.top10 ?? 0}</td>
  </tr>`;
}

function renderPodium() {
  const order = [standings[1], standings[0], standings[2]].filter(Boolean);

  $("#podium").innerHTML = order
    .map(
      (r) =>
        `<article class="podium-card ${podiumClass(r.place)}">
          <div class="rank-badge">${r.place}</div>
          <img class="driver-img" src="${r.photoUrl || driverImage(r.driver)}" alt="" onerror="this.onerror=null;this.src='/assets/drivers/placeholder.png'"/>
          <div class="podium-info">
            <h2>${String(r.driver).toUpperCase()}</h2>
            <div class="podium-points">${r.points}<small> PTS</small></div>
            ${gapHtml(r)}
          </div>
          <div class="stats-row">
            <div><b>${r.races}</b><span>RACES</span></div>
            <div><b>${r.wins ?? 0}</b><span>WINS</span></div>
            <div><b>${r.top5 ?? 0}</b><span>TOP 5s</span></div>
            <div><b>${r.top10 ?? 0}</b><span>TOP 10s</span></div>
          </div>
        </article>`
    )
    .join("");
}

function activeFieldSize() {
  if (playoffPhase?.fieldSize) return Number(playoffPhase.fieldSize);
  if (playoffCut != null) return Number(playoffCut);
  return DEFAULT_PLAYOFF_CUT;
}

function cutLineLabel() {
  if (playoffPhase?.isFinalRound) return null;
  if (playoffPhase?.isPlayoffs && playoffPhase?.advanceSize) {
    return `ADVANCEMENT CUT — TOP ${playoffPhase.advanceSize} ADVANCE`;
  }
  return `PLAYOFF CUT LINE — TOP ${playoffCut || DEFAULT_PLAYOFF_CUT}`;
}

function renderTable(target, rows, cut = true) {
  const html = [];
  const cutPos = playoffPhase?.isFinalRound
    ? null
    : Number(playoffCut || DEFAULT_PLAYOFF_CUT);
  const cutLabel = cutLineLabel();

  rows.forEach((r, i) => {
    html.push(row(r));

    const place = Number(r.place);
    const nextPlace = rows[i + 1] ? Number(rows[i + 1].place) : Infinity;
    if (
      cut &&
      cutPos &&
      cutLabel &&
      rows.length >= cutPos &&
      place <= cutPos &&
      nextPlace > cutPos
    ) {
      html.push(
        `<tr class="cutline"><td colspan="10">${cutLabel}</td></tr>`
      );
    }
  });

  $(target).innerHTML = html.join("");
}

function countDifferentWinners(rows) {
  return rows.filter((r) => Number(r.wins || 0) > 0).length;
}

function trackSlug(track) {
  if (window.BPTrackImages?.normalizeTrackSlug) {
    return window.BPTrackImages.normalizeTrackSlug(track);
  }
  return String(track || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Slug-based filename first; Supabase URL when configured; aliases as fallbacks.
function trackImageCandidates(track) {
  if (window.BPTrackImages?.trackImageCandidates) {
    return window.BPTrackImages.trackImageCandidates(track);
  }
  const slug = trackSlug(track);
  if (!slug) return [];
  const candidates = [`/assets/tracks/${slug}.png`];
  for (const [aliasSlug, path] of Object.entries(TRACK_IMAGE_ALIASES)) {
    if (slug.includes(aliasSlug) && !candidates.includes(path)) {
      candidates.push(path);
    }
  }
  return candidates;
}

function formatTrackHtml(track) {
  const t = String(track || "TBD").trim();
  const words = t.split(/\s+/);
  if (words.length <= 1) return t.toUpperCase();
  return `${words[0].toUpperCase()}<br /><small>${words.slice(1).join(" ").toUpperCase()}</small>`;
}

function splitDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return { date: "Date TBD", time: "" };
  const atParts = raw.split(/\s+@\s+|\s+at\s+/i);
  if (atParts.length > 1) {
    return { date: atParts[0].trim(), time: atParts.slice(1).join(" ").trim() };
  }
  const timeMatch = raw.match(
    /(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?|\d{1,2}\s*(?:AM|PM|am|pm))/
  );
  if (timeMatch) {
    return {
      date: raw.replace(timeMatch[0], "").replace(/[,–-]\s*$/, "").trim(),
      time: timeMatch[0].trim(),
    };
  }
  return { date: raw, time: "" };
}

function findDriverPhoto(name) {
  const needle = String(name || "").toLowerCase();
  const row = standings.find((r) => String(r.driver || "").toLowerCase() === needle);
  return row?.photoUrl || driverImage(name);
}

function ensureSidebarMarkup() {
  const sidebar = document.querySelector(".sidebar");
  const logoCard = sidebar?.querySelector(".logo-card");
  if (sidebar && logoCard && !$("#sidebarSponsors")) {
    const wrap = document.createElement("div");
    wrap.id = "sidebarSponsors";
    wrap.className = "sidebar-sponsors";
    sidebar.insertBefore(wrap, logoCard);
  }
}

function renderNextRaceImage(track) {
  const img = $("#nextRaceImg");
  const placeholder = $("#nextRacePlaceholder");
  if (!img || !placeholder) return;

  const candidates = trackImageCandidates(track);
  let i = 0;

  const showPlaceholder = () => {
    img.hidden = true;
    img.removeAttribute("src");
    placeholder.hidden = false;
  };

  const tryNext = () => {
    if (i >= candidates.length) {
      showPlaceholder();
      return;
    }
    img.src = candidates[i++];
  };

  img.onload = () => {
    img.hidden = false;
    placeholder.hidden = true;
  };
  img.onerror = tryNext;

  if (!candidates.length) {
    showPlaceholder();
    return;
  }
  tryNext();
}

function renderLastWinner(lastRace) {
  if (!lastRace?.winner) {
    const withWins = standings.filter((r) => Number(r.wins || 0) > 0);
    const pick = withWins[0] || standings[0];
    if (!pick) {
      $("#lastWinnerName").textContent = "—";
      $("#lastWinnerTrack").textContent = "Track TBD";
      $("#lastWinnerDate").textContent = "Date TBD";
      $("#lastWinnerImg").src = "/assets/drivers/placeholder.png";
      return;
    }
    $("#lastWinnerName").textContent = pick.driver;
    $("#lastWinnerTrack").textContent = "Track TBD";
    $("#lastWinnerDate").textContent = "Date TBD";
    $("#lastWinnerImg").src = pick.photoUrl || driverImage(pick.driver);
  } else {
    const { date } = splitDateTime(lastRace.date);
    $("#lastWinnerName").textContent = lastRace.winner;
    $("#lastWinnerTrack").textContent = lastRace.track || "Track TBD";
    $("#lastWinnerDate").textContent = date;
    $("#lastWinnerImg").src = findDriverPhoto(lastRace.winner);
  }

  $("#lastWinnerImg").onerror = function () {
    this.onerror = null;
    this.src = "/assets/drivers/placeholder.png";
  };
}

function renderNextRace(nextRace, raceStartTime) {
  const trackEl = $("#nextRaceTrack");
  const dateEl = $("#nextRaceDate");
  const timeEl = $("#nextRaceTime");

  if (!nextRace) {
    if (trackEl) trackEl.textContent = "TBD";
    if (dateEl) dateEl.textContent = "Date TBD";
    if (timeEl) timeEl.textContent = "";
    renderNextRaceImage("");
    return;
  }

  if (trackEl) trackEl.innerHTML = formatTrackHtml(nextRace.track);
  const { date, time } = splitDateTime(nextRace.date);
  if (dateEl) dateEl.textContent = date;
  if (timeEl) timeEl.textContent = raceStartTime || time || "";
  renderNextRaceImage(nextRace.track);
}

function renderSponsorCards() {
  const wrap = $("#sidebarSponsors");
  if (!wrap) return;

  wrap.innerHTML = SPONSOR_FILES.map(
    (file) =>
      `<div class="card sponsor-card" hidden>
        <img class="sponsor-logo" src="/assets/sponsors/${encodeURIComponent(file)}" alt="" />
      </div>`
  ).join("");

  wrap.querySelectorAll(".sponsor-card").forEach((card) => {
    const img = card.querySelector("img");
    const show = () => {
      card.hidden = false;
    };
    img.addEventListener("load", show);
    img.addEventListener("error", () => card.remove());
    if (img.complete && img.naturalWidth > 0) show();
  });
}

async function loadScheduleSidebar() {
  try {
    const res = await fetch("/api/schedule");
    const data = await res.json();
    const races = data.races || [];
    const completed = races.filter((r) => r.winner);
    const lastRace = completed[completed.length - 1] || null;
    renderLastWinner(lastRace);
    renderNextRace(data.next || null, data.settings?.raceStartTime || "");
  } catch (e) {
    console.warn("Schedule sidebar fallback:", e);
    renderLastWinner(null);
    renderNextRace(null, "");
  }
}

function renderSidebar() {
  const raceCountEl = $("#raceCount");
  if (raceCountEl) {
    if (sidebarPhase?.primary) {
      raceCountEl.textContent = sidebarPhase.primary;
      const labelEl = raceCountEl.parentElement?.querySelector("span");
      if (labelEl) {
        const parts = [sidebarPhase.secondary, sidebarPhase.detail].filter(Boolean);
        labelEl.textContent = parts.join(" · ") || "SEASON PROGRESS";
      }
    } else if (seasonCounts) {
      raceCountEl.textContent = `${seasonCounts.completedRegularSeasonRaces} / ${seasonCounts.regularSeasonRacesTotal}`;
      const labelEl = raceCountEl.parentElement?.querySelector("span");
      if (labelEl) labelEl.textContent = "REGULAR SEASON RACES";
    } else {
      const maxRaces = standings.length
        ? Math.max(...standings.map((x) => Number(x.races || 0)))
        : 0;
      raceCountEl.textContent = `${maxRaces} / 20`;
    }
  }

  $("#winnerCount").textContent = String(countDifferentWinners(standings));
  window.BPSeasonSummary?.renderAvgCautions(latestCautionStats);
  const count = standings.length;
  const fullStandingsTab = $("#fullStandingsTab");
  if (fullStandingsTab) fullStandingsTab.textContent = `FULL STANDINGS (1–${count})`;

  const topTab = document.querySelector('[data-table-view="top16"]');
  if (topTab) {
    const field = activeFieldSize();
    if (playoffPhase?.isFinalRound) topTab.textContent = `FINAL ${field}`;
    else if (playoffPhase?.isPlayoffs) topTab.textContent = `PLAYOFF FIELD (1–${field})`;
    else topTab.textContent = `TOP ${field}`;
  }

  loadScheduleSidebar();
}

function getStandingsTableRows() {
  if (standingsTableView === "top16") {
    return standings.slice(0, activeFieldSize());
  }

  const q = $("#search")?.value?.toLowerCase() || "";
  if (!q) return standings;
  return standings.filter((r) => r.driver.toLowerCase().includes(q));
}

function renderStandingsTable() {
  const searchInput = $("#search");
  if (searchInput) searchInput.hidden = standingsTableView === "top16";
  renderTable("#overviewBody", getStandingsTableRows(), true);
}

function setStandingsTableView(view) {
  standingsTableView = view;

  document.querySelectorAll(".standings-table-tabs [data-table-view]").forEach((btn) => {
    const isActive = btn.dataset.tableView === view;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  if (view === "top16" && $("#search")) $("#search").value = "";
  renderStandingsTable();
}

function initStandingsTableTabs() {
  if (!$("#overviewBody")) return;

  document.querySelectorAll(".standings-table-tabs [data-table-view]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      setStandingsTableView(btn.dataset.tableView);
    });
  });
}

function render() {
  $("#overviewHead").innerHTML = head();

  renderPodium();
  renderStandingsTable();
  renderSidebar();
}

async function load(force = false) {
  try {
    if (window.BPTrackImages?.loadConfig) {
      await window.BPTrackImages.loadConfig();
    }

    $("#lastUpdated").textContent = "Updating...";

    const res = await fetch(`/api/standings${force ? "?force=1" : ""}`);
    const data = await res.json();

    if (window.BPTrackImages?.applySettings) {
      window.BPTrackImages.applySettings(data.settings || {});
    }

    const rows = data.rows || [];
    const leaderPoints = rows[0]?.points || 0;
    const seasonName = data.settings?.seasonName || "Season 11";

    $("#seasonLabel").textContent = seasonName.toUpperCase();
    $("#sidebarSeason").textContent = seasonName.toUpperCase();

    standings = rows.map((r, index) => {
      const previous = rows[index - 1];

      return {
        place: r.position,
        change: r.gainLoss,
        driver: r.driver,
        carNumber: r.carNumber || "",
        photoUrl: r.photoUrl,
        points: r.points,
        behindLeader: r.position === 1 ? "—" : r.points - leaderPoints,
        behindNext: previous ? r.points - previous.points : "—",
        races: r.races,
        wins: r.wins,
        top5: r.top5,
        top10: r.top10
      };
    });

    latestCautionStats = data.cautionStats || null;
    playoffPhase = data.playoffPhase || null;
    sidebarPhase = data.sidebarPhase || null;
    seasonCounts = data.seasonCounts || null;
    if (playoffPhase?.cutPosition != null) {
      playoffCut = Number(playoffPhase.cutPosition);
    } else if (playoffPhase?.isFinalRound || playoffPhase?.showCutColumn === false) {
      playoffCut = null;
    } else {
      playoffCut = Number(data.settings?.playoffCut) || DEFAULT_PLAYOFF_CUT;
    }

    $("#lastUpdated").textContent = data.updatedAt
      ? new Date(data.updatedAt).toLocaleString()
      : new Date().toLocaleString();

    render();

    if (data.error) {
      console.warn("Using fallback/cache:", data.error);
    }
  } catch (e) {
    console.error("Failed to load standings:", e);
    $("#lastUpdated").textContent = "Load failed";
  }
}

const refreshBtn = $("#refreshBtn");
if (refreshBtn) refreshBtn.addEventListener("click", () => load(true));

const searchInput = $("#search");
if (searchInput) {
  searchInput.addEventListener("input", () => {
    if (standingsTableView === "full") renderStandingsTable();
  });
}

if ($("#overviewBody")) {
  initStandingsTableTabs();
  ensureSidebarMarkup();
  renderSponsorCards();
  if (window.BPShare?.initPageShare) {
    window.BPShare.initPageShare("#standingsShareHost", {
      title: "Blazing Pedals Truck Series Standings",
      text: "Season 11 championship standings for the Blazing Pedals Truck Series.",
      description: "Season 11 championship standings for the Blazing Pedals Truck Series.",
      url: window.location.href,
      image: window.BPShare.DEFAULT_IMAGE,
      type: "website",
      compact: true,
    });
  }
  load();
  setInterval(() => load(), 60000);
}
