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

function renderLastWinner(lastRace, leaderFallback) {
  const nameEl = $("#homeLastWinnerName");
  const trackEl = $("#homeLastWinnerTrack");
  const dateEl = $("#homeLastWinnerDate");
  const imgEl = $("#homeLastWinnerImg");
  if (!nameEl || !trackEl || !dateEl || !imgEl) return;

  if (lastRace?.winner) {
    const { date } = splitDateTime(lastRace.date);
    nameEl.textContent = lastRace.winner;
    trackEl.textContent = lastRace.track || "Track TBD";
    dateEl.textContent = date;
    imgEl.src = driverImage(lastRace.winner);
  } else if (leaderFallback) {
    nameEl.textContent = leaderFallback.driver;
    trackEl.textContent = "Track TBD";
    dateEl.textContent = "Date TBD";
    imgEl.src = leaderFallback.photoUrl || driverImage(leaderFallback.driver);
  } else {
    nameEl.textContent = "—";
    trackEl.textContent = "Track TBD";
    dateEl.textContent = "Date TBD";
    imgEl.src = "/assets/drivers/placeholder.png";
  }

  imgEl.onerror = function () {
    this.onerror = null;
    this.src = "/assets/drivers/placeholder.png";
  };
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
  const nameEl = $("#homePointsLeaderName");
  const ptsEl = $("#homePointsLeaderPts");
  const imgEl = $("#homePointsLeaderImg");
  if (!leader || !nameEl || !ptsEl || !imgEl) return;

  nameEl.textContent = leader.driver;
  ptsEl.textContent = `${leader.points} PTS`;
  imgEl.src = leader.photoUrl || driverImage(leader.driver);
  imgEl.onerror = function () {
    this.onerror = null;
    this.src = "/assets/drivers/placeholder.png";
  };

  const spotlightImg = $("#homeSpotlightImg");
  const spotlightCopy = $("#homeSpotlightCopy");
  if (spotlightImg) {
    spotlightImg.src = leader.photoUrl || driverImage(leader.driver);
    spotlightImg.onerror = function () {
      this.onerror = null;
      this.src = "/assets/drivers/placeholder.png";
    };
  }
  if (spotlightCopy) {
    spotlightCopy.textContent = `${leader.driver} leads the BP Truck Series with ${leader.points} points. Full driver spotlight stories coming soon.`;
    spotlightCopy.classList.remove("home-placeholder");
  }
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
  return NewsArticleImage.renderImageHtml(article, {
    wrapClass: "home-news-thumb-wrap",
    imgClass: "home-news-thumb-img",
    alt: article.headline || "Article image",
  });
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
    renderLastWinner(lastRace, leader);
  } catch (e) {
    console.warn("Home schedule load failed:", e);
    renderNextRace(null, "");
    renderLastWinner(null, leader);
  }
}

renderHomeSponsors();
loadGreenFlagBroadcast();
loadPowerRankingsWidget();
loadHomeNews();
loadHome();
