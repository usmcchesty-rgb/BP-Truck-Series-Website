const $ = (s) => document.querySelector(s);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPublishedDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function renderHeader(week) {
  const titleEl = $("#prWeekTitle");
  const dateEl = $("#prPublishedDate");
  const headerEl = $("#prHeader");

  if (!week) {
    if (headerEl) headerEl.hidden = true;
    return;
  }

  if (titleEl) titleEl.textContent = week.label || `Race ${week.raceNumber} Rankings`;
  if (dateEl) {
    const formatted = formatPublishedDate(week.publishedDate);
    dateEl.textContent = formatted ? `Published ${formatted}` : "";
  }
  if (headerEl) headerEl.hidden = false;
}

function formatCarNumber(carNumber) {
  const raw = String(carNumber || "").trim();
  if (!raw) return "";
  return raw.startsWith("#") ? raw : `#${raw}`;
}

function renderEntry(entry) {
  const carNumber = formatCarNumber(entry.carNumber);
  const carNumberHtml = carNumber
    ? `<div class="power-ranking-car-number">${escapeHtml(carNumber)}</div>`
    : "";
  const movementClass = entry.movementClass ? ` ${entry.movementClass}` : "";
  const rankClass = entry.rank === 1 ? " power-ranking-card-first" : "";

  return `<article class="power-ranking-card${rankClass}">
    <div class="power-ranking-lead">
      <div class="power-ranking-rank">#${entry.rank}</div>
      <span class="power-ranking-movement${movementClass}">${escapeHtml(entry.movementText)}</span>
    </div>
    <img
      class="power-ranking-photo"
      src="${escapeHtml(entry.photoUrl)}"
      alt=""
      loading="lazy"
      onerror="this.onerror=null;this.src='/assets/drivers/placeholder.png'"
    />
    <div class="power-ranking-body">
      <div class="power-ranking-identity">
        ${carNumberHtml}
        <h3 class="power-ranking-name">${escapeHtml(entry.driverName)}</h3>
      </div>
      <p class="power-ranking-subtitle">${escapeHtml(entry.subtitle)}</p>
      <p class="power-ranking-writeup">${escapeHtml(entry.writeup)}</p>
    </div>
  </article>`;
}

function renderHonorable(mention) {
  const carNumber = formatCarNumber(mention.carNumber);
  const carNumberHtml = carNumber
    ? `<div class="power-ranking-honorable-car">${escapeHtml(carNumber)}</div>`
    : "";

  return `<article class="power-ranking-honorable-card">
    <img
      class="power-ranking-honorable-photo"
      src="${escapeHtml(mention.photoUrl)}"
      alt=""
      loading="lazy"
      onerror="this.onerror=null;this.src='/assets/drivers/placeholder.png'"
    />
    <div class="power-ranking-honorable-body">
      <div class="power-ranking-honorable-identity">
        ${carNumberHtml}
        <h4 class="power-ranking-honorable-name">${escapeHtml(mention.driverName)}</h4>
      </div>
      <p>${escapeHtml(mention.writeup)}</p>
    </div>
  </article>`;
}

function renderArchive(archive, activeId) {
  const panel = $("#prArchivePanel");
  const nav = $("#prArchiveNav");
  if (!panel || !nav) return;

  if (!archive?.length) {
    panel.hidden = true;
    return;
  }

  nav.innerHTML = archive
    .map((item) => {
      const active = Number(item.id) === Number(activeId) ? " active" : "";
      return `<a class="power-rankings-archive-link${active}" href="/power-rankings.html?week=${item.id}">
        ${escapeHtml(item.label || `Race ${item.raceNumber} Rankings`)}
      </a>`;
    })
    .join("");

  panel.hidden = false;
}

function renderWeek(week, archive) {
  const listEl = $("#prList");
  const emptyEl = $("#prEmpty");
  const honorableSection = $("#prHonorableSection");
  const honorableList = $("#prHonorableList");

  if (!week?.entries?.length) {
    if (listEl) listEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    if (honorableSection) honorableSection.hidden = true;
    renderHeader(null);
    renderArchive(archive, null);
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  renderHeader(week);
  if (listEl) listEl.innerHTML = week.entries.map(renderEntry).join("");

  const mentions = week.honorableMentions || [];
  if (honorableSection && honorableList) {
    if (mentions.length) {
      honorableList.innerHTML = mentions.map(renderHonorable).join("");
      honorableSection.hidden = false;
    } else {
      honorableList.innerHTML = "";
      honorableSection.hidden = true;
    }
  }

  renderArchive(archive, week.id);
}

async function loadPowerRankings() {
  const params = new URLSearchParams(window.location.search);
  const weekId = params.get("week");
  const url = weekId ? `/api/power-rankings?weekId=${encodeURIComponent(weekId)}` : "/api/power-rankings";

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to load power rankings.");
    }

    if (weekId) {
      renderWeek(data.current, data.archive || []);
      return;
    }

    renderWeek(data.current, data.archive || []);
  } catch (error) {
    console.warn("Power rankings load failed:", error);
    renderWeek(null, []);
    const intro = $("#prIntro");
    if (intro) {
      intro.textContent =
        "Weekly power rankings based on recent form, consistency, and race performance. Rankings are not available right now.";
    }
  }
}

loadPowerRankings();
