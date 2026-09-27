const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, blockCount } = require('../engine.js');
const F = require('../field.js');
const C = require('../controllers.js');
const options = { brObservation: { model: 'level-radius', crossLevelRadius: 3, replan: 'after-work' }, redBrPlan: 'tactical-baseline-v2', blueBrPlan: 'tactical-baseline-v2' };
function world(extra = {}) {
  const s = new Simulation({ ...options, ...extra });
  s.robots.forEach(r => { r.auto = false; });
  return s;
}
function hold(s, r, id) {
  Object.assign(s.object(id), { location: 'cargo', holder: r.id, touchedBy: r.id });
  r.cargo.push(id); s.changed();
}
function job(s, r, action) {
  s.startJob(r, action); assert.ok(r.job, JSON.stringify(r.failure));
  for (let i = 0; r.job && i < 200; i++) s.step(.05);
  assert.equal(r.job, null); assert.equal(r.failure, null);
}
test('new observation settings are optional, validated and copied; old defaults remain fixed', () => {
  const s = new Simulation(); assert.equal(s.config.brObservation, undefined);
  assert.equal(s.config.brObservationMode, 'fixed'); assert.equal(s.config.trMustikaPickupSignal ?? 'off', 'off');
  const config = structuredClone(options), other = world(config);
  config.brObservation.crossLevelRadius = 99;
  assert.equal(other.config.brObservation.crossLevelRadius, 3);
  assert.throws(() => world({ brObservation: { model: 'omniscient' } }));
  assert.throws(() => world({ trMustikaPickupSignal: 'live-tracking' }));
});
test('work-completion observation costs scanSeconds and gates the next receive', () => {
  const s = world(), br = s.robot('redBR');
  Object.assign(br, F.points.red.transferBR, { z: .6, enteredL1: true });
  for (const id of ['red-E1', 'red-E2']) {
    const o = s.object(id), slot = s.freeSlot('red', o);
    Object.assign(o, { location: 'transfer', transferTeam: 'red', slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z });
  }
  s.changed(); job(s, br, { type: 'scan', local: true });
  job(s, br, { type: 'receive', objectId: 'red-E2' });
  assert.equal(br.needsWorkScan, true);
  assert.equal(s.validate(br, { type: 'receive', objectId: 'red-E1' }).kind, 'perception');
  const before = br.observation, start = s.time;
  s.startJob(br, { type: 'scan', local: true });
  for (let i = 0; i < 19; i++) s.step(.05);
  assert.equal(br.observation, before); assert.equal(br.needsWorkScan, true);
  for (let i = 0; br.job && i < 3; i++) s.step(.05);
  assert.ok(s.time - start >= .999); assert.equal(br.needsWorkScan, false);
  job(s, br, { type: 'receive', objectId: 'red-E1' });
  assert.equal(blockCount(br.cargo, id => s.object(id)), 2);
});
test('dispatcher keeps direct Mustika handoff and enshrine priority with two blocks after work scans', () => {
  for (const team of ['red', 'blue']) {
    const s = world(), br = s.robot(team + 'BR'), tr = s.robot(team + 'TR');
    Object.assign(br, F.points[team].transferBR, { z: .6, enteredL1: true, brain: { stage: 'choose' } });
    Object.assign(tr, F.points[team].transferTR, { z: .6 });
    hold(s, br, team + '-E1'); hold(s, br, 'S1'); hold(s, tr, 'M'); s.sanctuary[team] = 0;
    job(s, br, { type: 'scan', local: true });
    // Qualification is provided by the BR's already-observed sticky history.
    br.observation.sanctuary = true; br.brKnowledge.sanctuary = true;
    const decision = C.next(s.view(br));
    assert.ok(decision.actions.some(a => a.type === 'receive' && a.objectId === 'M'));
    job(s, br, { type: 'receive', objectId: 'M' });
    assert.equal(br.cargo.length, 3); assert.equal(blockCount(br.cargo, id => s.object(id)), 2);
    assert.ok(C.next(s.view(br)).actions.some(a => a.type === 'scan'));
    job(s, br, { type: 'scan', local: true });
    assert.ok(C.next(s.view(br)).actions.some(a => a.type === 'enshrine'));
  }
});
test('acquisition notification is opt-in, emitted only on completed legal TR pickup, and historical', () => {
  for (const signal of ['off', 'global-instant']) {
    const s = world({ trMustikaPickupSignal: signal }), tr = s.robot('redTR'), br = s.robot('blueBR');
    Object.assign(tr, F.points.red.mustika);
    assert.equal(s.validate(tr, { type: 'pickup', objectId: 'M' }).ok, false);
    assert.equal(br.opponentMustikaPickup, undefined);
    s.sanctuary.red = 0;
    s.startJob(tr, { type: 'pickup', objectId: 'M' }); assert.ok(tr.job);
    assert.equal(br.opponentMustikaPickup, undefined);
    for (let i = 0; tr.job && i < 80; i++) s.step(.05);
    assert.equal(s.object('M').holder, tr.id);
    if (signal === 'off') assert.equal(br.opponentMustikaPickup, undefined);
    else {
      const notification = structuredClone(br.opponentMustikaPickup);
      assert.equal(notification.opponent, 'redTR'); assert.equal(br.openingReleased, true);
      s.time += 2; Object.assign(s.object('M'), { location: 'source', holder: null }); tr.cargo = []; s.changed();
      assert.deepEqual(s.view(br).opponentMustikaPickup, notification);
    }
  }
});
test('Windows ideal supply remains finite and does not leak transport points into partial estimates', () => {
  const s = world({ supplyMode: 'ideal' }), br = s.robot('redBR');
  const counts = ['earth', 'sky'].map(type => s.objects.filter(o => o.type === type).length);
  Object.assign(br, F.points.red.brStandby, { z: .6, enteredL1: true });
  for (let i = 0; i < 10; i++) s.step(.05);
  assert.ok(s.stock('red').length > 0);
  job(s, br, { type: 'scan', local: true });
  assert.deepEqual(s.transferPoints, { red: 0, blue: 0 });
  assert.deepEqual(['earth', 'sky'].map(type => s.objects.filter(o => o.type === type).length), counts);
  assert.equal(br.observation.scores, null);
  assert.equal(br.observation.estimatedScores.red.transfer, 0);
});
test('explicit two-box turns survive per-work scans and advance only after both placements', () => {
  for (const model of ['ideal', 'level-radius']) {
    const turn = (...slots) => ({ slots: slots.map(([type, spotId]) => ({ type, spotId })) });
    const s = world({ supplyMode: 'ideal', brObservation: { model, replan: 'after-work' },
      redBrTurns: [turn(['earth', 's2'], ['earth', 'r2']), turn(['earth', 's2'], ['sky', 's2']), 'tactical-baseline-v2'] });
    const br = s.robot('redBR');
    Object.assign(br, F.points.red.brStandby, { enteredL1: true, z: .6, auto: true, brain: { stage: 'choose' } });
    while (s.time < 100 && (br.brTurn?.completed || 0) < 2) s.step(.05, C);
    assert.equal(br.brTurn?.completed, 2, JSON.stringify({ brain: br.brain, cargo: br.cargo, turn: br.brTurn, status: br.status }));
    const events = action => s.events.filter(e => e.robot === br.id && e.kind === 'action' && e.action === action);
    assert.deepEqual(events('receive').map(e => e.objectType), ['earth', 'earth', 'earth', 'sky']);
    assert.deepEqual(events('place').map(e => e.spotId), ['s2', 'r2', 's2', 's2']);
    assert.equal(s.brStrategy('red'), 'tactical-baseline-v2');
    const places = events('place');
    assert.ok(events('scan').some(e => e.time > places[2].time && e.time < places[3].time));
    assert.equal(events('scan').some(e => e.arrival), false);
  }
});
test('v2 also finishes under unchanged stopped/fixed observations and normal/ideal Windows supply', () => {
  for (const brObservationMode of ['stopped', 'fixed']) for (const supplyMode of ['normal', 'ideal']) {
    const s = new Simulation({ redBrPlan: 'tactical-baseline-v2', blueBrPlan: 'tactical-baseline-v2',
      redTrPlan: 'stock-e3', blueTrPlan: 'stock-e3', brObservationMode, supplyMode });
    while (!s.ended) s.step(.05, C);
    assert.equal(s.time, 180);
    assert.equal(s.events.some(e => e.kind === 'policy'), false);
    for (const team of ['red', 'blue']) assert.ok(s.events.some(e => e.robot === team + 'BR' && e.kind === 'action' && e.action === 'place'), `${brObservationMode}/${supplyMode}/${team}`);
  }
});
