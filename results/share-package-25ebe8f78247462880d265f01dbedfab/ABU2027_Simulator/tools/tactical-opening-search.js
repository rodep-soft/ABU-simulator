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

const PICKUP_SECONDS = { earth: 2.4, sky: 2.4, mustika: 3.5 };
const TR_DROPOFF_SECONDS_PER_ITEM = { earth: 1.2, sky: 1.2, mustika: 1.8 };
const BR_PICKUP_SECONDS_PER_ITEM = { earth: 1.4, sky: 1.4, mustika: 2.0 };
const PLACE_SECONDS = { earth: 3.6, sky: 3.0, flipSky: 2.8, mustika: 5.0 };
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
  blue: {
    trHome: { id: "blue-tr-home", x: 90.5, y: 95.5, level: "ground" },
    brStart: { id: "blue-br-start", x: 94.8, y: 95.5, level: "ground" },
    brHome: { id: "blue-br-home", x: 65, y: 75, level: "l1" },
    storage: { id: "blue-earth", x: 89.5, y: 5.5, level: "ground" },
    transfer: { id: "blue-transfer", x: 77.5, y: 50, level: "l1" },
  },
  skyShare: { id: "sky-share", x: 50, y: 86, level: "ground" },
  mustikaSource: { id: "mustika-source", x: 50, y: 12.3, level: "ground" },
  pillar: { id: "pillar", x: 50, y: 50, level: "l2" },
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
  blue: {
    groundL1: [
      {
        lower: { x: 84.0, y: 57.0, level: "ground" },
        upper: { x: 76.0, y: 57.0, level: "l1" },
        terrain: "ramp",
        stopSeconds: 0,
      },
      {
        lower: { x: 84.0, y: 72.0, level: "ground" },
        upper: { x: 76.0, y: 72.0, level: "l1" },
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
const SHARED_SPOTS = ["l1sA", "l1sB", "l2a", "l2b", "l2c", "l2d"];
const RED_OWN_SPOTS = ["r1", "r2"];

const SPEED_CASES = [
  { label: "同等", redFactor: 1, blueFactor: 1 },
  { label: "3/4", redFactor: 0.75, blueFactor: 1 },
  { label: "1/2", redFactor: 0.5, blueFactor: 1 },
  { label: "1/4", redFactor: 0.25, blueFactor: 1 },
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
    for (const point of trGroundWaypoints(from, to, teamId).slice(1)) {
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

function travelTime(start, target, teamId, speedFactor, actorRole = null) {
  let time = 0;
  let current = start;
  for (const segment of routeBetween(start, target, teamId, actorRole)) {
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

function countLabel(counts) {
  const parts = [];
  if (counts.earth) parts.push(`E${counts.earth}`);
  if (counts.sky) parts.push(`S${counts.sky}`);
  return parts.join("+") || "none";
}

function cargoLabel(cargo) {
  const base = countLabel(cargo);
  if (cargo.earth > 0 && cargo.sky > 0) {
    return `${base}/${cargo.order.map((item) => item === "earth" ? "E" : "S").join(">")}`;
  }
  return base;
}

function cargoOptions(maxItems = 3) {
  const options = [];
  for (let earth = 0; earth <= maxItems; earth += 1) {
    for (let sky = 0; sky <= maxItems; sky += 1) {
      const total = earth + sky;
      if (total < 1 || total > maxItems) continue;
      const orders = [];
      if (earth > 0 && sky > 0) {
        orders.push(["earth", "sky"], ["sky", "earth"]);
      } else if (earth > 0) {
        orders.push(["earth"]);
      } else {
        orders.push(["sky"]);
      }
      for (const order of orders) {
        options.push({ earth, sky, total, order, label: null });
      }
    }
  }
  return options.map((option) => ({ ...option, label: cargoLabel(option) }));
}

function trSchedulesFor(earthNeed, skyNeed, maxTrips = 3) {
  const options = cargoOptions(3);
  const schedules = [];

  function dfs(trips, earth, sky) {
    if (earth === earthNeed && sky === skyNeed) {
      schedules.push({
        trips: trips.map((trip) => ({ ...trip })),
        label: trips.map((trip, index) => `${index + 1}:${trip.label}`).join(" | "),
        firstLabel: trips[0]?.label ?? "none",
        firstCountLabel: trips[0] ? countLabel(trips[0]) : "none",
      });
      return;
    }
    if (trips.length >= maxTrips || earth > earthNeed || sky > skyNeed) return;
    for (const option of options) {
      dfs([...trips, option], earth + option.earth, sky + option.sky);
    }
  }

  dfs([], 0, 0);
  return schedules;
}

function simulateTr(teamId, schedule, speedFactor) {
  let time = 0;
  let position = POINTS[teamId].trHome;
  const deliveries = [];
  const events = [];

  for (const [tripIndex, trip] of schedule.trips.entries()) {
    for (const item of trip.order) {
      const count = trip[item];
      if (count <= 0) continue;
      const source = item === "earth" ? POINTS[teamId].storage : POINTS.skyShare;
      time += travelTime(position, source, teamId, speedFactor, "TR");
      time += scaled(PICKUP_SECONDS[item] * count, speedFactor);
      events.push({
        time,
        team: teamId,
        actor: "TR",
        type: "pickup",
        text: `${tripIndex + 1}便目 ${item === "earth" ? "Earth" : "Sky"}を${count}個取得`,
      });
      position = source;
    }

    time += travelTime(position, POINTS[teamId].transfer, teamId, speedFactor, "TR");
    time += scaled(TR_DROPOFF_SECONDS_PER_ITEM.earth * trip.total, speedFactor);

    for (let i = 0; i < trip.earth; i += 1) deliveries.push({ time, team: teamId, type: "earth" });
    for (let i = 0; i < trip.sky; i += 1) deliveries.push({ time, team: teamId, type: "sky" });
    events.push({
      time,
      team: teamId,
      actor: "TR",
      type: "deliver",
      text: `${tripIndex + 1}便目 ${trip.label} をTransferへ搬送`,
    });
    position = POINTS[teamId].transfer;
  }

  return {
    finalTime: time,
    finalPosition: position,
    deliveries: deliveries.sort((a, b) => a.time - b.time),
    events,
  };
}

function availableTime(deliveries, used, needed, type, earliest) {
  if (!needed) return earliest;
  const typed = deliveries.filter((delivery) => delivery.type === type);
  const targetIndex = used[type] + needed - 1;
  if (!typed[targetIndex]) return Infinity;
  return Math.max(earliest, typed[targetIndex].time);
}

function stepCargo(step) {
  if (step.type === "placeEarth") return "earth";
  if (step.type === "placeSky") return "sky";
  if (step.type === "placeMustika") return "mustika";
  return null;
}

function stepTarget(step) {
  if (step.type === "placeMustika") return POINTS.pillar;
  return SPOT_BY_ID[step.spotId];
}

function stepPlaceSeconds(step, speedFactor) {
  if (step.type === "placeEarth") return scaled(PLACE_SECONDS.earth, speedFactor);
  if (step.type === "placeSky") return scaled(PLACE_SECONDS.sky, speedFactor);
  if (step.type === "flipSky") return scaled(PLACE_SECONDS.flipSky, speedFactor);
  if (step.type === "placeMustika") return scaled(PLACE_SECONDS.mustika, speedFactor);
  return 0;
}

function describeStep(step) {
  if (step.type === "placeEarth") {
    return `${SPOT_BY_ID[step.spotId].name}:${step.layer === "earth1" ? "E1" : "E2"}`;
  }
  if (step.type === "placeSky") return `${SPOT_BY_ID[step.spotId].name}:S`;
  if (step.type === "flipSky") return `${SPOT_BY_ID[step.spotId].name}:Flip`;
  if (step.type === "placeMustika") return "Mustika";
  return step.type;
}

function sortieLabel(sortie) {
  return sortie.map(describeStep).join(" / ");
}

function simulateBrSorties({
  teamId,
  speedFactor,
  deliveries,
  sorties,
  startAt = 0,
  startPosition = null,
  used = null,
}) {
  const localUsed = used ? { ...used } : { earth: 0, sky: 0, mustika: 0 };
  let time = startAt;
  let position = startPosition || POINTS[teamId].brStart;
  const events = [];

  for (const [sortieIndex, sortie] of sorties.entries()) {
    if (sortie.length === 0) continue;
    const need = { earth: 0, sky: 0, mustika: 0 };
    for (const step of sortie) {
      const cargo = stepCargo(step);
      if (cargo) need[cargo] += 1;
    }

    time += travelTime(position, POINTS[teamId].brHome, teamId, speedFactor, "BR");
    position = POINTS[teamId].brHome;
    time += scaled(SCAN_SECONDS, speedFactor);
    events.push({
      time,
      team: teamId,
      actor: "BR",
      type: "scan",
      text: `${sortieIndex + 1}回目 ホームで認識停止`,
    });

    const itemCount = need.earth + need.sky + need.mustika;
    if (itemCount > 0) {
      time += travelTime(position, POINTS[teamId].transfer, teamId, speedFactor, "BR");
      time = availableTime(deliveries, localUsed, need.earth, "earth", time);
      time = availableTime(deliveries, localUsed, need.sky, "sky", time);
      time = availableTime(deliveries, localUsed, need.mustika, "mustika", time);
      if (!Number.isFinite(time)) {
        return {
          feasible: false,
          finalTime: Infinity,
          finalPosition: position,
          events,
          used: localUsed,
        };
      }
      time += scaled(
        BR_PICKUP_SECONDS_PER_ITEM.earth * need.earth +
          BR_PICKUP_SECONDS_PER_ITEM.sky * need.sky +
          BR_PICKUP_SECONDS_PER_ITEM.mustika * need.mustika,
        speedFactor
      );
      localUsed.earth += need.earth;
      localUsed.sky += need.sky;
      localUsed.mustika += need.mustika;
      events.push({
        time,
        team: teamId,
        actor: "BR",
        type: "pickup",
        text: `${sortieIndex + 1}回目 ${sortieLabel(sortie)} を受け取り`,
      });
      position = POINTS[teamId].transfer;
    }

    for (const step of sortie) {
      const target = stepTarget(step);
      time += travelTime(position, target, teamId, speedFactor, "BR");
      time += stepPlaceSeconds(step, speedFactor);
      events.push({
        time,
        team: teamId,
        actor: "BR",
        ...step,
        text: `${describeStep(step)} ${step.type === "flipSky" ? "反転" : "実行"}`,
      });
      position = target;
    }
  }

  return { feasible: true, finalTime: time, finalPosition: position, events, used: localUsed };
}

function emptyTowers() {
  return Object.fromEntries(SPOTS.map((spot) => [spot.id, {
    earth1: null,
    earth2: null,
    skyColor: null,
  }]));
}

function isCompleteForTeam(towers, spotId, teamId) {
  const tower = towers[spotId];
  return Boolean(tower.earth1 && tower.earth2 && tower.skyColor === teamId);
}

function sanctuaryStatus(towers, teamId) {
  let complete = 0;
  let sharedComplete = false;
  for (const spot of SPOTS) {
    if (isCompleteForTeam(towers, spot.id, teamId)) {
      complete += 1;
      if (spot.shared) sharedComplete = true;
    }
  }
  return { complete, sharedComplete, unlocked: complete >= 2 && sharedComplete };
}

function applyBrEvent(towers, event) {
  if (!event.spotId) return { ok: true };
  const tower = towers[event.spotId];

  if (event.type === "placeEarth") {
    if (tower[event.layer]) return { ok: false, reason: "earth layer occupied" };
    tower[event.layer] = event.team;
    return { ok: true };
  }

  if (event.type === "placeSky") {
    if (!tower.earth1 || !tower.earth2 || tower.skyColor) return { ok: false, reason: "sky invalid" };
    tower.skyColor = event.team;
    return { ok: true };
  }

  if (event.type === "flipSky") {
    if (!tower.earth1 || !tower.earth2 || !tower.skyColor || tower.skyColor === event.team) {
      return { ok: false, reason: "flip invalid" };
    }
    tower.skyColor = event.team;
    return { ok: true };
  }

  return { ok: true };
}

function scoreTowers(towers) {
  const score = {
    red: { transfer: 0, tower: 0, mustika: 0, total: 0 },
    blue: { transfer: 0, tower: 0, mustika: 0, total: 0 },
  };

  for (const spot of SPOTS) {
    const tower = towers[spot.id];
    const points = layerPoints(spot.id);
    if (tower.earth1) score[tower.earth1].tower += points.earth1;
    if (tower.earth2) score[tower.earth2].tower += points.earth2;
    if (tower.earth1 && tower.earth2 && tower.skyColor) {
      score[tower.skyColor].tower += points.sky;
    }
  }

  return score;
}

function replayCase({ brEvents, trDeliveries, mustikaAt = null }) {
  const towers = emptyTowers();
  const red = { sanctuaryAt: null };
  const blue = { sanctuaryAt: null };
  const invalid = [];
  const allEvents = brEvents
    .filter((event) => event.actor === "BR" && event.time <= MATCH_SECONDS)
    .sort((a, b) => a.time - b.time || (a.team === "red" ? -1 : 1));

  for (const event of allEvents) {
    const result = applyBrEvent(towers, event);
    if (!result.ok) {
      invalid.push({ time: event.time, team: event.team, step: describeStep(event), reason: result.reason });
      continue;
    }
    for (const teamId of ["red", "blue"]) {
      const team = teamId === "red" ? red : blue;
      if (!team.sanctuaryAt && sanctuaryStatus(towers, teamId).unlocked) {
        team.sanctuaryAt = event.time;
      }
    }
  }

  const score = scoreTowers(towers);
  for (const delivery of trDeliveries.filter((delivery) => delivery.time <= MATCH_SECONDS)) {
    if (delivery.type === "earth" || delivery.type === "sky") {
      score[delivery.team].transfer += 5;
    }
  }
  if (mustikaAt != null && mustikaAt <= MATCH_SECONDS) {
    score.red.mustika = 250;
  }
  for (const teamId of ["red", "blue"]) {
    score[teamId].total = score[teamId].transfer + score[teamId].tower + score[teamId].mustika;
  }

  return { towers, red, blue, score, invalid };
}

function placementStep(spotId, index) {
  if (index === 0) return { type: "placeEarth", spotId, layer: "earth1" };
  if (index === 1) return { type: "placeEarth", spotId, layer: "earth2" };
  if (index === 2) return { type: "placeSky", spotId };
  return null;
}

function towerPlacementOrders(spotA, spotB) {
  const orders = [];

  function dfs(counts, order) {
    if (order.length === 6) {
      orders.push(order);
      return;
    }
    for (const spotId of [spotA, spotB]) {
      const step = placementStep(spotId, counts[spotId]);
      if (!step) continue;
      dfs({ ...counts, [spotId]: counts[spotId] + 1 }, [...order, step]);
    }
  }

  dfs({ [spotA]: 0, [spotB]: 0 }, []);
  return orders;
}

function chunks(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

function earliestMustikaPlacement({
  redSanctuaryAt,
  redTr,
  redSpeedFactor,
  redBrFinalTime,
  redBrFinalPosition,
  mode,
}) {
  if (!redSanctuaryAt || redSanctuaryAt > MATCH_SECONDS) return null;

  const trReadyAtTransfer = Math.max(redTr.finalTime, redSanctuaryAt);
  let trStartTime = trReadyAtTransfer;
  let trStartPosition = POINTS.red.transfer;

  if (mode === "preposition") {
    const sourceArrival = redTr.finalTime +
      travelTime(redTr.finalPosition, POINTS.mustikaSource, "red", redSpeedFactor, "TR");
    trStartTime = Math.max(redSanctuaryAt, sourceArrival);
    trStartPosition = POINTS.mustikaSource;
  }

  let mustikaDeliveryTime = trStartTime;
  if (trStartPosition !== POINTS.mustikaSource) {
    mustikaDeliveryTime += travelTime(trStartPosition, POINTS.mustikaSource, "red", redSpeedFactor, "TR");
  }
  mustikaDeliveryTime += scaled(PICKUP_SECONDS.mustika, redSpeedFactor);
  mustikaDeliveryTime += travelTime(POINTS.mustikaSource, POINTS.red.transfer, "red", redSpeedFactor, "TR");
  mustikaDeliveryTime += scaled(TR_DROPOFF_SECONDS_PER_ITEM.mustika, redSpeedFactor);

  const brReachTransfer = Math.max(redBrFinalTime, redSanctuaryAt) +
    travelTime(redBrFinalPosition, POINTS.red.transfer, "red", redSpeedFactor, "BR");
  const brPickupAt = Math.max(mustikaDeliveryTime, brReachTransfer) +
    scaled(BR_PICKUP_SECONDS_PER_ITEM.mustika, redSpeedFactor);
  return brPickupAt +
    travelTime(POINTS.red.transfer, POINTS.pillar, "red", redSpeedFactor, "BR") +
    scaled(PLACE_SECONDS.mustika, redSpeedFactor);
}

function chooseBetterMustika(input) {
  const normal = earliestMustikaPlacement({ ...input, mode: "normal" });
  const preposition = earliestMustikaPlacement({ ...input, mode: "preposition" });
  if (normal == null) return { mustikaAt: null, mode: "none", normal, preposition };
  if (preposition != null && preposition < normal) {
    return { mustikaAt: preposition, mode: "TR Mustika前待機", normal, preposition };
  }
  return { mustikaAt: normal, mode: "Sanctuary後に取りに行く", normal, preposition };
}

function bestBlueResponseCompleteShared(sharedId, triggerTime, blueSpeedFactor, schedules) {
  let best = null;
  for (const schedule of schedules) {
    const blueTr = simulateTr("blue", schedule, blueSpeedFactor);
    const startAt = triggerTime + scaled(SCAN_SECONDS, blueSpeedFactor);
    const blueBr = simulateBrSorties({
      teamId: "blue",
      speedFactor: blueSpeedFactor,
      deliveries: blueTr.deliveries,
      startAt,
      sorties: [[
        { type: "placeEarth", spotId: sharedId, layer: "earth2" },
        { type: "placeSky", spotId: sharedId },
      ]],
    });
    if (!blueBr.feasible) continue;
    const skyEvent = blueBr.events.find((event) => event.type === "placeSky" && event.spotId === sharedId);
    if (!skyEvent) continue;
    const candidate = { schedule, tr: blueTr, br: blueBr, skyAt: skyEvent.time };
    if (!best || candidate.skyAt < best.skyAt) best = candidate;
  }
  return best;
}

function bestBlueSingleEarth(sharedId, blueSpeedFactor, schedules) {
  let best = null;
  for (const schedule of schedules) {
    const blueTr = simulateTr("blue", schedule, blueSpeedFactor);
    const blueBr = simulateBrSorties({
      teamId: "blue",
      speedFactor: blueSpeedFactor,
      deliveries: blueTr.deliveries,
      sorties: [[{ type: "placeEarth", spotId: sharedId, layer: "earth1" }]],
    });
    if (!blueBr.feasible) continue;
    const earthEvent = blueBr.events.find((event) => event.type === "placeEarth" && event.spotId === sharedId);
    if (!earthEvent) continue;
    const candidate = { schedule, tr: blueTr, br: blueBr, earthAt: earthEvent.time };
    if (!best || candidate.earthAt < best.earthAt) best = candidate;
  }
  return best;
}

function resultRow({
  caseId,
  speed,
  scenario,
  sharedId,
  ownId,
  planLabel,
  redTr,
  redBr,
  redEvents,
  blueTr = null,
  blueEvents = [],
  mustikaInput,
  extra = {},
}) {
  const prelimReplay = replayCase({
    brEvents: [...redEvents, ...blueEvents],
    trDeliveries: [
      ...redTr.deliveries,
      ...(blueTr ? blueTr.deliveries : []),
    ],
  });
  const mustika = chooseBetterMustika({
    redSanctuaryAt: prelimReplay.red.sanctuaryAt,
    redTr,
    redSpeedFactor: speed.redFactor,
    redBrFinalTime: redBr.finalTime,
    redBrFinalPosition: redBr.finalPosition,
    ...mustikaInput,
  });
  const replay = replayCase({
    brEvents: [...redEvents, ...blueEvents],
    trDeliveries: [
      ...redTr.deliveries,
      ...(blueTr ? blueTr.deliveries : []),
    ],
    mustikaAt: mustika.mustikaAt,
  });

  return {
    caseId,
    speedLabel: speed.label,
    redSpeedFactor: speed.redFactor,
    scenario,
    shared: SPOT_BY_ID[sharedId].name,
    own: SPOT_BY_ID[ownId].name,
    planLabel,
    firstTr: redTr.schedule?.firstCountLabel ?? extra.firstTr ?? "",
    trSchedule: redTr.schedule?.label ?? "",
    firstBr: extra.firstBr ?? "",
    sanctuaryAt: replay.red.sanctuaryAt,
    mustikaAt: mustika.mustikaAt,
    mustikaMode: mustika.mode,
    redScoreAt180: replay.score.red.total,
    blueScoreAt180: replay.score.blue.total,
    scoreDiff: replay.score.red.total - replay.score.blue.total,
    redTowerAt180: replay.score.red.tower,
    blueTowerAt180: replay.score.blue.tower,
    redTransferAt180: replay.score.red.transfer,
    blueTransferAt180: replay.score.blue.transfer,
    redMustikaAt180: replay.score.red.mustika,
    completed: replay.red.sanctuaryAt != null && replay.red.sanctuaryAt <= MATCH_SECONDS,
    mustikaCompleted: mustika.mustikaAt != null && mustika.mustikaAt <= MATCH_SECONDS,
    invalidCount: replay.invalid.length,
    invalid: replay.invalid,
    events: [...redTr.events, ...redEvents, ...(blueTr ? blueTr.events : []), ...blueEvents]
      .filter((event) => event.time <= MATCH_SECONDS)
      .sort((a, b) => a.time - b.time),
    ...extra,
  };
}

function simulateSelfCompleteCases(speed, schedules4e2s, caseIdStart) {
  const rows = [];
  let caseId = caseIdStart;
  for (const schedule of schedules4e2s) {
    const redTr = simulateTr("red", schedule, speed.redFactor);
    redTr.schedule = schedule;
    for (const sharedId of SHARED_SPOTS) {
      for (const ownId of RED_OWN_SPOTS) {
        for (const order of towerPlacementOrders(sharedId, ownId)) {
          const sorties = chunks(order, 2);
          const redBr = simulateBrSorties({
            teamId: "red",
            speedFactor: speed.redFactor,
            deliveries: redTr.deliveries,
            sorties,
          });
          if (!redBr.feasible) continue;
          rows.push(resultRow({
            caseId: caseId++,
            speed,
            scenario: "自力2本完成",
            sharedId,
            ownId,
            planLabel: "共有1本+赤専有1本を自力完成",
            redTr,
            redBr,
            redEvents: redBr.events,
            mustikaInput: {},
            extra: {
              firstBr: sortieLabel(sorties[0]),
              placementOrder: order.map(describeStep).join(" > "),
            },
          }));
        }
      }
    }
  }
  return { rows, nextCaseId: caseId };
}

function simulateBaitFlipCases(speed, schedules3e1s, blueSchedules1e1s, caseIdStart) {
  const rows = [];
  let caseId = caseIdStart;
  for (const schedule of schedules3e1s) {
    const redTr = simulateTr("red", schedule, speed.redFactor);
    redTr.schedule = schedule;
    for (const sharedId of SHARED_SPOTS) {
      for (const ownId of RED_OWN_SPOTS) {
        for (const firstOrder of [
          [
            { type: "placeEarth", spotId: sharedId, layer: "earth1" },
            { type: "placeEarth", spotId: ownId, layer: "earth1" },
          ],
          [
            { type: "placeEarth", spotId: ownId, layer: "earth1" },
            { type: "placeEarth", spotId: sharedId, layer: "earth1" },
          ],
        ]) {
          const first = simulateBrSorties({
            teamId: "red",
            speedFactor: speed.redFactor,
            deliveries: redTr.deliveries,
            sorties: [firstOrder],
          });
          if (!first.feasible) continue;
          const sharedEarth = first.events.find((event) =>
            event.type === "placeEarth" && event.spotId === sharedId && event.layer === "earth1"
          );
          if (!sharedEarth) continue;
          const blue = bestBlueResponseCompleteShared(sharedId, sharedEarth.time, speed.blueFactor, blueSchedules1e1s);
          if (!blue) continue;

          for (const orderMode of ["ownThenFlip", "flipThenOwn"]) {
            let redEvents = [...first.events];
            let used = first.used;
            let position = first.finalPosition;
            let time = first.finalTime;
            let redBrFinal = first;

            if (orderMode === "ownThenFlip") {
              const own = simulateBrSorties({
                teamId: "red",
                speedFactor: speed.redFactor,
                deliveries: redTr.deliveries,
                startAt: time,
                startPosition: position,
                used,
                sorties: [[
                  { type: "placeEarth", spotId: ownId, layer: "earth2" },
                  { type: "placeSky", spotId: ownId },
                ]],
              });
              if (!own.feasible) continue;
              redEvents = redEvents.concat(own.events);
              used = own.used;
              position = own.finalPosition;
              time = Math.max(own.finalTime, blue.skyAt);
              const flip = simulateBrSorties({
                teamId: "red",
                speedFactor: speed.redFactor,
                deliveries: redTr.deliveries,
                startAt: time,
                startPosition: position,
                used,
                sorties: [[{ type: "flipSky", spotId: sharedId }]],
              });
              if (!flip.feasible) continue;
              redEvents = redEvents.concat(flip.events);
              redBrFinal = flip;
            } else {
              const flip = simulateBrSorties({
                teamId: "red",
                speedFactor: speed.redFactor,
                deliveries: redTr.deliveries,
                startAt: Math.max(time, blue.skyAt),
                startPosition: position,
                used,
                sorties: [[{ type: "flipSky", spotId: sharedId }]],
              });
              if (!flip.feasible) continue;
              redEvents = redEvents.concat(flip.events);
              used = flip.used;
              position = flip.finalPosition;
              const own = simulateBrSorties({
                teamId: "red",
                speedFactor: speed.redFactor,
                deliveries: redTr.deliveries,
                startAt: flip.finalTime,
                startPosition: position,
                used,
                sorties: [[
                  { type: "placeEarth", spotId: ownId, layer: "earth2" },
                  { type: "placeSky", spotId: ownId },
                ]],
              });
              if (!own.feasible) continue;
              redEvents = redEvents.concat(own.events);
              redBrFinal = own;
            }

            rows.push(resultRow({
              caseId: caseId++,
              speed,
              scenario: "共有餌→相手完成→Sky反転",
              sharedId,
              ownId,
              planLabel: orderMode === "ownThenFlip" ? "専有を完成してから共有Sky反転" : "共有Skyを先に反転してから専有完成",
              redTr,
              redBr: redBrFinal,
              redEvents,
              blueTr: blue.tr,
              blueEvents: blue.br.events,
              mustikaInput: {},
              extra: {
                firstBr: sortieLabel(firstOrder),
                blueSharedCompleteAt: blue.skyAt,
                responseOrder: orderMode,
              },
            }));
          }
        }
      }
    }
  }
  return { rows, nextCaseId: caseId };
}

function simulatePoachCases(speed, schedules3e2s, blueSchedules1e0s, caseIdStart) {
  const rows = [];
  let caseId = caseIdStart;
  for (const schedule of schedules3e2s) {
    const redTr = simulateTr("red", schedule, speed.redFactor);
    redTr.schedule = schedule;
    for (const sharedId of SHARED_SPOTS) {
      const blue = bestBlueSingleEarth(sharedId, speed.blueFactor, blueSchedules1e0s);
      if (!blue) continue;
      for (const ownId of RED_OWN_SPOTS) {
        const startAt = blue.earthAt + scaled(SCAN_SECONDS, speed.redFactor);
        for (const ownMode of ["ownEEthenS", "ownEthenES"]) {
          const poach = simulateBrSorties({
            teamId: "red",
            speedFactor: speed.redFactor,
            deliveries: redTr.deliveries,
            startAt,
            sorties: [[
              { type: "placeEarth", spotId: sharedId, layer: "earth2" },
              { type: "placeSky", spotId: sharedId },
            ]],
          });
          if (!poach.feasible) continue;

          let redEvents = [...poach.events];
          let used = poach.used;
          let position = poach.finalPosition;
          let redBrFinal = poach;
          const ownSorties = ownMode === "ownEEthenS"
            ? [
                [
                  { type: "placeEarth", spotId: ownId, layer: "earth1" },
                  { type: "placeEarth", spotId: ownId, layer: "earth2" },
                ],
                [{ type: "placeSky", spotId: ownId }],
              ]
            : [
                [{ type: "placeEarth", spotId: ownId, layer: "earth1" }],
                [
                  { type: "placeEarth", spotId: ownId, layer: "earth2" },
                  { type: "placeSky", spotId: ownId },
                ],
              ];
          const own = simulateBrSorties({
            teamId: "red",
            speedFactor: speed.redFactor,
            deliveries: redTr.deliveries,
            startAt: poach.finalTime,
            startPosition: position,
            used,
            sorties: ownSorties,
          });
          if (!own.feasible) continue;
          redEvents = redEvents.concat(own.events);
          redBrFinal = own;

          rows.push(resultRow({
            caseId: caseId++,
            speed,
            scenario: "相手1段目を漁夫完成",
            sharedId,
            ownId,
            planLabel: ownMode === "ownEEthenS" ? "共有を漁夫後、専有はE+E→S" : "共有を漁夫後、専有はE→E+S",
            redTr,
            redBr: redBrFinal,
            redEvents,
            blueTr: blue.tr,
            blueEvents: blue.br.events,
            mustikaInput: {},
            extra: {
              firstBr: "相手E1確認後 E+Sで共有完成",
              blueFirstEarthAt: blue.earthAt,
              ownMode,
            },
          }));
        }
      }
    }
  }
  return { rows, nextCaseId: caseId };
}

function sortRows(rows) {
  return rows.slice().sort((a, b) =>
    Number(b.mustikaCompleted) - Number(a.mustikaCompleted) ||
    (a.mustikaAt ?? Infinity) - (b.mustikaAt ?? Infinity) ||
    Number(b.completed) - Number(a.completed) ||
    (a.sanctuaryAt ?? Infinity) - (b.sanctuaryAt ?? Infinity) ||
    b.redScoreAt180 - a.redScoreAt180 ||
    b.scoreDiff - a.scoreDiff
  );
}

function summarize(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const group = groups.get(key) || {
      key,
      count: 0,
      completed: 0,
      mustikaCompleted: 0,
      sumSanctuary: 0,
      sumMustika: 0,
      sumScore: 0,
      sumDiff: 0,
      bestCase: null,
    };
    group.count += 1;
    if (row.completed) {
      group.completed += 1;
      group.sumSanctuary += row.sanctuaryAt;
    }
    if (row.mustikaCompleted) {
      group.mustikaCompleted += 1;
      group.sumMustika += row.mustikaAt;
    }
    group.sumScore += row.redScoreAt180;
    group.sumDiff += row.scoreDiff;
    if (!group.bestCase || sortRows([group.bestCase, row])[0] === row) {
      group.bestCase = row;
    }
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      completionRate: group.completed / group.count,
      mustikaRate: group.mustikaCompleted / group.count,
      avgSanctuaryAt: group.completed > 0 ? group.sumSanctuary / group.completed : null,
      avgMustikaAt: group.mustikaCompleted > 0 ? group.sumMustika / group.mustikaCompleted : null,
      avgScore: group.sumScore / group.count,
      avgDiff: group.sumDiff / group.count,
    }))
    .sort((a, b) =>
      b.mustikaRate - a.mustikaRate ||
      (a.avgMustikaAt ?? Infinity) - (b.avgMustikaAt ?? Infinity) ||
      b.completionRate - a.completionRate ||
      (a.avgSanctuaryAt ?? Infinity) - (b.avgSanctuaryAt ?? Infinity) ||
      b.avgScore - a.avgScore
    );
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatTime(value) {
  return value == null || !Number.isFinite(value) ? "-" : `${value.toFixed(1)}s`;
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function groupLine(group) {
  const best = group.bestCase;
  return `- ${group.key}: Mustika率 ${formatPct(group.mustikaRate)}, Sanctuary率 ${formatPct(group.completionRate)}, ` +
    `平均Mustika ${formatTime(group.avgMustikaAt)}, 平均Sanctuary ${formatTime(group.avgSanctuaryAt)}, ` +
    `平均点 ${group.avgScore.toFixed(1)}, best #${best.caseId} ${formatTime(best.sanctuaryAt)} / Mustika ${formatTime(best.mustikaAt)} / ${best.redScoreAt180}点`;
}

function topCaseLine(row) {
  return `- #${row.caseId} ${row.scenario} / ${row.shared}+${row.own} / TR ${row.trSchedule}: ` +
    `Sanctuary ${formatTime(row.sanctuaryAt)}, Mustika ${formatTime(row.mustikaAt)}, ` +
    `${row.redScoreAt180}-${row.blueScoreAt180}点, 初回BR ${row.firstBr}`;
}

function eventLine(event) {
  const team = event.team === "red" ? "赤" : "青";
  return `${formatTime(event.time)} ${team}${event.actor}: ${event.text}`;
}

function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const schedules4e2s = trSchedulesFor(4, 2);
  const schedules3e1s = trSchedulesFor(3, 1);
  const schedules3e2s = trSchedulesFor(3, 2);
  const blueSchedules1e1s = trSchedulesFor(1, 1);
  const blueSchedules1e0s = trSchedulesFor(1, 0);

  const rows = [];
  let caseId = 1;

  for (const speed of SPEED_CASES) {
    const self = simulateSelfCompleteCases(speed, schedules4e2s, caseId);
    rows.push(...self.rows);
    caseId = self.nextCaseId;

    const bait = simulateBaitFlipCases(speed, schedules3e1s, blueSchedules1e1s, caseId);
    rows.push(...bait.rows);
    caseId = bait.nextCaseId;

    const poach = simulatePoachCases(speed, schedules3e2s, blueSchedules1e0s, caseId);
    rows.push(...poach.rows);
    caseId = poach.nextCaseId;
  }

  const sorted = sortRows(rows);
  const topLogs = sorted.slice(0, 40).map((row) => ({
    caseId: row.caseId,
    speed: row.speedLabel,
    scenario: row.scenario,
    shared: row.shared,
    own: row.own,
    trSchedule: row.trSchedule,
    firstBr: row.firstBr,
    sanctuaryAt: row.sanctuaryAt,
    mustikaAt: row.mustikaAt,
    score: { red: row.redScoreAt180, blue: row.blueScoreAt180, diff: row.scoreDiff },
    events: row.events.slice(0, 80).map(eventLine),
  }));

  const headers = [
    "case_id",
    "speed",
    "red_speed_factor",
    "scenario",
    "shared",
    "own",
    "plan",
    "first_tr",
    "tr_schedule",
    "first_br",
    "sanctuary_at",
    "mustika_at",
    "mustika_mode",
    "red_score_at_180",
    "blue_score_at_180",
    "score_diff",
    "red_tower_at_180",
    "blue_tower_at_180",
    "red_transfer_at_180",
    "blue_transfer_at_180",
    "red_mustika_at_180",
    "completed",
    "mustika_completed",
    "invalid_count",
  ];
  const csvRows = rows.map((row) => [
    row.caseId,
    row.speedLabel,
    row.redSpeedFactor,
    row.scenario,
    row.shared,
    row.own,
    row.planLabel,
    row.firstTr,
    row.trSchedule,
    row.firstBr,
    row.sanctuaryAt?.toFixed(3) ?? "",
    row.mustikaAt?.toFixed(3) ?? "",
    row.mustikaMode,
    row.redScoreAt180,
    row.blueScoreAt180,
    row.scoreDiff,
    row.redTowerAt180,
    row.blueTowerAt180,
    row.redTransferAt180,
    row.blueTransferAt180,
    row.redMustikaAt180,
    row.completed,
    row.mustikaCompleted,
    row.invalidCount,
  ].map(csvEscape).join(","));
  const csv = [headers.join(","), ...csvRows].join("\n");

  const byScenarioSpeed = Object.fromEntries(SPEED_CASES.map((speed) => [
    speed.label,
    summarize(rows.filter((row) => row.speedLabel === speed.label), (row) => row.scenario),
  ]));

  const e3BaitRows = rows.filter((row) =>
    row.scenario === "共有餌→相手完成→Sky反転" &&
    row.firstTr === "E3"
  );
  const e3BaitSummary = Object.fromEntries(SPEED_CASES.map((speed) => [
    speed.label,
    summarize(e3BaitRows.filter((row) => row.speedLabel === speed.label), (row) => `${row.shared}+${row.own}`).slice(0, 8),
  ]));

  const report = [
    "# Tactical opening search",
    "",
    "行動辞書から、開幕で特に重要そうな3系統をシナリオ分岐として探索しました。",
    "",
    "## 入れた分岐",
    "",
    "- 自力2本完成: 共有1本+赤専有1本をこちらだけで完成",
    "- 共有餌→相手完成→Sky反転: こちらが共有1段目を置き、相手が2段目+Skyで完成したあと、こちらがSkyを反転",
    "- 相手1段目を漁夫完成: 相手が共有1段目を置いたあと、こちらがEarth2段目+Skyで共有タワーを完成",
    "",
    "## 前提",
    "",
    "- 青は常に最高速100%として、赤だけを同等、3/4、1/2、1/4に変更",
    "- BRは各出撃前にホームで3秒相当の画像認識停止",
    "- TR最大3個、BR最大2個を反映",
    "- Sanctuaryは一度達成したらロックされ、あとでSkyを反転されても解除されない",
    "- Mustikaは250点、TRがMustika前に先回りする選択も計算",
    "- 衝突、ブロッキング、相手の妨害走行は未モデル化",
    "",
    "## 速度別の目立つ結果",
    "",
    ...SPEED_CASES.flatMap((speed) => {
      const speedRows = rows.filter((row) => row.speedLabel === speed.label);
      const top = sortRows(speedRows).slice(0, 10);
      return [
        `### 赤速度 ${speed.label}`,
        "",
        ...top.map(topCaseLine),
        "",
      ];
    }),
    "## シナリオ別集計",
    "",
    ...SPEED_CASES.flatMap((speed) => [
      `### 赤速度 ${speed.label}`,
      "",
      ...byScenarioSpeed[speed.label].map(groupLine),
      "",
    ]),
    "## E3初手の共有餌作戦だけを見る",
    "",
    "ユーザー仮説に近い「TR初手E3、BR初回で共有1段+赤専有1段」のケースです。",
    "",
    ...SPEED_CASES.flatMap((speed) => [
      `### 赤速度 ${speed.label}`,
      "",
      ...(e3BaitSummary[speed.label].length > 0
        ? e3BaitSummary[speed.label].map(groupLine)
        : ["- 該当なし"]),
      "",
    ]),
    "## 読み取り",
    "",
    "- 同等と3/4では、共有餌→相手完成→Sky反転がかなり強い。自分で共有タワー用の2段目EarthとSkyを運ばなくてよくなるため、Mustikaまでの最短が縮みやすい。",
    "- ただし、この作戦は相手が共有1段目に乗って完成してくれる前提なので、相手が無視する世界線では自力完成プランへ切り替える必要がある。",
    "- 1/2でも、相手が完成してくれるなら反転作戦はまだ成立するケースがある。自力2本完成よりMustikaが残りやすい。",
    "- 1/4では、こちらのBR移動と認識停止が重く、Mustikaまで届くケースはかなり少ない。部分点狙いか、相手の1段目を漁夫る待ちの価値が上がる。",
    "- Mustika前TR待機は多くの上位ケースで効く。Sanctuary後に取りに行くより、数秒から十数秒縮む。",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "tactical_opening_cases.csv"), csv, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "tactical_opening_top_logs.json"), JSON.stringify(topLogs, null, 2), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "tactical_opening_report.md"), report, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "tactical_opening_summary.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    rowCount: rows.length,
    speedCases: SPEED_CASES,
    scenarioSummary: byScenarioSpeed,
    e3BaitSummary,
    topCases: sorted.slice(0, 30).map((row) => ({
      caseId: row.caseId,
      speed: row.speedLabel,
      scenario: row.scenario,
      shared: row.shared,
      own: row.own,
      trSchedule: row.trSchedule,
      sanctuaryAt: row.sanctuaryAt,
      mustikaAt: row.mustikaAt,
      redScoreAt180: row.redScoreAt180,
      blueScoreAt180: row.blueScoreAt180,
    })),
  }, null, 2), "utf8");

  console.log(report);
}

run();
