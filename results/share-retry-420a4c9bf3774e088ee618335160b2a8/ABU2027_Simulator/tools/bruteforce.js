"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const APP_PATH = path.join(ROOT, "app.js");
const OUT_DIR = path.join(ROOT, "results");

const appSource = fs.readFileSync(APP_PATH, "utf8");

const context = {
  console,
  document: {
    addEventListener() {},
    getElementById() {
      return null;
    },
  },
  requestAnimationFrame() {},
};

const runnerSource = `
Object.assign(els, {
  redTrStrategy: { value: "demandPull" },
  redBrStrategy: { value: "l1FastMustika" },
  blueTrStrategy: { value: "demandPull" },
  blueBrStrategy: { value: "l1FastMustika" },
  redSpeed: { value: "1" },
  scanTime: { value: "3" },
  playToggle: { textContent: "" },
});

const SPEED_CASES = [
  { value: 1, label: "同等" },
  { value: 0.5, label: "1/2" },
  { value: 0.25, label: "1/4" },
];

function publicStrategies(source) {
  return Object.entries(source).map(([id, strategy]) => ({
    id,
    label: strategy.label,
  }));
}

function eventTime(teamId, keyword) {
  const event = state.events.find((item) => item.teamId === teamId && item.text.includes(keyword));
  return event ? Number(event.time.toFixed(1)) : null;
}

function countCompleteTowers(teamId) {
  return SPOTS.filter((spot) => isCompleteForTeam(spot.id, teamId)).length;
}

function countOwnedLayers(teamId) {
  let earth = 0;
  let sky = 0;
  for (const spot of SPOTS) {
    const towerState = state.spots[spot.id];
    if (towerState.earth1 === teamId) earth += 1;
    if (towerState.earth2 === teamId) earth += 1;
    if (towerState.skyColor === teamId) sky += 1;
  }
  return { earth, sky };
}

function runOne(config, caseId) {
  els.redTrStrategy.value = config.redTr;
  els.redBrStrategy.value = config.redBr;
  els.blueTrStrategy.value = config.blueTr;
  els.blueBrStrategy.value = config.blueBr;
  els.redSpeed.value = String(config.redSpeed);
  els.scanTime.value = String(config.scanTime);

  state = createInitialState();
  advance(MATCH_SECONDS);

  const scores = scoreState();
  const redLayers = countOwnedLayers("red");
  const blueLayers = countOwnedLayers("blue");
  const events = state.events.slice().reverse().map((event) => ({
    time: Number(event.time.toFixed(1)),
    team: event.teamId,
    text: event.text,
  }));

  return {
    caseId,
    config,
    score: {
      red: scores.red,
      blue: scores.blue,
      diff: scores.red.total - scores.blue.total,
      winner: scores.red.total === scores.blue.total ? "draw" : scores.red.total > scores.blue.total ? "red" : "blue",
    },
    milestones: {
      redSanctuaryAt: eventTime("red", "Sanctuary Mandate"),
      blueSanctuaryAt: eventTime("blue", "Sanctuary Mandate"),
      redMustikaAt: eventTime("red", "Mustikaを中央柱に奉納"),
      blueMustikaAt: eventTime("blue", "Mustikaを中央柱に奉納"),
      mustikaOwner: state.mustikaOwner,
    },
    build: {
      redCompleteTowers: countCompleteTowers("red"),
      blueCompleteTowers: countCompleteTowers("blue"),
      redLayers,
      blueLayers,
      redDeliveredEarth: state.teams.red.deliveredEarth,
      redDeliveredSky: state.teams.red.deliveredSky,
      blueDeliveredEarth: state.teams.blue.deliveredEarth,
      blueDeliveredSky: state.teams.blue.deliveredSky,
      skyRemaining: state.skyRemaining,
    },
    events,
  };
}

const trStrategies = publicStrategies(TR_STRATEGIES);
const brStrategies = publicStrategies(BR_STRATEGIES);
const cases = [];
let caseId = 1;

for (const speed of SPEED_CASES) {
  for (const redTr of trStrategies) {
    for (const redBr of brStrategies) {
      for (const blueTr of trStrategies) {
        for (const blueBr of brStrategies) {
          cases.push(runOne({
            speedLabel: speed.label,
            redSpeed: speed.value,
            scanTime: 3,
            redTr: redTr.id,
            redBr: redBr.id,
            blueTr: blueTr.id,
            blueBr: blueBr.id,
          }, caseId));
          caseId += 1;
        }
      }
    }
  }
}

globalThis.__BRUTEFORCE_RESULT__ = {
  meta: {
    matchSeconds: MATCH_SECONDS,
    scanTime: 3,
    totalCases: cases.length,
    generatedAt: new Date().toISOString(),
  },
  strategies: {
    tr: trStrategies,
    br: brStrategies,
  },
  cases,
};
`;

vm.createContext(context);
vm.runInContext(`${appSource}\n${runnerSource}`, context, { filename: "bruteforce-vm.js" });

const result = context.__BRUTEFORCE_RESULT__;
const trLabel = Object.fromEntries(result.strategies.tr.map((strategy) => [strategy.id, strategy.label]));
const brLabel = Object.fromEntries(result.strategies.br.map((strategy) => [strategy.id, strategy.label]));

function configLabel(config) {
  return [
    `赤TR=${trLabel[config.redTr]}`,
    `赤BR=${brLabel[config.redBr]}`,
    `青TR=${trLabel[config.blueTr]}`,
    `青BR=${brLabel[config.blueBr]}`,
  ].join(" / ");
}

function formatTime(value) {
  return value == null ? "-" : `${value.toFixed(1)}s`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function bySpeed(speedLabel) {
  return result.cases.filter((item) => item.config.speedLabel === speedLabel);
}

function topCases(cases, count = 5) {
  return cases
    .slice()
    .sort((a, b) => b.score.diff - a.score.diff || b.score.red.total - a.score.red.total)
    .slice(0, count);
}

function bottomCases(cases, count = 5) {
  return cases
    .slice()
    .sort((a, b) => a.score.diff - b.score.diff || a.score.red.total - b.score.red.total)
    .slice(0, count);
}

function aggregateByRedStrategy(cases) {
  const map = new Map();
  for (const item of cases) {
    const key = `${item.config.redTr}::${item.config.redBr}`;
    const current = map.get(key) || {
      redTr: item.config.redTr,
      redBr: item.config.redBr,
      n: 0,
      wins: 0,
      draws: 0,
      diffTotal: 0,
      redTotal: 0,
      redMustika: 0,
      redSanctuary: 0,
    };
    current.n += 1;
    current.wins += item.score.winner === "red" ? 1 : 0;
    current.draws += item.score.winner === "draw" ? 1 : 0;
    current.diffTotal += item.score.diff;
    current.redTotal += item.score.red.total;
    current.redMustika += item.milestones.mustikaOwner === "red" ? 1 : 0;
    current.redSanctuary += item.milestones.redSanctuaryAt == null ? 0 : 1;
    map.set(key, current);
  }
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      avgDiff: item.diffTotal / item.n,
      avgRedScore: item.redTotal / item.n,
      winRate: item.wins / item.n,
      mustikaRate: item.redMustika / item.n,
      sanctuaryRate: item.redSanctuary / item.n,
    }))
    .sort((a, b) => b.avgDiff - a.avgDiff || b.winRate - a.winRate);
}

function rowForCase(item) {
  return [
    item.caseId,
    item.config.speedLabel,
    trLabel[item.config.redTr],
    brLabel[item.config.redBr],
    trLabel[item.config.blueTr],
    brLabel[item.config.blueBr],
    item.score.red.total,
    item.score.blue.total,
    item.score.diff,
    item.score.winner,
    item.score.red.transfer,
    item.score.red.tower,
    item.score.red.mustika,
    item.score.blue.transfer,
    item.score.blue.tower,
    item.score.blue.mustika,
    item.milestones.redSanctuaryAt,
    item.milestones.blueSanctuaryAt,
    item.milestones.redMustikaAt,
    item.milestones.blueMustikaAt,
    item.milestones.mustikaOwner,
    item.build.redCompleteTowers,
    item.build.blueCompleteTowers,
    item.build.redDeliveredEarth,
    item.build.redDeliveredSky,
    item.build.blueDeliveredEarth,
    item.build.blueDeliveredSky,
  ];
}

function caseLine(item) {
  return `- #${item.caseId} ${configLabel(item.config)}: 赤 ${item.score.red.total} - 青 ${item.score.blue.total} / 差 ${item.score.diff} / 赤Sanctuary ${formatTime(item.milestones.redSanctuaryAt)} / Mustika ${item.milestones.mustikaOwner || "-"}`;
}

function eventLine(event) {
  const team = event.team ? `${event.team === "red" ? "赤" : "青"} ` : "";
  return `- ${formatTime(event.time)} ${team}${event.text}`;
}

function aggregateLine(item) {
  return `- ${trLabel[item.redTr]} + ${brLabel[item.redBr]}: 平均差 ${item.avgDiff.toFixed(1)}, 平均赤得点 ${item.avgRedScore.toFixed(1)}, 勝率 ${(item.winRate * 100).toFixed(0)}%, 赤Mustika率 ${(item.mustikaRate * 100).toFixed(0)}%`;
}

const csvHeader = [
  "case_id",
  "red_speed",
  "red_tr",
  "red_br",
  "blue_tr",
  "blue_br",
  "red_total",
  "blue_total",
  "diff",
  "winner",
  "red_transfer",
  "red_tower",
  "red_mustika",
  "blue_transfer",
  "blue_tower",
  "blue_mustika",
  "red_sanctuary_at",
  "blue_sanctuary_at",
  "red_mustika_at",
  "blue_mustika_at",
  "mustika_owner",
  "red_complete_towers",
  "blue_complete_towers",
  "red_delivered_earth",
  "red_delivered_sky",
  "blue_delivered_earth",
  "blue_delivered_sky",
];

const csv = [
  csvHeader.join(","),
  ...result.cases.map((item) => rowForCase(item).map(csvEscape).join(",")),
].join("\n");

const speedLabels = ["同等", "1/2", "1/4"];
const highlightedCases = [
  { title: "同等速度の赤ベスト", item: topCases(bySpeed("同等"), 1)[0] },
  { title: "赤1/2速度の最善粘り", item: topCases(bySpeed("1/2"), 1)[0] },
  { title: "赤1/4速度の最善粘り", item: topCases(bySpeed("1/4"), 1)[0] },
  { title: "同等速度で赤が大敗した例", item: bottomCases(bySpeed("同等"), 1)[0] },
];
const report = [
  "# ABU Robocon 2027 brute-force simulation",
  "",
  `- ケース数: ${result.meta.totalCases}`,
  `- 試合時間: ${result.meta.matchSeconds}s`,
  `- BR認識停止: ${result.meta.scanTime}s`,
  `- 生成時刻: ${result.meta.generatedAt}`,
  "",
  "## 速度別ベスト",
  "",
  ...speedLabels.flatMap((label) => [
    `### 赤速度 ${label}`,
    ...topCases(bySpeed(label), 5).map(caseLine),
    "",
  ]),
  "## 速度別ワースト",
  "",
  ...speedLabels.flatMap((label) => [
    `### 赤速度 ${label}`,
    ...bottomCases(bySpeed(label), 3).map(caseLine),
    "",
  ]),
  "## 赤側戦略の平均成績",
  "",
  ...speedLabels.flatMap((label) => [
    `### 赤速度 ${label}`,
    ...aggregateByRedStrategy(bySpeed(label)).slice(0, 6).map(aggregateLine),
    "",
  ]),
  "## 赤がMustikaを取れた代表ケース",
  "",
  ...result.cases
    .filter((item) => item.milestones.mustikaOwner === "red")
    .sort((a, b) => b.score.diff - a.score.diff)
    .slice(0, 10)
    .map(caseLine),
  "",
  "## 代表ケース時系列ログ",
  "",
  ...highlightedCases.flatMap(({ title, item }) => [
    `### ${title}`,
    caseLine(item),
    "",
    ...item.events.map(eventLine),
    "",
  ]),
].join("\n");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "bruteforce_latest.json"), JSON.stringify(result, null, 2), "utf8");
fs.writeFileSync(path.join(OUT_DIR, "bruteforce_latest.csv"), csv, "utf8");
fs.writeFileSync(path.join(OUT_DIR, "bruteforce_report.md"), report, "utf8");

console.log(report);
