const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../engine.js'), F = require('../field.js'), C = require('../controllers.js'), E = require('../efficient-strategy.js');
function world(team = 'red', config = {}) {
  const sim = new S.Simulation({ supplyMode: 'normal', brObservationMode: 'stopped', ...config });
  sim.robots.forEach(r => { r.auto = false; });
  const tr = sim.robot(team + 'TR'), br = sim.robot(team + 'BR');
  Object.assign(tr, F.points[team].transferTR, { brain: { stage: 'collect' } });
  Object.assign(br, F.points[team].brStandby, { enteredL1: true, brain: { stage: 'choose' } });
  return { sim, tr, br, team };
}
function material(sim, team, type, holder) {
  const o = sim.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === team));
  if (holder) { Object.assign(o, { location: 'cargo', holder: holder.id, touchedBy: holder.id }); holder.cargo.push(o.id); }
  else { const slot = sim.freeSlot(team, o); assert.ok(slot); Object.assign(o, { location: 'transfer', transferTeam: team, slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z }); }
  sim.changed(); return o;
}
function seed(sim, id, length, team) {
  const spot = F.spotById[id];
  for (let layer = 0; layer < length; layer++) {
    const type = layer < 2 ? 'earth' : 'sky', o = sim.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === team));
    Object.assign(o, { location: 'spot', spotId: id, layer, x: spot.x, y: spot.y, z: .6 + layer * .35, placedBy: team, color: type === 'sky' ? team : null });
  }
  sim.changed();
}
function view(sim, r) { sim.observe(r); r.scanLoaded = true; return sim.view(r); }
const pickup = r => r.actions?.some(a => a.type === 'pickup');
test('empty adaptive TR waits for a supplied E1S1 qualification pair in either color without early Mustika pickup', () => {
  for (const team of ['red', 'blue']) {
    const { sim, tr, br } = world(team); seed(sim, team === 'red' ? 'r2' : 'b2', 3, team); seed(sim, 's2', 1, team);
    material(sim, team, 'earth', br); material(sim, team, 'sky', br);
    const input = view(sim, tr), before = JSON.stringify(input), response = C.next(input);
    assert.equal(E.qualificationForecast(input).priority, 2); assert.equal(response.brain.prepositionUntil, 24);
    assert.ok(response.actions.some(a => a.label === '条件達成に備えMustika前へ')); assert.ok(!pickup(response));
    assert.equal(JSON.stringify(input), before);
    tr.brain = response.brain; Object.assign(tr, F.points[team].mustika); sim.time = 10;
    assert.ok(C.next(view(sim, tr)).wait > 0);
    sim.sanctuary[team] = 10; assert.ok(C.next(view(sim, tr)).actions.some(a => a.objectId === 'M'));
  }
});
test('speculative shared-foundation window is bounded, upgrades once, and cancels when further Earth supply is needed', () => {
  const { sim, tr, br } = world(); seed(sim, 'r2', 3, 'red');
  material(sim, 'red', 'earth', br); material(sim, 'red', 'sky', br);
  let response = C.next(view(sim, tr)); assert.equal(response.brain.prepositionUntil, 16); tr.brain = response.brain;
  Object.assign(tr, F.points.red.mustika); sim.time = 8;
  response = C.next(view(sim, tr)); assert.equal(response.brain.prepositionUntil, 16); tr.brain = response.brain;
  seed(sim, 's2', 1, 'blue'); response = C.next(view(sim, tr)); assert.equal(response.brain.prepositionUntil, 32); tr.brain = response.brain;
  sim.time = 20; response = C.next(view(sim, tr)); assert.equal(response.brain.prepositionUntil, 32); tr.brain = response.brain;
  sim.time = 33; response = C.next(view(sim, tr)); assert.notEqual(response.status, 'Mustika前待機 · 条件達成待ち');
  // An empty shared area with only Sky left is not a near-complete mandate.
  sim.objects.filter(o => o.spotId === 's2').forEach(o => { o.location = 'source'; });
  const earth = sim.object(br.cargo.find(id => sim.object(id).type === 'earth'));
  br.cargo = br.cargo.filter(id => id !== earth.id); Object.assign(earth, { location: 'spot', spotId: 's2', layer: 0, touchedBy: null });
  sim.changed(); assert.equal(E.qualificationForecast(view(sim, tr)), null);
  response = C.next(sim.view(tr)); assert.ok(pickup(response)); assert.equal(response.brain.prepositionUntil, undefined);
});
test('normal collection resumes after a false forecast instead of starving BR indefinitely', () => {
  const { sim } = world('red', { redBrPlan: 'private-first-short' });
  // Use the actual initial state and normal controllers, with no opponent cooperation.
  const initial = new S.Simulation(sim.config); initial.robots.filter(r => r.team === 'blue').forEach(r => { r.auto = false; });
  let firstForecast = null;
  const controllers = { next(v) { const response = C.next(v);
    if (v.id === 'redTR' && response.brain.prepositionUntil !== undefined) firstForecast ??= v.time;
    return response; } };
  while (!initial.ended) initial.step(.05, controllers);
  const events = initial.events, approach = events.find(e => e.robot === 'redTR' && e.kind === 'action' && e.action === 'pickup' && e.objectId === 'M');
  assert.ok(events.filter(e => e.robot === 'redTR' && e.action === 'delivery-complete').length >= 3);
  assert.ok(firstForecast !== null);
  assert.ok(events.some(e => e.robot === 'redTR' && e.kind === 'action' && e.action === 'pickup' && e.objectType === 'earth' && e.time > firstForecast));
  if (approach) assert.ok(approach.time >= initial.sanctuary.red);
});
test('forecast only uses the saved view; absent material, touched Mustika and locked opening cannot manufacture a pickup', () => {
  const { sim, tr } = world(); seed(sim, 'r2', 3, 'red'); seed(sim, 's2', 1, 'blue');
  assert.equal(E.qualificationForecast(view(sim, tr)), null);
  material(sim, 'red', 'earth'); material(sim, 'red', 'sky');
  const saved = view(sim, tr), expected = C.next(saved);
  sim.sanctuary.red = 0; sim.object('M').touchedBy = 'blueTR';
  assert.deepEqual(C.next(saved), expected);
  assert.ok(!C.next(view(sim, tr)).actions?.some(a => a.objectId === 'M'));
  sim.object('M').touchedBy = null; sim.sanctuary.red = null;
  const locked = E.courier(view(sim, tr), { opening: true, earth: 3, sky: 0 }, { lockOpening: true });
  assert.equal(locked.brain.prepositionUntil, undefined); assert.ok(pickup(locked));
});
test('receive refresh is normal-supply/local-observation only and never overrides explicit action programs', () => {
  const { sim, br } = world(); material(sim, 'red', 'earth'); material(sim, 'red', 'earth');
  const v = view(sim, br), ordinary = { brain: { stage: 'loaded' }, actions: [{ type: 'move', target: F.points.red.transferBR }, { type: 'receive', objectId: sim.stock('red')[1].id }] };
  assert.deepEqual(E.receiveAtTransfer({ ...v, supplyMode: 'ideal' }, ordinary), ordinary);
  assert.deepEqual(E.receiveAtTransfer({ ...v, brObservationMode: 'fixed' }, ordinary), ordinary);
  const guarded = E.receiveAtTransfer(v, ordinary); assert.equal(guarded.actions.at(-1).type, 'scan'); assert.ok(!guarded.actions.some(a => a.type === 'receive'));
  sim.config.robotPrograms = { redBR: { enabled: true, steps: [{ type: 'receive', objectType: 'earth' }], end: 'stop' } };
  Object.assign(br, F.points.red.transferBR); view(sim, br);
  assert.ok(C.next(sim.view(br)).actions.some(a => a.type === 'receive' && a.programStep === 0));
});
test('unloading status is a stopped observation, not live access to the partner job or future plan', () => {
  const { sim, tr, br } = world(); const upper = material(sim, 'red', 'earth', tr);
  sim.startJob(tr, { type: 'unload', objectId: upper.id }); view(sim, br);
  const saved = JSON.stringify(br.observation); assert.deepEqual(br.observation.transferWork, { unloading: true });
  assert.deepEqual(Object.keys(br.observation.partner).sort(), ['cargo', 'x', 'y']);
  tr.job = null; tr.brain.hiddenIntent = 'not an observation';
  assert.equal(JSON.stringify(sim.view(br).observation), saved);
  assert.deepEqual(view(sim, br).observation.transferWork, { unloading: false });
});
test('level-radius observation does not disclose hidden TR unloading', () => {
  const { sim, tr, br } = world('red', { brObservation: { model: 'level-radius', replan: 'after-work', crossLevelRadius: 0 } });
  Object.assign(br, F.points.red.homeL2); Object.assign(tr, F.points.red.transferTR);
  const upper = material(sim, 'red', 'earth', tr); sim.startJob(tr, { type: 'unload', objectId: upper.id });
  const hidden = view(sim, br).observation; assert.equal(hidden.transferWork, null); assert.equal(hidden.visibility.entries.transferWork.status, 'unknown');
  Object.assign(br, F.points.red.transferBR);
  const seen = view(sim, br).observation; assert.deepEqual(seen.transferWork, { unloading: true }); assert.equal(seen.visibility.entries.transferWork.status, 'current');
});
test('slow in-flight unloading and rapid scans finish without stale stack IDs, on either color and robot order', () => {
  for (const team of ['red', 'blue']) for (const reverse of [false, true]) {
    const { sim, tr, br } = world(team, { robotTiming: { [team + 'TR']: { unload: 3 }, [team + 'BR']: { scan: .1 } },
      [team + 'BrTurns']: [{ slots: [{ type: 'earth', spotId: 's2' }, { type: 'none' }] }] });
    if (reverse) sim.robots.reverse();
    const lower = material(sim, team, 'earth'), upper = material(sim, team, 'earth', tr);
    view(sim, br); sim.startJob(tr, { type: 'unload', objectId: upper.id }); br.auto = true;
    while (sim.time < 25 && !sim.events.some(e => e.robot === br.id && e.action === 'place' && e.kind === 'action')) sim.step(.05, C);
    const receive = sim.events.find(e => e.robot === br.id && e.action === 'receive' && e.kind === 'action');
    assert.ok(receive); assert.equal(receive.objectId, upper.id); assert.ok(receive.time > 3);
    assert.equal(sim.object(lower.id).location, 'transfer'); assert.equal(sim.object(upper.id).location, 'spot');
    assert.ok(!sim.events.some(e => ['physical', 'rule'].includes(e.kind) && ['receive', 'unload'].includes(e.action)), JSON.stringify(sim.events));
  }
});
