const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, distance, box, overlap } = require('../engine.js');
const F = require('../field.js');
const C = require('../controllers.js');

function jam(team = 'red', config = {}) {
  const s = new Simulation(config);
  for (const r of s.robots) r.auto = false;
  const r = s.robot(`${team}BR`), other = s.robot(`${team === 'red' ? 'blue' : 'red'}BR`);
  const position = team === 'red' ? { x: 5.1, y: 4.9 } : { x: 5.9, y: 4.9 };
  const direction = team === 'red' ? 1 : -1;
  Object.assign(r, position, { z: .9, enteredL1: true, auto: true });
  Object.assign(other, { x: r.x + direction * .515, y: r.y, z: .9, enteredL1: true });
  const target = { x: r.x + direction * .8, y: r.y };
  r.job = { type: 'move', target, destination: target, route: [target] };
  r.queue = [{ type: 'flip', spotId: 'u1' }];
  s.observe(r); r.scanLoaded = true; r.batchRemaining = 2;
  r.decision = { summary: 'stale plan' };
  // Deliberately hold the impasse when testing the fallback, independent of A* detours.
  s.findPath = () => null;
  return { s, r, other, target };
}
function advance(s, seconds, controllers) {
  const end = Math.min(180, s.time + seconds);
  while (s.time < end - 1e-8) s.step(Math.min(.05, end - s.time), controllers);
}
function hold(s, r, ids) {
  r.cargo = [...ids];
  for (const id of ids) Object.assign(s.object(id), { location: 'cargo', holder: r.id, touchedBy: r.id });
  s.changed();
}
const retries = s => s.events.filter(e => e.action === 'retry' && e.automatic);

test('both colors retry exactly after five simulated seconds, despite per-second path resets', () => {
  for (const team of ['red', 'blue']) {
    const { s, r } = jam(team); const start = { x: r.x, y: r.y };
    advance(s, 4.95); assert.equal(retries(s).length, 0); assert.equal(distance(r, start), 0);
    assert.ok(r.stall); assert.ok(r.blocked < 1); assert.match(r.status, /自動Retryまで/);
    advance(s, .05); assert.equal(retries(s).length, 1); assert.equal(retries(s)[0].time, 5);
    assert.equal(distance(r, F.points[team].retry), 0); assert.equal(r.z, .6); assert.equal(r.auto, true);
    assert.equal(r.queue.length, 0); assert.equal(r.job, null); assert.equal(r.observation, null);
    assert.equal(r.scanLoaded, false); assert.equal(r.batchRemaining, 0); assert.equal(r.decision, null);
    assert.equal(r.wait, 0); assert.equal(r.blocked, 0); assert.equal(r.stall, null); assert.equal(r.retryPending, null);
    assert.deepEqual(r.brain, { stage: 'start' }); assert.equal(r.enteredL1, true);
    assert.ok(s.footprintAllowed(r, r)); assert.equal(s.ended, false);
    assert.equal(s.history.at(-1).robots.find(br => br.id === r.id).x, r.x);
  }
});

test('retry delay is not scaled by robot performance', () => {
  for (const speed of [1, .75, .5, .25]) {
    const { s } = jam('red', { redSpeed: speed }); advance(s, 5);
    assert.equal(retries(s)[0].time, 5);
  }
});

test('collision yielding counts toward the same five-second stall, rather than resetting it', () => {
  const { s, r, target } = jam('blue'); s.findPath = () => [target];
  advance(s, 1.5); assert.ok(r.wait > 0); assert.equal(r.stall.since, 0);
  advance(s, 3.5); assert.equal(retries(s)[0].time, 5);
});

test('carried Earth and Sky retain IDs, owners and transfer history without new scoring', () => {
  const { s, r } = jam(); hold(s, r, ['red-E1', 'S1']);
  Object.assign(s.object('red-E1'), { placedBy: 'red', deliveries: ['red'] }); s.transferPoints.red = 10;
  const cargoBefore = r.cargo.map(id => structuredClone(s.object(id)));
  const score = s.scores(); advance(s, 5);
  assert.deepEqual(r.cargo, ['red-E1', 'S1']); assert.equal(s.objects.length, 53); assert.deepEqual(s.scores(), score);
  for (const before of cargoBefore) {
    const o = s.object(before.id); assert.equal(o.location, 'cargo'); assert.equal(o.holder, r.id); assert.equal(o.touchedBy, r.id);
    assert.deepEqual(o.deliveries, before.deliveries); assert.equal(o.placedBy, before.placedBy);
  }
  assert.equal(s.export().events.find(e => e.automatic).cargoPolicy, 'keep-earth-sky');
});

test('carried Mustika returns only on successful relocation; existing towers and mandate remain', () => {
  const { s, r } = jam(); hold(s, r, ['M']); s.sanctuary.red = 0;
  Object.assign(s.object('red-E1'), { location: 'spot', spotId: 'r2', x: 2.8, y: 8.2, z: .6, placedBy: 'red', layer: 0 });
  const tower = structuredClone(s.tower('r2')); advance(s, 5);
  assert.deepEqual(r.cargo, []); assert.equal(s.object('M').location, 'source'); assert.equal(s.object('M').holder, null);
  assert.equal(s.object('M').x, 5.5); assert.equal(s.object('M').y, 1.25); assert.equal(s.sanctuary.red, 0);
  assert.deepEqual(s.tower('r2'), tower); assert.equal(s.scores().red.tower, 10);
});

test('occupied retry area waits without losing Mustika or colliding, then restarts when clear', () => {
  const { s, r } = jam(); hold(s, r, ['M']); const occupant = s.robot('redTR');
  Object.assign(occupant, F.points.red.retry, { z: .6 });
  advance(s, 6); assert.equal(retries(s).length, 0); assert.ok(r.retryPending); assert.equal(r.job, null);
  assert.deepEqual(r.cargo, ['M']); assert.equal(s.object('M').location, 'cargo');
  assert.equal(s.events.filter(e => e.action === 'auto-retry-wait').length, 1);
  assert.match(r.status, /使用中/);
  Object.assign(occupant, F.points.red.startTR, { z: 0 }); advance(s, .05);
  assert.equal(retries(s).length, 1); assert.equal(retries(s)[0].time, 6.05); assert.equal(r.retryPending, null);
  assert.equal(s.object('M').location, 'source'); assert.equal(distance(r, F.points.red.retry), 0);
  assert.equal(overlap(box(r, .515), box(occupant, .515)), false);
});

test('a block in the retry area prevents teleportation through it', () => {
  const { s, r } = jam(), o = s.object('red-E2');
  Object.assign(o, F.points.red.retry, { location: 'spot', z: .6 }); advance(s, 5);
  assert.equal(retries(s).length, 0); assert.ok(r.retryPending); assert.match(r.status, /置けません/);
  o.location = 'removed'; s.changed(); advance(s, .05); assert.equal(retries(s).length, 1);
});

test('before its first L1 landing BR must restart on the ground, never shortcut to L1', () => {
  const { s, r } = jam(); r.enteredL1 = false; advance(s, 5);
  assert.equal(retries(s)[0].level, 0); assert.equal(distance(r, F.points.red.startBR), 0); assert.equal(r.enteredL1, false);
});

test('manual-stop and TR never trigger the BR fallback', () => {
  for (const mode of ['manual', 'TR']) {
    const { s, r } = jam(); if (mode === 'manual') r.auto = false; else r.role = 'TR';
    advance(s, 8); assert.equal(retries(s).length, 0); assert.equal(r.stall, null);
  }
  const { s, r } = jam(); advance(s, 3); r.auto = false; r.job = null; r.queue = [];
  advance(s, 5); assert.equal(retries(s).length, 0); assert.equal(r.stall, null);
});

test('ordinary scan, handling, stair pauses and waiting do not count as stalls', () => {
  for (const state of ['scan', 'place', 'stairs', 'idle']) {
    const { s, r } = jam(); r.queue = []; r.stall = null;
    if (state === 'idle') { r.job = null; r.wait = 12; }
    else if (state === 'stairs') { r.status = '段差で姿勢合わせ'; r.wait = 12; }
    else r.job = { type: state, remaining: 12 };
    advance(s, 6); assert.equal(retries(s).length, 0); assert.equal(r.stall, null);
  }
});

test('real movement clears the clock; a later blockage starts a fresh five seconds', () => {
  const { s, r, other } = jam(); advance(s, 3);
  Object.assign(other, F.points.blue.home, { z: .6 }); advance(s, .2); assert.equal(r.stall, null);
  const target = { x: r.x + .8, y: r.y };
  r.job = { type: 'move', route: [target], target, destination: target }; r.velocity = 0;
  Object.assign(other, { x: r.x + .515, y: r.y, z: r.z });
  advance(s, 4.95); assert.equal(retries(s).length, 0); advance(s, .05);
  assert.equal(retries(s)[0].time, 8.2);
});

test('progress of many tiny steps is not mistaken for immobility', () => {
  const { s, r, other } = jam('red', { maxSpeed: .02, acceleration: .02 });
  advance(s, 1); Object.assign(other, F.points.blue.home, { z: .6 });
  const start = r.x; advance(s, 6);
  assert.ok(r.x > start + .02); assert.equal(retries(s).length, 0); assert.equal(r.stall, null);
});

test('every BR policy goes home for a fresh scan after retry, including with cargo', () => {
  for (const brPlan of ['basic', 'split-seed', 'score-search', 'efficient']) {
    const { s, r } = jam('red', { redBrPlan: brPlan }); hold(s, r, ['red-E1', 'S1']); advance(s, 5);
    const decision = C.next(s.view(r)); assert.equal(decision.actions[0].type, 'move');
    assert.deepEqual(decision.actions[0].target, F.points.red.home); assert.equal(decision.actions.at(-1).type, 'scan');
    assert.equal(s.validate(r, { type: 'place', objectId: 'red-E1', spotId: 'r1' }).ok, false);
  }
});

test('pending retry cannot plan or move and can be cancelled by disabling auto', () => {
  const { s, r } = jam(); const occupant = s.robot('redTR'); Object.assign(occupant, F.points.red.retry, { z: .6 });
  advance(s, 5); assert.ok(r.retryPending);
  advance(s, 1, { next() { throw new Error('planning while retry pending'); } });
  r.auto = false; advance(s, .05); assert.equal(r.retryPending, null);
  Object.assign(occupant, F.points.red.startTR, { z: 0 }); advance(s, 1); assert.equal(retries(s).length, 0);
});

test('simultaneous retries do not depend on robot array order', () => {
  for (const reverse of [false, true]) {
    const { s, r, other } = jam(); other.auto = true;
    const target = { x: other.x - .8, y: other.y };
    other.job = { type: 'move', route: [target], target, destination: target };
    if (reverse) s.robots.reverse(); advance(s, 5);
    assert.equal(retries(s).length, 2); assert.equal(distance(r, F.points.red.retry), 0); assert.equal(distance(other, F.points.blue.retry), 0);
    assert.equal(s.history.at(-1).robots.filter(br => br.role === 'BR' && br.x === F.points[br.team].retry.x).length, 2);
  }
});

test('no automatic retry occurs on or after the 180-second buzzer', () => {
  const { s, r } = jam(); s.time = 175; const original = { x: r.x, y: r.y }; advance(s, 5);
  assert.equal(s.ended, true); assert.equal(retries(s).length, 0); assert.equal(distance(r, original), 0);
  s.step(.05); assert.equal(distance(r, original), 0);
});

test('failed manual Mustika retry also keeps cargo until its destination is available', () => {
  const s = new Simulation(); for (const br of s.robots) br.auto = false;
  const r = s.robot('redBR'), occupant = s.robot('redTR'); Object.assign(r, F.points.red.home, { enteredL1: true, z: .6 });
  Object.assign(occupant, F.points.red.retry, { z: .6 }); hold(s, r, ['M']);
  s.startJob(r, { type: 'retry', level: 1 }); advance(s, 3);
  assert.equal(s.object('M').location, 'cargo'); assert.deepEqual(r.cargo, ['M']); assert.match(r.failure.reason, /使用中/);
});
