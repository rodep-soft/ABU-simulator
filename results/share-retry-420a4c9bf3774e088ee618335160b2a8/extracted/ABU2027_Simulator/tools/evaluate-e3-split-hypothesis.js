"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RESULT_DIR = path.join(ROOT, "results");
const INPUT = path.join(RESULT_DIR, "opening_combo_all.csv");
const OUT = path.join(RESULT_DIR, "e3_split_hypothesis.md");

const lines = fs.readFileSync(INPUT, "utf8").trim().split(/\r?\n/);
const header = lines.shift().split(",");
const index = Object.fromEntries(header.map((name, i) => [name, i]));
const rows = lines.map((line) => line.split(","));

const SPEEDS = ["同等", "1/2", "1/4"];

function metric(filter) {
  const selected = rows.filter(filter);
  let done = 0;
  let scoreAt180 = 0;
  let sanctuarySum = 0;
  let best = Infinity;

  for (const row of selected) {
    const completed = row[index.completed] === "yes";
    scoreAt180 += Number(row[index.score_at_180]);
    if (completed) {
      done += 1;
      const sanctuaryAt = Number(row[index.sanctuary_at]);
      sanctuarySum += sanctuaryAt;
      if (sanctuaryAt < best) best = sanctuaryAt;
    }
  }

  return {
    n: selected.length,
    done,
    completionRate: selected.length ? done / selected.length : 0,
    avgScoreAt180: selected.length ? scoreAt180 / selected.length : 0,
    avgSanctuaryAt: done ? sanctuarySum / done : null,
    bestSanctuaryAt: best === Infinity ? null : best,
  };
}

function isE3(row) {
  return row[index.tr_schedule].startsWith("1:E3");
}

function isL1SharedOwnSplit(row) {
  const sortie = row[index.first_br_sortie];
  return (
    /E\+E -> (L1共有上|L1共有下):E1 \/ 赤L1(上|下):E1/.test(sortie) ||
    /E\+E -> 赤L1(上|下):E1 \/ (L1共有上|L1共有下):E1/.test(sortie)
  );
}

function isSameL1Tower(row) {
  const sortie = row[index.first_br_sortie];
  const match = sortie.match(/E\+E -> (L1共有上|L1共有下|赤L1上|赤L1下):E1 \/ (.+):E2/);
  return Boolean(match && match[1] === match[2]);
}

function isBaselineE2(row) {
  return row[index.tr_schedule] === "1:E2 | 2:E2+S1/E>S | 3:S1" ||
    row[index.tr_schedule] === "1:E2 | 2:E2+S1/S>E | 3:S1";
}

function fmtTime(value) {
  return value == null ? "-" : `${value.toFixed(1)}s`;
}

function fmtPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function mdMetric(name, item) {
  return `| ${name} | ${item.n} | ${fmtPercent(item.completionRate)} | ${item.avgScoreAt180.toFixed(1)} | ${fmtTime(item.avgSanctuaryAt)} | ${fmtTime(item.bestSanctuaryAt)} |`;
}

function exactSplitRows(speed) {
  const map = new Map();
  for (const row of rows) {
    if (row[index.speed] !== speed || !isE3(row) || !isL1SharedOwnSplit(row)) continue;
    const key = row[index.first_br_sortie];
    const existing = map.get(key) || [];
    existing.push(row);
    map.set(key, existing);
  }

  return Array.from(map.entries())
    .map(([key, localRows]) => {
      const localSet = new Set(localRows);
      return {
        key,
        metric: metric((row) => localSet.has(row)),
      };
    })
    .sort((a, b) =>
      b.metric.completionRate - a.metric.completionRate ||
      (a.metric.avgSanctuaryAt ?? Infinity) - (b.metric.avgSanctuaryAt ?? Infinity)
    );
}

const report = [
  "# E3 split opening hypothesis",
  "",
  "仮説: TR初手でEarthを3個運び、BR初回で共有エリア1つ・赤専有エリア1つにEarthを1段ずつ置く。",
  "",
  "この評価は、既存の開幕総当たりCSVを使った再集計です。相手がその共有1段を完成させ、それをこちらが反転する分岐はまだ未評価です。",
  "",
  "## 比較軸",
  "",
  "- 提案: 初手E3 + BR初回でL1共有/赤L1専有に1段ずつ",
  "- 同一L1 2段: 初手E3 + BR初回で同じL1タワーにEarthを2段",
  "- E3全体: 初手E3を選んだ全ケース",
  "- 以前の基準: E2 -> E2+S1 -> S1",
  "",
  "| 速度 | ケース | n | 完走率 | 180秒期待点 | Sanctuary平均 | Sanctuary最速 |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...SPEEDS.flatMap((speed) => {
    const base = (row) => row[index.speed] === speed;
    return [
      mdMetric(`${speed} / 提案`, metric((row) => base(row) && isE3(row) && isL1SharedOwnSplit(row))),
      mdMetric(`${speed} / 同一L1 2段`, metric((row) => base(row) && isE3(row) && isSameL1Tower(row))),
      mdMetric(`${speed} / E3全体`, metric((row) => base(row) && isE3(row))),
      mdMetric(`${speed} / 以前の基準`, metric((row) => base(row) && isBaselineE2(row))),
    ];
  }),
  "",
  "## 提案内の場所別",
  "",
  ...SPEEDS.flatMap((speed) => [
    `### ${speed}`,
    "",
    "| BR初回 | n | 完走率 | 180秒期待点 | Sanctuary平均 | Sanctuary最速 |",
    "|---|---:|---:|---:|---:|---:|",
    ...exactSplitRows(speed).map(({ key, metric: item }) => mdMetric(key, item)),
    "",
  ]),
  "## 読み取り",
  "",
  "- 提案は、Sanctuary到達時刻だけを見るとかなり速い。",
  "- ただしL1を2本完成させる前提なので、180秒時点の点数期待値はL2を絡めるケースより低く出る。",
  "- 同速と1/2速度では、提案は同一L1 2段よりSanctuary平均が速い。",
  "- 1/4速度では2本完成に届かないため、提案より同一タワー2段の方が部分点は高い。",
  "- 相手に共有1段を完成させてからSky反転で奪う展開は、次の探索で別分岐として入れる必要がある。",
  "",
].join("\n");

fs.writeFileSync(OUT, report, "utf8");
console.log(report);
