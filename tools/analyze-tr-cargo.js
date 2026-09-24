"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RESULT_DIR = path.join(ROOT, "results");
const INPUT = path.join(RESULT_DIR, "opening_combo_all.csv");
const OUT_MD = path.join(RESULT_DIR, "opening_tr_expectation.md");
const OUT_CSV = path.join(RESULT_DIR, "opening_tr_expectation.csv");

const lines = fs.readFileSync(INPUT, "utf8").trim().split(/\r?\n/);
const header = lines.shift().split(",");
const index = Object.fromEntries(header.map((name, i) => [name, i]));

function parseLine(line) {
  return line.split(",");
}

function getMetric(group) {
  return {
    ...group,
    completionRate: group.done / group.n,
    avgScoreAt180: group.scoreAt180 / group.n,
    avgSuccessAt: group.done > 0 ? group.sanctuaryDone / group.done : null,
    bestAt: group.bestAt === Infinity ? null : group.bestAt,
  };
}

function addTo(map, key, row) {
  const group = map.get(key) || {
    key,
    speed: row.speed,
    n: 0,
    done: 0,
    scoreAt180: 0,
    sanctuaryDone: 0,
    bestAt: Infinity,
  };
  group.n += 1;
  group.done += row.completed ? 1 : 0;
  group.scoreAt180 += row.scoreAt180;
  if (row.completed) {
    group.sanctuaryDone += row.sanctuaryAt;
    if (row.sanctuaryAt < group.bestAt) group.bestAt = row.sanctuaryAt;
  }
  map.set(key, group);
}

function rank(groups) {
  return Array.from(groups.values())
    .map(getMetric)
    .sort((a, b) =>
      b.completionRate - a.completionRate ||
      b.avgScoreAt180 - a.avgScoreAt180 ||
      (a.avgSuccessAt ?? Infinity) - (b.avgSuccessAt ?? Infinity)
    );
}

function formatTime(value) {
  return value == null ? "-" : `${value.toFixed(1)}s`;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function lineFor(group) {
  return `- ${group.key}: 完走率 ${percent(group.completionRate)}, 180秒期待点 ${group.avgScoreAt180.toFixed(1)}, 成功時平均 ${formatTime(group.avgSuccessAt)}, 最速 ${formatTime(group.bestAt)}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const scheduleGroups = new Map();
const tripGroups = new Map();
const speeds = ["同等", "1/2", "1/4"];

for (const line of lines) {
  const cells = parseLine(line);
  const row = {
    speed: cells[index.speed],
    trSchedule: cells[index.tr_schedule],
    completed: cells[index.completed] === "yes",
    scoreAt180: Number(cells[index.score_at_180]),
    sanctuaryAt: Number(cells[index.sanctuary_at]),
  };

  addTo(scheduleGroups, `${row.speed}||${row.trSchedule}`, row);

  const trips = row.trSchedule.split(" | ").map((trip) => trip.replace(/^\d+:/, ""));
  for (let i = 0; i < 3; i += 1) {
    addTo(tripGroups, `${row.speed}||${i + 1}||${trips[i] || "(なし)"}`, {
      ...row,
      speed: row.speed,
    });
  }
}

function groupRowsFor(map, speed) {
  return rank(new Map(Array.from(map).filter(([key]) => key.startsWith(`${speed}||`))))
    .map((group) => ({
      ...group,
      key: group.key.split("||").slice(1).join(" / "),
    }));
}

const markdown = [
  "# TR cargo expectation",
  "",
  "完走率を最優先、次に180秒時点の期待点、最後に成功時平均時間で並べています。",
  "",
  ...speeds.flatMap((speed) => [
    `## ${speed}`,
    "",
    "### 3便セット",
    "",
    ...groupRowsFor(scheduleGroups, speed).slice(0, 12).map(lineFor),
    "",
    "### 1便目",
    "",
    ...groupRowsFor(tripGroups, speed).filter((group) => group.key.startsWith("1 / ")).slice(0, 8).map((group) => lineFor({ ...group, key: group.key.replace("1 / ", "") })),
    "",
    "### 2便目",
    "",
    ...groupRowsFor(tripGroups, speed).filter((group) => group.key.startsWith("2 / ")).slice(0, 8).map((group) => lineFor({ ...group, key: group.key.replace("2 / ", "") })),
    "",
    "### 3便目",
    "",
    ...groupRowsFor(tripGroups, speed).filter((group) => group.key.startsWith("3 / ")).slice(0, 8).map((group) => lineFor({ ...group, key: group.key.replace("3 / ", "") })),
    "",
  ]),
].join("\n");

const csvRows = [["scope", "speed", "key", "completion_rate", "avg_score_at_180", "avg_success_at", "best_at", "cases"]];
for (const speed of speeds) {
  for (const group of groupRowsFor(scheduleGroups, speed)) {
    csvRows.push(["schedule", speed, group.key, group.completionRate, group.avgScoreAt180, group.avgSuccessAt, group.bestAt, group.n]);
  }
  for (const group of groupRowsFor(tripGroups, speed)) {
    csvRows.push(["trip", speed, group.key, group.completionRate, group.avgScoreAt180, group.avgSuccessAt, group.bestAt, group.n]);
  }
}

fs.writeFileSync(OUT_MD, markdown, "utf8");
fs.writeFileSync(OUT_CSV, csvRows.map((row) => row.map(csvEscape).join(",")).join("\n"), "utf8");

console.log(markdown);
