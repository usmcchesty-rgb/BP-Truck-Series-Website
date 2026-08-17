/**
 * Audit standings plate-color resolution against live standings + simulated
 * Power Rankings suit-cache white fills (the known failure mode).
 *
 * Run: node scripts/audit-standings-plate-colors.mjs
 */
import {
  takeTopDrivers,
  resolveStandingsPlateColors,
  isUsablePlateFill,
  isNearWhiteHex,
} from "../public/standings-graphic-export-logic.js";

const STANDINGS_URL =
  process.env.STANDINGS_URL || "https://www.blazingpedalsracing.com/api/standings";

async function main() {
  const res = await fetch(STANDINGS_URL);
  if (!res.ok) throw new Error(`standings fetch failed: ${res.status}`);
  const data = await res.json();
  const drivers = takeTopDrivers(data.rows || data.standings || [], 43);

  console.log(`[audit] drivers=${drivers.length} source=${STANDINGS_URL}`);

  const rows = drivers.map((driver) => {
    // Simulate the PR cache lightDominant pattern that previously produced white plates.
    const simulatedCache = {
      fill: "#ffffff",
      outline: "#c81010",
    };
    // Also test white+black (common PR contrast fix) and white-only.
    const cases = [
      {
        label: "cache_white_red",
        rawPrimary: "#ffffff",
        rawSecondary: "#c81010",
        rawSource: "suit_cache",
      },
      {
        label: "cache_white_black",
        rawPrimary: "#ffffff",
        rawSecondary: "#000000",
        rawSource: "suit_cache",
      },
      {
        label: "cache_white_only",
        rawPrimary: "#ffffff",
        rawSecondary: "",
        rawSource: "suit_cache",
      },
      {
        label: "cache_nearwhite_blue",
        rawPrimary: "#f5f5f5",
        rawSecondary: "#143a6e",
        rawSource: "suit_cache",
      },
    ];

    const resolvedCases = cases.map((c) => {
      const pack = resolveStandingsPlateColors({
        driver,
        rawPrimary: c.rawPrimary,
        rawSecondary: c.rawSecondary,
        rawSource: c.rawSource,
      });
      return {
        case: c.label,
        finalPrimary: pack.finalPrimary,
        finalSource: pack.finalColorSource,
        usable: isUsablePlateFill(pack.finalPrimary).ok,
        nearWhite: isNearWhiteHex(pack.finalPrimary),
      };
    });

    const defaultPack = resolveStandingsPlateColors({
      driver,
      rawPrimary: simulatedCache.fill,
      rawSecondary: simulatedCache.outline,
      rawSource: "suit_cache",
    });

    return {
      driverName: driver.driverName,
      driverId: driver.driverId,
      carNumber: driver.carNumber,
      rawPrimary: simulatedCache.fill,
      rawSecondary: simulatedCache.outline,
      rawColorSource: "suit_cache",
      finalPrimary: defaultPack.finalPrimary,
      finalSecondary: defaultPack.finalSecondary,
      finalTextColor: defaultPack.finalTextColor,
      finalColorSource: defaultPack.finalColorSource,
      rejectedReasonText: defaultPack.rejectedReasonText,
      cases: resolvedCases,
    };
  });

  const unintended = rows.filter((r) => !isUsablePlateFill(r.finalPrimary).ok || isNearWhiteHex(r.finalPrimary));
  console.log("[Standings Plate Colors] simulated PR white-cache audit");
  console.table(
    rows.map((r) => ({
      Driver: r.driverName,
      "Car #": r.carNumber,
      "Raw Source": r.rawColorSource,
      "Raw Primary": r.rawPrimary,
      "Raw Secondary": r.rawSecondary,
      "Final Source": r.finalColorSource,
      "Final Primary": r.finalPrimary,
      "Final Secondary": r.finalSecondary,
      "Text Color": r.finalTextColor,
      "Rejected Reason(s)": r.rejectedReasonText,
    })),
  );

  const whiteBlackFailures = rows.filter((r) =>
    r.cases.some((c) => c.case === "cache_white_black" && (c.nearWhite || !c.usable)),
  );
  const whiteOnlyFailures = rows.filter((r) =>
    r.cases.some((c) => c.case === "cache_white_only" && (c.nearWhite || !c.usable)),
  );

  console.log(
    JSON.stringify(
      {
        driverCount: rows.length,
        unintendedWhiteFromWhiteRedCache: unintended.length,
        whiteBlackUnusable: whiteBlackFailures.length,
        whiteOnlyUnusable: whiteOnlyFailures.length,
        sampleAffectedPreviously: unintended.slice(0, 5),
        whiteBlackSample: whiteBlackFailures[0]?.cases.find((c) => c.case === "cache_white_black"),
        whiteOnlySample: rows[0]?.cases.find((c) => c.case === "cache_white_only"),
      },
      null,
      2,
    ),
  );

  if (unintended.length || whiteBlackFailures.length || whiteOnlyFailures.length) {
    process.exitCode = 1;
  } else {
    console.log("[audit] OK — no unintended plain-white plate fills for simulated PR cache patterns");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
