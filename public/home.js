const $ = (s) => document.querySelector(s);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// URL-safe filenames served from /assets/sponsors/ (web root = public/).
const HOME_SPONSOR_FILES = [
  { file: "flying-pig-logo.png", label: "Flying Pig" },
  { file: "oi-roofing-logo.png", label: "OI Roofing" },
  { file: "short-stop-logo.png", label: "Short Stop" },
];

function sponsorImageSrc(file) {
  return `/assets/sponsors/${encodeURIComponent(file)}`;
}

function renderHomeSponsors() {
  const strip = $("#homeSponsorsStrip");
  if (!strip) return;

  const urls = HOME_SPONSOR_FILES.map((sponsor) => sponsorImageSrc(sponsor.file));
  console.log("[BP Home] Sponsor image URLs:", urls);

  strip.innerHTML = HOME_SPONSOR_FILES.map((sponsor) => {
    const src = sponsorImageSrc(sponsor.file);
    return `<div class="home-sponsor-slot">
      <img src="${src}" alt="${sponsor.label}" loading="lazy" />
    </div>`;
  }).join("");
}

const TRACK_IMAGE_ALIASES = {
  "charlotte-motor-speedway-oval": "/assets/tracks/charlotte-motor-speedway-oval-night.png",
  "charlotte-oval": "/assets/tracks/charlotte-motor-speedway-oval-night.png",
  indianapolis: "/assets/tracks/indianapolis-motor-speedway-nascar-oval.png",
};

function trackSlug(track) {
  return String(track || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function trackImageCandidates(track) {
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

function driverImage(driver) {
  const slug = String(driver || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `/assets/drivers/${slug}.png`;
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
  return { date: raw, time: "" };
}

function renderNextRaceImage(track) {
  const img = $("#homeNextRaceImg");
  const placeholder = $("#homeNextRacePlaceholder");
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

function renderNextRace(nextRace, raceStartTime) {
  const trackEl = $("#homeNextRaceTrack");
  const dateEl = $("#homeNextRaceDate");
  const timeEl = $("#homeNextRaceTime");

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

function formatOrdinal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return "";
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function formatPositionsChange(value) {
  const change = Number(value);
  if (!Number.isFinite(change) || change === 0) return "";
  return change > 0 ? `(+${change})` : `(${change})`;
}

function renderWinnerStat(label, value, formatter, options = {}) {
  if (value == null || value === "") return "";
  const display = formatter ? formatter(value) : String(value);
  const highlightClass = options.highlight ? " home-winner-stat--highlight" : "";
  return `<div class="home-winner-stat${highlightClass}">
    <span class="home-winner-stat-label">${escapeHtml(label)}</span>
    <strong class="home-winner-stat-value">${escapeHtml(display)}</strong>
  </div>`;
}

function renderWinnerStatsGrid(summary = {}) {
  const cells = [
    renderWinnerStat("Start", summary.startingPos, (v) => `P${v}`),
    renderWinnerStat("Laps Led", summary.lapsLed),
    renderWinnerStat("Incidents", summary.incidents),
    renderWinnerStat("Points", summary.racePoints, null, { highlight: true }),
    renderWinnerStat("Stage 1", summary.stage1Finish, formatOrdinal),
    renderWinnerStat("Stage 2", summary.stage2Finish, formatOrdinal),
    renderWinnerStat("Stage Pts", summary.stagePoints),
    renderWinnerStat("Total Pts", summary.totalPoints, null, { highlight: true }),
  ].filter(Boolean);

  if (!cells.length) return "";
  return cells.join("");
}

function setLastWinnerFinishBadge(finishEl, changeEl, finish, positionsGained) {
  if (finishEl) {
    const finishText = formatOrdinal(finish || 1).toUpperCase();
    finishEl.textContent = finishText || "1ST";
    finishEl.hidden = false;
  }
  if (changeEl) {
    const changeText = formatPositionsChange(positionsGained);
    if (changeText) {
      changeEl.textContent = changeText;
      changeEl.hidden = false;
    } else {
      changeEl.textContent = "";
      changeEl.hidden = true;
    }
  }
}

function renderLastWinner(raceResults, lastRace) {
  const nameEl = $("#homeLastWinnerName");
  const trackEl = $("#homeLastWinnerTrack");
  const dateEl = $("#homeLastWinnerDate");
  const finishEl = $("#homeLastWinnerFinish");
  const changeEl = $("#homeLastWinnerPositionChange");
  const imgEl = $("#homeLastWinnerImg");
  const statsEl = $("#homeLastWinnerStats");
  const photoLink = $("#homeLastWinnerPhotoLink");
  const nameLink = $("#homeLastWinnerNameLink");
  if (!nameEl || !trackEl || !dateEl || !imgEl) return;

  const summary = raceResults?.winnerSummary || null;
  const profileUrl = summary?.profileUrl || "drivers.html";

  if (photoLink) photoLink.href = profileUrl;
  if (nameLink) nameLink.href = profileUrl;

  if (summary) {
    const { date } = splitDateTime(raceResults?.selectedRaceDate || lastRace?.date || "");
    nameEl.textContent = summary.driverName || "—";
    trackEl.textContent =
      raceResults?.selectedRaceName || lastRace?.track || "Track TBD";
    dateEl.textContent = date || "Date TBD";
    imgEl.src = summary.photoUrl || driverImage(summary.driverName);
    setLastWinnerFinishBadge(finishEl, changeEl, summary.finish, summary.positionsGained);

    if (statsEl) {
      const statsHtml = renderWinnerStatsGrid(summary);
      if (statsHtml) {
        statsEl.innerHTML = statsHtml;
        statsEl.hidden = false;
      } else {
        statsEl.innerHTML = "";
        statsEl.hidden = true;
      }
    }
  } else if (lastRace?.winner) {
    const { date } = splitDateTime(lastRace.date);
    nameEl.textContent = lastRace.winner;
    trackEl.textContent = lastRace.track || "Track TBD";
    dateEl.textContent = date;
    imgEl.src = driverImage(lastRace.winner);
    setLastWinnerFinishBadge(finishEl, changeEl, 1, null);
    if (statsEl) {
      statsEl.innerHTML = "";
      statsEl.hidden = true;
    }
  } else {
    nameEl.textContent = "—";
    trackEl.textContent = "Track TBD";
    dateEl.textContent = "Date TBD";
    imgEl.src = "/assets/drivers/placeholder.png";
    if (finishEl) finishEl.hidden = true;
    if (changeEl) changeEl.hidden = true;
    if (statsEl) {
      statsEl.innerHTML = "";
      statsEl.hidden = true;
    }
  }

  imgEl.onerror = function () {
    this.onerror = null;
    this.src = "/assets/drivers/placeholder.png";
  };
}

function renderHomeSpotlightPlaceholder() {
  const active = $("#homeSpotlightActive");
  const placeholder = $("#homeSpotlightPlaceholder");
  if (active) active.hidden = true;
  if (placeholder) placeholder.hidden = false;
}

function renderHomeSpotlight(article, driver) {
  const active = $("#homeSpotlightActive");
  const placeholder = $("#homeSpotlightPlaceholder");
  const imgEl = $("#homeSpotlightImg");
  const nameEl = $("#homeSpotlightDriverName");
  const carEl = $("#homeSpotlightCarNumber");
  const headlineEl = $("#homeSpotlightHeadline");
  const dekEl = $("#homeSpotlightDek");
  const linkEl = $("#homeSpotlightArticleLink");

  if (!article || !active || !placeholder) {
    renderHomeSpotlightPlaceholder();
    return;
  }

  const driverName =
    driver?.display_name ||
    driver?.displayName ||
    driver?.iracing_name ||
    "Driver Spotlight";
  const carNumber = String(driver?.car_number || driver?.carNumber || "").trim();
  const imageUrl =
    article.displayImage?.url ||
    driver?.photo_url ||
    driver?.photoUrl ||
    driverImage(driverName);
  const dek = article.subheadline || article.summary || "";
  const articleHref = article.slug ? articleUrl(article.slug) : "news.html";

  if (imgEl) {
    imgEl.src = imageUrl;
    imgEl.alt = `${driverName} — Driver Spotlight`;
    imgEl.onerror = function () {
      this.onerror = null;
      this.src = "/assets/drivers/placeholder.png";
    };
  }
  if (nameEl) nameEl.textContent = driverName;
  if (carEl) {
    if (carNumber) {
      carEl.innerHTML = `<span class="num">${escapeHtml(carNumber)}</span>`;
      carEl.hidden = false;
    } else {
      carEl.textContent = "";
      carEl.hidden = true;
    }
  }
  if (headlineEl) headlineEl.textContent = article.headline || "";
  if (dekEl) {
    dekEl.textContent = dek;
    dekEl.hidden = !dek;
  }
  if (linkEl) linkEl.href = articleHref;

  active.hidden = false;
  placeholder.hidden = true;
}

async function loadHomeSpotlight() {
  try {
    const [newsRes, driversRes] = await Promise.all([
      fetch("/api/news"),
      fetch("/api/drivers"),
    ]);
    if (!newsRes.ok) throw new Error(`News HTTP ${newsRes.status}`);
    const newsData = await newsRes.json();
    const drivers = driversRes.ok ? await driversRes.json() : [];
    const driverById = Object.fromEntries(
      (Array.isArray(drivers) ? drivers : []).map((driver) => [
        String(driver.driver_id),
        driver,
      ])
    );

    const spotlightArticle = (newsData.articles || [])
      .filter((article) => article.published && article.articleType === "driver-spotlight")
      .sort((a, b) => {
        const aTime = new Date(a.publishedAt || 0).getTime();
        const bTime = new Date(b.publishedAt || 0).getTime();
        return bTime - aTime;
      })[0];

    if (!spotlightArticle) {
      renderHomeSpotlightPlaceholder();
      return;
    }

    const driver = spotlightArticle.spotlightDriverId
      ? driverById[String(spotlightArticle.spotlightDriverId)] || null
      : null;
    renderHomeSpotlight(spotlightArticle, driver);
  } catch (e) {
    console.warn("Home driver spotlight load failed:", e);
    renderHomeSpotlightPlaceholder();
  }
}

function renderStandingsTop10(rows) {
  const body = $("#homeStandingsBody");
  if (!body) return;

  const top = rows.slice(0, 10);
  if (!top.length) {
    body.innerHTML = `<tr><td colspan="4">Standings loading...</td></tr>`;
    return;
  }

  body.innerHTML = top
    .map((r) => {
      const num = r.carNumber ? `<span class="num">${r.carNumber}</span>` : "";
      return `<tr>
        <td class="pos">${r.place}</td>
        <td><span class="driver-cell">${num}${r.driver}</span></td>
        <td class="points">${r.points}</td>
        <td>${r.wins ?? 0}</td>
      </tr>`;
    })
    .join("");
}

function renderPointsLeader(leader) {
  void leader;
}

function renderQuickStats(rows) {
  const driversEl = $("#homeStatDrivers");
  const racesEl = $("#homeStatRaces");
  const playoffEl = $("#homeStatPlayoff");
  if (!driversEl) return;

  const maxRaces = rows.length
    ? Math.max(...rows.map((x) => Number(x.races || 0)))
    : 0;

  driversEl.textContent = String(rows.length);
  if (racesEl) racesEl.textContent = String(maxRaces);
  if (playoffEl) playoffEl.textContent = "16";
}

const PLAYLIST_EMBED =
  "https://www.youtube.com/embed/videoseries?list=PL4aFms0YBw6_uE-yoYgOFDtaNcN9ozPIO";

function renderGreenFlagBroadcast(data) {
  const titleEl = $("#homeBroadcastTitle");
  const iframe = $("#homeBroadcastEmbed");
  if (!titleEl || !iframe) return;

  const featured = data?.featured;
  const usePlaylistFallback = data?.fallback || !featured?.videoId;

  if (usePlaylistFallback) {
    titleEl.textContent = "Green Flag TV Broadcasts";
    iframe.src = data?.embedUrl || PLAYLIST_EMBED;
    iframe.title = "Green Flag TV race broadcasts";
    return;
  }

  titleEl.textContent = featured.title || "Green Flag TV Broadcast";
  iframe.src = featured.embedUrl || `https://www.youtube.com/embed/${featured.videoId}`;
  iframe.title = featured.title || "Green Flag TV race broadcast";
}

async function loadGreenFlagBroadcast() {
  try {
    const res = await fetch("/api/youtube-broadcasts");
    const data = await res.json();
    renderGreenFlagBroadcast(data);
  } catch (e) {
    console.warn("Green Flag TV broadcast load failed:", e);
    renderGreenFlagBroadcast({ fallback: true, embedUrl: PLAYLIST_EMBED });
  }
}

function renderPowerRankingsWidget(entries) {
  const list = $("#homePowerRankingsList");
  if (!list) return;

  const top = (entries || []).slice(0, 3);
  if (!top.length) {
    list.innerHTML = `<div class="home-rank-item home-rank-placeholder">
      <span class="home-rank-loading">Rankings coming soon.</span>
    </div>`;
    return;
  }

  list.innerHTML = top
    .map((entry) => {
      const movementClass = entry.movementClass ? ` ${entry.movementClass}` : "";
      return `<div class="home-rank-item">
        <span class="rank">${entry.rank}.</span>
        <div class="home-rank-main">
          <div class="home-rank-top">
            <span class="home-rank-name">${escapeHtml(entry.driverName)}</span>
            <span class="home-rank-move${movementClass}">${escapeHtml(entry.movementText)}</span>
          </div>
          <div class="home-rank-subtitle">${escapeHtml(entry.subtitle || "")}</div>
        </div>
      </div>`;
    })
    .join("");
}

async function loadPowerRankingsWidget() {
  try {
    const res = await fetch("/api/power-rankings");
    const data = await res.json();
    renderPowerRankingsWidget(data.current?.entries || []);
  } catch (e) {
    console.warn("Home power rankings load failed:", e);
    renderPowerRankingsWidget([]);
  }
}

const HOME_NEWS_PLACEHOLDER_HTML = `
  <div class="home-news-item home-news-item--placeholder">
    <div class="home-news-thumb" aria-hidden="true">📰</div>
    <div class="home-news-copy">
      <h4>Season 11 Playoff Picture Heating Up</h4>
      <p>News content coming soon. Check back for race reports, driver interviews, and championship coverage.</p>
      <time>Coming Soon</time>
    </div>
  </div>
  <div class="home-news-item home-news-item--placeholder">
    <div class="home-news-thumb" aria-hidden="true">🏁</div>
    <div class="home-news-copy">
      <h4>Weekly Race Recaps</h4>
      <p>Full race results, highlights, and standings updates will publish here after each event.</p>
      <time>Coming Soon</time>
    </div>
  </div>
  <div class="home-news-item home-news-item--placeholder">
    <div class="home-news-thumb" aria-hidden="true">🎙️</div>
    <div class="home-news-copy">
      <h4>League Announcements</h4>
      <p>Schedule changes, rule updates, and community news will appear in this feed.</p>
      <time>Coming Soon</time>
    </div>
  </div>
`;

function articleUrl(slug) {
  return `/news/${encodeURIComponent(slug)}`;
}

function renderHomeNewsThumb(article) {
  if (!NewsArticleImage.hasImage(article)) {
    return `<div class="home-news-thumb home-news-thumb--placeholder" aria-hidden="true"><span>BP</span></div>`;
  }
  return NewsArticleImage.renderThumbMedia(article);
}

function renderHomeNewsMeta(article) {
  const author = escapeHtml(article.author || "Miles Apex");
  const date = MilesApexAvatar.formatShortDate(article.publishedAt);
  const readTime = MilesApexAvatar.formatReadTime(
    MilesApexAvatar.articleReadMinutes(article)
  );
  const parts = [
    `<span>${author}</span>`,
    date ? `<span>${escapeHtml(date)}</span>` : "",
    readTime ? `<span>${escapeHtml(readTime)}</span>` : "",
  ].filter(Boolean);
  return `<div class="home-news-meta">${parts.join('<span class="home-news-meta-sep" aria-hidden="true">·</span>')}</div>`;
}

function renderHomeNewsItem(article) {
  const dek = article.subheadline || article.summary || "";
  const typeLabel = escapeHtml(article.articleTypeLabel || article.articleType || "News");
  return `
    <a class="home-news-item" href="${articleUrl(article.slug)}">
      ${renderHomeNewsThumb(article)}
      <div class="home-news-copy">
        <span class="news-type-badge">${typeLabel}</span>
        <h4>${escapeHtml(article.headline)}</h4>
        ${dek ? `<p>${escapeHtml(dek)}</p>` : ""}
        ${renderHomeNewsMeta(article)}
      </div>
    </a>
  `;
}

function renderHomeNewsPlaceholder() {
  const list = $("#homeNewsList");
  if (!list) return;
  list.innerHTML = HOME_NEWS_PLACEHOLDER_HTML;
}

function renderHomeNews(articles) {
  const list = $("#homeNewsList");
  if (!list) return;

  const published = (articles || [])
    .filter((a) => a.published)
    .sort((a, b) => {
      const aTime = new Date(a.publishedAt || 0).getTime();
      const bTime = new Date(b.publishedAt || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, 3);

  if (!published.length) {
    renderHomeNewsPlaceholder();
    return;
  }

  list.innerHTML = published.map((article) => renderHomeNewsItem(article)).join("");
}

async function loadHomeNews() {
  try {
    const res = await fetch("/api/news");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderHomeNews(data.articles || []);
  } catch (e) {
    console.warn("Home news load failed:", e);
    renderHomeNewsPlaceholder();
  }
}

function resolveLeagueFacebookUrl(settings) {
  if (window.BPPublicNav?.resolveLeagueFacebookUrl) {
    return window.BPPublicNav.resolveLeagueFacebookUrl(settings);
  }
  if (settings && settings.leagueFacebookUrl === "") return "";
  return String(
    settings?.leagueFacebookUrl || "https://www.facebook.com/blazingpedalsracingleague/"
  ).trim();
}

function renderHomeLeagueUpdates(settings) {
  const copyEl = $("#homeLeagueUpdatesCopy");
  const btnEl = $("#homeLeagueFacebookBtn");
  if (!copyEl && !btnEl) return;

  const url = resolveLeagueFacebookUrl(settings || {});
  if (url && btnEl) {
    btnEl.hidden = false;
    btnEl.onclick = () => window.open(url, "_blank", "noopener,noreferrer");
    copyEl.textContent = "Facebook league updates and community posts coming soon.";
    return;
  }

  if (btnEl) {
    btnEl.hidden = true;
    btnEl.onclick = null;
  }
  if (copyEl) copyEl.textContent = "Facebook updates coming soon.";
}

async function loadHomeLeagueUpdates() {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderHomeLeagueUpdates(await res.json());
  } catch (e) {
    console.warn("Home league updates settings load failed:", e);
    renderHomeLeagueUpdates({});
  }
}

async function loadHome() {
  let leader = null;
  let rows = [];

  try {
    const standingsRes = await fetch("/api/standings");
    const standingsData = await standingsRes.json();
    const apiRows = standingsData.rows || [];

    if (standingsData.settings?.seasonName) {
      const seasonEl = $("#seasonLabel");
      if (seasonEl) seasonEl.textContent = standingsData.settings.seasonName.toUpperCase();
    }

    rows = apiRows.map((r, index) => ({
      place: r.position,
      driver: r.driver,
      carNumber: r.carNumber || "",
      photoUrl: r.photoUrl,
      points: r.points,
      races: r.races,
      wins: r.wins,
    }));

    leader = rows[0] || null;
    renderStandingsTop10(rows);
    renderPointsLeader(leader);
    renderQuickStats(rows);
  } catch (e) {
    console.warn("Home standings load failed:", e);
  }

  try {
    const scheduleRes = await fetch("/api/schedule");
    const scheduleData = await scheduleRes.json();
    const races = scheduleData.races || [];
    const completed = races.filter((r) => r.winner);
    const lastRace = completed[completed.length - 1] || null;

    renderNextRace(scheduleData.next || null, scheduleData.settings?.raceStartTime || "");
    renderLastWinner(scheduleData.raceResults || null, lastRace);
  } catch (e) {
    console.warn("Home schedule load failed:", e);
    renderNextRace(null, "");
    renderLastWinner(null, null);
  }
}

renderHomeSponsors();
loadGreenFlagBroadcast();
loadPowerRankingsWidget();
loadHomeNews();
loadHomeSpotlight();
loadHomeLeagueUpdates();
loadHome();
