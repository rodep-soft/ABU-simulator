"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "results");

const SPOTS = [
  { id: "l1sA", name: "L1共有上", level: 1, shared: true, side: null },
  { id: "l1sB", name: "L1共有下", level: 1, shared: true, side: null },
  { id: "r1", name: "赤L1上", level: 1, shared: false, side: "red" },
  { id: "r2", name: "赤L1下", level: 1, shared: false, side: "red" },
  { id: "b1", name: "青L1上", level: 1, shared: false, side: "blue" },
  { id: "b2", name: "青L1下", level: 1, shared: false, side: "blue" },
  { id: "l2a", name: "L2左上", level: 2, shared: true, side: null },
  { id: "l2b", name: "L2右上", level: 2, shared: true, side: null },
  { id: "l2c", name: "L2左下", level: 2, shared: true, side: null },
  { id: "l2d", name: "L2右下", level: 2, shared: true, side: null },
];

const SPOT_BY_ID = Object.fromEntries(SPOTS.map((spot) => [spot.id, spot]));
const ITEM_LABEL = { earth: "Earth", sky: "Sky", mustika: "Mustika" };

function emptyTowers() {
  return Object.fromEntries(SPOTS.map((spot) => [spot.id, {
    earth1: null,
    earth2: null,
    skyColor: null,
  }]));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cargoCombos(items, maxItems, options = {}) {
  const results = [];

  function dfs(start, picked) {
    if (picked.length > 0) {
      results.push(picked.slice());
    }
    if (picked.length >= maxItems) return;
    for (let i = start; i < items.length; i += 1) {
      const next = items[i];
      if (next === "mustika" && picked.length > 0) continue;
      if (picked.includes("mustika")) continue;
      const count = picked.filter((item) => item === next).length;
      const limit = options.limits?.[next] ?? maxItems;
      if (count >= limit) continue;
      dfs(i, [...picked, next]);
    }
  }

  dfs(0, []);
  return results;
}

function cargoText(cargo) {
  const counts = cargo.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([item, count]) => `${ITEM_LABEL[item]}x${count}`)
    .join("+");
}

function action(id, actor, type, label, extra = {}) {
  return { id, actor, type, label, ...extra };
}

function enumerateTrActions(state, teamId = "red") {
  const actions = [];
  const cargoes = cargoCombos(["earth", "sky"], 3);

  for (const cargo of cargoes) {
    const needSky = cargo.filter((item) => item === "sky").length;
    if (needSky > state.skyRemaining) continue;
    actions.push(action(
      `tr-deliver-${cargo.join("-")}`,
      "TR",
      "deliverToTransfer",
      `${cargoText(cargo)}を取りに行ってTransferへ搬送`,
      { cargo, to: "transfer" }
    ));
  }

  if (state.sanctuaryUnlocked || state.sanctuaryLikelySoon) {
    actions.push(action(
      "tr-fetch-mustika",
      "TR",
      "deliverToTransfer",
      "Mustikaを取りに行ってTransferへ搬送",
      { cargo: ["mustika"], to: "transfer" }
    ));
    actions.push(action(
      "tr-wait-mustika-source",
      "TR",
      "preposition",
      "Sanctuary達成を見越してMustika付近で待機",
      { point: "mustikaSource" }
    ));
  }

  actions.push(
    action("tr-wait-earth", "TR", "preposition", "Earth置き場付近で待機", { point: `${teamId}EarthSource` }),
    action("tr-wait-sky", "TR", "preposition", "Sky置き場付近で待機", { point: "skyShare" }),
    action("tr-wait-transfer", "TR", "wait", "Transfer付近で待機", { point: `${teamId}Transfer` })
  );

  return actions;
}

function nextEarthLayer(tower) {
  if (!tower.earth1) return "earth1";
  if (!tower.earth2) return "earth2";
  return null;
}

function canPlaceSky(tower) {
  return Boolean(tower.earth1 && tower.earth2 && !tower.skyColor);
}

function enumerateSingleBrActions(state, teamId = "red") {
  const actions = [];

  for (const spot of SPOTS) {
    const tower = state.towers[spot.id];
    const earthLayer = nextEarthLayer(tower);
    if (earthLayer) {
      const poach = earthLayer === "earth2" && tower.earth1 !== teamId;
      actions.push(action(
        `br-place-earth-${spot.id}-${earthLayer}`,
        "BR",
        poach ? "poachEarth" : "placeEarth",
        `${spot.name}の${earthLayer === "earth1" ? "1段目" : "2段目"}にEarth配置${poach ? "（相手1段目に便乗）" : ""}`,
        { cargo: ["earth"], spotId: spot.id, layer: earthLayer, poach }
      ));
    }

    if (canPlaceSky(tower)) {
      const poach = tower.earth1 !== teamId || tower.earth2 !== teamId;
      actions.push(action(
        `br-place-sky-${spot.id}`,
        "BR",
        poach ? "poachSky" : "placeSky",
        `${spot.name}にSky配置${poach ? "（相手/混色タワーを奪取）" : ""}`,
        { cargo: ["sky"], spotId: spot.id, poach }
      ));
    }

    if (tower.earth1 && tower.earth2 && tower.skyColor && tower.skyColor !== teamId) {
      actions.push(action(
        `br-flip-sky-${spot.id}`,
        "BR",
        "flipSky",
        `${spot.name}の完成済みSkyを反転`,
        { cargo: [], spotId: spot.id }
      ));
    }
  }

  if (state.transfer.mustika > 0 || state.sanctuaryUnlocked) {
    actions.push(action(
      "br-place-mustika",
      "BR",
      "placeMustika",
      "Mustikaを受け取って中央柱へ奉納",
      { cargo: ["mustika"], point: "pillar" }
    ));
  }

  if (state.sanctuaryLikelySoon || state.sanctuaryUnlocked) {
    actions.push(
      action("br-wait-transfer-mustika", "BR", "preposition", "Mustika受け取りを見越してTransfer付近で待機", { point: "transfer" }),
      action("br-wait-pillar", "BR", "preposition", "Mustika奉納を見越して中央柱付近で待機", { point: "pillar" })
    );
  }

  actions.push(action("br-scan-home", "BR", "scan", "ホームポジションで停止して画像認識", { point: "brHome" }));
  return actions;
}

function applyPrimitive(towers, teamId, primitive) {
  const next = clone(towers);
  const tower = next[primitive.spotId];
  if (primitive.type === "placeEarth" || primitive.type === "poachEarth") {
    tower[primitive.layer] = teamId;
  }
  if (primitive.type === "placeSky" || primitive.type === "poachSky") {
    tower.skyColor = teamId;
  }
  if (primitive.type === "flipSky") {
    tower.skyColor = teamId;
  }
  return next;
}

function enumerateBrCarrySequences(state, teamId = "red") {
  const primitives = enumerateSingleBrActions(state, teamId)
    .filter((item) => ["placeEarth", "poachEarth", "placeSky", "poachSky", "flipSky"].includes(item.type));
  const sequences = [];

  for (const first of primitives) {
    const firstCargo = first.cargo || [];
    if (firstCargo.length > 2) continue;
    sequences.push(action(
      `br-seq-${first.id}`,
      "BR",
      "carrySequence",
      `BR最大2個: ${first.label}`,
      { steps: [first], cargo: firstCargo }
    ));

    const afterFirst = { ...state, towers: applyPrimitive(state.towers, teamId, first) };
    const secondCandidates = enumerateSingleBrActions(afterFirst, teamId)
      .filter((item) => ["placeEarth", "poachEarth", "placeSky", "poachSky", "flipSky"].includes(item.type));

    for (const second of secondCandidates) {
      const cargo = [...firstCargo, ...(second.cargo || [])];
      if (cargo.length > 2) continue;
      if (cargo.includes("mustika") && cargo.length > 1) continue;
      sequences.push(action(
        `br-seq-${first.id}--${second.id}`,
        "BR",
        "carrySequence",
        `BR最大2個: ${first.label} → ${second.label}`,
        { steps: [first, second], cargo }
      ));
    }
  }

  return sequences;
}

function makeScenario(name, configure) {
  const state = {
    name,
    skyRemaining: 12,
    sanctuaryUnlocked: false,
    sanctuaryLikelySoon: false,
    transfer: { earth: 2, sky: 2, mustika: 0 },
    towers: emptyTowers(),
  };
  configure(state);
  return state;
}

const scenarios = [
  makeScenario("初期状態", () => {}),
  makeScenario("相手が1段だけ置いた状態", (state) => {
    state.towers.l1sA.earth1 = "blue";
    state.towers.l2a.earth1 = "blue";
  }),
  makeScenario("相手が完成タワーを持つ状態", (state) => {
    state.towers.l1sA.earth1 = "blue";
    state.towers.l1sA.earth2 = "blue";
    state.towers.l1sA.skyColor = "blue";
    state.towers.r1.earth1 = "red";
    state.towers.r1.earth2 = "red";
  }),
  makeScenario("Sanctuary目前", (state) => {
    state.sanctuaryLikelySoon = true;
    state.towers.l1sA.earth1 = "red";
    state.towers.l1sA.earth2 = "red";
    state.towers.l1sA.skyColor = "red";
    state.towers.r1.earth1 = "red";
    state.towers.r1.earth2 = "red";
    state.transfer.sky = 1;
  }),
  makeScenario("Sanctuary達成済み", (state) => {
    state.sanctuaryUnlocked = true;
    state.transfer.mustika = 1;
    state.towers.l1sA.earth1 = "red";
    state.towers.l1sA.earth2 = "red";
    state.towers.l1sA.skyColor = "red";
    state.towers.r1.earth1 = "red";
    state.towers.r1.earth2 = "red";
    state.towers.r1.skyColor = "red";
  }),
];

function summarize(actions) {
  return actions.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
}

const catalog = scenarios.map((scenario) => {
  const trActions = enumerateTrActions(scenario);
  const brPrimitiveActions = enumerateSingleBrActions(scenario);
  const brCarrySequences = enumerateBrCarrySequences(scenario);
  return {
    scenario: scenario.name,
    counts: {
      tr: trActions.length,
      brPrimitive: brPrimitiveActions.length,
      brCarrySequences: brCarrySequences.length,
    },
    summaries: {
      tr: summarize(trActions),
      brPrimitive: summarize(brPrimitiveActions),
      brCarrySequences: summarize(brCarrySequences),
    },
    trActions,
    brPrimitiveActions,
    brCarrySequences,
  };
});

function bulletSamples(title, actions, count = 12) {
  return [
    `### ${title}`,
    "",
    ...actions.slice(0, count).map((item) => `- ${item.label}`),
    actions.length > count ? `- ...ほか${actions.length - count}件` : null,
    "",
  ].filter(Boolean);
}

const report = [
  "# ABU Robocon 2027 action space catalog",
  "",
  "現時点で探索器へ入れるべき行動候補の辞書です。これは得点探索そのものではなく、探索前の「何を選択肢として認めるか」の確認用です。",
  "",
  "## 含める行動",
  "",
  "- TR: Earth/Skyの1から3個搬送",
  "- TR: Sanctuary達成を見越したMustika付近待機、Mustika搬送",
  "- BR: Earth配置、Sky配置、Sky反転",
  "- BR: 相手の1段目Earthに自分のEarthを2段目として置く",
  "- BR: 相手/混色のEarth2段タワーにSkyを置いて奪う",
  "- BR: Earth+Skyを最大2個保持して、相手1段目から即完成させる漁夫シーケンス",
  "- BR: Mustika受け取り待機、中央柱待機、Mustika奉納",
  "- BR: ホームポジションでの画像認識停止",
  "",
  "## まだ探索評価に入っていないもの",
  "",
  "- ロボット同士の衝突、ブロッキング、進路妨害",
  "- 相手の未来行動の確率分布",
  "- フィールド上で荷物を途中置きする行動",
  "- ルール上の審判判断が必要な危険操作",
  "",
  ...catalog.flatMap((entry) => [
    `## ${entry.scenario}`,
    "",
    `- TR候補: ${entry.counts.tr}`,
    `- BR単発候補: ${entry.counts.brPrimitive}`,
    `- BR最大2個シーケンス候補: ${entry.counts.brCarrySequences}`,
    "",
    ...bulletSamples("TR候補例", entry.trActions, 8),
    ...bulletSamples("BR単発候補例", entry.brPrimitiveActions, 10),
    ...bulletSamples("BR最大2個シーケンス例", entry.brCarrySequences, 14),
  ]),
].join("\n");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "action_space_catalog.json"), JSON.stringify({ catalog }, null, 2), "utf8");
fs.writeFileSync(path.join(OUT_DIR, "action_space_catalog.md"), report, "utf8");

console.log(report);
