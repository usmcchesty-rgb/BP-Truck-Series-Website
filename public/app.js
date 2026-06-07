const PLAYOFF_CUT = 16;
const $ = (s) => document.querySelector(s);
let standings = [];

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

function head() {
  return `<tr><th>POS</th><th>DRIVER</th><th>CHANGE</th><th>POINTS</th><th>BEHIND LEADER</th><th>BEHIND NEXT</th><th>RACES</th><th>WINS</th><th>TOP 5s</th><th>TOP 10s</th></tr>`;
}

function row(r) {
  return `<tr>
    <td class="pos">${r.place}</td>
    <td>${r.carNumber ? `<span class="num">${r.carNumber}</span>` : ""}${r.driver}</td>
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
        `<article class="podium-card ${r.place === 1 ? "first" : r.place === 3 ? "third" : ""}">
          <div class="rank-badge">${r.place}</div>
          <img class="driver-img" src="${driverImage(r.driver)}" onerror="this.onerror=null;this.src='/assets/drivers/placeholder.png'"/>
          <div class="podium-info">
            <h2>${String(r.driver).toUpperCase()}</h2>
            <div class="podium-points">${r.points}<small> PTS</small></div>
            <div class="gap">${r.place === 1 ? "LEADER" : `${r.behindLeader} BEHIND LEADER`}</div>
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

function renderTable(target, rows, cut = true) {
  const html = [];

  rows.forEach((r) => {
    html.push(row(r));

    if (cut && r.place === PLAYOFF_CUT) {
      html.push(
        `<tr class="cutline"><td colspan="10">PLAYOFF CUT LINE — TOP ${PLAYOFF_CUT}</td></tr>`
      );
    }
  });

  $(target).innerHTML = html.join("");
}

function render() {
  $("#overviewHead").innerHTML = head();
  $("#fullHead").innerHTML = head();

  renderPodium();
  renderTable("#overviewBody", standings.slice(0, PLAYOFF_CUT));
  renderTable("#fullBody", standings);

  const maxRaces = standings.length
    ? Math.max(...standings.map((x) => Number(x.races || 0)))
    : 0;

  $("#raceCount").textContent = `${maxRaces} / 20`;
  $("#fieldCount").textContent = standings.length;

  const leader = standings[0];

  if (leader) {
    $("#leaderCard").innerHTML =
      `<h3>POINTS LEADER</h3>
       <div class="big">${leader.points} <small>PTS</small></div>
       <p>${leader.driver}</p>
       <button>VIEW DRIVER STATS</button>`;
  } else {
    $("#leaderCard").innerHTML =
      `<h3>POINTS LEADER</h3><p>No standings loaded.</p>`;
  }
}

async function load(force = false) {
  try {
    $("#lastUpdated").textContent = "Updating...";

    const res = await fetch(`/api/standings${force ? "?force=1" : ""}`);
    const data = await res.json();

    console.log("API RESPONSE:", data);

    const rows = data.rows || [];
    const leaderPoints = rows[0]?.points || 0;

    standings = rows.map((r, index) => {
      const previous = rows[index - 1];

      return {
        place: r.position,
        change: r.gainLoss,
        driver: r.driver,
        carNumber: r.carNumber,
        points: r.points,
        behindLeader: r.position === 1 ? "—" : r.points - leaderPoints,
        behindNext: previous ? r.points - previous.points : "—",
        races: r.races,
        wins: r.wins,
        top5: r.top5,
        top10: r.top10
      };
    });

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

document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    document
      .querySelectorAll("nav button,.tab")
      .forEach((x) => x.classList.remove("active"));

    b.classList.add("active");
    $("#" + b.dataset.tab).classList.add("active");
  })
);

$("#refreshBtn").addEventListener("click", () => load(true));

$("#search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();

  renderTable(
    "#fullBody",
    standings.filter((r) => r.driver.toLowerCase().includes(q)),
    true
  );
});

load();
setInterval(() => load(), 60000);