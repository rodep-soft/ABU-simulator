const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../field.js');
const { Simulation, scanBudget } = require('../engine.js');
const C = require('../controllers.js');
const P = require('../score-planner.js');
const E = require('../efficient-strategy.js');
const { Review } = require('../post-match-review.js');

function world(team = 'red', mode = 'endgame') {
  const s = new Simulation({ [`${team}BrPlan`]: mode });
  s.robots.forEach(r => r.auto = false);
  const br = s.robot(`${team}BR`);
  Object.assign(br, F.points[team].homeL2, { z: .9, enteredL1: true, brain: { stage: 'return' } });
  return { s, br };
}
function tower(s, id, team = 'blue', count = 3) {
  const p = F.spotById[id];
  for (let layer = 0; layer < count; layer++) {
    const type = layer < 2 ? 'earth' : 'sky';
    const o = s.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === team));
    Object.assign(o, { location: 'spot', spotId: id, layer, placedBy: team, color: layer === 2 ? team : null, touchedBy: null,
      x: p.x, y: p.y, z: (p.level === 2 ? .9 : .6) + layer * .35 });
  }
  s.changed();
}
function scan(s, br) {
  s.observe(br); br.scanLoaded = true; br.batchRemaining = scanBudget(br); br.batchFlips = []; br.brain = { stage: 'choose' };
  return s.view(br);
}
function execute(s, br, response) {
  br.brain = response.brain; s.enqueue(br.id, response.actions);
  while (!s.ended && (br.queue.length || br.job)) s.step(.05);
  assert.equal(br.failure, null);
}

test('both L2 scan points are mirrored, reachable and legal only for their own BR scan', () => {
  for (const team of ['red', 'blue']) {
    const { s, br } = world(team), home = F.points[team].homeL2;
    assert.equal(F.surface(home).type, 'l2'); assert.ok(s.footprintAllowed(br, home));
    assert.ok(s.validate(br, { type: 'scan' }).ok);
    assert.ok(s.findPath(br, F.points[team].home));
    Object.assign(br, F.points[team === 'red' ? 'blue' : 'red'].homeL2);
    assert.equal(s.validate(br, { type: 'scan' }).ok, false);
    Object.assign(br, { x: 5, y: 4.9 }); assert.equal(s.validate(br, { type: 'scan' }).ok, false);
    Object.assign(br, F.points[team].home); assert.ok(s.validate(br, { type: 'scan' }).ok);
  }
});
test('all BR modes return to L2 for scanning after an L2 task, and L1 after an L1 task', () => {
  for (const team of ['red', 'blue']) for (const mode of C.listStrategies('BR')) {
    const { s, br } = world(team, mode.id);
    Object.assign(br, F.spotApproaches(F.spotById.u1, team)[0]);
    assert.deepEqual(C.next(s.view(br)).actions[0].target, F.points[team].homeL2, mode.id);
    Object.assign(br, F.points[team].home);
    assert.deepEqual(C.next(s.view(br)).actions[0].target, F.points[team].home, mode.id);
  }
});
test('L2 scan takes the configured stop time, refreshes flip allowance and records its origin', () => {
  const { s, br } = world(); tower(s, 'u1');
  s.enqueue(br.id, { type: 'scan' });
  for (let i = 0; i < 19; i++) s.step(.05);
  assert.equal(br.observation, null); s.step(.05);
  assert.equal(br.observation.at, 1); assert.deepEqual(br.observation.origin, F.points.red.homeL2);
  assert.equal(br.scanLoaded, true); assert.ok(br.batchRemaining > 0);
  assert.equal(s.events.find(e => e.action === 'scan').level, 'l2');
});
test('late L2 reversal plans start from L2 and rescan there without descending', () => {
  for (const team of ['red', 'blue']) {
    const { s, br } = world(team), enemy = team === 'red' ? 'blue' : 'red';
    tower(s, team === 'red' ? 'u1' : 'u2', enemy); s.time = 169;
    const v = scan(s, br), near = P.flipBatch(v, { efficient: true }); assert.ok(near);
    const downstairs = { ...v, ...F.points[team].home };
    const far = P.flipBatch(downstairs, { efficient: true });
    assert.ok(!far || near.completeSeconds < far.completeSeconds);
    assert.deepEqual(near.returnPoint, F.points[team].homeL2);
    const response = C.next(v); assert.ok(response.actions.some(a => a.type === 'flip'));
    execute(s, br, response);
    assert.equal(F.surface(br).type, 'l2'); assert.deepEqual(C.next(s.view(br)).actions[0].target, F.points[team].homeL2);
  }
});
test('normal receipt, returned cargo and direct Mustika receipt always rescan on L1 even when planned on L2', () => {
  const { s, br } = world(); let v = scan(s, br);
  const candidate = { tasks: [], picked: ['red-E1'], gain: 10, horizonGain: 10, completeSeconds: 10, horizonSeconds: 10, candidates: 1 };
  assert.deepEqual(E.execute(v, candidate).actions.at(-2).target, F.points.red.home);
  const o = s.object('red-E1'); Object.assign(o, { location: 'cargo', holder: br.id, touchedBy: br.id }); br.cargo.push(o.id);
  v = scan(s, br); assert.deepEqual(E.returnCargo(v).actions.at(-2).target, F.points.red.home);
  v.cargo = []; v.observation.sanctuary = true; v.observation.handoff = { objectId: 'M' };
  assert.deepEqual(E.handoffNext(v).actions.at(-2).target, F.points.red.home);
});
test('L2 pickup estimates include descent and never teleport to the L1 receiving point', () => {
  const { s, br } = world(), o = s.object('red-E1'), slot = s.freeSlot('red', o);
  Object.assign(o, { location: 'transfer', transferTeam: 'red', slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z });
  s.changed(); s.time = 160; const v = scan(s, br);
  const upper = P.plan(v, { efficient: true, oneSortie: true, noRecover: true, onlyPlace: true });
  const lower = P.plan({ ...v, ...F.points.red.home }, { efficient: true, oneSortie: true, noRecover: true, onlyPlace: true });
  assert.ok(upper && lower); assert.ok(upper.completeSeconds > lower.completeSeconds + 2);
});
test('efficient policy clears L2 when there is no useful task instead of indefinitely waiting there', () => {
  const { s, br } = world(); const response = E.builder(scan(s, br), () => null);
  assert.deepEqual(response.actions[0].target, F.points.red.home);
});

function finalWorld() {
  const s = new Simulation(); tower(s, 's1'); tower(s, 'u1');
  s.transferPoints = { red: 35, blue: 20 }; s.sanctuary.red = 23;
  Object.assign(s.object('M'), { location: 'pillar', placedBy: 'red', touchedBy: null });
  s.time = 180; s.ended = true; s.capture(true); return s;
}
test('review cannot be entered during a match or edit source, stock or Mustika', () => {
  assert.throws(() => new Review(new Simulation().snapshot()));
  const r = new Review(finalWorld().snapshot());
  for (const id of ['M', 'red-E1', 'unknown']) assert.throws(() => r.setColor(id, 'red'));
  assert.throws(() => r.setColor(r.state.objects.find(o => o.location === 'spot').id, 'green'));
});
test('L1 and L2 Sky flips swing the score differential by 80 and 160 points', () => {
  const s = finalWorld(), original = JSON.stringify(s.export()), r = new Review(s.snapshot());
  for (const [spot, swing] of [['s1', 80], ['u1', 160]]) {
    const before = r.state.scores.red.total - r.state.scores.blue.total;
    r.flip(s.tower(spot)[2].id);
    assert.equal(r.state.scores.red.total - r.state.scores.blue.total - before, swing);
  }
  assert.equal(JSON.stringify(s.export()), original);
  assert.equal(r.state.scores.red.mustika, 250); assert.equal(r.state.scores.red.transfer, 35);
  assert.deepEqual(r.state.sanctuary, s.sanctuary); assert.deepEqual(r.state.sanctuaryEvidence, s.sanctuaryEvidence);
  assert.equal(r.export().format, 'robocon-post-match-review-v1');
});
test('Earth recoloring scores by layer and level; undo, redo, reset and detached exports preserve original match', () => {
  const s = finalWorld(), r = new Review(s.snapshot()), original = s.snapshot();
  for (const [spot, layer, points] of [['s1', 0, 10], ['s1', 1, 20], ['u1', 0, 20], ['u1', 1, 40]]) {
    const old = r.state.scores.red.total; r.setColor(s.tower(spot)[layer].id, 'red'); assert.equal(r.state.scores.red.total - old, points);
  }
  assert.equal(r.changes().length, 4); const changed = r.snapshot();
  r.undo(); assert.equal(r.changes().length, 3); r.redo(); assert.deepEqual(r.snapshot(), changed);
  r.export().hypothetical.objects[0].placedBy = 'blue'; assert.deepEqual(r.snapshot(), changed);
  r.undo(); r.setColor(s.tower('s1')[0].id, 'blue'); assert.equal(r.redoStack.length, 0);
  r.reset(); assert.deepEqual(r.snapshot(), original); assert.deepEqual(s.snapshot(), original);
  assert.equal(r.changes().length, 0);
});
test('review retains contact-at-buzzer exclusions and never invents new sanctuary history', () => {
  const s = finalWorld(), sky = s.tower('u1')[2]; sky.touchedBy = 'redBR';
  const r = new Review(s.snapshot()), before = r.state.scores;
  r.flip(sky.id); assert.deepEqual(r.state.scores, before);
  r.flip(s.tower('s1')[2].id); assert.deepEqual(r.state.sanctuary, s.sanctuary);
});
test('review Earth flip toggles either layer at both levels without altering Sky or the original match', () => {
  const s = finalWorld(), original = JSON.stringify(s.export()), r = new Review(s.snapshot());
  for (const [spot, layer, points] of [['s1', 0, 10], ['s1', 1, 20], ['u1', 0, 20], ['u1', 1, 40]]) {
    const earth = s.tower(spot)[layer], before = r.snapshot();
    r.flip(earth.id);
    assert.equal(r.state.scores.red.total - before.scores.red.total, points);
    assert.equal(r.state.scores.blue.total - before.scores.blue.total, -points);
    assert.equal(r.state.objects.find(o => o.id === s.tower(spot)[2].id).color, 'blue');
    r.undo(); assert.deepEqual(r.snapshot(), before); r.redo();
    r.flip(earth.id); assert.deepEqual(r.snapshot(), before);
  }
  for (const id of ['M', 'red-E1', 'missing']) assert.throws(() => r.flip(id));
  assert.equal(JSON.stringify(s.export()), original);
});
