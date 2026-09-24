const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, scanBudget } = require('../engine.js');
const F = require('../field.js');
const C = require('../controllers.js');
const P = require('../score-planner.js');
const E = require('../efficient-strategy.js');
const M = require('../match-strategies.js');
function world(mode = 'mustika-fast', team = 'red') {
  const s = new Simulation({ [`${team}TrPlan`]: 'stock-e3', [`${team}BrPlan`]: mode });
  for (const r of s.robots) r.auto = false;
  const tr = s.robot(`${team}TR`), br = s.robot(`${team}BR`);
  Object.assign(tr, F.points[team].transferTR, { z: .6 });
  Object.assign(br, F.points[team].home, { z: .6, enteredL1: true, brain: { stage: 'choose' } });
  return { s, tr, br, team };
}
function source(s, type, team) { return s.objects.find(o => o.type === type && o.location === 'source' && (!o.team || o.team === team)); }
function hold(s, r, type) {
  const o = source(s, type, r.team); Object.assign(o, { location: 'cargo', holder: r.id, touchedBy: r.id }); r.cargo.push(o.id); s.changed(); return o;
}
function stock(s, team, type) {
  const o = source(s, type, team), slot = s.freeSlot(team, o); assert.ok(slot);
  Object.assign(o, { location: 'transfer', transferTeam: team, slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z }); s.changed(); return o;
}
function seed(s, id, length, team = 'blue') {
  const p = F.spotById[id];
  while (s.tower(id).length < length) {
    const layer = s.tower(id).length, o = source(s, layer < 2 ? 'earth' : 'sky', team);
    Object.assign(o, { location: 'spot', spotId: id, layer, x: p.x, y: p.y, z: (p.level === 1 ? .6 : .9) + layer * .35, placedBy: team, color: layer < 2 ? null : team });
  }
  s.changed();
}
function scan(s, r) { s.observe(r); r.scanLoaded = true; r.batchRemaining = scanBudget(r); r.batchFlips = []; return s.view(r); }
function run(s, r, response) {
  r.brain = response.brain || r.brain; s.enqueue(r.id, response.actions);
  for (let i = 0; i < 3600 && (r.job || r.queue.length) && !s.ended; i++) s.step(.05);
  assert.equal(r.failure, null); assert.equal(r.job, null); assert.equal(r.queue.length, 0);
}
const ops = r => (r.actions || []).filter(a => a.type !== 'move' && a.type !== 'scan');

test('both mode presets pair independent TR and BR strategies without mutating metadata', () => {
  const presets = C.listPresets(); assert.deepEqual(presets.map(p => p.id), ['mustika-fast', 'earth-late', 'l2-earth', 'second-layer', 'score-adaptive', 'endgame']);
  for (const p of presets) {
    assert.ok(C.listStrategies('TR').some(s => s.id === p.tr)); assert.ok(C.listStrategies('BR').some(s => s.id === p.br));
  }
  presets[0].tr = 'invalid'; assert.equal(C.listPresets()[0].tr, 'stock-e3');
  assert.deepEqual(C.transportPlan('stock-e3', 0), { earth: 3, sky: 0, label: 'E3', opening: true });
  assert.equal(C.transportPlan('stock-e3', 1).opening, false);
});

test('one observation permits two or more different flips without a home detour', () => {
  for (const mode of ['efficient', 'earth-late']) {
    const { s, br } = world(mode); for (const id of ['u1', 'u2', 'u3']) seed(s, id, 3);
    s.time = 150; scan(s, br);
    const response = C.next(s.view(br)); assert.equal(ops(response).filter(a => a.type === 'flip').length, 3);
    assert.equal(response.actions.some(a => a.type === 'scan'), false);
    const seen = JSON.stringify(br.observation); run(s, br, response);
    assert.equal(JSON.stringify(br.observation), seen); assert.equal(br.batchRemaining, 0);
    assert.deepEqual([...br.batchFlips].sort(), ['u1', 'u2', 'u3']);
    assert.equal(C.next(s.view(br)).actions.at(-1).type, 'scan');
  }
});

test('real scan grants a separate flip budget but does not increase two-block capacity', () => {
  const { s, br } = world(); for (const id of ['u1', 'u2']) seed(s, id, 3);
  run(s, br, { actions: [{ type: 'scan' }] }); assert.equal(br.batchRemaining, 2);
  hold(s, br, 'earth'); hold(s, br, 'earth');
  Object.assign(br, F.spotApproaches(F.spotById.u1, 'red')[0]);
  assert.equal(s.validate(br, { type: 'flip', spotId: 'u1' }).ok, false);
});

test('a visited Sky cannot be flipped again on the same observation', () => {
  const { s, br } = world(); seed(s, 'u1', 3); seed(s, 'u2', 3); scan(s, br);
  run(s, br, { actions: [{ type: 'move', target: F.spotApproaches(F.spotById.u1, 'red')[0] }, { type: 'flip', spotId: 'u1' }] });
  s.tower('u1').at(-1).color = 'blue';
  assert.equal(s.validate(br, { type: 'flip', spotId: 'u1' }).ok, false);
});

test('flip route respects remaining time, fresh observations and deterministic cache results', () => {
  const { s, br } = world('earth-late'); seed(s, 'u1', 3); seed(s, 'u2', 3);
  s.time = 170; const v = scan(s, br), plan = P.flipBatch(v);
  assert.ok(plan && plan.completeSeconds < 10); const before = JSON.stringify(plan);
  s.tower('u2').at(-1).color = 'red'; P.clearCache(); assert.equal(JSON.stringify(P.flipBatch(s.view(br))), before);
  s.time = 179; assert.equal(P.flipBatch(scan(s, br)), null);
});

test('Mustika mode first distributes Earth to one shared and one private spot on both sides', () => {
  for (const team of ['red', 'blue']) {
    const { s, br } = world('mustika-fast', team); hold(s, br, 'earth'); hold(s, br, 'earth');
    const response = C.next(scan(s, br));
    assert.deepEqual(ops(response).map(a => a.spotId).sort(), M.seedSpots(team).sort());
    run(s, br, response); for (const id of M.seedSpots(team)) assert.equal(s.tower(id).length, 1);
  }
});

test('Mustika mode completes an unassisted foundation or flips a rival cap for eligibility', () => {
  for (const assisted of [false, true]) {
    const { s, br } = world(); seed(s, 'r2', 3, 'red'); seed(s, 's2', assisted ? 3 : 1);
    if (!assisted) { hold(s, br, 'earth'); hold(s, br, 'sky'); }
    const response = C.next(scan(s, br));
    if (assisted) assert.deepEqual(ops(response).map(a => [a.type, a.spotId]), [['flip', 's2']]);
    else assert.deepEqual(ops(response).map(a => [a.type, a.spotId]), [['place', 's2'], ['place', 's2']]);
    run(s, br, response); assert.notEqual(s.sanctuary.red, null);
  }
});

test('Earth mode chooses L2 Earth over early flip wars; if L2 is full it builds private L1', () => {
  const { s, br } = world('earth-late'); seed(s, 'u1', 3); seed(s, 'u2', 3);
  hold(s, br, 'earth'); hold(s, br, 'earth');
  const plan = C.next(scan(s, br)); assert.equal(ops(plan).length, 2);
  assert.ok(ops(plan).every(a => a.type === 'place' && F.spotById[a.spotId].level === 2));
  seed(s, 'u3', 3); seed(s, 'u4', 3);
  const fallback = C.next(scan(s, br)); assert.ok(ops(fallback).every(a => a.type === 'place' && F.spotById[a.spotId].team === 'red'));
});

test('150 seconds switches the next plan from Earth to Sky without new live perception', () => {
  const { s, br } = world('earth-late'); seed(s, 'u1', 2); seed(s, 'u2', 2);
  for (const type of ['earth', 'earth', 'sky', 'sky']) stock(s, 'red', type);
  s.time = 149; const v = scan(s, br), early = M.selectPlan(v, 'earth-late');
  assert.ok(early.tasks.every(a => a.type === 'place' && s.object(a.objectId).type === 'earth'));
  s.time = 150; const late = M.selectPlan(s.view(br), 'earth-late');
  assert.ok(late.tasks.every(a => a.type === 'place' && s.object(a.objectId).type === 'sky'));
  assert.equal(s.view(br).observation.at, 149);
});

test('a mixed Earth/Sky batch still places its Earth on L2 before private L1', () => {
  const { s, br } = world('earth-late'); seed(s, 'u1', 2);
  hold(s, br, 'earth'); hold(s, br, 'sky');
  const response = C.next(scan(s, br));
  const earth = ops(response).find(a => a.type === 'place' && s.object(a.objectId).type === 'earth');
  assert.ok(earth); assert.equal(F.spotById[earth.spotId].level, 2);
});

test('stock TR adapts uncollected items to newly observed Earth shortage, without changing held cargo', () => {
  const { s, tr } = world('earth-late'); stock(s, 'red', 'earth'); const sky = hold(s, tr, 'sky');
  tr.transport.completed = [{ items: [] }]; tr.brain = { stage: 'collect', trip: 1, manifest: { earth: 0, sky: 3 } };
  const response = C.next(scan(s, tr)); assert.deepEqual(response.brain.manifest, { earth: 2, sky: 1 });
  assert.equal(s.object(response.actions.at(-1).objectId).type, 'earth'); assert.deepEqual(tr.cargo, [sky.id]);
});

test('a full BR batch does not wait for unrelated TR unloading', () => {
  const { s, tr, br } = world('earth-late'); hold(s, br, 'earth'); hold(s, br, 'earth'); hold(s, tr, 'sky');
  const response = C.next(scan(s, br)); assert.equal(ops(response).filter(a => a.type === 'place').length, 2);
});

test('stock targets are E3/S4, account for BR returns and ignore inaccessible Sky source', () => {
  const { s, tr, br } = world(); assert.deepEqual(F.stockLimits, { earth: 3, sky: 4 });
  for (let i = 0; i < 3; i++) stock(s, 'red', 'earth');
  assert.deepEqual(E.stockDemand(scan(s, tr)), { earth: 0, sky: 3 });
  for (let i = 0; i < 2; i++) stock(s, 'red', 'sky'); hold(s, br, 'sky'); hold(s, br, 'sky');
  assert.deepEqual(E.stockDemand(scan(s, tr)), { earth: 0, sky: 0 });
  const v = scan(s, tr); v.observation.stock = []; v.observation.partner.cargo = [];
  v.observation.source = v.observation.source.filter(o => o.type !== 'sky' || o.x > 5.51);
  assert.deepEqual(E.stockDemand(v), { earth: 3, sky: 0 });
});

test('TR can unload Sky before a blocked Earth, preserving transport IDs and points', () => {
  const { s, tr } = world(); for (let i = 0; i < 3; i++) stock(s, 'red', 'earth');
  const e = hold(s, tr, 'earth'), sky = hold(s, tr, 'sky'); tr.transport.completed = [{ items: [] }];
  tr.brain = { stage: 'deliver', trip: 1, manifest: { earth: 1, sky: 1 } };
  const response = C.next(scan(s, tr)); assert.equal(response.actions[0].objectId, sky.id);
  run(s, tr, response); assert.deepEqual(tr.cargo, [e.id]); assert.equal(s.transferPoints.red, 5);
  const pause = C.next(scan(s, tr)); assert.deepEqual(pause.actions[0].target, F.points.red.stockStandby);
  run(s, tr, pause); assert.ok(C.next(scan(s, tr)).wait > 0);
});

test('stock mode preserves the first E3 trip even with early eligibility', () => {
  const { s, tr } = world(); s.sanctuary.red = 0;
  const response = C.next(scan(s, tr)); assert.equal(s.object(response.actions.at(-1).objectId).type, 'earth');
});

test('Mustika mode completes eligibility and enshrines in a real solo match with or without rival assistance', () => {
  for (const assisted of [false, true]) {
    const s = new Simulation({ redTrPlan: 'stock-e3', redBrPlan: 'mustika-fast' });
    for (const r of s.robots.filter(r => r.team === 'blue')) r.auto = false;
    let injected = false;
    while (!s.ended) {
      s.step(.05, C);
      if (assisted && !injected && s.tower('s2').length === 1 && s.tower('r2').length === 1) { seed(s, 's2', 3); injected = true; }
    }
    const places = s.events.filter(e => e.robot === 'redBR' && e.kind === 'action' && e.action === 'place');
    assert.deepEqual(places.slice(0, 2).map(e => e.spotId).sort(), ['r2', 's2']);
    assert.deepEqual(s.robot('redTR').transport.completed[0].items.map(o => o.type), ['earth', 'earth', 'earth']);
    assert.notEqual(s.sanctuary.red, null); assert.equal(s.scores().red.mustika, 250, `assistance=${assisted}`);
    if (assisted) assert.ok(s.events.some(e => e.action === 'flip' && e.kind === 'action' && e.spotId === 's2'));
  }
});
