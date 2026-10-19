const test = require('node:test'), assert = require('node:assert/strict');
const F = require('../field.js'), S = require('../engine.js'), C = require('../controllers.js'), E = require('../efficient-strategy.js');
function world(team = 'red') {
  const sim = new S.Simulation({ supplyMode: 'normal', brObservationMode: 'stopped' }); sim.robots.forEach(r => { r.auto = false; });
  const tr = sim.robot(team + 'TR'), br = sim.robot(team + 'BR');
  Object.assign(tr, F.points[team].transferTR, { z: .6, brain: { stage: 'collect', trip: 0 } });
  Object.assign(br, F.points[team].brStandby, { z: .6, enteredL1: true }); return { sim, tr, br, team };
}
function material(sim, team, type, holder) {
  const o = sim.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === team));
  if (holder) { Object.assign(o, { location: 'cargo', holder: holder.id, touchedBy: holder.id }); holder.cargo.push(o.id); }
  else { const slot = sim.freeSlot(team, o); assert.ok(slot); Object.assign(o, { location: 'transfer', transferTeam: team, slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z, touchedBy: null }); }
  sim.changed(); return o;
}
function seed(sim, team, id, length) {
  const spot = F.spotById[id];
  for (let layer = 0; layer < length; layer++) {
    const o = material(sim, team, layer < 2 ? 'earth' : 'sky', sim.robot(team + 'BR'));
    sim.robot(team + 'BR').cargo.pop();
    Object.assign(o, { location: 'spot', holder: null, touchedBy: null, placedBy: team, spotId: id, layer,
      x: spot.x, y: spot.y, z: (spot.level === 2 ? .9 : .6) + layer * .35, color: layer === 2 ? team : null });
  }
  sim.changed();
}
function view(sim, tr) { sim.observe(tr); return sim.view(tr); }
const operation = response => response.actions?.find(a => ['pickup', 'unload'].includes(a.type));

test('implicit adaptive initial mixed load collects the nearby Sky first on both sides', () => {
  for (const team of ['red', 'blue']) {
    const { sim, tr } = world(team); Object.assign(tr, F.points[team].startTR);
    const response = C.next(view(sim, tr)); assert.equal(sim.object(operation(response).objectId).type, 'sky');
    assert.deepEqual(response.brain.manifest, { earth: 2, sky: 1 });
  }
});

test('adaptive refreshes a stale manifest while retaining every carried box and the three-box bound', () => {
  const { sim, tr } = world(); material(sim, 'red', 'earth', tr); material(sim, 'red', 'sky'); material(sim, 'red', 'sky');
  tr.brain.manifest = { earth: 1, sky: 2 };
  const response = C.next(view(sim, tr)); assert.equal(sim.object(operation(response).objectId).type, 'earth');
  assert.equal(response.brain.manifest.sky, 0); assert.equal(response.brain.manifest.earth, 3); assert.equal(tr.cargo.length, 1);
});

test('deliver the carried Earth pair before a distant Sky detour when a waiting BR gains useful work', () => {
  for (const team of ['red', 'blue']) {
    const { sim, tr } = world(team); seed(sim, team, 's2', 1);
    material(sim, team, 'earth', tr); material(sim, team, 'earth', tr); material(sim, team, 'earth');
    Object.assign(tr, F.points[team].storage); tr.brain.manifest = { earth: 2, sky: 1 };
    const response = C.next(view(sim, tr)); assert.equal(operation(response), undefined);
    assert.equal(response.brain.stage, 'deliver'); assert.match(response.status, /先行納品/);
    assert.equal(tr.cargo.length, 2);
  }
});

test('a cheap nearby third Earth is still collected rather than forcing all trips to two boxes', () => {
  const { sim, tr } = world(); const o = material(sim, 'red', 'earth', tr); material(sim, 'red', 'earth', tr);
  material(sim, 'red', 'sky'); material(sim, 'red', 'sky'); Object.assign(tr, F.points.red.storage);
  tr.brain.manifest = { earth: 3, sky: 0 };
  assert.equal(sim.object(operation(C.next(view(sim, tr))).objectId).type, 'earth');
});

test('unload the missing Sky before surplus Earth when it enables work using the observed stock', () => {
  const { sim, tr } = world(); seed(sim, 'red', 's2', 1);
  material(sim, 'red', 'earth'); material(sim, 'red', 'earth', tr); const sky = material(sim, 'red', 'sky', tr);
  tr.brain.stage = 'deliver'; tr.brain.manifest = { earth: 1, sky: 1 };
  // The receiving position must remain clear for the normal unloading protocol.
  Object.assign(sim.robot('redBR'), F.points.red.brStandby);
  assert.equal(operation(C.next(view(sim, tr))).objectId, sky.id);
});

test('a missing Sky for an observed two-Earth tower outranks optional Earth collection', () => {
  const { sim, tr } = world(); seed(sim, 'red', 'r2', 2);
  Object.assign(tr, F.points.red.storage);
  const response = C.next(view(sim, tr)); assert.equal(sim.object(operation(response).objectId).type, 'sky');
});

test('even after collecting Sky first, unload two Earths first if that is the earliest useful BR batch', () => {
  const { sim, tr } = world(); material(sim, 'red', 'sky', tr); material(sim, 'red', 'earth', tr); material(sim, 'red', 'earth', tr);
  tr.brain.stage = 'deliver'; tr.brain.manifest = { earth: 2, sky: 1 };
  const response = C.next(view(sim, tr)); assert.equal(sim.object(operation(response).objectId).type, 'earth');
});

test('explicit opening/trips preserve their cargo and Earth-first collection; ideal stays unchanged', () => {
  const { sim, tr } = world(); Object.assign(tr, F.points.red.startTR);
  const v = view(sim, tr);
  const response = E.courier(v, { opening: true, earth: 1, sky: 2 });
  assert.equal(sim.object(operation(response).objectId).type, 'earth');
  sim.config.redTrTrips = [['earth', 'sky', 'sky']];
  assert.equal(sim.object(operation(C.next(view(sim, tr))).objectId).type, 'earth');
  sim.config.supplyMode = 'ideal'; assert.ok(!operation(C.next(view(sim, tr))) || operation(C.next(view(sim, tr))).objectId === 'M');
});

test('responsive supply does not mutate input or read hidden BR strategy, turn, brain or future world', () => {
  const { sim, tr } = world(); const v = view(sim, tr), saved = JSON.stringify(v), expected = C.next(v);
  sim.robot('redBR').brain.hidden = 'not observable'; sim.robot('redBR').queue = [{ type: 'place', spotId: 'u4' }];
  material(sim, 'red', 'earth', sim.robot('redBR')); sim.objects.find(o => o.type === 'sky').location = 'removed';
  assert.deepEqual(C.next(v), expected); assert.equal(JSON.stringify(v), saved);
  assert.deepEqual(C.next({ ...v, brPlan: 'l2-earth', brTurnPlan: { secret: true } }), expected);
});

test('unknown partner/stock cannot justify the new partial delivery decision', () => {
  const { sim, tr } = world(); const o = material(sim, 'red', 'earth', tr); material(sim, 'red', 'earth', tr); material(sim, 'red', 'sky');
  Object.assign(tr, F.points.red.storage); tr.brain.manifest = { earth: 2, sky: 1 };
  const v = view(sim, tr); v.observation.visibility = { entries: { partner: { status: 'unknown' }, stock: { status: 'stale' } } };
  assert.notEqual(C.next(v).brain.stage, 'deliver');
});

test('a full Sky pile and held Sky never block collecting Earth that can restart construction', () => {
  for (const team of ['red', 'blue']) {
    const { sim, tr } = world(team); material(sim, team, 'sky', tr);
    for (let i = 0; i < 4; i++) material(sim, team, 'sky');
    Object.assign(tr, F.points[team].storage);
    const response = C.next(view(sim, tr)); assert.equal(sim.object(operation(response)?.objectId)?.type, 'earth');
    assert.equal(response.brain.manifest.sky, 1); assert.equal(tr.cargo.length, 1);
  }
});

test('a distant BR does not cause an urgent partial-trip return based on an imagined arrival time', () => {
  const { sim, tr, br } = world(); seed(sim, 'red', 's2', 1);
  material(sim, 'red', 'earth', tr); material(sim, 'red', 'earth', tr); material(sim, 'red', 'earth');
  Object.assign(tr, F.points.red.storage); Object.assign(br, F.points.red.homeL2);
  assert.equal(sim.object(operation(C.next(view(sim, tr))).objectId).type, 'sky');
});

test('ordinary responsive trips do not run the BR multi-sortie planner on every pickup', () => {
  const P = require('../score-planner.js'), plan = P.plan;
  try {
    P.plan = () => { throw new Error('Unexpected BR workload search'); };
    const { sim, tr } = world(); assert.ok(operation(C.next(view(sim, tr))));
  } finally { P.plan = plan; }
});
