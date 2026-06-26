const $ = (s) => document.querySelector(s);

const FORMULA_FALLBACK_TEXT =
  "Power Rankings are calculated using recent form, season performance, race impact, championship position, and momentum.";
const DEFAULT_FORMULA_IMAGE_URL = "/assets/power-rankings/formula.png";

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

  if (!week) {
    if (titleEl) titleEl.textContent = "Race Rankings";
    if (dateEl) dateEl.textContent = "";
    return;
  }

  if (titleEl) titleEl.textContent = week.label || `Race ${week.raceNumber} Rankings`;
  if (dateEl) {
    const formatted = formatPublishedDate(week.publishedDate);
    dateEl.textContent = formatted ? `Published ${formatted}` : "";
  }
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
        <span class="power-ranking-movement${movementClass}" aria-label="Rank movement">${escapeHtml(entry.movementText)}</span>
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
  const signature = $("#prProphetSignature");
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

  if (signature) signature.hidden = !week?.entries?.length;
}

function renderWeek(week, archive) {
  const listEl = $("#prList");
  const rankingsBlock = $("#prRankingsBlock");
  const emptyEl = $("#prEmpty");
  const honorableSection = $("#prHonorableSection");
  const honorableList = $("#prHonorableList");

  if (!week?.entries?.length) {
    if (listEl) listEl.innerHTML = "";
    if (rankingsBlock) rankingsBlock.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
    if (honorableSection) honorableSection.hidden = true;
    renderProphetTake(null);
    renderHeader(null);
    renderArchive(archive, null);
    mountPowerRankingsShare(null);
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (rankingsBlock) rankingsBlock.hidden = false;
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
  mountPowerRankingsShare(week);
}

function mountPowerRankingsShare(week) {
  if (!window.BPShare?.initPageShare) return;
  const title = week?.label
    ? `${week.label} — The Pedal Prophet Power Rankings`
    : "The Pedal Prophet Power Rankings — Blazing Pedals Truck Series";
  const text =
    week?.prophetTake?.slice?.(0, 200) ||
    "Weekly power rankings, race analysis, and championship insight from The Pedal Prophet.";
  window.BPShare.initPageShare("#prShareHost", {
    title,
    text,
    description: text,
    url: window.location.href,
    image: "/assets/logos/pedal-prophet-logo.png",
    type: "website",
  });
}

function setActiveTab(tabName) {
  const rankingsPanel = $("#prTabRankings");
  const howPanel = $("#prTabHowItWorks");
  const rankingsBtn = $("#prTabBtnRankings");
  const howBtn = $("#prTabBtnHowItWorks");
  const isHow = tabName === "how-it-works";

  rankingsPanel?.classList.toggle("active", !isHow);
  howPanel?.classList.toggle("active", isHow);
  rankingsBtn?.classList.toggle("active", !isHow);
  howBtn?.classList.toggle("active", isHow);
  if (rankingsBtn) rankingsBtn.setAttribute("aria-selected", isHow ? "false" : "true");
  if (howBtn) howBtn.setAttribute("aria-selected", isHow ? "true" : "false");

  const params = new URLSearchParams(window.location.search);
  if (isHow) params.set("tab", "how-it-works");
  else params.delete("tab");
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", nextUrl);
}

function initTabs() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("tab") === "how-it-works") {
    setActiveTab("how-it-works");
  }

  document.querySelectorAll("[data-pr-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.getAttribute("data-pr-tab") || "rankings");
    });
  });
}

function showFormulaFallback() {
  const wrap = $("#prFormulaImageWrap");
  const img = $("#prFormulaImage");
  const fallback = $("#prFormulaFallback");
  if (wrap) wrap.hidden = true;
  if (img) img.removeAttribute("src");
  if (fallback) {
    fallback.textContent = FORMULA_FALLBACK_TEXT;
    fallback.hidden = false;
  }
}

function renderFormulaImage(formulaImageUrl) {
  const wrap = $("#prFormulaImageWrap");
  const img = $("#prFormulaImage");
  const fallback = $("#prFormulaFallback");
  const url = String(formulaImageUrl || DEFAULT_FORMULA_IMAGE_URL).trim();

  if (!img || !wrap || !fallback) return;

  fallback.hidden = true;
  wrap.hidden = false;
  img.onerror = () => {
    img.onerror = null;
    showFormulaFallback();
  };
  img.src = url;
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
      renderFormulaImage(data.formulaImageUrl);
      return;
    }

    renderWeek(data.current, data.archive || []);
    renderFormulaImage(data.formulaImageUrl);
  } catch (error) {
    console.warn("Power rankings load failed:", error);
    renderWeek(null, []);
    const intro = $("#prIntro");
    if (intro) {
      intro.textContent =
        "Weekly rankings, race analysis, and championship insight from The Pedal Prophet. Rankings are not available right now.";
    }
    renderFormulaImage(DEFAULT_FORMULA_IMAGE_URL);
  }
}

initTabs();
loadPowerRankings();
mountPowerRankingsShare(null);
