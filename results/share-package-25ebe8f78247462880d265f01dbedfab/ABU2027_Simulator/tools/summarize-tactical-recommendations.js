"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(ROOT, "results", "tactical_opening_cases.csv");
const OUTPUT = path.join(ROOT, "results", "tactical_recommendations.md");

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === "\"") {
      if (quoted && line[i + 1] === "\"") {
        cur += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function readRows() {
  const lines = fs.readFileSync(INPUT, "utf8").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    return {
      ...row,
      red_score_at_180: Number(row.red_score_at_180),
      blue_score_at_180: Number(row.blue_score_at_180),
      score_diff: Number(row.score_diff),
      sanctuary_at: row.sanctuary_at ? Number(row.sanctuary_at) : null,
      mustika_at: row.mustika_at ? Number(row.mustika_at) : null,
      completed: row.completed === "true",
      mustika_completed: row.mustika_completed === "true",
    };
  });
}

function firstTwoTrips(schedule) {
  return schedule.split(" | ").slice(0, 2).join(" | ");
}

function firstTrip(schedule) {
  return schedule.split(" | ")[0] || "";
}

function groupRows(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        count: 0,
        completed: 0,
        mustikaCompleted: 0,
        sumScore: 0,
        sumDiff: 0,
        sumSanctuary: 0,
        sumMustika: 0,
        example: row,
        best: row,
      };
      groups.set(key, group);
    }
    group.count += 1;
    if (row.completed) {
      group.completed += 1;
      group.sumSanctuary += row.sanctuary_at;
    }
    if (row.mustika_completed) {
      group.mustikaCompleted += 1;
      group.sumMustika += row.mustika_at;
    }
    group.sumScore += row.red_score_at_180;
    group.sumDiff += row.score_diff;
    const rowRank = rankTuple(row);
    const bestRank = rankTuple(group.best);
    if (compareRanks(rowRank, bestRank) < 0) group.best = row;
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    completionRate: group.completed / group.count,
    mustikaRate: group.mustikaCompleted / group.count,
    avgScore: group.sumScore / group.count,
    avgDiff: group.sumDiff / group.count,
    avgSanctuary: group.completed ? group.sumSanctuary / group.completed : null,
    avgMustika: group.mustikaCompleted ? group.sumMustika / group.mustikaCompleted : null,
  }));
}

function rankTuple(row) {
  return [
    row.mustika_completed ? 0 : 1,
    row.mustika_at ?? Infinity,
    row.completed ? 0 : 1,
    row.sanctuary_at ?? Infinity,
    -row.score_diff,
    -row.red_score_at_180,
  ];
}

function compareRanks(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function sortGroups(groups) {
  return groups.slice().sort((a, b) =>
    b.mustikaRate - a.mustikaRate ||
    b.avgDiff - a.avgDiff ||
    (a.avgMustika ?? Infinity) - (b.avgMustika ?? Infinity) ||
    b.completionRate - a.completionRate ||
    (a.avgSanctuary ?? Infinity) - (b.avgSanctuary ?? Infinity) ||
    b.avgScore - a.avgScore
  );
}

function fmtTime(value) {
  return value == null || !Number.isFinite(value) ? "-" : `${value.toFixed(1)}s`;
}

function fmtPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function table(groups, limit = 8) {
  return [
    "| 順位 | 戦術 | TR | BR初回 | 置き場所 | Mustika率 | 平均Mustika | 平均点差 | 平均点 | n |",
    "|---:|---|---|---|---|---:|---:|---:|---:|---:|",
    ...groups.slice(0, limit).map((group, index) => {
      const row = group.example;
      return [
        index + 1,
        row.scenario,
        firstTwoTrips(row.tr_schedule),
        row.first_br,
        `${row.shared}+${row.own}`,
        fmtPct(group.mustikaRate),
        fmtTime(group.avgMustika),
        group.avgDiff.toFixed(1),
        group.avgScore.toFixed(1),
        group.count,
      ].join(" | ");
    }).map((line) => `| ${line} |`),
  ].join("\n");
}

function compactRecommendation(groups) {
  const top = groups[0];
  if (!top) return "-";
  const row = top.example;
  return `${row.scenario} / TR ${firstTwoTrips(row.tr_schedule)} / BR初回 ${row.first_br} / ${row.shared}+${row.own}`;
}

function run() {
  const rows = readRows();
  const speeds = ["同等", "3/4", "1/2", "1/4"];

  const lines = [
    "# Tactical recommendations",
    "",
    "tactical_opening_cases.csv から、速度別に勝ちやすさ重視で再集計しました。",
    "",
    "評価順は Mustika成功率、平均点差、平均Mustika時刻、Sanctuary成功率、平均Sanctuary時刻、平均得点です。",
    "",
    "## 速度別おすすめ",
    "",
  ];

  const output = {};
  for (const speed of speeds) {
    const speedRows = rows.filter((row) => row.speed === speed);
    const fullGroups = sortGroups(groupRows(speedRows, (row) => [
      row.scenario,
      firstTwoTrips(row.tr_schedule),
      row.first_br,
      row.shared,
      row.own,
      row.plan,
    ].join(" @@ ")));
    const firstTripGroups = sortGroups(groupRows(speedRows, (row) => firstTrip(row.tr_schedule)));
    const placeGroups = sortGroups(groupRows(speedRows, (row) => `${row.shared}+${row.own}`));

    output[speed] = { fullGroups, firstTripGroups, placeGroups };
    lines.push(`### ${speed}`);
    lines.push("");
    lines.push(`- 推奨: ${compactRecommendation(fullGroups)}`);
    lines.push(`- 初手TRだけで見るなら: ${firstTripGroups.slice(0, 4).map((group) => `${group.key}(${fmtPct(group.mustikaRate)}, 点差${group.avgDiff.toFixed(1)})`).join(" / ")}`);
    lines.push(`- 場所だけで見るなら: ${placeGroups.slice(0, 4).map((group) => `${group.key}(${fmtPct(group.mustikaRate)}, 点差${group.avgDiff.toFixed(1)})`).join(" / ")}`);
    lines.push("");
    lines.push(table(fullGroups, 8));
    lines.push("");
  }

  fs.writeFileSync(OUTPUT, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
}

run();
