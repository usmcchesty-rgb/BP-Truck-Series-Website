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

function renderEntry(entry) {
  const num = entry.carNumber
    ? `<span class="num">${escapeHtml(entry.carNumber)}</span>`
    : "";
  const movementClass = entry.movementClass ? ` ${entry.movementClass}` : "";
  const rankClass = entry.rank === 1 ? " power-ranking-card-first" : "";

  return `<article class="power-ranking-card${rankClass}">
    <div class="power-ranking-rank">#${entry.rank}</div>
    <img
      class="power-ranking-photo"
      src="${escapeHtml(entry.photoUrl)}"
      alt=""
      loading="lazy"
      onerror="this.onerror=null;this.src='/assets/drivers/placeholder.png'"
    />
    <div class="power-ranking-body">
      <div class="power-ranking-title-row">
        <h3>${escapeHtml(entry.driverName)}${num}</h3>
        <span class="power-ranking-movement${movementClass}">${escapeHtml(entry.movementText)}</span>
      </div>
      <p class="power-ranking-subtitle">${escapeHtml(entry.subtitle)}</p>
      <p class="power-ranking-writeup">${escapeHtml(entry.writeup)}</p>
    </div>
  </article>`;
}

function renderHonorable(mention) {
  const num = mention.carNumber
    ? `<span class="num">${escapeHtml(mention.carNumber)}</span>`
    : "";

  return `<article class="power-ranking-honorable-card">
    <img
      class="power-ranking-honorable-photo"
      src="${escapeHtml(mention.photoUrl)}"
      alt=""
      loading="lazy"
      onerror="this.onerror=null;this.src='/assets/drivers/placeholder.png'"
    />
    <div>
      <h4>${escapeHtml(mention.driverName)}${num}</h4>
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

function renderProphetTake(week) {
  const section = $("#prProphetTake");
  const body = $("#prProphetTakeBody");
  const about = $("#prProphetAbout");
  const text = String(week?.prophetTake || "").trim();

  if (section && body) {
    if (!text) {
      section.hidden = true;
      body.innerHTML = "";
    } else {
      const paragraphs = text
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean);

      body.innerHTML = paragraphs.length
        ? paragraphs.map((part) => `<p>${escapeHtml(part)}</p>`).join("")
        : `<p>${escapeHtml(text)}</p>`;

      section.hidden = false;
    }
  }

  if (about) about.hidden = !week;
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
    renderProphetTake(null);
    renderHeader(null);
    renderArchive(archive, null);
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  renderHeader(week);
  renderProphetTake(week);
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
        "The Pedal Prophet's weekly look at the hottest drivers, biggest movers, championship contenders, and emerging storylines across the Blazing Pedals Truck Series. Rankings are not available right now.";
    }
  }
}

loadPowerRankings();
