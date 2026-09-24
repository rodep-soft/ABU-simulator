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
const LEVEL_ORDER = { ground: 0, l1: 1, l2: 2 };
const LEVEL_BY_ORDER = ["ground", "l1", "l2"];

const TEAM_META = {
  red: { label: "赤", color: "red" },
  blue: { label: "青", color: "blue" },
};

const POINTS = {
  red: {
    trHome: { x: 9.5, y: 95.5, level: "ground" },
    brStart: { x: 5.2, y: 95.5, level: "ground" },
    brHome: { x: 35, y: 75, level: "l1" },
    storage: { x: 10.5, y: 5.5, level: "ground" },
    transfer: { x: 22.5, y: 50, level: "l1" },
  },
  blue: {
    trHome: { x: 90.5, y: 95.5, level: "ground" },
    brStart: { x: 94.8, y: 95.5, level: "ground" },
    brHome: { x: 65, y: 75, level: "l1" },
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
        name: "坂",
        lower: { x: 16.0, y: 57.0, level: "ground" },
        upper: { x: 24.0, y: 57.0, level: "l1" },
        terrain: "ramp",
        stopSeconds: 0,
      },
      {
        name: "階段",
        lower: { x: 16.0, y: 72.0, level: "ground" },
        upper: { x: 24.0, y: 72.0, level: "l1" },
        terrain: "stair",
        stopSeconds: STAIR_STOP_SECONDS,
      },
    ],
    l1L2: [
      {
        name: "階段",
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
        name: "坂",
        lower: { x: 84.0, y: 57.0, level: "ground" },
        upper: { x: 76.0, y: 57.0, level: "l1" },
        terrain: "ramp",
        stopSeconds: 0,
      },
      {
        name: "階段",
        lower: { x: 84.0, y: 72.0, level: "ground" },
        upper: { x: 76.0, y: 72.0, level: "l1" },
        terrain: "stair",
        stopSeconds: STAIR_STOP_SECONDS,
      },
    ],
    l1L2: [
      {
        name: "階段",
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

const BR_STRATEGIES = {
  l1FastMustika: {
    label: "L1最速サンクチュアリ",
    red: [
      tower("l1sA"),
      tower("r1"),
      mustika(),
      tower("l2a"),
      tower("l2c"),
      autoFlip(),
    ],
    blue: [
      tower("l1sB"),
      tower("b1"),
      mustika(),
      tower("l2d"),
      tower("l2b"),
      autoFlip(),
    ],
  },
  l2Value: {
    label: "L2高得点寄せ",
    red: [
      tower("l2a"),
      tower("l1sA"),
      mustika(),
      tower("l2c"),
      tower("r1"),
      autoFlip(),
    ],
    blue: [
      tower("l2d"),
      tower("l1sB"),
      mustika(),
      tower("l2b"),
      tower("b1"),
      autoFlip(),
    ],
  },
  sharedFight: {
    label: "共有エリア先取り",
    red: [
      tower("l1sA"),
      tower("l1sB"),
      mustika(),
      tower("l2a"),
      tower("l2c"),
      autoFlip(),
    ],
    blue: [
      tower("l1sB"),
      tower("l1sA"),
      mustika(),
      tower("l2d"),
      tower("l2b"),
      autoFlip(),
    ],
  },
  flipPressure: {
    label: "スカイ反転圧力",
    red: [
      tower("l1sA"),
      autoFlip(),
      tower("r1"),
      mustika(),
      autoFlip(),
      tower("l2a"),
    ],
    blue: [
      tower("l1sB"),
      autoFlip(),
      tower("b1"),
      mustika(),
      autoFlip(),
      tower("l2d"),
    ],
  },
};

const TR_STRATEGIES = {
  demandPull: {
    label: "BR要求に追従",
    choose: chooseDemandPullDelivery,
  },
  earthBuffer: {
    label: "Earth先行補給",
    choose: chooseEarthBufferDelivery,
  },
  skyReady: {
    label: "Sky先置き準備",
    choose: chooseSkyReadyDelivery,
  },
};

const els = {};
let state = null;
let lastFrame = 0;
let selectedSpotId = "l1sA";

function tower(spot) {
  return { type: "tower", spot };
}

function flip(spot) {
  return { type: "flip", spot };
}

function mustika() {
  return { type: "mustika" };
}

function autoFlip() {
  return { type: "autoFlip" };
}

function $(id) {
  return document.getElementById(id);
}

function fmtTime(seconds) {
  const clamped = Math.max(0, MATCH_SECONDS - seconds);
  const minutes = Math.floor(clamped / 60);
  const rest = clamped - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function levelOf(point) {
  if (point.level === 2) return "l2";
  if (point.level === 1) return "l1";
  return point.level || "ground";
}

function moveSegment(to, terrain = "normal", stopSeconds = 0) {
  return {
    to,
    terrain,
    stopSeconds,
    stopRemaining: null,
  };
}

function addSegment(route, to, terrain = "normal", stopSeconds = 0) {
  const last = route.length > 0 ? route[route.length - 1].to : null;
  if (last && dist(last, to) < 0.05) return;
  route.push(moveSegment(to, terrain, stopSeconds));
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

function chooseTransition(teamId, current, target, fromLevel, toLevel) {
  const transitions = transitionsForLevelStep(teamId, fromLevel, toLevel);
  if (transitions.length === 0) return null;

  return transitions
    .map((transition) => {
      const endpoints = transitionEndpoints(transition, fromLevel, toLevel);
      return {
        transition,
        endpoints,
        cost: dist(current, endpoints.entry) + dist(endpoints.exit, target),
      };
    })
    .sort((a, b) => a.cost - b.cost)[0];
}

function cleanedWaypoints(points) {
  return points.filter((point, index) => {
    if (index === 0) return true;
    return dist(points[index - 1], point) > 0.05;
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

function addGroundAwareSegment(route, from, to, teamId, robot) {
  if (robot.type === "tr" && levelOf(from) === "ground" && levelOf(to) === "ground") {
    for (const point of trGroundWaypoints(from, to, teamId).slice(1)) {
      addSegment(route, point);
    }
    return;
  }
  addSegment(route, to);
}

function routeBetween(robot, target, teamId) {
  const targetLevel = levelOf(target);
  const route = [];
  let current = {
    x: robot.x,
    y: robot.y,
    level: robot.level || "ground",
  };

  while (current.level !== targetLevel) {
    const fromOrder = LEVEL_ORDER[current.level];
    const toOrder = LEVEL_ORDER[targetLevel];
    const nextLevel = LEVEL_BY_ORDER[fromOrder + Math.sign(toOrder - fromOrder)];
    const selected = chooseTransition(teamId, current, target, current.level, nextLevel);

    if (!selected) break;

    addGroundAwareSegment(route, current, selected.endpoints.entry, teamId, robot);
    addSegment(
      route,
      selected.endpoints.exit,
      selected.transition.terrain,
      selected.transition.stopSeconds
    );
    current = selected.endpoints.exit;
  }

  addGroundAwareSegment(route, current, target, teamId, robot);
  return route;
}

function terrainSpeedFactor(terrain) {
  if (terrain === "ramp") return RAMP_SPEED_FACTOR;
  if (terrain === "stair") return STAIR_SPEED_FACTOR;
  return 1;
}

function terrainStatus(label, terrain, waiting) {
  if (terrain === "ramp") return `${label}（坂で減速）`;
  if (terrain === "stair" && waiting) return "階段で姿勢合わせ";
  if (terrain === "stair") return `${label}（階段）`;
  return label;
}

function cloneBrPlan(strategy, teamId) {
  return BR_STRATEGIES[strategy][teamId].map((step) => ({ ...step }));
}

function createRobot(teamId, type) {
  const startKey = type === "tr" ? "trHome" : "brStart";
  const homeKey = type === "tr" ? "trHome" : "brHome";
  const start = POINTS[teamId][startKey];
  const home = POINTS[teamId][homeKey];
  return {
    teamId,
    type,
    x: start.x,
    y: start.y,
    level: start.level,
    home,
    job: null,
    status: "待機",
    carrying: null,
    lastPath: null,
  };
}

function createTeam(teamId, trStrategyName, brStrategyName, speedFactor) {
  return {
    id: teamId,
    label: TEAM_META[teamId].label,
    speedFactor,
    trStrategyName,
    brStrategyName,
    brPlan: cloneBrPlan(brStrategyName, teamId),
    brPlanIndex: 0,
    customBrQueue: [],
    transferEarth: 0,
    transferSky: 0,
    transferMustika: false,
    transferPoints: 0,
    earthSupply: 20,
    deliveredEarth: 0,
    deliveredSky: 0,
    sanctuaryUnlocked: false,
    mustikaPlaced: false,
    tr: createRobot(teamId, "tr"),
    br: createRobot(teamId, "br"),
  };
}

function createInitialState() {
  const redTrStrategy = els.redTrStrategy.value || "demandPull";
  const redBrStrategy = els.redBrStrategy.value || "l1FastMustika";
  const blueTrStrategy = els.blueTrStrategy.value || "demandPull";
  const blueBrStrategy = els.blueBrStrategy.value || "l1FastMustika";
  const redSpeed = Number(els.redSpeed.value || 1);
  const spots = {};
  for (const spot of SPOTS) {
    spots[spot.id] = {
      earth1: null,
      earth2: null,
      skyColor: null,
      skyPlacedBy: null,
    };
  }

  return {
    time: 0,
    running: false,
    skyRemaining: 12,
    mustikaInPlay: true,
    mustikaOwner: null,
    spots,
    teams: {
      red: createTeam("red", redTrStrategy, redBrStrategy, redSpeed),
      blue: createTeam("blue", blueTrStrategy, blueBrStrategy, 1),
    },
    events: [],
  };
}

function addEvent(teamId, text) {
  state.events.unshift({
    time: state.time,
    teamId,
    text,
  });
  state.events = state.events.slice(0, 80);
}

function teamName(teamId) {
  return TEAM_META[teamId].label;
}

function ownerShort(owner) {
  if (!owner) return "-";
  return owner === "red" ? "赤" : "青";
}

function otherTeam(teamId) {
  return teamId === "red" ? "blue" : "red";
}

function layerPoints(spotId) {
  const level = SPOT_BY_ID[spotId].level;
  return {
    earth1: level === 1 ? 10 : 20,
    earth2: level === 1 ? 20 : 40,
    sky: level === 1 ? 40 : 80,
  };
}

function isCompleteForTeam(spotId, teamId) {
  const towerState = state.spots[spotId];
  return Boolean(towerState.earth1 && towerState.earth2 && towerState.skyColor === teamId);
}

function isSharedSpot(spotId) {
  return SPOT_BY_ID[spotId].shared;
}

function updateSanctuary(team) {
  if (team.sanctuaryUnlocked) return;
  let complete = 0;
  let sharedComplete = false;
  for (const spot of SPOTS) {
    if (isCompleteForTeam(spot.id, team.id)) {
      complete += 1;
      if (spot.shared) sharedComplete = true;
    }
  }
  if (complete >= 2 && sharedComplete) {
    team.sanctuaryUnlocked = true;
    addEvent(team.id, "Sanctuary Mandate 達成");
  }
}

function scoreState() {
  const score = {
    red: { transfer: state.teams.red.transferPoints, tower: 0, mustika: 0, total: 0 },
    blue: { transfer: state.teams.blue.transferPoints, tower: 0, mustika: 0, total: 0 },
  };

  for (const spot of SPOTS) {
    const towerState = state.spots[spot.id];
    const points = layerPoints(spot.id);
    if (towerState.earth1) score[towerState.earth1].tower += points.earth1;
    if (towerState.earth2) score[towerState.earth2].tower += points.earth2;
    if (towerState.earth1 && towerState.earth2 && towerState.skyColor) {
      score[towerState.skyColor].tower += points.sky;
    }
  }

  for (const teamId of ["red", "blue"]) {
    if (state.teams[teamId].mustikaPlaced) score[teamId].mustika = 250;
    score[teamId].total = score[teamId].transfer + score[teamId].tower + score[teamId].mustika;
  }

  return score;
}

function currentBrStep(team) {
  if (team.customBrQueue.length > 0) return team.customBrQueue[0];
  return team.brPlan[team.brPlanIndex] || null;
}

function finishBrStep(team) {
  if (team.customBrQueue.length > 0) {
    team.customBrQueue.shift();
  } else {
    team.brPlanIndex += 1;
  }
}

function firstOpenLayerForTower(spotId) {
  const towerState = state.spots[spotId];
  if (!towerState.earth1) return "earth1";
  if (!towerState.earth2) return "earth2";
  if (!towerState.skyColor) return "sky";
  return null;
}

function findFlipCandidate(teamId) {
  const preferred = SPOTS
    .filter((spot) => spot.shared)
    .concat(SPOTS.filter((spot) => !spot.shared));
  for (const spot of preferred) {
    const towerState = state.spots[spot.id];
    if (towerState.earth1 && towerState.earth2 && towerState.skyColor && towerState.skyColor !== teamId) {
      return spot.id;
    }
  }
  return null;
}

function deliveryNeededForBr(team) {
  const step = currentBrStep(team);
  if (!step) return null;

  if (step.type === "tower") {
    const layer = firstOpenLayerForTower(step.spot);
    if ((layer === "earth1" || layer === "earth2") && team.transferEarth < 1 && team.earthSupply > 0) {
      return "earth";
    }
    if (layer === "sky" && team.transferSky < 1 && state.skyRemaining > 0) {
      return "sky";
    }
    return null;
  }

  if (step.type === "mustika") {
    if (team.sanctuaryUnlocked && state.mustikaInPlay && !team.transferMustika && !team.mustikaPlaced) {
      return "mustika";
    }
    return null;
  }

  return null;
}

function chooseDemandPullDelivery(team) {
  return deliveryNeededForBr(team);
}

function chooseEarthBufferDelivery(team) {
  const directNeed = deliveryNeededForBr(team);
  if (directNeed === "mustika") return "mustika";
  if (team.transferEarth < 2 && team.earthSupply > 0) return "earth";
  if (directNeed) return directNeed;
  if (team.transferEarth < 3 && team.earthSupply > 0) return "earth";
  return null;
}

function chooseSkyReadyDelivery(team) {
  const directNeed = deliveryNeededForBr(team);
  if (directNeed === "mustika") return "mustika";
  if (team.transferSky < 1 && state.skyRemaining > 0) return "sky";
  if (directNeed) return directNeed;
  if (team.transferEarth < 1 && team.earthSupply > 0) return "earth";
  return null;
}

function chooseTrDelivery(team) {
  const strategy = TR_STRATEGIES[team.trStrategyName] || TR_STRATEGIES.demandPull;
  return strategy.choose(team);
}

function scaledDuration(baseSeconds, team) {
  return baseSeconds / Math.max(team.speedFactor, 0.05);
}

function makeMovePhase(robot, to, label) {
  return {
    kind: "move",
    to,
    label,
    started: false,
    route: null,
    segmentIndex: 0,
    velocity: 0,
    maxSpeed: ROBOT_MAX_SPEED_UNITS,
    maxAccel: ROBOT_MAX_ACCEL_UNITS,
  };
}

function makeWaitPhase(duration, label, onComplete) {
  return {
    kind: "wait",
    remaining: duration,
    label,
    onComplete,
  };
}

function startTrJob(team, blockType) {
  const robot = team.tr;
  if (blockType === "earth" && team.earthSupply <= 0) return;
  if (blockType === "sky" && state.skyRemaining <= 0) return;
  if (blockType === "mustika" && (!state.mustikaInPlay || team.transferMustika || team.mustikaPlaced)) return;

  const source = blockType === "earth"
    ? POINTS[team.id].storage
    : blockType === "sky"
      ? POINTS.skyShare
      : POINTS.mustikaSource;
  const blockLabel = blockType === "earth" ? "Earth" : blockType === "sky" ? "Sky" : "Mustika";

  robot.job = {
    type: `tr-${blockType}`,
    phases: [
      makeMovePhase(robot, source, `${blockLabel}へ移動`),
      makeWaitPhase(scaledDuration(blockType === "mustika" ? 3.5 : 2.4, team), `${blockLabel}取得`, () => {
        if (blockType === "earth") {
          if (team.earthSupply <= 0) {
            robot.job.phases = [];
            return;
          }
          team.earthSupply -= 1;
        }
        if (blockType === "sky") {
          if (state.skyRemaining <= 0) {
            robot.job.phases = [];
            return;
          }
          state.skyRemaining -= 1;
        }
        if (blockType === "mustika") {
          if (!state.mustikaInPlay) {
            robot.job.phases = [];
            return;
          }
          state.mustikaInPlay = false;
        }
        robot.carrying = blockType;
      }),
      makeMovePhase(robot, POINTS[team.id].transfer, "Transferへ移動"),
      makeWaitPhase(scaledDuration(blockType === "mustika" ? 1.8 : 1.2, team), "受け渡し", () => {
        if (robot.carrying !== blockType) return;
        if (blockType === "earth") {
          team.transferEarth += 1;
          team.deliveredEarth += 1;
          team.transferPoints += 5;
          addEvent(team.id, "TRがEarthをTransferへ搬送");
        } else if (blockType === "sky") {
          team.transferSky += 1;
          team.deliveredSky += 1;
          team.transferPoints += 5;
          addEvent(team.id, "TRがSkyをTransferへ搬送");
        } else {
          team.transferMustika = true;
          addEvent(team.id, "TRがMustikaをTransferへ搬送");
        }
        robot.carrying = null;
      }),
    ],
  };
}

function actionForTower(team, spotId) {
  const towerState = state.spots[spotId];
  if (!towerState.earth1) {
    if (team.transferEarth > 0) return { type: "placeEarth", spot: spotId, layer: "earth1" };
    return null;
  }
  if (!towerState.earth2) {
    if (team.transferEarth > 0) return { type: "placeEarth", spot: spotId, layer: "earth2" };
    return null;
  }
  if (!towerState.skyColor) {
    if (team.transferSky > 0) return { type: "placeSky", spot: spotId };
    return null;
  }
  if (towerState.skyColor !== team.id) {
    return { type: "flipSky", spot: spotId };
  }
  return "done";
}

function chooseBrAction(team) {
  const step = currentBrStep(team);
  if (!step) return null;

  if (step.type === "tower") {
    const action = actionForTower(team, step.spot);
    if (action === "done") {
      finishBrStep(team);
      return chooseBrAction(team);
    }
    return action;
  }

  if (step.type === "autoFlip") {
    const target = findFlipCandidate(team.id);
    if (!target) {
      finishBrStep(team);
      return chooseBrAction(team);
    }
    return { type: "flipSky", spot: target, autoFlip: true };
  }

  if (step.type === "flip") {
    const towerState = state.spots[step.spot];
    if (towerState.skyColor === team.id) {
      finishBrStep(team);
      return chooseBrAction(team);
    }
    if (towerState.earth1 && towerState.earth2 && towerState.skyColor && towerState.skyColor !== team.id) {
      return { type: "flipSky", spot: step.spot };
    }
    return null;
  }

  if (step.type === "mustika") {
    if (team.mustikaPlaced) {
      finishBrStep(team);
      return chooseBrAction(team);
    }
    if (!team.sanctuaryUnlocked) return null;
    if (team.transferMustika) return { type: "placeMustika" };
    return null;
  }

  return null;
}

function startBrJob(team, action) {
  const robot = team.br;
  const phases = [
    makeMovePhase(robot, POINTS[team.id].brHome, "ホームへ移動"),
  ];
  const scanSeconds = Number(els.scanTime.value || 0);
  if (scanSeconds > 0) {
    phases.push(makeWaitPhase(scaledDuration(scanSeconds, team), "ホームで認識停止"));
  }

  if (action.type === "placeEarth") {
    const spot = SPOT_BY_ID[action.spot];
    phases.push(
      makeMovePhase(robot, POINTS[team.id].transfer, "Earth受け取りへ移動"),
      makeWaitPhase(scaledDuration(1.4, team), "Earth受け取り", () => {
        if (team.transferEarth > 0) {
          team.transferEarth -= 1;
          robot.carrying = "earth";
        }
      }),
      makeMovePhase(robot, spot, `${spot.name}へ移動`),
      makeWaitPhase(scaledDuration(3.6, team), `${spot.name}にEarth配置`, () => {
        const towerState = state.spots[action.spot];
        if (robot.carrying === "earth" && !towerState[action.layer]) {
          towerState[action.layer] = team.id;
          addEvent(team.id, `BRが${spot.name}の${action.layer === "earth1" ? "1段目" : "2段目"}にEarth配置`);
        }
        robot.carrying = null;
      })
    );
  }

  if (action.type === "placeSky") {
    const spot = SPOT_BY_ID[action.spot];
    phases.push(
      makeMovePhase(robot, POINTS[team.id].transfer, "Sky受け取りへ移動"),
      makeWaitPhase(scaledDuration(1.4, team), "Sky受け取り", () => {
        if (team.transferSky > 0) {
          team.transferSky -= 1;
          robot.carrying = "sky";
        }
      }),
      makeMovePhase(robot, spot, `${spot.name}へ移動`),
      makeWaitPhase(scaledDuration(3.0, team), `${spot.name}にSky配置`, () => {
        const towerState = state.spots[action.spot];
        if (robot.carrying === "sky" && towerState.earth1 && towerState.earth2 && !towerState.skyColor) {
          towerState.skyColor = team.id;
          towerState.skyPlacedBy = team.id;
          addEvent(team.id, `BRが${spot.name}に自色Sky配置`);
        }
        robot.carrying = null;
      })
    );
  }

  if (action.type === "flipSky") {
    const spot = SPOT_BY_ID[action.spot];
    phases.push(
      makeMovePhase(robot, spot, `${spot.name}へ移動`),
      makeWaitPhase(scaledDuration(2.8, team), `${spot.name}のSky反転`, () => {
        const towerState = state.spots[action.spot];
        if (towerState.earth1 && towerState.earth2 && towerState.skyColor && towerState.skyColor !== team.id) {
          towerState.skyColor = team.id;
          towerState.skyPlacedBy = team.id;
          addEvent(team.id, `BRが${spot.name}のSkyを反転`);
        }
      })
    );
  }

  if (action.type === "placeMustika") {
    phases.push(
      makeMovePhase(robot, POINTS[team.id].transfer, "Mustika受け取りへ移動"),
      makeWaitPhase(scaledDuration(2.0, team), "Mustika受け取り", () => {
        if (team.transferMustika) {
          team.transferMustika = false;
          robot.carrying = "mustika";
        }
      }),
      makeMovePhase(robot, POINTS.pillar, "中央柱へ移動"),
      makeWaitPhase(scaledDuration(5.0, team), "Mustika奉納", () => {
        if (!state.mustikaOwner && robot.carrying === "mustika") {
          team.mustikaPlaced = true;
          state.mustikaOwner = team.id;
          addEvent(team.id, "BRがMustikaを中央柱に奉納");
        }
        robot.carrying = null;
      })
    );
  }

  robot.job = {
    type: `br-${action.type}`,
    phases,
  };
}

function processRobot(robot, team, dt) {
  if (!robot.job || robot.job.phases.length === 0) {
    robot.job = null;
    robot.status = "待機";
    return;
  }

  const phase = robot.job.phases[0];
  robot.status = phase.label;

  if (phase.kind === "move") {
    if (!phase.started) {
      phase.started = true;
      phase.route = routeBetween(robot, phase.to, team.id);
      phase.segmentIndex = 0;
      robot.lastPath = {
        points: [
          { x: robot.x, y: robot.y },
          ...phase.route.map((segment) => segment.to),
        ],
      };
    }

    if (!phase.route || phase.segmentIndex >= phase.route.length) {
      robot.level = levelOf(phase.to);
      robot.job.phases.shift();
      return;
    }

    const segment = phase.route[phase.segmentIndex];
    if (segment.stopSeconds > 0 && segment.stopRemaining === null) {
      segment.stopRemaining = scaledDuration(segment.stopSeconds, team);
      phase.velocity = 0;
    }
    if (segment.stopRemaining > 0) {
      segment.stopRemaining -= dt;
      robot.status = terrainStatus(phase.label, segment.terrain, true);
      return;
    }

    const target = segment.to;
    robot.status = terrainStatus(phase.label, segment.terrain, false);
    const distance = dist(robot, target);
    if (distance < 0.05) {
      robot.x = target.x;
      robot.y = target.y;
      robot.level = levelOf(target);
      phase.segmentIndex += 1;
      phase.velocity = 0;
      return;
    }
    const terrainFactor = terrainSpeedFactor(segment.terrain);
    const speedFactor = Math.max(team.speedFactor, 0.05);
    const maxSpeed = phase.maxSpeed * speedFactor * terrainFactor;
    const maxAccel = phase.maxAccel * speedFactor * terrainFactor;
    const brakingDistance = (phase.velocity * phase.velocity) / (2 * Math.max(maxAccel, 0.001));
    const nextVelocity = distance <= brakingDistance
      ? Math.max(0, phase.velocity - maxAccel * dt)
      : Math.min(maxSpeed, phase.velocity + maxAccel * dt);
    const step = Math.min(distance, ((phase.velocity + nextVelocity) / 2) * dt);
    phase.velocity = nextVelocity;
    robot.x += ((target.x - robot.x) / distance) * step;
    robot.y += ((target.y - robot.y) / distance) * step;
    if (step >= distance - 0.01) {
      robot.x = target.x;
      robot.y = target.y;
      robot.level = levelOf(target);
      phase.segmentIndex += 1;
      phase.velocity = 0;
    }
    return;
  }

  if (phase.kind === "wait") {
    phase.remaining -= dt;
    if (phase.remaining <= 0) {
      if (phase.onComplete) phase.onComplete();
      robot.job.phases.shift();
    }
  }
}

function processTeam(team, dt) {
  updateSanctuary(team);

  if (!team.tr.job) {
    const needed = chooseTrDelivery(team);
    if (needed) startTrJob(team, needed);
  }

  if (!team.br.job) {
    const action = chooseBrAction(team);
    if (action) startBrJob(team, action);
  }

  processRobot(team.tr, team, dt);
  processRobot(team.br, team, dt);
  updateSanctuary(team);
}

function advance(seconds) {
  let remaining = seconds;
  while (remaining > 0 && state.time < MATCH_SECONDS) {
    const dt = Math.min(0.2, remaining, MATCH_SECONDS - state.time);
    state.time += dt;
    processTeam(state.teams.red, dt);
    processTeam(state.teams.blue, dt);
    remaining -= dt;
  }

  if (state.time >= MATCH_SECONDS) {
    state.time = MATCH_SECONDS;
    state.running = false;
    els.playToggle.textContent = "開始";
  }
}

function spotTeamClass(owner) {
  if (owner === "red") return "red";
  if (owner === "blue") return "blue";
  return "empty";
}

function renderSpots() {
  const layer = els.spotLayer;
  layer.innerHTML = "";

  for (const spot of SPOTS) {
    const towerState = state.spots[spot.id];
    const selected = spot.id === selectedSpotId ? " selected" : "";
    const x = spot.x;
    const y = spot.y;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("data-spot", spot.id);

    group.innerHTML = `
      <rect class="spot${selected}" x="${x - 3.3}" y="${y - 3}" width="6.6" height="6" rx="0.6"></rect>
      <rect class="tower-block ${spotTeamClass(towerState.earth1 || "empty")}" x="${x - 2.75}" y="${y - 2.25}" width="1.55" height="4.5" rx="0.22"></rect>
      <rect class="tower-block ${spotTeamClass(towerState.earth2 || "empty")}" x="${x - 0.75}" y="${y - 2.25}" width="1.55" height="4.5" rx="0.22"></rect>
      <rect class="tower-block ${spotTeamClass(towerState.skyColor || "empty")}" x="${x + 1.25}" y="${y - 2.25}" width="1.55" height="4.5" rx="0.22"></rect>
      <text class="spot-mini-label" x="${x - 1.98}" y="${y + 0.45}" text-anchor="middle">1</text>
      <text class="spot-mini-label" x="${x + 0.03}" y="${y + 0.45}" text-anchor="middle">2</text>
      <text class="spot-mini-label" x="${x + 2.03}" y="${y + 0.45}" text-anchor="middle">S</text>
      <text class="spot-label" x="${x}" y="${y + 4.7}" text-anchor="middle">${spot.name}</text>
      <rect class="spot-hit" x="${x - 4.5}" y="${y - 4.5}" width="9" height="10.5" rx="1"></rect>
    `;
    layer.appendChild(group);
  }

  layer.querySelectorAll("[data-spot]").forEach((group) => {
    group.addEventListener("click", () => {
      selectedSpotId = group.getAttribute("data-spot");
      render();
    });
  });
}

function renderRobots() {
  els.robotLayer.innerHTML = "";
  els.pathLayer.innerHTML = "";

  for (const teamId of ["red", "blue"]) {
    const team = state.teams[teamId];
    for (const robot of [team.tr, team.br]) {
      if (robot.lastPath) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        path.setAttribute("class", `path ${teamId}`);
        path.setAttribute("points", robot.lastPath.points.map((point) => `${point.x},${point.y}`).join(" "));
        els.pathLayer.appendChild(path);
      }

      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const radius = robot.type === "tr" ? 2.2 : 2.6;
      const label = robot.type.toUpperCase();
      group.innerHTML = `
        <circle class="robot ${teamId} ${robot.type}" cx="${robot.x.toFixed(2)}" cy="${robot.y.toFixed(2)}" r="${radius}"></circle>
        <text class="robot-label" x="${robot.x.toFixed(2)}" y="${robot.y.toFixed(2)}">${label}</text>
      `;
      els.robotLayer.appendChild(group);
    }
  }
}

function renderScores() {
  const scores = scoreState();
  for (const teamId of ["red", "blue"]) {
    const score = scores[teamId];
    const team = state.teams[teamId];
    $(`${teamId}-score`).textContent = String(score.total);
    $(`${teamId}-breakdown`).textContent = `搬送 ${score.transfer} / 建設 ${score.tower} / ムスティカ ${score.mustika}`;
    const sanctuary = $(`${teamId}-sanctuary`);
    sanctuary.textContent = team.sanctuaryUnlocked ? "Sanctuary 達成" : "Sanctuary 未達";
    sanctuary.className = team.sanctuaryUnlocked ? "flag ok" : "flag";
    $(`${teamId}-action`).textContent = `TR: ${team.tr.status} / BR: ${team.br.status}`;
  }
}

function renderTowerTable() {
  const rows = SPOTS.map((spot) => {
    const towerState = state.spots[spot.id];
    return `
      <tr>
        <td>${spot.name}</td>
        <td><span class="chip ${spotTeamClass(towerState.earth1)}">${ownerShort(towerState.earth1)}</span></td>
        <td><span class="chip ${spotTeamClass(towerState.earth2)}">${ownerShort(towerState.earth2)}</span></td>
        <td><span class="chip ${spotTeamClass(towerState.skyColor)}">${ownerShort(towerState.skyColor)}</span></td>
      </tr>
    `;
  }).join("");
  els.towerTable.innerHTML = rows;
}

function renderLog() {
  const rows = state.events.slice(0, 22).map((event) => {
    const team = event.teamId ? `${teamName(event.teamId)} ` : "";
    return `<li><span class="event-time">${(event.time).toFixed(1)}s</span> ${team}${event.text}</li>`;
  }).join("");
  els.eventLog.innerHTML = rows || "<li>ログなし</li>";
}

function renderComparison(rows) {
  els.comparisonTable.innerHTML = rows.map((row) => {
    const diff = row.red - row.blue;
    const diffText = diff > 0 ? `+${diff}` : String(diff);
    return `
      <tr>
        <td>${row.label}</td>
        <td>${row.red}</td>
        <td>${row.blue}</td>
        <td>${diffText}</td>
      </tr>
    `;
  }).join("");
}

function render() {
  els.matchTime.textContent = fmtTime(state.time);
  els.timeFill.style.width = `${(state.time / MATCH_SECONDS) * 100}%`;
  els.scanLabel.textContent = `${Number(els.scanTime.value).toFixed(1)}秒`;
  const mustika = state.mustikaOwner ? `${teamName(state.mustikaOwner)}奉納済` : state.mustikaInPlay ? "未搬送" : "搬送中";
  els.stockLine.textContent = `Sky残 ${state.skyRemaining} / Mustika ${mustika}`;
  els.selectedSpot.textContent = SPOT_BY_ID[selectedSpotId].name;
  renderSpots();
  renderRobots();
  renderScores();
  renderTowerTable();
  renderLog();
}

function frame(now) {
  if (!lastFrame) lastFrame = now;
  const realDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  if (state.running) {
    const playbackRate = Number(els.playbackRate.value || 1);
    advance(realDt * playbackRate);
    render();
  }

  requestAnimationFrame(frame);
}

function resetSim() {
  state = createInitialState();
  addEvent(null, "試合初期化");
  render();
}

function populateStrategies() {
  const trOptions = Object.entries(TR_STRATEGIES)
    .map(([key, strategy]) => `<option value="${key}">${strategy.label}</option>`)
    .join("");
  const brOptions = Object.entries(BR_STRATEGIES)
    .map(([key, strategy]) => `<option value="${key}">${strategy.label}</option>`)
    .join("");
  els.redTrStrategy.innerHTML = trOptions;
  els.blueTrStrategy.innerHTML = trOptions;
  els.redBrStrategy.innerHTML = brOptions;
  els.blueBrStrategy.innerHTML = brOptions;
  els.redTrStrategy.value = "earthBuffer";
  els.blueTrStrategy.value = "demandPull";
  els.redBrStrategy.value = "l1FastMustika";
  els.blueBrStrategy.value = "l2Value";
}

function addCustom(teamId, step) {
  state.teams[teamId].customBrQueue.push(step);
  addEvent(teamId, `${step.type === "tower" ? "タワー" : "反転"}予約: ${SPOT_BY_ID[step.spot].name}`);
  render();
}

function bindControls() {
  els.playToggle.addEventListener("click", () => {
    state.running = !state.running;
    els.playToggle.textContent = state.running ? "一時停止" : "開始";
    lastFrame = 0;
  });

  els.stepButton.addEventListener("click", () => {
    state.running = false;
    els.playToggle.textContent = "開始";
    advance(10);
    render();
  });

  els.finishButton.addEventListener("click", () => {
    state.running = false;
    els.playToggle.textContent = "開始";
    advance(MATCH_SECONDS - state.time);
    render();
  });

  els.resetButton.addEventListener("click", resetSim);
  els.redSpeed.addEventListener("change", resetSim);
  els.redTrStrategy.addEventListener("change", resetSim);
  els.redBrStrategy.addEventListener("change", resetSim);
  els.blueTrStrategy.addEventListener("change", resetSim);
  els.blueBrStrategy.addEventListener("change", resetSim);
  els.scanTime.addEventListener("input", render);
  els.compareButton.addEventListener("click", () => {
    const originalSpeed = els.redSpeed.value;
    const cases = [
      { value: "1", label: "同等" },
      { value: "0.5", label: "1/2" },
      { value: "0.25", label: "1/4" },
    ];
    const rows = [];
    for (const item of cases) {
      els.redSpeed.value = item.value;
      state = createInitialState();
      advance(MATCH_SECONDS);
      const scores = scoreState();
      rows.push({ label: item.label, red: scores.red.total, blue: scores.blue.total });
    }
    els.redSpeed.value = originalSpeed;
    state = createInitialState();
    addEvent(null, "速度3条件を計算");
    render();
    renderComparison(rows);
  });

  els.redAddTower.addEventListener("click", () => addCustom("red", tower(selectedSpotId)));
  els.blueAddTower.addEventListener("click", () => addCustom("blue", tower(selectedSpotId)));
  els.redAddFlip.addEventListener("click", () => addCustom("red", flip(selectedSpotId)));
  els.blueAddFlip.addEventListener("click", () => addCustom("blue", flip(selectedSpotId)));
  els.clearCustom.addEventListener("click", () => {
    state.teams.red.customBrQueue = [];
    state.teams.blue.customBrQueue = [];
    addEvent(null, "予約をクリア");
    render();
  });
}

function cacheElements() {
  Object.assign(els, {
    matchTime: $("match-time"),
    timeFill: $("time-fill"),
    playToggle: $("play-toggle"),
    stepButton: $("step-button"),
    finishButton: $("finish-button"),
    resetButton: $("reset-button"),
    playbackRate: $("playback-rate"),
    redSpeed: $("red-speed"),
    scanTime: $("scan-time"),
    scanLabel: $("scan-label"),
    redTrStrategy: $("red-tr-strategy"),
    redBrStrategy: $("red-br-strategy"),
    blueTrStrategy: $("blue-tr-strategy"),
    blueBrStrategy: $("blue-br-strategy"),
    compareButton: $("compare-button"),
    comparisonTable: $("comparison-table"),
    selectedSpot: $("selected-spot"),
    redAddTower: $("red-add-tower"),
    blueAddTower: $("blue-add-tower"),
    redAddFlip: $("red-add-flip"),
    blueAddFlip: $("blue-add-flip"),
    clearCustom: $("clear-custom"),
    stockLine: $("stock-line"),
    towerTable: $("tower-table"),
    eventLog: $("event-log"),
    spotLayer: $("spot-layer"),
    pathLayer: $("path-layer"),
    robotLayer: $("robot-layer"),
  });
}

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  populateStrategies();
  bindControls();
  resetSim();
  requestAnimationFrame(frame);
});
