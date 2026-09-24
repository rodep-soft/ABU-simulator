"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "results");

const MATCH_SECONDS = 180;
const FIELD_SIZE_METERS = 11.2;
const VIEWBOX_SIZE = 100;
const METERS_PER_UNIT = FIELD_SIZE_METERS / VIEWBOX_SIZE;
const ROBOT_MAX_SPEED_MPS = 7;
const ROBOT_MAX_ACCEL_MPS2 = 3.5;
const ROBOT_MAX_SPEED_UNITS = ROBOT_MAX_SPEED_MPS / METERS_PER_UNIT;
const ROBOT_MAX_ACCEL_UNITS = ROBOT_MAX_ACCEL_MPS2 / METERS_PER_UNIT;
const RAMP_SPEED_FACTOR = 0.45;
const STAIR_SPEED_FACTOR = 0.75;
const STAIR_STOP_SECONDS = 1.2;
const SCAN_SECONDS = 3;

const PICKUP_SECONDS = { earth: 2.4, sky: 2.4 };
const TR_DROPOFF_SECONDS_PER_ITEM = 1.2;
const BR_PICKUP_SECONDS_PER_ITEM = 1.4;
const PLACE_SECONDS = { earth: 3.6, sky: 3.0 };

const LEVEL_ORDER = { ground: 0, l1: 1, l2: 2 };
const LEVEL_BY_ORDER = ["ground", "l1", "l2"];

const POINTS = {
  red: {
    trHome: { id: "red-tr-home", x: 9.5, y: 95.5, level: "ground" },
    brStart: { id: "red-br-start", x: 5.2, y: 95.5, level: "ground" },
    brHome: { id: "red-br-home", x: 35, y: 75, level: "l1" },
    storage: { id: "red-earth", x: 10.5, y: 5.5, level: "ground" },
    transfer: { id: "red-transfer", x: 22.5, y: 50, level: "l1" },
  },
  skyShare: { id: "sky-share", x: 50, y: 86, level: "ground" },
};

const LEVEL_TRANSITIONS = {
  red: {
    groundL1: [
      {
        lower: { x: 16.0, y: 57.0, level: "ground" },
        upper: { x: 24.0, y: 57.0, level: "l1" },
        terrain: "ramp",
        stopSeconds: 0,
      },
      {
        lower: { x: 16.0, y: 72.0, level: "ground" },
        upper: { x: 24.0, y: 72.0, level: "l1" },
        terrain: "stair",
        stopSeconds: STAIR_STOP_SECONDS,
      },
    ],
    l1L2: [
      {
        lower: { x: 35.5, y: 50, level: "l1" },
        upper: { x: 39.5, y: 50, level: "l2" },
        terrain: "stair",
        stopSeconds: STAIR_STOP_SECONDS,
      },
    ],
  },
};

const SPOTS = [
  { id: "l1sA", name: "L1共有上", level: 1, shared: true, x: 50.2, y: 26.2 },
  { id: "l1sB", name: "L1共有下", level: 1, shared: true, x: 50.2, y: 74.0 },
  { id: "r1", name: "赤L1上", level: 1, shared: false, side: "red", x: 26.3, y: 26.2 },
  { id: "r2", name: "赤L1下", level: 1, shared: false, side: "red", x: 26.3, y: 74.0 },
  { id: "l2a", name: "L2左上", level: 2, shared: true, x: 39.3, y: 39.0 },
  { id: "l2b", name: "L2右上", level: 2, shared: true, x: 60.8, y: 39.0 },
  { id: "l2c", name: "L2左下", level: 2, shared: true, x: 39.3, y: 61.3 },
  { id: "l2d", name: "L2右下", level: 2, shared: true, x: 60.8, y: 61.3 },
];

const SPOT_BY_ID = Object.fromEntries(SPOTS.map((spot) => [spot.id, spot]));

const SPEED_CASES = [
  { label: "同等", factor: 1 },
  { label: "1/2", factor: 0.5 },
  { label: "1/4", factor: 0.25 },
];

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function levelOf(point) {
  if (point.level === 2) return "l2";
  if (point.level === 1) return "l1";
  return point.level || "ground";
}

function terrainSpeedFactor(terrain) {
  if (terrain === "ramp") return RAMP_SPEED_FACTOR;
  if (terrain === "stair") return STAIR_SPEED_FACTOR;
  return 1;
}

function scaled(seconds, speedFactor) {
  return seconds / Math.max(speedFactor, 0.05);
}

function transitionsForLevelStep(fromLevel, toLevel) {
  if (
    (fromLevel === "ground" && toLevel === "l1") ||
    (fromLevel === "l1" && toLevel === "ground")
  ) {
    return LEVEL_TRANSITIONS.red.groundL1;
  }
  if (
    (fromLevel === "l1" && toLevel === "l2") ||
    (fromLevel === "l2" && toLevel === "l1")
  ) {
    return LEVEL_TRANSITIONS.red.l1L2;
  }
  return [];
}

function transitionEndpoints(transition, fromLevel, toLevel) {
  const ascending = LEVEL_ORDER[toLevel] > LEVEL_ORDER[fromLevel];
  return {
    entry: ascending ? transition.lower : transition.upper,
    exit: ascending ? transition.upper : transition.lower,
  };
}

function cleanedWaypoints(points) {
  return points.filter((point, index) => {
    if (index === 0) return true;
    return dist(points[index - 1], point) > 0.01;
  });
}

function trGroundWaypoints(start, target) {
  const laneX = 16;
  return cleanedWaypoints([
    { x: start.x, y: start.y, level: "ground" },
    { x: laneX, y: start.y, level: "ground" },
    { x: laneX, y: target.y, level: "ground" },
    { x: target.x, y: target.y, level: "ground" },
  ]);
}

function pushNormalRoute(route, from, to, actorRole) {
  if (actorRole === "TR" && levelOf(from) === "ground" && levelOf(to) === "ground") {
    for (const point of trGroundWaypoints(from, to).slice(1)) {
      route.push({ to: point, terrain: "normal", stopSeconds: 0 });
    }
    return;
  }
  route.push({ to, terrain: "normal", stopSeconds: 0 });
}

function routeBetween(start, target, actorRole = null) {
  const targetLevel = levelOf(target);
  const route = [];
  let current = { x: start.x, y: start.y, level: levelOf(start) };

  while (current.level !== targetLevel) {
    const fromOrder = LEVEL_ORDER[current.level];
    const toOrder = LEVEL_ORDER[targetLevel];
    const nextLevel = LEVEL_BY_ORDER[fromOrder + Math.sign(toOrder - fromOrder)];
    const selected = transitionsForLevelStep(current.level, nextLevel)
      .map((transition) => {
        const endpoints = transitionEndpoints(transition, current.level, nextLevel);
        return {
          transition,
          endpoints,
          cost: dist(current, endpoints.entry) + dist(endpoints.exit, target),
        };
      })
      .sort((a, b) => a.cost - b.cost)[0];

    if (!selected) break;
    pushNormalRoute(route, current, selected.endpoints.entry, actorRole);
    route.push({
      to: selected.endpoints.exit,
      terrain: selected.transition.terrain,
      stopSeconds: selected.transition.stopSeconds,
    });
    current = selected.endpoints.exit;
  }

  pushNormalRoute(route, current, target, actorRole);
  return route;
}

function segmentMotionTime(distance, terrain, speedFactor) {
  if (distance <= 0.001) return 0;
  const terrainFactor = terrainSpeedFactor(terrain);
  const maxSpeed = ROBOT_MAX_SPEED_UNITS * speedFactor * terrainFactor;
  const maxAccel = ROBOT_MAX_ACCEL_UNITS * speedFactor * terrainFactor;
  const accelDistance = (maxSpeed * maxSpeed) / (2 * maxAccel);

  if (distance <= accelDistance * 2) {
    return 2 * Math.sqrt(distance / maxAccel);
  }
  return (2 * maxSpeed) / maxAccel + (distance - accelDistance * 2) / maxSpeed;
}

function travelTime(start, target, speedFactor, actorRole = null) {
  let time = 0;
  let current = start;
  for (const segment of routeBetween(start, target, actorRole)) {
    time += segmentMotionTime(dist(current, segment.to), segment.terrain, speedFactor);
    if (segment.stopSeconds > 0) time += scaled(segment.stopSeconds, speedFactor);
    current = segment.to;
  }
  return time;
}

function layerPoints(spotId) {
  const level = SPOT_BY_ID[spotId].level;
  return {
    earth1: level === 1 ? 10 : 20,
    earth2: level === 1 ? 20 : 40,
    sky: level === 1 ? 40 : 80,
  };
}

function towerPoints(spotId) {
  const points = layerPoints(spotId);
  return points.earth1 + points.earth2 + points.sky;
}

function countLabel(counts) {
  const parts = [];
  if (counts.earth) parts.push(`E${counts.earth}`);
  if (counts.sky) parts.push(`S${counts.sky}`);
  return parts.join("+");
}

function cargoLabel(cargo) {
  const base = countLabel(cargo);
  if (cargo.earth > 0 && cargo.sky > 0) {
    return `${base}/${cargo.order.map((item) => item === "earth" ? "E" : "S").join(">")}`;
  }
  return base;
}

function cargoOptions() {
  const options = [];
  for (let earth = 0; earth <= 3; earth += 1) {
    for (let sky = 0; sky <= 3; sky += 1) {
      const total = earth + sky;
      if (total < 1 || total > 3) continue;
      const orders = [];
      if (earth > 0 && sky > 0) {
        orders.push(["earth", "sky"], ["sky", "earth"]);
      } else if (earth > 0) {
        orders.push(["earth"]);
      } else {
        orders.push(["sky"]);
      }
      for (const order of orders) {
        options.push({
          earth,
          sky,
          total,
          order,
          label: null,
        });
      }
    }
  }
  return options.map((option) => ({ ...option, label: cargoLabel(option) }));
}

function trSchedules() {
  const options = cargoOptions();
  const schedules = [];

  function dfs(trips, earth, sky) {
    if (trips.length >= 2 && earth === 4 && sky === 2) {
      schedules.push({
        trips: trips.map((trip) => ({ ...trip })),
        label: trips.map((trip, index) => `${index + 1}:${trip.label}`).join(" | "),
        firstLabel: trips[0].label,
        firstCountLabel: countLabel(trips[0]),
      });
    }
    if (trips.length >= 3 || earth > 4 || sky > 2) return;
    for (const option of options) {
      dfs([...trips, option], earth + option.earth, sky + option.sky);
    }
  }

  dfs([], 0, 0);
  return schedules;
}

function simulateTr(schedule, speedFactor) {
  let time = 0;
  let position = POINTS.red.trHome;
  const deliveries = [];
  const events = [];

  for (const [tripIndex, trip] of schedule.trips.entries()) {
    for (const item of trip.order) {
      const count = trip[item];
      if (count <= 0) continue;
      const source = item === "earth" ? POINTS.red.storage : POINTS.skyShare;
      time += travelTime(position, source, speedFactor, "TR");
      time += scaled(PICKUP_SECONDS[item] * count, speedFactor);
      events.push({
        time,
        actor: "TR",
        text: `${tripIndex + 1}便目 ${item === "earth" ? "Earth" : "Sky"}を${count}個取得`,
      });
      position = source;
    }

    time += travelTime(position, POINTS.red.transfer, speedFactor, "TR");
    time += scaled(TR_DROPOFF_SECONDS_PER_ITEM * trip.total, speedFactor);

    for (let i = 0; i < trip.earth; i += 1) deliveries.push({ time, type: "earth" });
    for (let i = 0; i < trip.sky; i += 1) deliveries.push({ time, type: "sky" });
    events.push({
      time,
      actor: "TR",
      text: `${tripIndex + 1}便目 ${trip.label} をTransferへ搬送`,
    });
    position = POINTS.red.transfer;
  }

  return {
    deliveries: deliveries.sort((a, b) => a.time - b.time),
    events,
  };
}

function nextStepForSpot(spotId, placedCount) {
  if (placedCount === 0) return { spotId, item: "earth", layer: "earth1" };
  if (placedCount === 1) return { spotId, item: "earth", layer: "earth2" };
  if (placedCount === 2) return { spotId, item: "sky", layer: "sky" };
  return null;
}

function placementOrders(spotA, spotB) {
  const orders = [];

  function dfs(counts, order) {
    if (order.length === 6) {
      orders.push(order);
      return;
    }

    for (const spotId of [spotA, spotB]) {
      const step = nextStepForSpot(spotId, counts[spotId]);
      if (!step) continue;
      dfs(
        { ...counts, [spotId]: counts[spotId] + 1 },
        [...order, step]
      );
    }
  }

  dfs({ [spotA]: 0, [spotB]: 0 }, []);
  return orders;
}

function placementPlans() {
  const pairs = [];
  const spots = SPOTS;
  for (let i = 0; i < spots.length; i += 1) {
    for (let j = i + 1; j < spots.length; j += 1) {
      if (!spots[i].shared && !spots[j].shared) continue;
      pairs.push([spots[i].id, spots[j].id]);
    }
  }

  const plans = [];
  for (const [spotA, spotB] of pairs) {
    for (const order of placementOrders(spotA, spotB)) {
      plans.push({
        spotA,
        spotB,
        pairLabel: `${SPOT_BY_ID[spotA].name}+${SPOT_BY_ID[spotB].name}`,
        order,
        orderLabel: order.map((step) => `${SPOT_BY_ID[step.spotId].name}:${step.layer === "sky" ? "S" : step.layer === "earth1" ? "E1" : "E2"}`).join(" > "),
      });
    }
  }
  return plans;
}

function availableTime(deliveries, used, needed, type, earliest) {
  if (!needed) return earliest;
  const typed = deliveries.filter((delivery) => delivery.type === type);
  const targetIndex = used[type] + needed - 1;
  if (!typed[targetIndex]) return Infinity;
  return Math.max(earliest, typed[targetIndex].time);
}

function sortieLabel(steps) {
  const itemPart = steps.map((step) => step.item === "earth" ? "E" : "S").join("+");
  const spotPart = steps.map((step) => `${SPOT_BY_ID[step.spotId].name}:${step.layer === "sky" ? "S" : step.layer === "earth1" ? "E1" : "E2"}`).join(" / ");
  return `${itemPart} -> ${spotPart}`;
}

function simulateBr(plan, trResult, speedFactor) {
  const used = { earth: 0, sky: 0 };
  const placed = Object.fromEntries(SPOTS.map((spot) => [spot.id, { earth1: false, earth2: false, sky: false }]));
  const events = [];
  let time = 0;
  let position = POINTS.red.brStart;
  let towerScore = 0;
  const sorties = [
    plan.order.slice(0, 2),
    plan.order.slice(2, 4),
    plan.order.slice(4, 6),
  ];

  for (const [sortieIndex, steps] of sorties.entries()) {
    const need = {
      earth: steps.filter((step) => step.item === "earth").length,
      sky: steps.filter((step) => step.item === "sky").length,
    };

    time += travelTime(position, POINTS.red.brHome, speedFactor, "BR");
    position = POINTS.red.brHome;
    time += scaled(SCAN_SECONDS, speedFactor);
    events.push({ time, actor: "BR", text: `${sortieIndex + 1}回目 ホームで認識停止` });

    time += travelTime(position, POINTS.red.transfer, speedFactor, "BR");
    time = availableTime(trResult.deliveries, used, need.earth, "earth", time);
    time = availableTime(trResult.deliveries, used, need.sky, "sky", time);
    if (!Number.isFinite(time)) return null;

    time += scaled(BR_PICKUP_SECONDS_PER_ITEM * steps.length, speedFactor);
    used.earth += need.earth;
    used.sky += need.sky;
    events.push({ time, actor: "BR", text: `${sortieIndex + 1}回目 ${sortieLabel(steps)} を受け取り` });
    position = POINTS.red.transfer;

    for (const step of steps) {
      const spot = SPOT_BY_ID[step.spotId];
      time += travelTime(position, spot, speedFactor, "BR");
      time += scaled(PLACE_SECONDS[step.item], speedFactor);
      placed[step.spotId][step.layer] = true;
      const points = layerPoints(step.spotId)[step.layer];
      towerScore += points;
      events.push({
        time,
        actor: "BR",
        points,
        text: `${spot.name} ${step.layer === "sky" ? "Sky" : step.layer === "earth1" ? "1段目Earth" : "2段目Earth"}配置`,
      });
      position = spot;
    }
  }

  const transferPoints = trResult.deliveries.filter((delivery) => delivery.time <= time).length * 5;
  const transferPointsAt180 = trResult.deliveries.filter((delivery) => delivery.time <= MATCH_SECONDS).length * 5;
  const towerScoreAt180 = events
    .filter((event) => event.points && event.time <= MATCH_SECONDS)
    .reduce((total, event) => total + event.points, 0);
  const pairHasShared = SPOT_BY_ID[plan.spotA].shared || SPOT_BY_ID[plan.spotB].shared;
  const sanctuaryAt = pairHasShared ? time : null;
  return {
    sanctuaryAt,
    completed: sanctuaryAt != null && sanctuaryAt <= MATCH_SECONDS,
    towerScore,
    transferPoints,
    openingScore: towerScore + transferPoints,
    towerScoreAt180,
    transferPointsAt180,
    scoreAt180: towerScoreAt180 + transferPointsAt180,
    events,
  };
}

function summarizeRows(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const group = groups.get(key) || {
      key,
      count: 0,
      completed: 0,
      bestSanctuaryAt: Infinity,
      sumSanctuaryAt: 0,
      sumPenaltySanctuaryAt: 0,
      sumOpeningScore: 0,
      sumScoreAt180: 0,
      bestOpeningScore: 0,
      bestCaseId: null,
    };
    group.count += 1;
    if (row.completed) {
      group.completed += 1;
      group.sumSanctuaryAt += row.sanctuaryAt;
      if (row.sanctuaryAt < group.bestSanctuaryAt) {
        group.bestSanctuaryAt = row.sanctuaryAt;
        group.bestCaseId = row.caseId;
      }
    }
    group.sumPenaltySanctuaryAt += Math.min(row.sanctuaryAt ?? MATCH_SECONDS, MATCH_SECONDS);
    group.sumOpeningScore += row.openingScore;
    group.sumScoreAt180 += row.scoreAt180;
    if (row.openingScore > group.bestOpeningScore) group.bestOpeningScore = row.openingScore;
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      completionRate: group.completed / group.count,
      avgSanctuaryAt: group.completed > 0 ? group.sumSanctuaryAt / group.completed : null,
      avgPenaltySanctuaryAt: group.sumPenaltySanctuaryAt / group.count,
      avgOpeningScore: group.sumOpeningScore / group.count,
      avgScoreAt180: group.sumScoreAt180 / group.count,
    }))
    .sort((a, b) => b.completionRate - a.completionRate || b.avgScoreAt180 - a.avgScoreAt180 || a.avgPenaltySanctuaryAt - b.avgPenaltySanctuaryAt);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatTime(value) {
  return value == null || !Number.isFinite(value) ? "-" : `${value.toFixed(1)}s`;
}

function rowLine(row) {
  return `- #${row.caseId} ${row.speedLabel} / TR ${row.trScheduleLabel} / BR初回 ${row.firstBrSortie} / ${row.pairLabel}: Sanctuary ${formatTime(row.sanctuaryAt)}, 開幕点 ${row.openingScore}`;
}

function groupLine(group) {
  return `- ${group.key}: 完走率 ${(group.completionRate * 100).toFixed(1)}%, 180秒期待点 ${group.avgScoreAt180.toFixed(1)}, 成功時平均 ${formatTime(group.avgSanctuaryAt)}, 最速 ${formatTime(group.bestSanctuaryAt)}, ケース数 ${group.count}`;
}

function sectionItems(items, mapper, emptyText = "180秒以内に完走なし") {
  if (items.length === 0) return [`- ${emptyText}`];
  return items.map(mapper);
}

function run() {
  const schedules = trSchedules();
  const plans = placementPlans();
  const rows = [];
  const topLogs = [];
  let caseId = 1;

  for (const speed of SPEED_CASES) {
    for (const schedule of schedules) {
      const trResult = simulateTr(schedule, speed.factor);
      for (const plan of plans) {
        const brResult = simulateBr(plan, trResult, speed.factor);
        if (!brResult) {
          caseId += 1;
          continue;
        }

        const firstBrSortie = sortieLabel(plan.order.slice(0, 2));
        rows.push({
          caseId,
          speedLabel: speed.label,
          speedFactor: speed.factor,
          trScheduleLabel: schedule.label,
          firstTr: schedule.firstLabel,
          firstTrCounts: schedule.firstCountLabel,
          trips: schedule.trips.length,
          firstBrSortie,
          pairLabel: plan.pairLabel,
          orderLabel: plan.orderLabel,
          sanctuaryAt: brResult.sanctuaryAt,
          completed: brResult.completed,
          towerScore: brResult.towerScore,
          transferPoints: brResult.transferPoints,
          openingScore: brResult.openingScore,
          towerScoreAt180: brResult.towerScoreAt180,
          transferPointsAt180: brResult.transferPointsAt180,
          scoreAt180: brResult.scoreAt180,
          events: [...trResult.events, ...brResult.events].sort((a, b) => a.time - b.time),
        });
        caseId += 1;
      }
    }
  }

  const csvHeader = [
    "case_id",
    "speed",
    "speed_factor",
    "tr_schedule",
    "first_tr",
    "first_tr_counts",
    "tr_trips",
    "first_br_sortie",
    "pair",
    "placement_order",
    "sanctuary_at",
    "completed",
    "score_at_180",
    "tower_score_at_180",
    "transfer_points_at_180",
    "opening_score",
    "tower_score",
    "transfer_points",
  ];

  const completedRows = rows.filter((row) => row.completed);
  const sorted = completedRows.slice().sort((a, b) => a.sanctuaryAt - b.sanctuaryAt || b.openingScore - a.openingScore);
  for (const row of sorted.slice(0, 80)) {
    topLogs.push({
      ...row,
      events: row.events.map((event) => ({
        time: Number(event.time.toFixed(2)),
        actor: event.actor,
        text: event.text,
      })),
    });
  }

  const csv = [
    csvHeader.join(","),
    ...rows.map((row) => [
      row.caseId,
      row.speedLabel,
      row.speedFactor,
      row.trScheduleLabel,
      row.firstTr,
      row.firstTrCounts,
      row.trips,
      row.firstBrSortie,
      row.pairLabel,
      row.orderLabel,
      row.sanctuaryAt.toFixed(3),
      row.completed ? "yes" : "no",
      row.scoreAt180,
      row.towerScoreAt180,
      row.transferPointsAt180,
      row.openingScore,
      row.towerScore,
      row.transferPoints,
    ].map(csvEscape).join(",")),
  ].join("\n");

  const report = [
    "# ABU Robocon 2027 opening combination search",
    "",
    `- 対象: TR最大3個、BR最大2個で2本のタワーを完成させる開幕`,
    `- TR便数: 2から3便`,
    `- 必要搬送: Earth 4個 + Sky 2個`,
    `- 速度モデル: 最高速 ${ROBOT_MAX_SPEED_MPS}m/s、最高加速度 ${ROBOT_MAX_ACCEL_MPS2}m/s^2`,
    `- フィールド換算: ${FIELD_SIZE_METERS}m / viewBox 100`,
    `- BR認識停止: ${SCAN_SECONDS}s`,
    `- 全ケース: ${rows.length}`,
    `- 完走ケース: ${completedRows.length}`,
    `- 生成時刻: ${new Date().toISOString()}`,
    "",
    "## 全体トップ",
    "",
    ...sorted.slice(0, 20).map(rowLine),
    "",
    "## 速度別トップ",
    "",
    ...SPEED_CASES.flatMap((speed) => {
      const speedRows = sorted.filter((row) => row.speedLabel === speed.label).slice(0, 10);
      return [
      `### 赤速度 ${speed.label}`,
      ...sectionItems(speedRows, rowLine),
      "",
    ];
    }),
    "## 初手TR積み合わせの平均",
    "",
    ...SPEED_CASES.flatMap((speed) => {
      const groups = summarizeRows(rows.filter((row) => row.speedLabel === speed.label), (row) => row.firstTrCounts).slice(0, 12);
      return [
      `### 赤速度 ${speed.label}`,
      ...sectionItems(groups, groupLine),
      "",
    ];
    }),
    "## 初手TR積み順込みの平均",
    "",
    ...SPEED_CASES.flatMap((speed) => {
      const groups = summarizeRows(rows.filter((row) => row.speedLabel === speed.label), (row) => row.firstTr).slice(0, 12);
      return [
      `### 赤速度 ${speed.label}`,
      ...sectionItems(groups, groupLine),
      "",
    ];
    }),
    "## 初手BR持ち出しの平均",
    "",
    ...SPEED_CASES.flatMap((speed) => {
      const groups = summarizeRows(rows.filter((row) => row.speedLabel === speed.label), (row) => row.firstBrSortie).slice(0, 16);
      return [
      `### 赤速度 ${speed.label}`,
      ...sectionItems(groups, groupLine),
      "",
    ];
    }),
    "## 代表トップケースのログ",
    "",
    ...topLogs.slice(0, 5).flatMap((row) => [
      `### #${row.caseId}`,
      rowLine(row),
      "",
      ...row.events.map((event) => `- ${formatTime(event.time)} ${event.actor}: ${event.text}`),
      "",
    ]),
  ].join("\n");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "opening_combo_all.csv"), csv, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "opening_combo_top_logs.json"), JSON.stringify(topLogs, null, 2), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "opening_combo_report.md"), report, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "opening_combo_summary.json"), JSON.stringify({
    meta: {
      matchSeconds: MATCH_SECONDS,
      fieldSizeMeters: FIELD_SIZE_METERS,
      maxSpeedMps: ROBOT_MAX_SPEED_MPS,
      maxAccelMps2: ROBOT_MAX_ACCEL_MPS2,
      scanSeconds: SCAN_SECONDS,
      rows: rows.length,
      completedRows: completedRows.length,
      trSchedules: schedules.length,
      placementPlans: plans.length,
      generatedAt: new Date().toISOString(),
    },
    best: sorted.slice(0, 100).map(({ events, ...row }) => row),
    firstTrCounts: Object.fromEntries(SPEED_CASES.map((speed) => [
      speed.label,
      summarizeRows(rows.filter((row) => row.speedLabel === speed.label), (row) => row.firstTrCounts),
    ])),
    firstTr: Object.fromEntries(SPEED_CASES.map((speed) => [
      speed.label,
      summarizeRows(rows.filter((row) => row.speedLabel === speed.label), (row) => row.firstTr),
    ])),
    firstBrSortie: Object.fromEntries(SPEED_CASES.map((speed) => [
      speed.label,
      summarizeRows(rows.filter((row) => row.speedLabel === speed.label), (row) => row.firstBrSortie),
    ])),
  }, null, 2), "utf8");

  console.log(report);
}

run();
