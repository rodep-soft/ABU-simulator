"use strict";

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

const PICKUP_SECONDS = { earth: 2.4, sky: 2.4, mustika: 3.5 };
const TR_DROPOFF_SECONDS = { earth: 1.2, sky: 1.2, mustika: 1.8 };
const BR_PICKUP_SECONDS = { earth: 1.4, sky: 1.4, mustika: 2.0 };
const PLACE_SECONDS = { earth: 3.6, sky: 3.0, flipSky: 2.8, mustika: 5.0 };
const LEVEL_ORDER = { ground: 0, l1: 1, l2: 2 };
const LEVEL_BY_ORDER = ["ground", "l1", "l2"];

const POINTS = {
  red: {
    trHome: { x: 9.5, y: 95.5, level: "ground" },
    brStart: { x: 5.2, y: 95.5, level: "ground" },
    brScan: { x: 35, y: 75, level: "l1" },
    storage: { x: 10.5, y: 5.5, level: "ground" },
    transfer: { x: 22.5, y: 50, level: "l1" },
  },
  blue: {
    trHome: { x: 90.5, y: 95.5, level: "ground" },
    brStart: { x: 94.8, y: 95.5, level: "ground" },
    brScan: { x: 65, y: 75, level: "l1" },
    storage: { x: 89.5, y: 5.5, level: "ground" },
    transfer: { x: 77.5, y: 50, level: "l1" },
  },
  skyShare: { x: 50, y: 86, level: "ground" },
  mustikaSource: { x: 50, y: 12.3, level: "ground" },
  pillar: { x: 50, y: 50, level: "l2" },
};

const LEVEL_TRANSITIONS = {
  red: {
    groundL1: [
      {
        lower: { x: 16, y: 57, level: "ground" },
        upper: { x: 24, y: 57, level: "l1" },
        terrain: "ramp",
        stopSeconds: 0,
      },
      {
        lower: { x: 16, y: 72, level: "ground" },
        upper: { x: 24, y: 72, level: "l1" },
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
  blue: {
    groundL1: [
      {
        lower: { x: 84, y: 57, level: "ground" },
        upper: { x: 76, y: 57, level: "l1" },
        terrain: "ramp",
        stopSeconds: 0,
      },
      {
        lower: { x: 84, y: 72, level: "ground" },
        upper: { x: 76, y: 72, level: "l1" },
        terrain: "stair",
        stopSeconds: STAIR_STOP_SECONDS,
      },
    ],
    l1L2: [
      {
        lower: { x: 64.5, y: 50, level: "l1" },
        upper: { x: 60.5, y: 50, level: "l2" },
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
  { id: "b1", name: "青L1上", level: 1, shared: false, side: "blue", x: 73.8, y: 26.2 },
  { id: "b2", name: "青L1下", level: 1, shared: false, side: "blue", x: 73.8, y: 74.0 },
  { id: "l2a", name: "L2左上", level: 2, shared: true, x: 39.3, y: 39.0 },
  { id: "l2b", name: "L2右上", level: 2, shared: true, x: 60.8, y: 39.0 },
  { id: "l2c", name: "L2左下", level: 2, shared: true, x: 39.3, y: 61.3 },
  { id: "l2d", name: "L2右下", level: 2, shared: true, x: 60.8, y: 61.3 },
];

const SPOT_BY_ID = Object.fromEntries(SPOTS.map((spot) => [spot.id, spot]));

const els = {
  caseSelect: document.getElementById("case-select"),
  speedSelect: document.getElementById("speed-select"),
  blueResponseSelect: document.getElementById("blue-response-select"),
  playButton: document.getElementById("play-button"),
  timeSlider: document.getElementById("time-slider"),
  timeLabel: document.getElementById("time-label"),
  redScore: document.getElementById("red-score"),
  blueScore: document.getElementById("blue-score"),
  sanctuaryLabel: document.getElementById("sanctuary-label"),
  annotationLayer: document.getElementById("annotation-layer"),
  trailLayer: document.getElementById("trail-layer"),
  towerLayer: document.getElementById("tower-layer"),
  robotLayer: document.getElementById("robot-layer"),
  eventList: document.getElementById("event-list"),
  redTrCargo: document.getElementById("red-tr-cargo"),
  redBrCargo: document.getElementById("red-br-cargo"),
  blueTrCargo: document.getElementById("blue-tr-cargo"),
  blueBrCargo: document.getElementById("blue-br-cargo"),
  redTransfer: document.getElementById("red-transfer"),
  blueTransfer: document.getElementById("blue-transfer"),
  towerStateList: document.getElementById("tower-state-list"),
};

let replay = null;
let currentTime = 0;
let playing = false;
let lastFrame = 0;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function levelOf(point) {
  if (point.level === 2) return "l2";
  if (point.level === 1) return "l1";
  return point.level || "ground";
}

function scaled(seconds, speedFactor) {
  return seconds / Math.max(speedFactor, 0.05);
}

function terrainSpeedFactor(terrain) {
  if (terrain === "ramp") return RAMP_SPEED_FACTOR;
  if (terrain === "stair") return STAIR_SPEED_FACTOR;
  return 1;
}

function transitionsForLevelStep(teamId, fromLevel, toLevel) {
  if (
    (fromLevel === "ground" && toLevel === "l1") ||
    (fromLevel === "l1" && toLevel === "ground")
  ) {
    return LEVEL_TRANSITIONS[teamId].groundL1;
  }
  if (
    (fromLevel === "l1" && toLevel === "l2") ||
    (fromLevel === "l2" && toLevel === "l1")
  ) {
    return LEVEL_TRANSITIONS[teamId].l1L2;
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

function trGroundWaypoints(start, target, teamId) {
  const laneX = teamId === "red" ? 16 : 84;
  return cleanedWaypoints([
    { x: start.x, y: start.y, level: "ground" },
    { x: laneX, y: start.y, level: "ground" },
    { x: laneX, y: target.y, level: "ground" },
    { x: target.x, y: target.y, level: "ground" },
  ]);
}

function pushNormalRoute(route, from, to, teamId, actorRole) {
  if (actorRole === "TR" && levelOf(from) === "ground" && levelOf(to) === "ground") {
    const points = trGroundWaypoints(from, to, teamId);
    for (const point of points.slice(1)) {
      route.push({ to: point, terrain: "normal", stopSeconds: 0 });
    }
    return;
  }
  route.push({ to, terrain: "normal", stopSeconds: 0 });
}

function routeBetween(start, target, teamId, actorRole = null) {
  const targetLevel = levelOf(target);
  const route = [];
  let current = { x: start.x, y: start.y, level: levelOf(start) };

  while (current.level !== targetLevel) {
    const fromOrder = LEVEL_ORDER[current.level];
    const toOrder = LEVEL_ORDER[targetLevel];
    const nextLevel = LEVEL_BY_ORDER[fromOrder + Math.sign(toOrder - fromOrder)];
    const selected = transitionsForLevelStep(teamId, current.level, nextLevel)
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
    pushNormalRoute(route, current, selected.endpoints.entry, teamId, actorRole);
    route.push({
      to: selected.endpoints.exit,
      terrain: selected.transition.terrain,
      stopSeconds: selected.transition.stopSeconds,
    });
    current = selected.endpoints.exit;
  }

  pushNormalRoute(route, current, target, teamId, actorRole);
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

function interpolate(a, b, ratio) {
  return {
    x: a.x + (b.x - a.x) * ratio,
    y: a.y + (b.y - a.y) * ratio,
    level: ratio < 1 ? levelOf(a) : levelOf(b),
  };
}

function makeTrack(start) {
  return {
    phases: [],
    cursor: { time: 0, position: { ...start } },
  };
}

function addEvent(events, time, team, actor, text, extra = {}) {
  events.push({ time, team, actor, text, ...extra });
}

function addWait(track, seconds, label) {
  if (seconds <= 0) return;
  const from = { ...track.cursor.position };
  track.phases.push({
    kind: "wait",
    label,
    start: track.cursor.time,
    end: track.cursor.time + seconds,
    from,
    to: from,
  });
  track.cursor.time += seconds;
}

function waitUntil(track, targetTime, label) {
  if (track.cursor.time < targetTime) addWait(track, targetTime - track.cursor.time, label);
}

function addMove(track, target, teamId, speedFactor, label, actorRole = null) {
  let current = { ...track.cursor.position };
  for (const segment of routeBetween(current, target, teamId, actorRole)) {
    const distance = dist(current, segment.to);
    const duration = segmentMotionTime(distance, segment.terrain, speedFactor);
    if (duration > 0) {
      track.phases.push({
        kind: "move",
        label,
        terrain: segment.terrain,
        start: track.cursor.time,
        end: track.cursor.time + duration,
        from: { ...current },
        to: { ...segment.to },
      });
      track.cursor.time += duration;
    }
    current = { ...segment.to };
    track.cursor.position = { ...current };
    if (segment.stopSeconds > 0) addWait(track, scaled(segment.stopSeconds, speedFactor), "階段姿勢合わせ");
  }
}

function deliveryCount(deliveries, type, time) {
  return deliveries.filter((item) => item.type === type && item.time <= time).length;
}

function waitForCargo(track, deliveries, used, need, type, label) {
  if (!need) return;
  const targetIndex = used[type] + need - 1;
  const delivery = deliveries.filter((item) => item.type === type)[targetIndex];
  if (delivery && track.cursor.time < delivery.time) waitUntil(track, delivery.time, label);
}

function buildTr(teamId, trips, speedFactor, events) {
  const track = makeTrack(POINTS[teamId].trHome);
  const deliveries = [];

  trips.forEach((trip, tripIndex) => {
    trip.order.forEach((item) => {
      const count = trip[item] || 0;
      if (count <= 0) return;
      const source = item === "earth" ? POINTS[teamId].storage : POINTS.skyShare;
      addMove(track, source, teamId, speedFactor, `${item}へ移動`, "TR");
      addWait(track, scaled(PICKUP_SECONDS[item] * count, speedFactor), `${item}取得`);
      addEvent(events, track.cursor.time, teamId, "TR", `${tripIndex + 1}便目 ${labelItem(item)} ${count}個取得`, {
        inventory: `${teamId}Tr`,
        cargoDelta: { [item]: count },
      });
    });

    addMove(track, POINTS[teamId].transfer, teamId, speedFactor, "Transferへ移動", "TR");
    addWait(track, scaled(TR_DROPOFF_SECONDS.earth * trip.total, speedFactor), "受け渡し");
    for (let i = 0; i < (trip.earth || 0); i += 1) deliveries.push({ type: "earth", team: teamId, time: track.cursor.time });
    for (let i = 0; i < (trip.sky || 0); i += 1) deliveries.push({ type: "sky", team: teamId, time: track.cursor.time });
    addEvent(events, track.cursor.time, teamId, "TR", `${tripIndex + 1}便目 ${trip.label} をTransferへ搬送`, {
      inventory: `${teamId}Tr`,
      cargoDelta: { earth: -(trip.earth || 0), sky: -(trip.sky || 0) },
      transferTeam: teamId,
      transferDelta: { earth: trip.earth || 0, sky: trip.sky || 0 },
    });
  });

  return { track, deliveries };
}

function appendTrTrips(teamId, tr, trips, speedFactor, events, labelPrefix = "後半") {
  trips.forEach((trip, tripIndex) => {
    trip.order.forEach((item) => {
      const count = trip[item] || 0;
      if (count <= 0) return;
      const source = item === "earth" ? POINTS[teamId].storage : POINTS.skyShare;
      addMove(tr.track, source, teamId, speedFactor, `${item}へ移動`, "TR");
      addWait(tr.track, scaled(PICKUP_SECONDS[item] * count, speedFactor), `${item}取得`);
      addEvent(events, tr.track.cursor.time, teamId, "TR", `${labelPrefix}${tripIndex + 1}便目 ${labelItem(item)} ${count}個取得`, {
        inventory: `${teamId}Tr`,
        cargoDelta: { [item]: count },
      });
    });

    addMove(tr.track, POINTS[teamId].transfer, teamId, speedFactor, "Transferへ移動", "TR");
    addWait(tr.track, scaled(TR_DROPOFF_SECONDS.earth * trip.total, speedFactor), "受け渡し");
    for (let i = 0; i < (trip.earth || 0); i += 1) {
      tr.deliveries.push({ type: "earth", team: teamId, time: tr.track.cursor.time });
    }
    for (let i = 0; i < (trip.sky || 0); i += 1) {
      tr.deliveries.push({ type: "sky", team: teamId, time: tr.track.cursor.time });
    }
    addEvent(events, tr.track.cursor.time, teamId, "TR", `${labelPrefix}${tripIndex + 1}便目 ${trip.label} をTransferへ搬送`, {
      inventory: `${teamId}Tr`,
      cargoDelta: { earth: -(trip.earth || 0), sky: -(trip.sky || 0) },
      transferTeam: teamId,
      transferDelta: { earth: trip.earth || 0, sky: trip.sky || 0 },
    });
  });
}

function labelItem(item) {
  if (item === "earth") return "Earth";
  if (item === "sky") return "Sky";
  return "Mustika";
}

function stepNeed(sortie) {
  return sortie.reduce((acc, step) => {
    if (step.type === "earth") acc.earth += 1;
    if (step.type === "sky") acc.sky += 1;
    if (step.type === "mustika") acc.mustika += 1;
    return acc;
  }, { earth: 0, sky: 0, mustika: 0 });
}

function stepTarget(step) {
  if (step.type === "mustika") return POINTS.pillar;
  return SPOT_BY_ID[step.spotId];
}

function stepSeconds(step, speedFactor) {
  if (step.type === "earth") return scaled(PLACE_SECONDS.earth, speedFactor);
  if (step.type === "sky") return scaled(PLACE_SECONDS.sky, speedFactor);
  if (step.type === "flip") return scaled(PLACE_SECONDS.flipSky, speedFactor);
  if (step.type === "mustika") return scaled(PLACE_SECONDS.mustika, speedFactor);
  return 0;
}

function stepText(step) {
  if (step.type === "earth") return `${SPOT_BY_ID[step.spotId].name}:${step.layer === "earth1" ? "E1" : "E2"}`;
  if (step.type === "sky") return `${SPOT_BY_ID[step.spotId].name}:S`;
  if (step.type === "flip") return `${SPOT_BY_ID[step.spotId].name}:Sky反転`;
  if (step.type === "mustika") return "Mustika奉納";
  return step.type;
}

function buildBr(teamId, sorties, deliveries, speedFactor, events, options = {}) {
  const track = makeTrack(POINTS[teamId].brStart);
  const used = { earth: 0, sky: 0, mustika: 0 };
  if (options.startAt) waitUntil(track, options.startAt, "待機");

  sorties.forEach((sortie, sortieIndex) => {
    if (sortie.length === 0) return;
    addMove(track, POINTS[teamId].brScan, teamId, speedFactor, "Homeへ移動", "BR");
    addWait(track, scaled(SCAN_SECONDS, speedFactor), "ホーム認識");
    addEvent(events, track.cursor.time, teamId, "BR", `${sortieIndex + 1}回目 ホームで認識停止`);

    const need = stepNeed(sortie);
    const itemCount = need.earth + need.sky + need.mustika;
    if (itemCount > 0) {
      addMove(track, POINTS[teamId].transfer, teamId, speedFactor, "Transferへ移動", "BR");
      waitForCargo(track, deliveries, used, need.earth, "earth", "Earth待ち");
      waitForCargo(track, deliveries, used, need.sky, "sky", "Sky待ち");
      waitForCargo(track, deliveries, used, need.mustika, "mustika", "Mustika待ち");
      addWait(track, scaled(
        BR_PICKUP_SECONDS.earth * need.earth +
          BR_PICKUP_SECONDS.sky * need.sky +
          BR_PICKUP_SECONDS.mustika * need.mustika,
        speedFactor
      ), "受け取り");
      used.earth += need.earth;
      used.sky += need.sky;
      used.mustika += need.mustika;
      addEvent(events, track.cursor.time, teamId, "BR", `${sortieIndex + 1}回目 ${sortie.map(stepText).join(" / ")} を受け取り`, {
        inventory: `${teamId}Br`,
        cargoDelta: { earth: need.earth, sky: need.sky, mustika: need.mustika },
        transferTeam: teamId,
        transferDelta: { earth: -need.earth, sky: -need.sky, mustika: -need.mustika },
      });
    }

    sortie.forEach((step) => {
      addMove(track, stepTarget(step), teamId, speedFactor, `${stepText(step)}へ移動`, "BR");
      addWait(track, stepSeconds(step, speedFactor), stepText(step));
      addEvent(events, track.cursor.time, teamId, "BR", `${stepText(step)} 実行`, {
        action: step.type,
        spotId: step.spotId,
        layer: step.layer,
        inventory: step.type === "earth" || step.type === "sky" || step.type === "mustika" ? `${teamId}Br` : null,
        cargoDelta: step.type === "earth" ? { earth: -1 } : step.type === "sky" ? { sky: -1 } : step.type === "mustika" ? { mustika: -1 } : null,
      });
    });
  });

  return { track, used };
}

function addMustikaFlow(redTr, redBr, redDeliveries, speedFactor, events, sanctuaryAt) {
  if (!sanctuaryAt || sanctuaryAt > MATCH_SECONDS) return;

  addMove(redTr.track, POINTS.mustikaSource, "red", speedFactor, "Mustika前へ移動", "TR");
  waitUntil(redTr.track, sanctuaryAt, "Sanctuary待ち");
  addWait(redTr.track, scaled(PICKUP_SECONDS.mustika, speedFactor), "Mustika取得");
  addEvent(events, redTr.track.cursor.time, "red", "TR", "Mustika取得", {
    inventory: "redTr",
    cargoDelta: { mustika: 1 },
  });
  addMove(redTr.track, POINTS.red.transfer, "red", speedFactor, "MustikaをTransferへ移動", "TR");
  addWait(redTr.track, scaled(TR_DROPOFF_SECONDS.mustika, speedFactor), "Mustika受け渡し");
  redDeliveries.push({ type: "mustika", team: "red", time: redTr.track.cursor.time });
  addEvent(events, redTr.track.cursor.time, "red", "TR", "MustikaをTransferへ搬送", {
    inventory: "redTr",
    cargoDelta: { mustika: -1 },
    transferTeam: "red",
    transferDelta: { mustika: 1 },
  });

  waitUntil(redBr.track, sanctuaryAt, "Sanctuary待ち");
  addMove(redBr.track, POINTS.red.brScan, "red", speedFactor, "Homeへ移動", "BR");
  addWait(redBr.track, scaled(SCAN_SECONDS, speedFactor), "ホーム認識");
  addMove(redBr.track, POINTS.red.transfer, "red", speedFactor, "Transferへ移動", "BR");
  waitForCargo(redBr.track, redDeliveries, redBr.used, 1, "mustika", "Mustika待ち");
  addWait(redBr.track, scaled(BR_PICKUP_SECONDS.mustika, speedFactor), "Mustika受け取り");
  redBr.used.mustika += 1;
  addEvent(events, redBr.track.cursor.time, "red", "BR", "Mustika受け取り", {
    inventory: "redBr",
    cargoDelta: { mustika: 1 },
    transferTeam: "red",
    transferDelta: { mustika: -1 },
  });
  addMove(redBr.track, POINTS.pillar, "red", speedFactor, "中央柱へ移動", "BR");
  addWait(redBr.track, scaled(PLACE_SECONDS.mustika, speedFactor), "Mustika奉納");
  addEvent(events, redBr.track.cursor.time, "red", "BR", "Mustika奉納", {
    action: "mustika",
    inventory: "redBr",
    cargoDelta: { mustika: -1 },
  });
}

function postMustikaPlan() {
  return {
    trips: [
      mixedTrip(2, 1, ["earth", "sky"]),
      mixedTrip(2, 1, ["earth", "sky"]),
    ],
    sorties: [
      [
        { type: "earth", spotId: "l2c", layer: "earth1" },
        { type: "earth", spotId: "l2c", layer: "earth2" },
      ],
      [
        { type: "sky", spotId: "l2c" },
        { type: "earth", spotId: "l2a", layer: "earth1" },
      ],
      [
        { type: "earth", spotId: "l2a", layer: "earth2" },
        { type: "sky", spotId: "l2a" },
      ],
    ],
  };
}

function blueLatePlan() {
  return {
    trips: [
      mixedTrip(2, 1, ["earth", "sky"]),
      mixedTrip(2, 1, ["earth", "sky"]),
    ],
    sorties: [
      [
        { type: "earth", spotId: "l2d", layer: "earth1" },
        { type: "earth", spotId: "l2d", layer: "earth2" },
      ],
      [
        { type: "sky", spotId: "l2d" },
        { type: "earth", spotId: "l2b", layer: "earth1" },
      ],
      [
        { type: "earth", spotId: "l2b", layer: "earth2" },
        { type: "sky", spotId: "l2b" },
      ],
    ],
  };
}

function addPostMustikaContinuation(redTr, redBr, speedFactor, events) {
  const mustikaAt = eventTime(events, "red", "BR", "Mustika奉納");
  if (!mustikaAt || mustikaAt >= MATCH_SECONDS) return;
  const plan = postMustikaPlan();
  appendTrTrips("red", redTr, plan.trips, speedFactor, events, "Mustika後");
  buildBrContinuation("red", redBr, plan.sorties, redTr.deliveries, speedFactor, events, "Mustika後");
}

function addBlueContinuation(blueTr, blueBr, events) {
  if (!blueTr || !blueBr) return;
  const plan = blueLatePlan();
  appendTrTrips("blue", blueTr, plan.trips, 1, events, "青後半");
  buildBrContinuation("blue", blueBr, plan.sorties, blueTr.deliveries, 1, events, "青後半");
}

function earthTrip(count) {
  return { earth: count, sky: 0, total: count, order: ["earth"], label: `E${count}` };
}

function skyTrip(count) {
  return { earth: 0, sky: count, total: count, order: ["sky"], label: `S${count}` };
}

function mixedTrip(earth, sky, order) {
  return {
    earth,
    sky,
    total: earth + sky,
    order,
    label: `E${earth}+S${sky}/${order.map((item) => item === "earth" ? "E" : "S").join(">")}`,
  };
}

function buildBlueIgnore(events) {
  const blueTr = buildTr("blue", [
    earthTrip(3),
    mixedTrip(1, 2, ["sky", "earth"]),
  ], 1, events);
  const blueBr = buildBr("blue", [
    [
      { type: "earth", spotId: "l1sA", layer: "earth1" },
      { type: "earth", spotId: "b1", layer: "earth1" },
    ],
    [
      { type: "earth", spotId: "b1", layer: "earth2" },
      { type: "sky", spotId: "b1" },
    ],
    [
      { type: "earth", spotId: "l1sA", layer: "earth2" },
      { type: "sky", spotId: "l1sA" },
    ],
  ], blueTr.deliveries, 1, events);
  return { blueTr, blueBr };
}

function buildStableSelf(redSpeed, blueResponse = "ignore") {
  const events = [];
  const redTr = buildTr("red", [
    earthTrip(3),
    mixedTrip(1, 2, ["sky", "earth"]),
  ], redSpeed, events);
  const firstTwoSorties = [
    [
      { type: "earth", spotId: "l1sB", layer: "earth1" },
      { type: "earth", spotId: "r2", layer: "earth1" },
    ],
    [
      { type: "earth", spotId: "r2", layer: "earth2" },
      { type: "sky", spotId: "r2" },
    ],
  ];
  const selfFinishSortie = [
    [
      { type: "earth", spotId: "l1sB", layer: "earth2" },
      { type: "sky", spotId: "l1sB" },
    ],
  ];

  let blueTr = null;
  let blueBr = null;
  let redBr = null;
  let sanctuaryAt = null;

  if (blueResponse === "join") {
    redBr = buildBr("red", firstTwoSorties, redTr.deliveries, redSpeed, events);
    const sharedE1At = eventTime(events, "red", "BR", "L1共有下:E1 実行");
    blueTr = buildTr("blue", [
      skyTrip(1),
      earthTrip(1),
    ], 1, events);
    blueBr = buildBr("blue", [[
      { type: "earth", spotId: "l1sB", layer: "earth2" },
      { type: "sky", spotId: "l1sB" },
    ]], blueTr.deliveries, 1, events, { startAt: sharedE1At + SCAN_SECONDS });
    waitUntil(redBr.track, Math.max(redBr.track.cursor.time, eventTime(events, "blue", "BR", "L1共有下:S 実行")), "反転待ち");
    buildBrContinuation("red", redBr, [[{ type: "flip", spotId: "l1sB" }]], redTr.deliveries, redSpeed, events);
    sanctuaryAt = eventTime(events, "red", "BR", "L1共有下:Sky反転 実行");
  } else {
    redBr = buildBr("red", [...firstTwoSorties, ...selfFinishSortie], redTr.deliveries, redSpeed, events);
    const blue = buildBlueIgnore(events);
    blueTr = blue.blueTr;
    blueBr = blue.blueBr;
    sanctuaryAt = eventTime(events, "red", "BR", "L1共有下:S 実行");
  }

  addEvent(events, sanctuaryAt, "red", "BR", "Sanctuary Mandate 達成");
  addMustikaFlow(redTr, redBr, redTr.deliveries, redSpeed, events, sanctuaryAt);
  addPostMustikaContinuation(redTr, redBr, redSpeed, events);
  addBlueContinuation(blueTr, blueBr, events);
  const title = blueResponse === "join"
    ? "E3 -> E1+S2 / 青が共有に乗ってくる"
    : "E3 -> E1+S2 / 青が乗ってこない";
  return finishReplay(title, redTr, redBr, blueTr, blueBr, events);
}

function buildFlipTrap(redSpeed) {
  const events = [];
  const redTr = buildTr("red", [
    earthTrip(2),
    mixedTrip(1, 1, ["earth", "sky"]),
  ], redSpeed, events);
  const blueTr = buildTr("blue", [
    skyTrip(1),
    earthTrip(1),
  ], 1, events);

  const redFirstSorties = [
    [
      { type: "earth", spotId: "l1sB", layer: "earth1" },
      { type: "earth", spotId: "r2", layer: "earth1" },
    ],
    [
      { type: "earth", spotId: "r2", layer: "earth2" },
      { type: "sky", spotId: "r2" },
    ],
  ];
  const redBr = buildBr("red", redFirstSorties, redTr.deliveries, redSpeed, events);
  const sharedE1At = eventTime(events, "red", "BR", "L1共有下:E1 実行");
  const blueBr = buildBr("blue", [[
    { type: "earth", spotId: "l1sB", layer: "earth2" },
    { type: "sky", spotId: "l1sB" },
  ]], blueTr.deliveries, 1, events, { startAt: sharedE1At + SCAN_SECONDS });
  waitUntil(redBr.track, Math.max(redBr.track.cursor.time, eventTime(events, "blue", "BR", "L1共有下:S 実行")), "反転待ち");
  buildBrContinuation("red", redBr, [[{ type: "flip", spotId: "l1sB" }]], redTr.deliveries, redSpeed, events);
  const sanctuaryAt = eventTime(events, "red", "BR", "L1共有下:Sky反転 実行");
  addEvent(events, sanctuaryAt, "red", "BR", "Sanctuary Mandate 達成");
  addMustikaFlow(redTr, redBr, redTr.deliveries, redSpeed, events, sanctuaryAt);
  addPostMustikaContinuation(redTr, redBr, redSpeed, events);
  addBlueContinuation(blueTr, blueBr, events);
  return finishReplay("E2 -> E1+S1 共有餌からSky反転", redTr, redBr, blueTr, blueBr, events);
}

function buildPoach(redSpeed) {
  const events = [];
  const redTr = buildTr("red", [
    mixedTrip(1, 1, ["earth", "sky"]),
    earthTrip(1),
    mixedTrip(1, 1, ["earth", "sky"]),
  ], redSpeed, events);
  const blueTr = buildTr("blue", [earthTrip(1)], 1, events);
  const blueBr = buildBr("blue", [[{ type: "earth", spotId: "l1sB", layer: "earth1" }]], blueTr.deliveries, 1, events);
  const blueE1At = eventTime(events, "blue", "BR", "L1共有下:E1 実行");
  const redBr = buildBr("red", [
    [
      { type: "earth", spotId: "l1sB", layer: "earth2" },
      { type: "sky", spotId: "l1sB" },
    ],
    [{ type: "earth", spotId: "r2", layer: "earth1" }],
    [
      { type: "earth", spotId: "r2", layer: "earth2" },
      { type: "sky", spotId: "r2" },
    ],
  ], redTr.deliveries, redSpeed, events, { startAt: blueE1At + scaled(SCAN_SECONDS, redSpeed) });
  const sanctuaryAt = eventTime(events, "red", "BR", "赤L1下:S 実行");
  addEvent(events, sanctuaryAt, "red", "BR", "Sanctuary Mandate 達成");
  addMustikaFlow(redTr, redBr, redTr.deliveries, redSpeed, events, sanctuaryAt);
  addPostMustikaContinuation(redTr, redBr, redSpeed, events);
  addBlueContinuation(blueTr, blueBr, events);
  return finishReplay("相手1段目をE+Sで漁夫完成", redTr, redBr, blueTr, blueBr, events);
}

function buildBrContinuation(teamId, br, sorties, deliveries, speedFactor, events, labelPrefix = "追加") {
  sorties.forEach((sortie, index) => {
    addMove(br.track, POINTS[teamId].brScan, teamId, speedFactor, "Homeへ移動", "BR");
    addWait(br.track, scaled(SCAN_SECONDS, speedFactor), "ホーム認識");
    addEvent(events, br.track.cursor.time, teamId, "BR", `${labelPrefix}${index + 1}回目 ホームで認識停止`);

    const need = stepNeed(sortie);
    const itemCount = need.earth + need.sky + need.mustika;
    if (itemCount > 0) {
      addMove(br.track, POINTS[teamId].transfer, teamId, speedFactor, "Transferへ移動", "BR");
      waitForCargo(br.track, deliveries, br.used, need.earth, "earth", "Earth待ち");
      waitForCargo(br.track, deliveries, br.used, need.sky, "sky", "Sky待ち");
      waitForCargo(br.track, deliveries, br.used, need.mustika, "mustika", "Mustika待ち");
      addWait(br.track, scaled(
        BR_PICKUP_SECONDS.earth * need.earth +
          BR_PICKUP_SECONDS.sky * need.sky +
          BR_PICKUP_SECONDS.mustika * need.mustika,
        speedFactor
      ), "受け取り");
      br.used.earth += need.earth;
      br.used.sky += need.sky;
      br.used.mustika += need.mustika;
      addEvent(events, br.track.cursor.time, teamId, "BR", `${labelPrefix}${index + 1}回目 ${sortie.map(stepText).join(" / ")} を受け取り`, {
        inventory: `${teamId}Br`,
        cargoDelta: { earth: need.earth, sky: need.sky, mustika: need.mustika },
        transferTeam: teamId,
        transferDelta: { earth: -need.earth, sky: -need.sky, mustika: -need.mustika },
      });
    }

    sortie.forEach((step) => {
      addMove(br.track, stepTarget(step), teamId, speedFactor, `${stepText(step)}へ移動`, "BR");
      addWait(br.track, stepSeconds(step, speedFactor), stepText(step));
      addEvent(events, br.track.cursor.time, teamId, "BR", `${stepText(step)} 実行`, {
        action: step.type,
        spotId: step.spotId,
        layer: step.layer,
        inventory: step.type === "earth" || step.type === "sky" || step.type === "mustika" ? `${teamId}Br` : null,
        cargoDelta: step.type === "earth" ? { earth: -1 } : step.type === "sky" ? { sky: -1 } : step.type === "mustika" ? { mustika: -1 } : null,
      });
    });
  });
}

function eventTime(events, team, actor, text) {
  const event = events.find((item) => item.team === team && item.actor === actor && item.text === text);
  return event ? event.time : null;
}

function finishReplay(title, redTr, redBr, blueTr, blueBr, events) {
  const tracks = {
    redTr: redTr.track,
    redBr: redBr.track,
    blueTr: blueTr ? blueTr.track : makeTrack(POINTS.blue.trHome),
    blueBr: blueBr ? blueBr.track : makeTrack(POINTS.blue.brStart),
  };
  return {
    title,
    tracks,
    events: events
      .filter((event) => event.time != null && Number.isFinite(event.time))
      .sort((a, b) => a.time - b.time || teamOrder(a.team) - teamOrder(b.team)),
  };
}

function teamOrder(team) {
  return team === "red" ? 0 : 1;
}

function phasePosition(phase, time) {
  if (!phase) return null;
  if (phase.kind === "wait") return phase.from;
  const ratio = Math.max(0, Math.min(1, (time - phase.start) / (phase.end - phase.start)));
  return interpolate(phase.from, phase.to, ratio);
}

function positionAt(track, time) {
  let last = track.phases[0]?.from || track.cursor.position;
  for (const phase of track.phases) {
    if (time < phase.start) return last;
    if (time <= phase.end) return phasePosition(phase, time);
    last = phase.to;
  }
  return last;
}

function sampleTrail(track, time) {
  const points = [];
  for (let t = 0; t <= Math.min(time, MATCH_SECONDS); t += 1.2) {
    points.push(positionAt(track, t));
  }
  points.push(positionAt(track, time));
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

function emptyTowers() {
  return Object.fromEntries(SPOTS.map((spot) => [spot.id, {
    earth1: null,
    earth2: null,
    skyColor: null,
  }]));
}

function layerPoints(spotId) {
  const level = SPOT_BY_ID[spotId].level;
  return {
    earth1: level === 1 ? 10 : 20,
    earth2: level === 1 ? 20 : 40,
    sky: level === 1 ? 40 : 80,
  };
}

function stateAt(time) {
  const towers = emptyTowers();
  const cargo = {
    redTr: { earth: 0, sky: 0, mustika: 0 },
    redBr: { earth: 0, sky: 0, mustika: 0 },
    blueTr: { earth: 0, sky: 0, mustika: 0 },
    blueBr: { earth: 0, sky: 0, mustika: 0 },
  };
  const transfer = {
    red: { earth: 0, sky: 0, mustika: 0 },
    blue: { earth: 0, sky: 0, mustika: 0 },
  };
  const score = {
    red: { transfer: 0, tower: 0, mustika: 0, total: 0 },
    blue: { transfer: 0, tower: 0, mustika: 0, total: 0 },
  };
  let sanctuary = false;

  for (const event of replay.events) {
    if (event.time > time) break;
    if (event.inventory && event.cargoDelta) {
      for (const [item, delta] of Object.entries(event.cargoDelta)) {
        cargo[event.inventory][item] += delta;
      }
    }
    if (event.transferTeam && event.transferDelta) {
      for (const [item, delta] of Object.entries(event.transferDelta)) {
        transfer[event.transferTeam][item] += delta;
      }
    }
    if (event.action === "earth") towers[event.spotId][event.layer] = event.team;
    if (event.action === "sky") towers[event.spotId].skyColor = event.team;
    if (event.action === "flip") towers[event.spotId].skyColor = event.team;
    if (event.action === "mustika") score[event.team].mustika = 250;
    if (event.text === "Sanctuary Mandate 達成" && event.team === "red") sanctuary = true;
    if (event.actor === "TR" && event.text.includes("Transferへ搬送")) {
      if (event.text.includes("Mustika")) {
        // Mustika has no transfer point in this model.
      } else {
        const match = event.text.match(/E(\d+)/);
        const skyMatch = event.text.match(/S(\d+)/);
        const count = (match ? Number(match[1]) : 0) + (skyMatch ? Number(skyMatch[1]) : 0);
        score[event.team].transfer += count * 5;
      }
    }
  }

  for (const spot of SPOTS) {
    const tower = towers[spot.id];
    const points = layerPoints(spot.id);
    if (tower.earth1) score[tower.earth1].tower += points.earth1;
    if (tower.earth2) score[tower.earth2].tower += points.earth2;
    if (tower.earth1 && tower.earth2 && tower.skyColor) score[tower.skyColor].tower += points.sky;
  }
  for (const team of ["red", "blue"]) {
    score[team].total = score[team].transfer + score[team].tower + score[team].mustika;
  }
  return { towers, cargo, transfer, score, sanctuary };
}

function render() {
  els.timeLabel.textContent = `${currentTime.toFixed(1)}s`;
  els.timeSlider.value = String(currentTime);

  const matchState = stateAt(currentTime);
  els.redScore.textContent = String(matchState.score.red.total);
  els.blueScore.textContent = String(matchState.score.blue.total);
  els.sanctuaryLabel.textContent = matchState.sanctuary ? "達成" : "未達";

  renderAnnotations(matchState);
  renderTrails();
  renderTowers(matchState.towers);
  renderRobots(matchState);
  renderStatePanel(matchState);
  renderEvents();
}

function svgText(parent, x, y, text, className, anchor = "middle") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("class", className);
  el.setAttribute("text-anchor", anchor);
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function svgRect(parent, x, y, width, height, className) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("width", String(width));
  el.setAttribute("height", String(height));
  el.setAttribute("rx", "0.7");
  el.setAttribute("class", className);
  parent.appendChild(el);
  return el;
}

function renderAnnotations(matchState) {
  els.annotationLayer.innerHTML = "";
  const labels = [
    [POINTS.red.trHome.x, POINTS.red.trHome.y + 4.5, "赤TR Start"],
    [POINTS.red.brStart.x + 3.5, POINTS.red.brStart.y + 4.5, "赤BR Start"],
    [POINTS.blue.trHome.x, POINTS.blue.trHome.y + 4.5, "青TR Start"],
    [POINTS.blue.brStart.x - 3.5, POINTS.blue.brStart.y + 4.5, "青BR Start"],
    [POINTS.red.storage.x, POINTS.red.storage.y - 2.6, "赤Earth"],
    [POINTS.blue.storage.x, POINTS.blue.storage.y - 2.6, "青Earth"],
    [POINTS.skyShare.x, POINTS.skyShare.y + 4.4, "Sky"],
    [POINTS.mustikaSource.x, POINTS.mustikaSource.y - 3.2, "Mustika"],
  ];
  labels.forEach(([x, y, text]) => svgText(els.annotationLayer, x, y, text, "field-label"));

  renderTransferLabel("red", POINTS.red.transfer, matchState.transfer.red);
  renderTransferLabel("blue", POINTS.blue.transfer, matchState.transfer.blue);
}

function renderTransferLabel(team, point, counts) {
  const text = `Transfer E${counts.earth}/S${counts.sky}/M${counts.mustika}`;
  const width = Math.max(15, text.length * 1.35);
  const x = team === "red" ? point.x - 2 : point.x + 2;
  const anchor = team === "red" ? "start" : "end";
  svgRect(els.annotationLayer, team === "red" ? x - 1 : x - width + 1, point.y - 5.5, width, 4.1, "field-marker");
  svgText(els.annotationLayer, x, point.y - 2.8, text, "transfer-label", anchor);
}

function renderTrails() {
  els.trailLayer.innerHTML = "";
  for (const [id, className] of [
    ["redTr", "red-tr"],
    ["redBr", "red-br"],
    ["blueTr", "blue-tr"],
    ["blueBr", "blue-br"],
  ]) {
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("class", `trail ${className}`);
    polyline.setAttribute("points", sampleTrail(replay.tracks[id], currentTime));
    els.trailLayer.appendChild(polyline);
  }
}

function renderTowers(towers) {
  els.towerLayer.innerHTML = "";
  for (const spot of SPOTS) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("transform", `translate(${spot.x - 2.1} ${spot.y - 2.1})`);
    const tower = towers[spot.id];
    const layers = [
      ["earth1", tower.earth1],
      ["earth2", tower.earth2],
      ["sky", tower.skyColor],
    ];
    layers.forEach(([layer, owner], index) => {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(index * 1.45));
      rect.setAttribute("y", "0");
      rect.setAttribute("width", "1.25");
      rect.setAttribute("height", "4.2");
      rect.setAttribute("class", `tower-slot ${owner ? `block-${owner}` : "block-empty"}`);
      group.appendChild(rect);
    });
    const label = towerText(tower);
    if (label) {
      svgText(group, 2.1, 6.3, label.replaceAll("赤", "R").replaceAll("青", "B"), "tower-label");
    }
    els.towerLayer.appendChild(group);
  }

  const mustika = replay.events.find((event) => event.action === "mustika" && event.time <= currentTime);
  if (mustika) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "50");
    circle.setAttribute("cy", "50");
    circle.setAttribute("r", "1.2");
    circle.setAttribute("class", "mustika");
    els.towerLayer.appendChild(circle);
  }
}

function cargoText(cargo) {
  const text = `E${Math.max(0, cargo.earth)}/S${Math.max(0, cargo.sky)}/M${Math.max(0, cargo.mustika)}`;
  if (cargo.earth === 0 && cargo.sky === 0 && cargo.mustika === 0) return "空";
  return text;
}

function countText(counts) {
  return `E${Math.max(0, counts.earth)}/S${Math.max(0, counts.sky)}/M${Math.max(0, counts.mustika)}`;
}

function renderRobots(matchState) {
  els.robotLayer.innerHTML = "";
  const robots = [
    ["redTr", "red", "TR", "#d71920", 1.65],
    ["redBr", "red", "BR", "#94161d", 2.05],
    ["blueTr", "blue", "TR", "#0b37c8", 1.65],
    ["blueBr", "blue", "BR", "#0b238f", 2.05],
  ];
  robots.forEach(([id, team, label, fill, radius]) => {
    const point = positionAt(replay.tracks[id], currentTime);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(point.x));
    circle.setAttribute("cy", String(point.y));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("class", "robot");
    circle.setAttribute("fill", fill);
    els.robotLayer.appendChild(circle);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(point.x));
    text.setAttribute("y", String(point.y + 0.04));
    text.setAttribute("class", "robot-label");
    text.textContent = team === "red" ? `R${label}` : `B${label}`;
    els.robotLayer.appendChild(text);

    const cargo = cargoText(matchState.cargo[id]);
    const tagWidth = cargo === "空" ? 5.2 : 11.2;
    const tagX = Math.min(97, Math.max(3, point.x + radius + 0.8));
    const tagY = Math.min(98, Math.max(3, point.y - radius - 3.4));
    svgRect(els.robotLayer, tagX - 0.7, tagY - 2.55, tagWidth, 3.6, "field-marker");
    svgText(els.robotLayer, tagX, tagY, cargo, "cargo-label", "start");
  });
}

function towerText(tower) {
  const parts = [];
  if (tower.earth1) parts.push(`E1:${tower.earth1 === "red" ? "赤" : "青"}`);
  if (tower.earth2) parts.push(`E2:${tower.earth2 === "red" ? "赤" : "青"}`);
  if (tower.skyColor) parts.push(`S:${tower.skyColor === "red" ? "赤" : "青"}`);
  return parts.join(" / ");
}

function renderStatePanel(matchState) {
  els.redTrCargo.textContent = cargoText(matchState.cargo.redTr);
  els.redBrCargo.textContent = cargoText(matchState.cargo.redBr);
  els.blueTrCargo.textContent = cargoText(matchState.cargo.blueTr);
  els.blueBrCargo.textContent = cargoText(matchState.cargo.blueBr);
  els.redTransfer.textContent = countText(matchState.transfer.red);
  els.blueTransfer.textContent = countText(matchState.transfer.blue);

  els.towerStateList.innerHTML = "";
  const active = SPOTS
    .map((spot) => ({ spot, text: towerText(matchState.towers[spot.id]) }))
    .filter((item) => item.text);

  if (active.length === 0) {
    const li = document.createElement("li");
    li.textContent = "まだ配置なし";
    els.towerStateList.appendChild(li);
    return;
  }

  for (const item of active) {
    const li = document.createElement("li");
    li.textContent = `${item.spot.name}: ${item.text}`;
    els.towerStateList.appendChild(li);
  }
}

function renderEvents() {
  els.eventList.innerHTML = "";
  const visible = replay.events.filter((event) => event.time <= Math.max(currentTime, 0.1));
  for (const event of replay.events) {
    const li = document.createElement("li");
    if (visible.includes(event)) li.className = "active";
    li.textContent = `${event.time.toFixed(1)}s ${event.team === "red" ? "赤" : "青"}${event.actor}: ${event.text}`;
    els.eventList.appendChild(li);
  }
}

function rebuild() {
  const speed = Number(els.speedSelect.value);
  const blueResponse = els.blueResponseSelect.value;
  if (els.caseSelect.value === "flip-trap") replay = buildFlipTrap(speed);
  else if (els.caseSelect.value === "poach") replay = buildPoach(speed);
  else replay = buildStableSelf(speed, blueResponse);
  currentTime = 0;
  playing = false;
  els.playButton.textContent = "再生";
  render();
}

function tick(timestamp) {
  if (!lastFrame) lastFrame = timestamp;
  const dt = (timestamp - lastFrame) / 1000;
  lastFrame = timestamp;
  if (playing) {
    currentTime = Math.min(MATCH_SECONDS, currentTime + dt * 3);
    if (currentTime >= MATCH_SECONDS) {
      playing = false;
      els.playButton.textContent = "再生";
    }
    render();
  }
  requestAnimationFrame(tick);
}

els.playButton.addEventListener("click", () => {
  playing = !playing;
  els.playButton.textContent = playing ? "停止" : "再生";
});

els.timeSlider.addEventListener("input", () => {
  currentTime = Number(els.timeSlider.value);
  render();
});

els.caseSelect.addEventListener("change", rebuild);
els.speedSelect.addEventListener("change", rebuild);
els.blueResponseSelect.addEventListener("change", rebuild);

rebuild();
requestAnimationFrame(tick);
