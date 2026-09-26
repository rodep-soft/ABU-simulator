const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../engine.js');
const F = require('../field.js');

function jam(team = 'red', config = {}) {
  const s = new S.Simulation(config);
  s.robots.forEach(r => { r.auto = false; });
  s.objects.filter(o => o.type === 'sky').forEach(o => { o.location = 'removed'; });
  const r = s.robot(`${team}TR`), other = s.robot(`${team === 'red' ? 'blue' : 'red'}TR`);
  Object.assign(s.robot('redTR'), { x: 5.2425, y: 9.75, z: 0 });
  Object.assign(s.robot('blueTR'), { x: 5.7575, y: 9.75, z: 0 });
  const target = { x: 5.5, y: 9.75 };
  r.auto = true; r.brain = { stage: 'collect', marker: 'keep-plan' };
  r.job = { type: 'move', target, destination: target, route: [target], label: 'Sky採集へ' };
  // Keep a deliberate impasse rather than depending on an incidental A* detour.
  const findPath = s.findPath.bind(s); s.findPath = () => null;
  return { s, r, other, target, findPath };
}
function advance(s, seconds, controllers) {
  const end = Math.min(180, s.time + seconds);
  while (s.time < end - 1e-8) s.step(Math.min(.05, end - s.time), controllers);
}
function hold(s, r, ids) {
  r.cargo = [...ids];
  ids.forEach(id => { Object.assign(s.object(id), { location: 'cargo', holder: r.id, touchedBy: r.id }); });
  s.changed();
}
const restarts = s => s.events.filter(e => e.action === 'tr-restart');

test('both colors restart at their original TR start after exactly one second of opposing TR movement collision', () => {
  for (const team of ['red', 'blue']) for (const speed of [1, .75, .5, .25]) {
    const { s, r, target } = jam(team, { [`${team}Speed`]: speed });
    const before = { x: r.x, y: r.y };
    advance(s, .95); assert.equal(restarts(s).length, 0); assert.equal(S.distance(r, before), 0);
    advance(s, .05); assert.equal(restarts(s).length, 1); assert.equal(restarts(s)[0].time, 1);
    assert.equal(S.distance(r, F.points[team].startTR), 0); assert.equal(r.z, 0); assert.equal(r.auto, true);
    assert.deepEqual(r.queue[0].target, target); assert.equal(r.job, null); assert.equal(r.wait, 0);
    assert.equal(r.trRestartPending, null); assert.equal(r.trCollisionStall, null);
    assert.equal(s.history.at(-1).robots.find(robot => robot.id === r.id).x, r.x);
  }
});

test('restart retains cargo identities, partial deliveries, specified trip and planned work without adding score', () => {
  const { s, r, target, findPath } = jam('red', { redTrTrips: [['earth', 'sky', 'sky']] });
  hold(s, r, ['red-E1', 'S1']); s.object('red-E1').deliveries = ['red']; s.transferPoints.red = 5;
  r.transport.pending = [{ id: 'S2', type: 'sky' }];
  r.queue = [{ type: 'pickup', objectId: 'S3' }];
  const brain = structuredClone(r.brain), transport = structuredClone(r.transport), scores = s.scores();
  advance(s, 1);
  assert.deepEqual(r.cargo, ['red-E1', 'S1']); assert.deepEqual(r.transport, transport); assert.deepEqual(r.brain, brain);
  assert.equal(S.transportTripIndex(r.transport), 0); assert.deepEqual(s.scores(), scores); assert.equal(s.objects.length, 53);
  assert.deepEqual(r.queue.map(a => a.type), ['move', 'pickup']); assert.equal(r.queue[1].objectId, 'S3');
  assert.deepEqual(r.queue[0].target, target);
  for (const id of r.cargo) { const o = s.object(id); assert.equal(o.holder, r.id); assert.equal(o.touchedBy, r.id); assert.equal(S.distance(o, r), 0); }
  assert.deepEqual(s.object('red-E1').deliveries, ['red']);
  Object.assign(s.robot('blueTR'), F.points.blue.startTR); s.findPath = findPath;
  advance(s, .5); assert.equal(r.job.type, 'move'); assert.ok(S.distance(r, F.points.red.startTR) > .01);
});

test('Mustika is retained, not returned or scored by this movement-only TR recovery', () => {
  const { s, r } = jam(); hold(s, r, ['M']); s.sanctuary.red = 0;
  advance(s, 1); assert.deepEqual(r.cargo, ['M']); assert.equal(s.object('M').location, 'cargo');
  assert.equal(s.object('M').holder, r.id); assert.equal(s.sanctuary.red, 0); assert.equal(s.scores().red.mustika, 0);
  assert.equal(restarts(s)[0].cargoPolicy, 'keep-all');
});

test('handling, idle, stair pauses, manual moves and simultaneous pickup claims never trigger a restart', () => {
  for (const kind of ['pickup', 'unload', 'scan', 'idle', 'stairs', 'manual', 'claims']) {
    const { s, r, other } = jam();
    if (['pickup', 'unload', 'scan'].includes(kind)) r.job = { type: kind, remaining: 10 };
    if (kind === 'idle') { r.job = null; r.wait = 10; }
    if (kind === 'stairs') { r.wait = 10; r.status = '段差で姿勢合わせ'; }
    if (kind === 'manual') r.auto = false;
    if (kind === 'claims') {
      r.job = null; r.queue = [{ type: 'pickup', objectId: 'S2' }];
      other.queue = [{ type: 'pickup', objectId: 'S2' }];
    }
    advance(s, 2); assert.equal(restarts(s).length, 0, kind); assert.equal(r.trCollisionStall, null, kind);
    if (kind === 'claims') assert.equal(r.status, '同時操作の競合');
  }
});

test('wall/object blockage and BR collisions are not mistaken for opponent TR collisions', () => {
  for (const kind of ['terrain', 'box', 'BR']) {
    const { s, r, other } = jam();
    if (kind === 'terrain') s.segmentAllowed = () => false;
    if (kind === 'box') {
      Object.assign(other, F.points.blue.startTR);
      Object.assign(s.object('S1'), { location: 'source', x: r.x + .35, y: r.y, z: 0 }); s.changed();
    }
    if (kind === 'BR') other.role = 'BR';
    advance(s, 2); assert.equal(restarts(s).length, 0, kind); assert.equal(r.trCollisionStall, null, kind);
  }
});

test('any real movement, or a non-collision pause, breaks the consecutive collision clock', () => {
  for (const kind of ['move', 'wait']) {
    const { s, r, other } = jam(); advance(s, .7);
    if (kind === 'move') { Object.assign(other, F.points.blue.startTR); advance(s, .05); }
    else { r.wait = .1; advance(s, .05); }
    assert.equal(r.trCollisionStall, null);
    Object.assign(other, { x: r.x + .515, y: r.y, z: 0 });
    advance(s, .95); assert.equal(restarts(s).length, 0);
    advance(s, .05); assert.equal(restarts(s)[0].time, 1.75);
  }
});

test('occupied start waits without moving, executing queued work or dropping cargo, then resumes when clear', () => {
  const { s, r } = jam(); hold(s, r, ['red-E1']);
  const occupant = s.robot('redBR'); Object.assign(occupant, F.points.red.startTR);
  const start = { x: r.x, y: r.y };
  advance(s, 2, { next() { throw new Error('unexpected planning'); } });
  assert.equal(restarts(s).length, 0); assert.ok(r.trRestartPending); assert.equal(S.distance(r, start), 0);
  assert.deepEqual(r.cargo, ['red-E1']); assert.equal(s.events.filter(e => e.action === 'tr-restart-wait').length, 1);
  Object.assign(occupant, F.points.red.startBR); advance(s, .05);
  assert.equal(restarts(s).length, 1); assert.equal(S.distance(r, F.points.red.startTR), 0);
});

test('a box in the start blocks relocation; disabling auto cancels a pending recovery', () => {
  const { s, r } = jam(); Object.assign(s.object('red-E2'), F.points.red.startTR, { z: 0 }); s.changed();
  advance(s, 1); assert.ok(r.trRestartPending); assert.equal(restarts(s).length, 0);
  r.auto = false; advance(s, .05); assert.equal(r.trRestartPending, null);
  s.object('red-E2').location = 'removed'; s.changed(); advance(s, 1); assert.equal(restarts(s).length, 0);
});

test('simultaneous TR recoveries are independent of robot iteration order', () => {
  for (const reverse of [false, true]) {
    const { s, r, other, target } = jam();
    other.auto = true; other.job = { type: 'move', route: [target], target, destination: target };
    if (reverse) s.robots.reverse(); advance(s, 1);
    assert.equal(restarts(s).length, 2); assert.equal(S.distance(r, F.points.red.startTR), 0); assert.equal(S.distance(other, F.points.blue.startTR), 0);
  }
});

test('recovery is disabled at the buzzer and may be explicitly disabled in config', () => {
  const { s, r } = jam(); s.time = 179; advance(s, 1); assert.equal(s.ended, true); assert.equal(restarts(s).length, 0);
  const point = { x: r.x, y: r.y }; s.step(.05); assert.equal(S.distance(r, point), 0);
  const disabled = jam('red', { trAutoRestartSeconds: 0 }); advance(disabled.s, 2); assert.equal(restarts(disabled.s).length, 0);
  for (const value of [-1, NaN, Infinity, '1']) assert.throws(() => new S.Simulation({ trAutoRestartSeconds: value }), TypeError);
});
