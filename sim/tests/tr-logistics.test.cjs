const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../engine.js'), F = require('../field.js'), C = require('../controllers.js'), E = require('../efficient-strategy.js');
function world(team = 'red', config = {}) {
  const sim = new S.Simulation({ supplyMode: 'normal', brObservationMode: 'stopped', ...config });
  sim.robots.forEach(r => { r.auto = false; });
  const tr = sim.robot(team + 'TR'); Object.assign(tr, F.points[team].transferTR, { brain: { stage: 'collect' } });
  return { sim, tr, team };
}
function take(sim, team, type, holder) {
  const o = sim.objects.find(o => o.type === type && o.location === 'source' && (!o.team || o.team === team));
  if (holder) { Object.assign(o, { location: 'cargo', holder: holder.id, touchedBy: holder.id }); holder.cargo.push(o.id); }
  else { const slot = sim.freeSlot(team, o); assert.ok(slot); Object.assign(o, { location: 'transfer', transferTeam: team, slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z }); }
  sim.changed(); return o;
}
function foundations(sim, team) {
  for (const id of ['u1', 'u2']) for (let layer = 0; layer < 2; layer++) {
    const o = sim.objects.find(o => o.type === 'earth' && o.team === team && o.location === 'source'), p = F.spotById[id];
    Object.assign(o, { location: 'spot', spotId: id, layer, x: p.x, y: p.y, z: .9 + layer * .35, placedBy: team });
  }
  sim.changed();
}
function view(sim, tr) { sim.observe(tr); return sim.view(tr); }
const pickup = r => r.actions?.find(a => a.type === 'pickup');
test('Sky-covered foundations no longer suppress a small Earth buffer for other observed open sites', () => {
  for (const team of ['red', 'blue']) {
    const { sim, tr } = world(team); foundations(sim, team); take(sim, team, 'sky'); take(sim, team, 'sky');
    const v = view(sim, tr); assert.deepEqual(E.demand(v), { earth: 2, sky: 0 });
    assert.equal(sim.object(pickup(C.next(v)).objectId).type, 'earth');
    take(sim, team, 'earth', sim.robot(team + 'BR'));
    assert.deepEqual(E.demand(view(sim, tr)), { earth: 1, sky: 0 });
  }
});
test('urgent Sky demand, unknown sites, exhausted Earth and reserved return capacity remain respected', () => {
  const { sim, tr } = world(); foundations(sim, 'red');
  assert.deepEqual(E.demand(view(sim, tr)), { earth: 0, sky: 2 });
  take(sim, 'red', 'sky'); take(sim, 'red', 'sky');
  const v = view(sim, tr);
  v.observation.towers = { u1: v.observation.towers.u1, u2: v.observation.towers.u2 };
  v.observation.visibility = { entries: { 'tower:u1': { status: 'current' }, 'tower:u2': { status: 'current' } } };
  assert.deepEqual(E.demand(v), { earth: 0, sky: 0 });
  const fresh = view(sim, tr); fresh.observation.source = fresh.observation.source.filter(o => o.type !== 'earth');
  assert.deepEqual(E.demand(fresh), { earth: 0, sky: 0 });
  take(sim, 'red', 'earth'); take(sim, 'red', 'earth', sim.robot('redBR'));
  assert.ok(E.demand(view(sim, tr)).earth <= 1);
});
test('empty TR refuses an unfinishable last trip without altering cargo or match time', () => {
  const { sim, tr } = world(); sim.time = 179;
  const response = C.next(view(sim, tr)); assert.ok(!pickup(response)); assert.match(response.status, /終盤締切/);
  assert.deepEqual(tr.cargo, []); assert.equal(sim.time, 179); assert.equal(sim.transferPoints.red, 0);
});
test('additional Sky is skipped when held Earth can still be delivered, for both colors', () => {
  for (const team of ['red', 'blue']) {
    const { sim, tr } = world(team); Object.assign(tr, F.points[team].storage);
    const held = take(sim, team, 'earth', tr);
    tr.brain = { stage: 'collect', trip: 0, manifest: { earth: 1, sky: 1 } };
    const v = view(sim, tr), sky = v.observation.source.filter(o => o.type === 'sky' && (team === 'red' ? o.x <= 5.51 : o.x >= 5.49)).sort((a, b) => b.y - a.y || Math.abs(a.x - v.x) - Math.abs(b.x - v.x))[0];
    const direct = E.deliveryBudget(v), extra = E.deliveryBudget(v, sky); assert.ok(extra.seconds > direct.seconds);
    sim.time = 180 - (direct.seconds + extra.seconds) / 2;
    const response = C.next(view(sim, tr)); assert.ok(!pickup(response)); assert.equal(response.brain.stage, 'deliver');
    assert.match(response.status, /追加採集をやめ/); tr.brain = response.brain; tr.auto = true;
    while (!sim.ended) sim.step(.05, C);
    const delivered = sim.events.find(e => e.kind === 'action' && e.action === 'unload' && e.objectId === held.id);
    assert.ok(delivered && delivered.time < 180); assert.equal(sim.transferPoints[team], 5);
  }
});
test('a partial last unload earns only genuinely completed transfer points and retains unfinished boxes', () => {
  const { sim, tr } = world(); const cargo = Array.from({ length: 3 }, () => take(sim, 'red', 'earth', tr).id);
  tr.brain = { stage: 'deliver', trip: 0, manifest: { earth: 3, sky: 0 } }; sim.time = 177.6;
  assert.equal(E.deliveryBudget(view(sim, tr)).deliverable, 1); tr.auto = true;
  while (!sim.ended) sim.step(.05, C);
  assert.equal(sim.transferPoints.red, 5); assert.equal(tr.cargo.length, 2);
  assert.ok(tr.cargo.every(id => cargo.includes(id))); assert.equal(tr.transport.completed.length, 0);
});
test('budget follows own speed, acceleration, ramp/stair and action settings, not robot speed for work', () => {
  const { sim, tr } = world(); Object.assign(tr, F.points.red.sky); take(sim, 'red', 'earth', tr);
  const full = E.deliveryBudget(view(sim, tr)); sim.config.redSpeed = .5;
  const slow = E.deliveryBudget(view(sim, tr)); assert.ok(slow.travel > full.travel);
  sim.config.robotTiming = { redTR: { unload: 4 } };
  const work = E.deliveryBudget(view(sim, tr)); assert.ok(Math.abs(work.seconds - slow.seconds - 2.5) < 1e-8);
  sim.config.robotTiming = { redTR: { stairSpeed: .1, stairPause: 2 } };
  assert.ok(E.deliveryBudget(view(sim, tr)).travel > slow.travel);
});
test('deadline prediction covers an unobstructed legal source-and-return route at both speed factors', () => {
  for (const speed of [1, .5]) {
    const { sim, tr } = world('red', { redSpeed: speed }); Object.assign(tr, F.points.red.startTR);
    const v = view(sim, tr), o = v.observation.source.filter(o => o.type === 'sky').find(o => o.x < 5.49);
    Object.assign(sim.robot('redBR'), F.points.red.brStandby);
    const budget = E.deliveryBudget(v, o), point = C.sourceApproach(o, 'red');
    sim.enqueue(tr.id, [{ type: 'move', target: point }, { type: 'pickup', objectId: o.id }, { type: 'move', target: F.points.red.transferTR }, { type: 'unload', objectId: o.id }]);
    while (!sim.ended && (tr.job || tr.queue.length)) sim.step(.05);
    assert.equal(tr.failure, null); assert.equal(sim.transferPoints.red, 5); assert.ok(sim.time < budget.seconds);
  }
});
test('new logistics are view-only and independent of BR strategy, hidden plans and changed ground truth', () => {
  const { sim, tr } = world(); foundations(sim, 'red'); take(sim, 'red', 'sky'); take(sim, 'red', 'sky'); sim.time = 140;
  const v = view(sim, tr), before = JSON.stringify(v), expected = C.next(v), budget = E.deliveryBudget(v);
  sim.objects.forEach(o => { if (o.location === 'source') o.location = 'removed'; });
  sim.robot('redBR').brain.nextTarget = 'u4'; sim.robot('redBR').queue = [{ type: 'place', spotId: 'u4' }];
  assert.deepEqual(C.next(v), expected); assert.deepEqual(E.deliveryBudget(v), budget); assert.equal(JSON.stringify(v), before);
  assert.deepEqual(C.next({ ...v, brPlan: 'other-private-plan', brTurnPlan: { secret: true } }), expected);
  assert.ok(!Object.keys(v.observation.partner).some(k => ['brain', 'queue', 'destination', 'eta', 'request'].includes(k)));
});
test('explicit opening trips and action programs retain priority rather than silently truncating', () => {
  const { sim, tr } = world('red', { redTrTrips: [['earth', 'earth', 'earth']] }); sim.time = 179;
  assert.ok(pickup(C.next(view(sim, tr))));
  const opening = E.courier(view(sim, tr), { opening: true, earth: 3, sky: 0 }); assert.ok(pickup(opening));
  sim.config.robotPrograms = { redTR: { enabled: true, steps: [{ type: 'pickup', objectType: 'earth' }], end: 'stop' } };
  assert.equal(pickup(C.next(view(sim, tr))).programStep, 0);
});
