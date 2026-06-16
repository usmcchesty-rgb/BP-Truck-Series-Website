(function () {
  const PLACEHOLDER = "/assets/drivers/placeholder.png";
  const EXPORT_WIDTH = 1600;
  const CANVAS_SCALE = 2;
  const MOVEMENT_NEW_SENTINEL = 100;
  const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;

  let scheduleTrackMapCache = null;

  function escapeHtml(value) {
    return String(value ?? "")
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

  function slugifyName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function stripUrlQuery(url) {
    return String(url || "")
      .trim()
      .split("?")[0]
      .split("#")[0];
  }

  function isNonPointsRace(race) {
    const points = String(race?.points ?? "")
      .trim()
      .toLowerCase();
    const status = String(race?.status ?? "")
      .trim()
      .toLowerCase();
    const label = String(race?.track ?? "");
    if (points === "no" || status === "non-points") return true;
    return NON_POINTS_LABEL_PATTERN.test(label);
  }

  function buildPointsRaceTrackMap(races) {
    let officialPointsRaceNumber = 0;
    const map = {};
    for (const race of races || []) {
      if (isNonPointsRace(race)) continue;
      officialPointsRaceNumber += 1;
      map[officialPointsRaceNumber] = String(race.track || "").trim();
    }
    return map;
  }

  async function resolveTrackName(raceNumber, week = {}) {
    const fromWeek = String(week.trackName || week.track || "").trim();
    if (fromWeek) return fromWeek;

    if (!scheduleTrackMapCache) {
      try {
        const res = await fetch("/api/schedule");
        const data = await res.json();
        scheduleTrackMapCache = buildPointsRaceTrackMap(data.races || []);
      } catch {
        scheduleTrackMapCache = {};
      }
    }

    return scheduleTrackMapCache[Number(raceNumber)] || "";
  }

  function movementTypeFromStored(movement) {
    if (Number(movement) === MOVEMENT_NEW_SENTINEL) return "new";
    const value = Number(movement);
    if (!Number.isFinite(value) || value === 0) return "unchanged";
    if (value > 0) return "up";
    return "down";
  }

  function formatMovementDisplay(movement, movementType) {
    const type = movementType || movementTypeFromStored(movement);
    if (type === "new") return { text: "NEW", class: "new" };
    const value = Number(movement);
    if (!Number.isFinite(value) || value === MOVEMENT_NEW_SENTINEL || value === 0) {
      return { text: "—", class: "" };
    }
    if (value > 0) return { text: `▲${value}`, class: "positive" };
    return { text: `▼${Math.abs(value)}`, class: "negative" };
  }

  function parseMovementInput(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return { movement: 0, movementType: "unchanged" };
    const upper = raw.toUpperCase();
    if (upper === "NEW" || upper === "NR") {
      return { movement: MOVEMENT_NEW_SENTINEL, movementType: "new" };
    }
    if (upper === "—" || upper === "-" || upper === "0") {
      return { movement: 0, movementType: "unchanged" };
    }
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return {
      movement: numeric,
      movementType:
        numeric === MOVEMENT_NEW_SENTINEL
          ? "new"
          : numeric > 0
            ? "up"
            : numeric < 0
              ? "down"
              : "unchanged",
    };
  }

  function driverPhotoUrl(profile, name) {
    const photo = stripUrlQuery(profile?.photo_url || profile?.photoUrl || "");
    if (photo) return photo;
    const slug = slugifyName(
      profile?.display_name || profile?.displayName || profile?.iracing_name || name,
    );
    return slug ? `/assets/drivers/${slug}.png` : PLACEHOLDER;
  }

  function normalizeEntry(entry) {
    const movementParsed = parseMovementInput(entry.movementInput ?? entry.movement);
    const movementType = entry.movementType || movementParsed?.movementType;
    const movementValue =
      entry.movement != null && entry.movement !== ""
        ? Number(entry.movement)
        : movementParsed?.movement ?? 0;
    const movement = formatMovementDisplay(movementValue, movementType);

    return {
      rank: Number(entry.rank),
      driverName: entry.driverName || "Unknown Driver",
      carNumber: entry.carNumber || "",
      photoUrl: entry.photoUrl || PLACEHOLDER,
      movementText: entry.movementText || movement.text,
      movementClass: entry.movementClass || movement.class,
      subtitle: entry.subtitle || "",
      writeup: entry.writeup || "",
    };
  }

  function renderEntryHtml(entry) {
    const normalized = normalizeEntry(entry);
    const num = normalized.carNumber
      ? `<span class="num">${escapeHtml(normalized.carNumber)}</span>`
      : "";
    const movementClass = normalized.movementClass ? ` ${normalized.movementClass}` : "";
    const rankClass = normalized.rank === 1 ? " power-ranking-card-first" : "";

    return `<article class="power-ranking-card${rankClass}">
      <div class="power-ranking-rank">#${normalized.rank}</div>
      <img
        class="power-ranking-photo"
        src="${escapeHtml(normalized.photoUrl)}"
        alt=""
        crossorigin="anonymous"
      />
      <div class="power-ranking-body">
        <div class="power-ranking-title-row">
          <h3>${escapeHtml(normalized.driverName)}${num}</h3>
          <span class="power-ranking-movement${movementClass}">${escapeHtml(normalized.movementText)}</span>
        </div>
        <p class="power-ranking-subtitle">${escapeHtml(normalized.subtitle)}</p>
        <p class="power-ranking-writeup">${escapeHtml(normalized.writeup)}</p>
      </div>
    </article>`;
  }

  function renderExportBanner(week) {
    const raceNumber = Number(week.raceNumber);
    const trackName = String(week.trackName || "").trim();
    const raceLine = trackName
      ? `Race ${raceNumber} • ${trackName}`
      : `Race ${raceNumber}`;
    const published = formatPublishedDate(week.publishedDate);
    const publishedLine = published ? `Published ${published}` : "";

    return `<header class="pr-discord-export-banner">
      <h1 class="pr-discord-export-kicker">POWER RANKINGS</h1>
      <p class="pr-discord-export-race-line">${escapeHtml(raceLine)}</p>
      <p class="pr-discord-export-presented">Presented by The Pedal Prophet</p>
      ${publishedLine ? `<p class="pr-discord-export-published">${escapeHtml(publishedLine)}</p>` : ""}
      <div class="pr-discord-export-divider" aria-hidden="true"></div>
    </header>`;
  }

  function buildExportHtml(week) {
    const entries = (week.entries || [])
      .slice()
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .slice(0, 10);

    return `<div class="pr-discord-export-root">
      ${renderExportBanner(week)}
      <div class="power-rankings-list">
        ${entries.map(renderEntryHtml).join("")}
      </div>
      <p class="pr-discord-export-brand-footer">Blazing Pedals Truck Series</p>
    </div>`;
  }

  function getExportHost() {
    let host = document.getElementById("prDiscordExportHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "prDiscordExportHost";
      host.className = "pr-discord-export-host";
      host.setAttribute("aria-hidden", "true");
      document.body.appendChild(host);
    }
    return host;
  }

  function isCrossOrigin(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  async function preloadExportImages(container) {
    const images = [...container.querySelectorAll("img")];
    await Promise.all(
      images.map(
        (img) =>
          new Promise((resolve) => {
            const fallback = () => {
              img.src = PLACEHOLDER;
              img.removeAttribute("crossorigin");
              resolve();
            };

            if (!img.getAttribute("src")) {
              fallback();
              return;
            }

            if (isCrossOrigin(img.src)) {
              img.crossOrigin = "anonymous";
            } else {
              img.removeAttribute("crossorigin");
            }

            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }

            img.onload = () => resolve();
            img.onerror = fallback;
          }),
      ),
    );
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function validateWeek(week) {
    if (!week) throw new Error("No rankings loaded to export.");
    const raceNumber = Number(week.raceNumber);
    if (!Number.isInteger(raceNumber) || raceNumber < 1) {
      throw new Error("Valid race number is required before exporting.");
    }
    const entries = (week.entries || []).filter(
      (entry) => entry.driverName || entry.driverId,
    );
    if (entries.length < 10) {
      throw new Error("All 10 rankings must have drivers before exporting.");
    }
    return raceNumber;
  }

  async function exportWeek(week, options = {}) {
    if (typeof html2canvas !== "function") {
      throw new Error("Export library failed to load. Refresh and try again.");
    }

    const raceNumber = validateWeek(week);
    const trackName = await resolveTrackName(raceNumber, week);
    const exportWeekData = { ...week, trackName };

    const host = getExportHost();
    host.innerHTML = buildExportHtml(exportWeekData);
    const root = host.querySelector(".pr-discord-export-root");
    if (!root) throw new Error("Could not build export layout.");

    host.style.visibility = "visible";

    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      await preloadExportImages(root);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const canvas = await html2canvas(root, {
        backgroundColor: "#060606",
        scale: CANVAS_SCALE,
        useCORS: true,
        allowTaint: false,
        logging: false,
        width: EXPORT_WIDTH,
        windowWidth: EXPORT_WIDTH,
        scrollX: 0,
        scrollY: 0,
        ...options.canvasOptions,
      });

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error("PNG export failed."));
          },
          "image/png",
          1,
        );
      });

      downloadBlob(blob, `bp-power-rankings-race-${raceNumber}.png`);
      return {
        raceNumber,
        trackName,
        width: canvas.width,
        height: canvas.height,
      };
    } finally {
      host.innerHTML = "";
      host.style.visibility = "hidden";
    }
  }

  function buildWeekFromAdminForm(formData, driverOptions = [], profileById = {}) {
    const byDriverId = Object.fromEntries(
      (driverOptions || []).map((driver) => [String(driver.driver_id), driver]),
    );

    const entries = (formData.entries || [])
      .filter((entry) => entry.driverId)
      .map((entry) => {
        const driver =
          byDriverId[String(entry.driverId)] ||
          profileById[String(entry.driverId)] ||
          {};
        const profile = profileById[String(entry.driverId)] || driver;
        const name =
          driver.display_name ||
          driver.displayName ||
          profile?.display_name ||
          profile?.iracing_name ||
          "Unknown Driver";
        const movementParsed = parseMovementInput(entry.movement);
        const movement = movementParsed
          ? formatMovementDisplay(movementParsed.movement, movementParsed.movementType)
          : formatMovementDisplay(0, "unchanged");

        return {
          rank: entry.rank,
          driverId: entry.driverId,
          driverName: name,
          carNumber: driver.car_number || profile?.car_number || "",
          photoUrl: driverPhotoUrl(profile, name),
          movement: movementParsed?.movement ?? 0,
          movementType: movementParsed?.movementType,
          movementText: movement.text,
          movementClass: movement.class,
          subtitle: entry.subtitle || "",
          writeup: entry.writeup || "",
        };
      });

    return {
      raceNumber: formData.raceNumber,
      publishedDate: formData.publishedDate,
      label: `Race ${formData.raceNumber} Rankings`,
      trackName: formData.trackName || "",
      entries,
    };
  }

  window.BPPowerRankingsDiscordExport = {
    EXPORT_WIDTH,
    CANVAS_SCALE,
    PLACEHOLDER,
    buildWeekFromAdminForm,
    exportWeek,
    buildExportHtml,
    renderEntryHtml,
    resolveTrackName,
    buildPointsRaceTrackMap,
  };
})();
