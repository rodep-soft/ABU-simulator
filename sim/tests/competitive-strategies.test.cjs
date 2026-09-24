const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, scanBudget } = require('../engine.js');
const F = require('../field.js');
const C = require('../controllers.js');
const P = require('../score-planner.js');
const W = require('../competitive-strategies.js');
const copy = v => JSON.parse(JSON.stringify(v));
function world(mode, team = 'red') {
  const s = new Simulation({ [`${team}TrPlan`]: 'stock-e3', [`${team}BrPlan`]: mode });
  for (const r of s.robots) r.auto = false;
  const br = s.robot(`${team}BR`);
  Object.assign(br, F.points[team].home, { z: .6, enteredL1: true, brain: { stage: 'choose' } });
  return { s, br, team };
}
function item(s, type, team) { return s.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === team)); }
function hold(s, r, type) {
  const o = item(s, type, r.team); Object.assign(o, { location: 'cargo', holder: r.id, touchedBy: r.id }); r.cargo.push(o.id); s.changed(); return o;
}
function stock(s, team, type) {
  const o = item(s, type, team), slot = s.freeSlot(team, o); assert.ok(slot);
  Object.assign(o, { location: 'transfer', transferTeam: team, slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z }); s.changed(); return o;
}
function tower(s, id, length, team) {
  const p = F.spotById[id];
  while (s.tower(id).length < length) {
    const layer = s.tower(id).length, o = item(s, layer < 2 ? 'earth' : 'sky', team);
    Object.assign(o, { location: 'spot', spotId: id, layer, placedBy: team, color: layer === 2 ? team : null, touchedBy: null,
      x: p.x, y: p.y, z: (p.level === 2 ? .9 : .6) + layer * .35 });
  }
  s.changed();
}
function scan(s, r) { s.observe(r); r.scanLoaded = true; r.batchRemaining = scanBudget(r); r.batchFlips = []; return s.view(r); }
function execute(s, r, response) {
  r.brain = response.brain; s.enqueue(r.id, response.actions);
  while (!s.ended && (r.queue.length || r.job)) s.step(.05);
  assert.equal(r.failure, null);
}

test('all three presets keep first E3 and independent TR/BR catalogs', () => {
  for (const p of W.presets()) {
    assert.equal(p.tr, 'stock-e3'); assert.ok(C.listStrategies('BR').some(b => b.id === p.br));
    const s = new Simulation({ redTrPlan: p.tr, redBrPlan: p.br }); const tr = s.robot('redTR');
    s.observe(tr); const response = C.next(s.view(tr)); assert.equal(s.object(response.actions.at(-1).objectId).type, 'earth');
    assert.deepEqual(response.brain.manifest, { earth: 3, sky: 0 });
  }
});
test('second-layer policy uses rival L2 foundation with E1+S1 in both colors', () => {
  for (const team of ['red', 'blue']) {
    const { s, br } = world('second-layer', team), enemy = team === 'red' ? 'blue' : 'red';
    tower(s, 'u1', 1, enemy); tower(s, 's2', 1, enemy);
    const earth = hold(s, br, 'earth'), sky = hold(s, br, 'sky');
    const response = C.next(scan(s, br));
    assert.deepEqual(response.decision.tasks.map(a => [a.objectId, a.spotId]), [[earth.id, 'u1'], [sky.id, 'u1']]);
    execute(s, br, response); assert.equal(s.scores()[team].tower, 120); assert.equal(s.tower('u1')[0].placedBy, enemy);
  }
});
test('second-layer policy requests E1+S1 rather than E2 when that completion is available', () => {
  const { s, br } = world('second-layer'); tower(s, 'u1', 1, 'blue');
  for (const type of ['earth', 'earth', 'sky']) stock(s, 'red', type);
  const response = C.next(scan(s, br));
  assert.deepEqual(response.actions.filter(a => a.type === 'receive').map(a => s.object(a.objectId).type).sort(), ['earth', 'sky']);
});
test('second-layer policy builds instead of waiting when no rival foundation exists', () => {
  const { s, br } = world('second-layer'); hold(s, br, 'earth'); hold(s, br, 'earth');
  const response = C.next(scan(s, br)); assert.equal(response.decision.tasks.filter(a => a.type === 'place').length, 2);
});
test('score-aware BR changes between protected construction and shared reversal using observed scores only', () => {
  const { s, br } = world('score-adaptive'); tower(s, 'u1', 3, 'blue');
  stock(s, 'red', 'earth'); stock(s, 'red', 'earth');
  s.transferPoints.red = 200; const leading = scan(s, br);
  const defend = W.selectPlan(leading, 'score-adaptive'); assert.ok(defend.tasks.some(a => a.type === 'place' && F.spotById[a.spotId].team === 'red'));
  s.transferPoints.red = 0; Object.assign(s.robot('blueBR'), { x: 4.5, y: 4.5 });
  assert.equal(W.lead(s.view(br)), 60); assert.deepEqual(W.selectPlan(s.view(br), 'score-adaptive').tasks, defend.tasks);
  const attack = W.selectPlan(scan(s, br), 'score-adaptive'); assert.ok(attack.tasks.some(a => a.type === 'flip'));
  assert.equal(attack.assessment.lead, -140);
});
test('scan snapshots include scores and visible enemy pose, never live intentions or mutable references', () => {
  const { s, br } = world('endgame'); const v = scan(s, br), seen = copy(v.observation);
  assert.deepEqual(v.observation.scores, s.scores());
  assert.deepEqual(Object.keys(v.observation.opponentBR).sort(), ['maxSpeed', 'placeSeconds', 'x', 'y', 'z']);
  s.transferPoints.blue = 100; s.robot('blueBR').x = 3;
  assert.deepEqual(s.view(br).observation, seen);
  v.observation.scores.red.total = 999; assert.equal(br.observation.scores.red.total, 0);
});
test('only endgame mode permits one normal block from 150 seconds and rescans after receipt', () => {
  const { s, br } = world('endgame'); const e = stock(s, 'red', 'earth');
  s.time = 149; assert.equal(W.selectPlan(scan(s, br), 'endgame'), null);
  s.time = 150; const response = C.next(scan(s, br));
  assert.deepEqual(response.actions.filter(a => a.type === 'receive').map(a => a.objectId), [e.id]);
  assert.equal(response.actions.at(-1).type, 'scan'); assert.equal(response.decision.assessment.single, true);
  execute(s, br, response); assert.equal(br.cargo.length, 1); assert.ok(br.scanLoaded);
  const place = C.next(s.view(br)); assert.equal(place.decision.tasks.length, 1); execute(s, br, place);
  assert.equal(br.cargo.length, 0); assert.ok(s.scores().red.tower > 0);
});
test('endgame single departure is not held up by a normal TR supply wait', () => {
  const { s, br } = world('endgame'); stock(s, 'red', 'earth');
  const tr = s.robot('redTR'); Object.assign(tr, F.points.red.transferTR); hold(s, tr, 'sky');
  s.time = 151; assert.ok(C.next(scan(s, br)).actions.some(a => a.type === 'receive'));
});
test('endgame refuses impossible late work and keeps other two new modes pair-only', () => {
  for (const id of W.ids) {
    const { s, br } = world(id); stock(s, 'red', 'earth');
    s.time = 150; if (id !== 'endgame') assert.equal(W.selectPlan(scan(s, br), id), null);
    s.time = 179; assert.equal(W.selectPlan(scan(s, br), id), null);
  }
});
test('Sky response estimate accounts for order, stale observations and contact at the buzzer', () => {
  const { s, br } = world('endgame'); tower(s, 'u1', 3, 'red'); tower(s, 'u4', 3, 'red');
  s.time = 176; const v = scan(s, br); v.observation.opponentBR = { x: 4.25, y: 4.25, maxSpeed: .5, placeSeconds: 2.5 };
  const candidate = { state: { towers: copy(v.observation.towers) }, tasks: [{ type: 'flip', spotId: 'u1' }, { type: 'flip', spotId: 'u4' }], taskTimes: [.5, 2], completeSeconds: 2, gain: 160, opponentGain: -160, picked: [] };
  const firstNear = W.replyDamage(v, candidate);
  const reverse = { ...candidate, tasks: [...candidate.tasks].reverse() };
  assert.ok(W.replyDamage(v, reverse) < firstNear);
  const older = copy(v); older.observation.at -= 10; assert.ok(W.replyDamage(older, reverse) >= W.replyDamage(v, reverse));
  const contact = copy(candidate); contact.tasks = [candidate.tasks[0]]; contact.taskTimes = [3]; contact.state.towers.u4 = [];
  assert.equal(W.replyDamage(v, contact), 80);
});
test('order-sensitive flip enumeration keeps both orders and records actual completion estimates', () => {
  const { s, br } = world('endgame'); tower(s, 'u1', 3, 'blue'); tower(s, 'u2', 3, 'blue'); s.time = 160;
  const v = scan(s, br), orders = new Set();
  const selected = P.flipBatch(v, { orderSensitive: true, rank: c => { orders.add(c.tasks.map(a => a.spotId).join(',')); return [c.tasks.length, -c.completeSeconds]; } });
  assert.ok(orders.has('u1,u2') && orders.has('u2,u1'));
  assert.equal(selected.taskTimes.length, selected.tasks.length); assert.equal(selected.taskTimes.at(-1), selected.completeSeconds);
  assert.ok(selected.taskTimes[0] < selected.taskTimes[1]);
});
