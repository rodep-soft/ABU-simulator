const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, distance, box, overlap } = require('../engine.js');
const F = require('../field.js');
const P = require('../score-planner.js');
const C = require('../controllers.js');

function world(config = {}, team = 'red') {
  const s = new Simulation({ redBrPlan: 'score-search', blueBrPlan: 'score-search', ...config });
  for (const r of s.robots) r.auto = false;
  const r = s.robot(`${team}BR`);
  Object.assign(r, F.points[team].home, { z: .6, enteredL1: true, brain: { stage: 'choose' } });
  return { s, r };
}
function source(s, type, team = 'red') {
  return s.objects.find(o => o.type === type && o.location === 'source' && (type !== 'earth' || o.team === team));
}
function hold(s, r, type) {
  const o = source(s, type, r.team);
  Object.assign(o, { location: 'cargo', holder: r.id, touchedBy: r.id }); r.cargo.push(o.id); s.changed(); return o;
}
function stock(s, r, type) {
  const o = source(s, type, r.team), slot = s.freeSlot(r.team, o); assert.ok(slot);
  Object.assign(o, { location: 'transfer', transferTeam: r.team, slot: slot.id, x: slot.x, y: slot.y, z: slot.z, layer: slot.layer });
  s.changed(); return o;
}
function seed(s, id, earths, color) {
  const spot = F.spotById[id];
  for (const [type, team] of [...earths.map(team => ['earth', team]), ...(color ? [['sky', color]] : [])]) {
    const o = source(s, type, team), layer = s.tower(id).length;
    Object.assign(o, { location: 'spot', spotId: id, placedBy: team, color: type === 'sky' ? team : null, layer,
      x: spot.x, y: spot.y, z: (spot.level === 1 ? .6 : .9) + layer * .35 });
  }
  s.changed();
}
function scan(s, r) { s.observe(r); r.scanLoaded = true; r.batchRemaining = Math.max(1, r.cargo.length); return s.view(r); }
function execute(s, r, response) {
  r.brain = response.brain; s.enqueue(r.id, response.actions);
  for (let i = 0; i < 3600 && (r.queue.length || r.job) && !s.ended; i++) s.step(.05);
  assert.equal(r.failure, null); assert.equal(r.job, null); assert.equal(r.queue.length, 0);
}
const ops = response => response.actions.filter(a => a.type !== 'move');

test('both teams default to efficient search; first action and each completed batch return to scan', () => {
  const s = new Simulation();
  for (const team of ['red', 'blue']) {
    const r = s.robot(`${team}BR`); assert.equal(s.config[`${team}BrPlan`], 'efficient');
    assert.deepEqual(ops(C.next(s.view(r))).map(a => a.type), ['scan']);
    Object.assign(r, F.points[team].home); scan(s, r); r.brain.stage = 'return';
    assert.deepEqual(ops(C.next(s.view(r))).map(a => a.type), ['scan']);
  }
});

test('supply at the source or on TR is not available BR stock', () => {
  const { s, r } = world(); hold(s, s.robot('redTR'), 'earth');
  const v = scan(s, r), before = JSON.stringify(v);
  assert.equal(P.plan(v), null); assert.equal(JSON.stringify(v), before);
  assert.ok(P.next(v).wait > 0);
});

test('two Earths maximize known points on L2, with only one fixed two-placement batch', () => {
  for (const team of ['red', 'blue']) {
    const { s, r } = world({}, team); hold(s, r, 'earth'); hold(s, r, 'earth');
    const v = scan(s, r), plan = P.plan(v), response = P.next(v), before = s.scores()[team].total;
    assert.equal(plan.gain, 60); assert.equal(plan.horizonGain, 60);
    assert.equal(plan.tasks.length, 2); assert.equal(plan.tasks[0].spotId, plan.tasks[1].spotId);
    assert.equal(F.spotById[plan.tasks[0].spotId].level, 2);
    assert.deepEqual(ops(response).map(a => a.type), ['place', 'place']);
    const observed = JSON.stringify(r.observation); execute(s, r, response);
    assert.equal(s.scores()[team].total - before, plan.gain);
    assert.equal(JSON.stringify(r.observation), observed); assert.equal(r.batchRemaining, 0);
    assert.deepEqual(ops(P.next(s.view(r))).map(a => a.type), ['scan']);
  }
});

test('short remaining time changes the plan from L2 to a reachable L1 score', () => {
  const { s, r } = world(); hold(s, r, 'earth'); hold(s, r, 'earth');
  const early = P.plan(scan(s, r)); assert.equal(early.gain, 60);
  s.time = 173; const late = P.plan(scan(s, r));
  assert.ok(late); assert.ok(late.completeSeconds < 7); assert.ok(late.gain > 0 && late.gain < early.gain);
  assert.ok(late.tasks.every(a => F.spotById[a.spotId].level === 1));
  s.time = 179; assert.equal(P.plan(scan(s, r)), null);
});

test('movement estimate scales speed and acceleration but not scan or handling duration', () => {
  const seconds = [];
  for (const factor of [1, .75, .5, .25]) {
    const { s, r } = world({ redSpeed: factor }); hold(s, r, 'earth'); hold(s, r, 'earth');
    const v = scan(s, r), plan = P.plan(v); seconds.push(plan.completeSeconds);
    assert.equal(v.motion.speedFactor, factor); assert.equal(v.motion.scanSeconds, 1); assert.equal(plan.gain, 60);
    assert.equal(v.motion.blueSpeed, undefined); assert.equal(v.robots, undefined);
  }
  for (let i = 1; i < seconds.length; i++) assert.ok(seconds[i] > seconds[i - 1]);
});

test('same legal route has the same terrain-aware time estimate as the executor', () => {
  for (const factor of [1, .5]) {
    const { s, r } = world({ redSpeed: factor });
    const target = F.spotApproaches(F.spotById.u1, 'red')[0], route = s.findPath(r, target);
    assert.ok(route); const estimate = P.travelSeconds(r, route, s.view(r).motion);
    execute(s, r, { brain: r.brain, actions: [{ type: 'move', target }] });
    assert.ok(Math.abs(s.time - estimate) < .2, `estimated ${estimate}, actual ${s.time}`);
    const noPause = P.travelSeconds(F.points.red.home, route, { ...s.view(r).motion, stairPause: 0 });
    assert.ok(estimate > noPause);
  }
});

test('observed opponent towers can be flipped, but only after returning to the home', () => {
  const { s, r } = world(); seed(s, 's2', ['blue', 'blue'], 'blue'); seed(s, 'u1', ['blue', 'blue'], 'blue');
  const v = scan(s, r), plan = P.plan(v);
  assert.equal(plan.tasks[0].type, 'flip'); assert.ok(['u1', 's2'].includes(plan.tasks[0].spotId)); assert.equal(plan.horizonGain, 120);
  const before = s.scores().red.total; execute(s, r, P.next(v));
  assert.equal(s.scores().red.total - before, plan.gain); assert.equal(s.scores().blue.tower, 210 - plan.gain);
  assert.equal(ops(P.next(s.view(r)))[0].type, 'scan');
});

test('a changed live tower does not leak into a stale observation; invalid work returns to scan', () => {
  const { s, r } = world(); seed(s, 's2', ['blue', 'blue'], 'blue');
  const v = scan(s, r), planned = P.next(v); s.tower('s2').at(-1).color = 'red';
  assert.deepEqual(P.next(s.view(r)), planned);
  r.failure = { reason: 'changed' }; Object.assign(r, F.spotApproaches(F.spotById.s2, 'red')[0]);
  assert.deepEqual(ops(P.next(s.view(r))).map(a => a.type), ['scan']);
});

test('mixed Earth1 foundation can be completed with E1+S1 in the correct order', () => {
  const { s, r } = world(); seed(s, 'u1', ['blue']); hold(s, r, 'sky'); hold(s, r, 'earth');
  const v = scan(s, r), p = P.plan(v);
  assert.equal(p.gain, 120); assert.deepEqual(p.tasks.map(a => a.spotId), ['u1', 'u1']);
  assert.deepEqual(p.tasks.map(a => s.object(a.objectId).type), ['earth', 'sky']);
  execute(s, r, P.next(v)); assert.equal(s.scores().red.tower, 120); assert.equal(s.scores().blue.tower, 20);
});

test('typed stock receipt obeys two-item capacity and a new scan before work', () => {
  const { s, r } = world(); seed(s, 'u1', ['blue']);
  const e = stock(s, r, 'earth'), sky = stock(s, r, 'sky');
  const v = scan(s, r), p = P.plan(v), response = P.next(v);
  assert.notEqual(e.slot, sky.slot); assert.deepEqual([...p.picked].sort(), [sky.id, e.id].sort()); assert.equal(p.gain, 120);
  assert.deepEqual(ops(response).map(a => a.type), ['receive', 'receive', 'scan']);
  execute(s, r, response); assert.equal(r.cargo.length, 2); assert.equal(r.scanLoaded, true);
  assert.equal(r.observation.stock.length, 0); assert.equal(P.plan(s.view(r)).gain, 120);
});

test('two-sortie search can recover own Earth and move it to a more valuable layer', () => {
  const { s, r } = world(); seed(s, 'r2', ['red']); seed(s, 'u1', ['blue']);
  const v = scan(s, r), p = P.plan(v);
  assert.equal(p.tasks.length, 1); assert.equal(p.tasks[0].type, 'recover'); assert.equal(p.tasks[0].spotId, 'r2');
  assert.equal(p.gain, -10); assert.equal(p.horizonGain, 30);
  execute(s, r, P.next(v)); assert.equal(r.cargo.length, 1); assert.equal(r.scanLoaded, false);
  execute(s, r, P.next(s.view(r))); assert.equal(r.scanLoaded, true);
  const next = P.plan(s.view(r)); assert.equal(next.gain, 40); assert.equal(next.tasks[0].spotId, 'u1');
});

test('opponent Earth is not recoverable, nor is Earth underneath a Sky', () => {
  const { s, r } = world(); seed(s, 's1', ['blue']); seed(s, 'r2', ['red', 'red'], 'red');
  assert.equal(P.plan(scan(s, r)), null);
});

test('Mustika requires the observed mandate and receipt; it never ends the match', () => {
  const { s, r } = world(), tr = s.robot('redTR'); hold(s, tr, 'mustika');
  Object.assign(tr, F.points.red.transferTR, { z: .6 });
  assert.equal(P.plan(scan(s, r)), null);
  s.sanctuary.red = 0; execute(s, r, C.next(scan(s, r)));
  const p = P.plan(s.view(r));
  assert.equal(p.horizonGain, 250); assert.deepEqual(p.picked, []); assert.equal(p.tasks[0].type, 'enshrine');
  execute(s, r, P.next(s.view(r)));
  assert.equal(s.scores().red.mustika, 250); assert.equal(s.ended, false);
  execute(s, r, P.next(s.view(r))); seed(s, 's2', ['blue', 'blue'], 'blue');
  const after = P.plan(scan(s, r)); assert.equal(after.tasks[0].type, 'flip'); assert.equal(after.gain, 40);
});

test('mandate alone gets no speculative Mustika points from undelivered supply', () => {
  const { s, r } = world(); seed(s, 'r2', ['red', 'red'], 'red'); seed(s, 's2', ['red', 'red'], 'blue');
  const p = P.plan(scan(s, r)); assert.equal(p.horizonGain, 40); assert.equal(p.state.sanctuary, true);
});

test('an unscored Sky can be made scoring by a legal reorientation', () => {
  const { s, r } = world(); seed(s, 's2', ['blue', 'blue'], 'blue'); s.tower('s2').at(-1).color = null;
  const p = P.plan(scan(s, r)); assert.equal(p.gain, 40); assert.equal(p.tasks[0].type, 'flip');
});

test('the execution collision boundary still permits a dynamic route away from the other BR', () => {
  const { s, r } = world(), other = s.robot('blueBR');
  Object.assign(r, { x: 5.7575, y: 5.95, z: .9 });
  Object.assign(other, { x: 5.2425, y: 5.95, z: .9, enteredL1: true });
  assert.equal(overlap(box(r, .515), box(other, .515)), false);
  assert.equal(s.obstacleFree(r, r, true), true);
  const route = s.findPath(r, F.points.red.home, true); assert.ok(route);
  assert.ok(route.length > 0); let previous = r;
  for (const p of route) { assert.equal(s.segmentAllowed(r, previous, p, true), true); previous = p; }
});

test('planner choices and predictions are retained in snapshots and exported logs', () => {
  const { s, r } = world(); hold(s, r, 'earth'); hold(s, r, 'earth'); scan(s, r); r.auto = true;
  s.step(.05, C); const e = s.export().events.find(e => e.action === 'plan');
  assert.equal(e.robot, 'redBR'); assert.equal(e.decision.horizonGain, 60);
  assert.equal(s.snapshot().robots.find(r => r.id === 'redBR').decision.at, 0);
  assert.ok(e.decision.candidates > 1); assert.ok(distance(r, F.points.red.home) > 0);
});

test('opposing BRs get home without synchronized detour oscillation or body overlap', () => {
  for (const reverse of [false, true]) {
    const { s, r } = world(), other = s.robot('blueBR');
    for (const id of ['u1', 'u2', 'u3', 'u4']) seed(s, id, ['red', 'blue'], 'blue');
    Object.assign(r, { x: 5.7575, y: 5.95, z: .9 });
    Object.assign(other, { x: 5.2425, y: 5.95, z: .9, enteredL1: true });
    if (reverse) s.robots.reverse();
    for (const br of [r, other]) s.enqueue(br.id, { type: 'move', target: F.points[br.team].home });
    for (let i = 0; i < 800 && [r, other].some(br => br.queue.length || br.job); i++) {
      s.step(.05); assert.equal(overlap(box(r, .515), box(other, .515)), false);
    }
    for (const br of [r, other]) assert.ok(distance(br, F.points[br.team].home) < .01, `${br.id} remains at ${br.x},${br.y}`);
  }
});
