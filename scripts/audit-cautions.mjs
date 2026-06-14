import * as cheerio from "cheerio";
import { getSettings, fetchHtml } from "../api/_lib.js";

const settings = await getSettings();
const seasonId = settings.seasonId || "27987";
const html = await fetchHtml(settings.scheduleUrl);
const latest = [...new Set([...html.matchAll(/schedule_id=(\d+)/g)].map((m) => m[1]))].at(-1);

const data = await fetch(
  `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${latest}`,
  { headers: { "user-agent": "BP-Truck-Series-Website/1.0" } },
).then((r) => r.json());

const scheduleMetaKeys = new Set();
const resultKeys = new Set();
for (const s of Object.values(data.schedules || {})) {
  Object.keys(s)
    .filter((k) => k !== "drivers")
    .forEach((k) => scheduleMetaKeys.add(k));
  for (const bucket of Object.values(s.drivers || {})) {
    for (const result of Object.values(bucket || {})) {
      if (result && typeof result === "object") {
        Object.keys(result).forEach((k) => resultKeys.add(k));
      }
    }
  }
}

console.log("schedule meta keys:", [...scheduleMetaKeys].sort());
console.log("result keys:", [...resultKeys].sort());
console.log(
  "caution-ish keys in meta/result:",
  [...scheduleMetaKeys, ...resultKeys].filter((k) => /caution|yellow|flag/i.test(k)),
);

const $ = cheerio.load(html);
let raceHref = "";
$("table tr").each((_i, tr) => {
  const tds = $(tr).find("td");
  if (tds.length < 7) return;
  const winner = tds.eq(6).text().trim();
  if (!winner) return;
  raceHref = $(tr).find("a[href*='race']").last().attr("href") || "";
  if (raceHref) return false;
});

console.log("sample race href:", raceHref);

const $sched = cheerio.load(html);
const raceLinks = [];
$sched("table tr").each((_i, tr) => {
  const tds = $sched(tr).find("td");
  if (tds.length < 7) return;
  const winner = tds.eq(6).text().trim();
  if (!winner) return;
  const points = tds.eq(2).text().trim().toLowerCase();
  const href = $sched(tr).find("a[href*='race']").last().attr("href") || "";
  if (href) raceLinks.push({ href, points, winner });
});

console.log("completed race links:", raceLinks.length);
const samples = [];
for (const race of raceLinks.slice(0, 8)) {
  const raceUrl = race.href.startsWith("http")
    ? race.href
    : `https://www.simracerhub.com/scoring/${race.href.replace(/^\//, "")}`;
  const raceHtml = await fetchHtml(raceUrl);
  const m =
    raceHtml.match(/(\d+)\s+cautions?/i) ||
    raceHtml.match(/cautions?\s*[:=]?\s*(\d+)/i);
  samples.push({
    href: race.href,
    points: race.points,
    cautions: m ? Number(m[1]) : null,
    snippet: raceHtml.match(/Lead Changes[^<]{0,80}/i)?.[0] || null,
  });
}
console.log("caution samples:", samples);

if (raceHref) {
  const raceUrl = raceHref.startsWith("http")
    ? raceHref
    : `https://www.simracerhub.com/scoring/${raceHref.replace(/^\//, "")}`;
  const raceHtml = await fetchHtml(raceUrl);
  const cautionMatches = [...raceHtml.matchAll(/caution|yellow flag|yellows/gi)].slice(0, 20);
  console.log("race page caution match count:", cautionMatches.length);
  const $r = cheerio.load(raceHtml);
  const snippets = [];
  $r("td, th, div, span, p, b, strong").each((_i, el) => {
    const t = $r(el).text().replace(/\s+/g, " ").trim();
    if (/caution|yellow/i.test(t) && t.length < 120) snippets.push(t);
  });
  console.log("race page caution snippets:", [...new Set(snippets)].slice(0, 15));
}
