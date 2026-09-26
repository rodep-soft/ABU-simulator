const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../engine.js');
const F = require('../field.js');
const C = require('../controllers.js');
const Planner = require('../score-planner.js');
const program = (...slots) => ({ slots: slots.map(([type, spotId]) => ({ type, spotId: spotId || null })) });
const EE = () => program(['earth', 's2'], ['earth', 'r2']);
function world(config = {}) {
  const s = new S.Simulation({ brObservationMode: 'stopped', ...config });
  s.robots.forEach(r => { r.auto = false; });
  const br = s.robot('redBR');
  Object.assign(br, F.points.red.brStandby, { z: .6, enteredL1: true, brain: { stage: 'choose' } });
  return { s, br };
}
function runUntil(s, condition, limit = 180) {
  while (!condition() && !s.ended && s.time < limit) s.step(.05, C);
  assert.ok(condition(), JSON.stringify(s.robots.map(r => ({ id: r.id, status: r.status, brain: r.brain, progress: r.brTurn, cargo: r.cargo }))));
}
function observe(s, br) { s.observe(br); br.scanLoaded = true; br.batchRemaining = S.scanBudget(br); }
function tower(s, id, types, team = 'blue') {
  const spot = F.spotById[id]; let z = spot.level === 1 ? .6 : .9;
  for (const [layer, type] of types.entries()) {
    const o = s.objects.find(o => o.location === 'source' && o.type === type && (type !== 'earth' || o.team === team));
    Object.assign(o, { location: 'spot', x: spot.x, y: spot.y, z, layer, spotId: id, placedBy: team, color: type === 'sky' ? team : null, touchedBy: null });
    z += o.height;
  }
  s.changed();
}
const actionEvents = (s, action) => s.events.filter(e => e.robot === 'redBR' && e.kind === 'action' && e.action === action);

test('observation mode and mixed named/specified turns validate and copy independently', () => {
  const turn = EE(), s = new S.Simulation({ redBrTurns: [turn, 'l2-earth'] });
  turn.slots[0].spotId = 'u1'; assert.equal(s.config.redBrTurns[0].slots[0].spotId, 's2');
  assert.equal(s.config.brObservationMode, 'fixed'); assert.equal(s.view(s.robot('redBR')).brPlan, 'efficient');
  assert.deepEqual(new S.Simulation(s.export().config).config, s.config);
  assert.throws(() => new S.Simulation({ brObservationMode: 'moving' }), TypeError);
  for (const turn of [{ slots: [] }, program(['none'], ['none']), program(['earth', 'b1'], ['none']), program(['sky', 'missing'], ['none']), program(['mustika', 's2'], ['none'])]) {
    assert.throws(() => new S.Simulation({ redBrTurns: [turn] }), TypeError);
  }
  assert.deepEqual(s.config.blueBrTurns, []);
});

test('standby is legal, mirrored and outside the receive exclusion radius', () => {
  const s = new S.Simulation();
  for (const team of ['red', 'blue']) {
    const r = s.robot(`${team}BR`); r.enteredL1 = true;
    assert.ok(s.footprintAllowed(r, F.points[team].brStandby));
    assert.ok(S.distance(F.points[team].brStandby, F.points[team].transferBR) > .75);
  }
  assert.deepEqual(F.points.blue.brStandby, F.mirror(F.points.red.brStandby));
});

test('scan is permitted only when stopped on L1/L2; fixed mode retains home restriction', () => {
  const { s, br } = world();
  assert.equal(s.validate(br, { type: 'scan' }).ok, true);
  br.velocity = .1; assert.equal(s.validate(br, { type: 'scan' }).ok, false); br.velocity = 0;
  Object.assign(br, F.points.red.startBR, { enteredL1: false });
  assert.equal(s.validate(br, { type: 'scan' }).ok, false);
  Object.assign(br, F.spotApproaches(F.spotById.u1, 'red')[0], { enteredL1: true });
  assert.equal(s.validate(br, { type: 'scan' }).ok, true);
  s.config.brObservationMode = 'fixed'; assert.equal(s.validate(br, { type: 'scan' }).ok, false);
});

test('observation remains stale during movement and until the full scan completes', () => {
  const { s, br } = world(); observe(s, br);
  const before = JSON.stringify(br.observation);
  tower(s, 'u1', ['earth']);
  s.enqueue(br.id, [{ type: 'move', target: F.points.red.transferBR }]);
  while (br.queue.length || br.job) s.step(.05);
  assert.equal(JSON.stringify(br.observation), before);
  s.startJob(br, { type: 'scan' });
  for (let i = 0; i < 10; i++) s.step(.05);
  assert.equal(JSON.stringify(br.observation), before);
  while (br.job) s.step(.05);
  assert.equal(br.observation.towers.u1.length, 1);
  assert.deepEqual(br.observation.origin, F.points.red.transferBR);
});

test('initial BR entry and idle scans stay near transfer without blocking normal TR supply', () => {
  const s = new S.Simulation({ brObservationMode: 'stopped', redTrPlan: 'stock-e3', redBrTurns: [EE()] });
  s.robots.filter(r => r.team === 'blue').forEach(r => { r.auto = false; });
  runUntil(s, () => actionEvents(s, 'place').length >= 2, 90);
  assert.deepEqual(actionEvents(s, 'scan')[0].origin, F.points.red.brStandby);
  assert.ok(s.events.some(e => e.action === 'unload' && e.robot === 'redTR'));
  assert.deepEqual(actionEvents(s, 'place').slice(0, 2).map(e => e.spotId), ['s2', 'r2']);
  assert.ok(!actionEvents(s, 'scan').some(e => S.distance(e.origin, F.points.red.home) < .12));
});

test('specified mixed rounds receive exact pairs, honor slot order and switch after both placements', () => {
  const { s, br } = world({ supplyMode: 'ideal', redBrTurns: [EE(), program(['earth', 's2'], ['sky', 's2']), 'l2-earth'] });
  br.auto = true;
  runUntil(s, () => br.brTurn?.completed >= 2, 100);
  assert.deepEqual(actionEvents(s, 'receive').map(e => e.objectType), ['earth', 'earth', 'earth', 'sky']);
  assert.deepEqual(actionEvents(s, 'place').map(e => e.spotId), ['s2', 'r2', 's2', 's2']);
  assert.equal(s.brStrategy('red'), 'l2-earth');
  const places = actionEvents(s, 'place'), scans = actionEvents(s, 'scan');
  assert.ok(scans.some(e => e.time > places[0].time && e.time < places[1].time && S.distance(e.origin, F.spotApproaches(F.spotById.s2, 'red')[0]) < .12));
  assert.ok(!scans.some(e => e.time > places[2].time && e.time < places[3].time));
  assert.equal(s.events.filter(e => e.action === 'br-turn-complete').length, 2);
});

test('all eight nonempty E/S/none combinations produce the requested number and order', () => {
  for (const a of ['earth', 'sky', 'none']) for (const b of ['earth', 'sky', 'none']) {
    if (a === 'none' && b === 'none') continue;
    const { s, br } = world({ supplyMode: 'ideal', redBrTurns: [program([a, 's2'], [b, 'r2'])] });
    if (a === 'sky') tower(s, 's2', ['earth', 'earth']);
    if (b === 'sky') tower(s, 'r2', ['earth', 'earth'], 'red');
    br.auto = true; runUntil(s, () => br.brTurn?.completed === 1, 70);
    assert.deepEqual(actionEvents(s, 'receive').map(e => e.objectType), [a, b].filter(type => type !== 'none'));
    assert.deepEqual(actionEvents(s, 'place').map(e => e.spotId), [a === 'none' ? null : 's2', b === 'none' ? null : 'r2'].filter(Boolean));
  }
});

test('partial receipts and Retry preserve slot assignment without fetching a third box', () => {
  const { s, br } = world({ supplyMode: 'ideal', redBrTurns: [EE()] }); br.auto = true;
  runUntil(s, () => actionEvents(s, 'receive').length === 1);
  const first = br.cargo[0]; assert.equal(br.brTurn.assigned[0], first);
  assert.equal(s.relocateForRetry(br, 1).ok, true);
  runUntil(s, () => br.brTurn.completed === 1, 90);
  assert.equal(actionEvents(s, 'receive').length, 2);
  assert.equal(actionEvents(s, 'place')[0].objectId, first);
});

test('a destination filled while travelling is observed on arrival and falls back without advancing early', () => {
  const { s, br } = world({ supplyMode: 'ideal', redBrTurns: [EE()] }); br.auto = true;
  runUntil(s, () => br.cargo.length === 2 && br.job?.type === 'move' && S.distance(br.job.target, F.spotApproaches(F.spotById.s2, 'red')[0]) < .02);
  tower(s, 's2', ['earth', 'earth', 'sky']);
  assert.equal(br.observation.towers.s2.length, 0);
  runUntil(s, () => br.brTurn?.fallback, 60);
  assert.equal(br.brTurn.completed, 0); assert.equal(br.cargo.length, 2);
  assert.equal(br.observation.towers.s2.length, 3);
  runUntil(s, () => br.brTurn.completed === 1, 100);
  assert.ok(actionEvents(s, 'place').every(e => e.spotId !== 's2'));
  assert.equal(s.events.filter(e => e.action === 'br-turn-fallback').length, 1);
});

test('unplaceable carried Sky is returned and the next turn starts, without waiting on a full load', () => {
  const { s, br } = world({ supplyMode: 'ideal', redBrTurns: [program(['sky', 'u1'], ['sky', 'u2'])] });
  for (const id of ['u1', 'u2']) tower(s, id, ['earth', 'earth']);
  br.auto = true; runUntil(s, () => br.cargo.length === 2);
  for (const id of ['u1', 'u2']) {
    const o = s.objects.find(o => o.type === 'sky' && o.location === 'source'), spot = F.spotById[id];
    Object.assign(o, { location: 'spot', spotId: id, layer: 2, x: spot.x, y: spot.y, z: 1.6, placedBy: 'blue', color: 'blue' });
  }
  s.changed(); runUntil(s, () => br.brTurn.completed === 1, 120);
  assert.equal(actionEvents(s, 'return').length, 2); assert.equal(br.cargo.length, 0);
});

test('idle specified pair waits clear of transfer rather than departing with one', () => {
  const { s, br } = world({ redBrTurns: [EE()] });
  const o = s.object('red-E1'), slot = F.slots('red')[0];
  Object.assign(o, { location: 'transfer', transferTeam: 'red', slot: slot.id, x: slot.x, y: slot.y, z: .6, layer: 0 });
  s.changed(); br.auto = true;
  while (s.time < 10) s.step(.05, C);
  assert.equal(actionEvents(s, 'receive').length, 0); assert.equal(br.brTurn?.completed || 0, 0);
  assert.ok(S.distance(br, F.points.red.brStandby) < .12);
  assert.ok(actionEvents(s, 'scan').length >= 3);
});

test('manual schedules still work with the legacy fixed observation mode', () => {
  const { s, br } = world({ brObservationMode: 'fixed', supplyMode: 'ideal', redBrTurns: [EE()] });
  br.brain.stage = 'start'; br.auto = true;
  runUntil(s, () => br.brTurn?.completed === 1, 90);
  assert.deepEqual(actionEvents(s, 'place').map(e => e.spotId), ['s2', 'r2']);
  assert.ok(actionEvents(s, 'scan').every(e => F.atScanPoint('red', e.origin)));
});

test('specified pairs detect finite shortages by count and exclude inaccessible Sky supply', () => {
  const { s, br } = world({ redBrTurns: [EE()] });
  observe(s, br);
  br.observation.source = [br.observation.source.find(o => o.type === 'earth')];
  assert.ok(C.next(s.view(br)).fallbackTurn);
  br.observation.partner.cargo = [{ id: 'incoming-E', type: 'earth' }];
  assert.equal(C.next(s.view(br)).fallbackTurn, undefined);
  s.config.redBrTurns = [program(['sky', 'u1'], ['sky', 'u2'])];
  br.observation.partner.cargo = [];
  br.observation.source = [{ id: 'far-S1', type: 'sky', x: 6 }, { id: 'far-S2', type: 'sky', x: 6 }];
  assert.ok(C.next(s.view(br)).fallbackTurn);
  s.config.supplyMode = 'ideal';
  br.observation.source.forEach(o => { o.x = 5.5; o.supplyTeam = 'blue'; });
  assert.ok(C.next(s.view(br)).fallbackTurn);
});

test('fallback hands existing cargo to every normal BR policy without picking up extra boxes', () => {
  for (const { id: redBrPlan } of C.listStrategies('BR')) {
    const { s, br } = world({ redBrPlan, redBrTurns: [EE()] });
    const held = [s.object('red-E1'), s.object('red-E2')];
    held.forEach(o => { Object.assign(o, { location: 'cargo', holder: br.id, touchedBy: br.id }); });
    br.cargo = held.map(o => o.id);
    br.brTurn = { completed: 0, fallback: true, assigned: [...br.cargo], settled: [] };
    observe(s, br);
    const response = C.next(s.view(br));
    assert.ok(response.actions.some(a => a.type === 'place'), redBrPlan);
    assert.ok(!response.actions.some(a => a.type === 'receive'), redBrPlan);
  }
});

test('L2 work re-observes locally and continues with the remaining single box', () => {
  const { s, br } = world({ supplyMode: 'ideal', redBrTurns: [program(['earth', 'u1'], ['earth', 'u2'])] }); br.auto = true;
  runUntil(s, () => br.brTurn?.completed === 1, 110);
  const places = actionEvents(s, 'place'); assert.deepEqual(places.map(e => e.spotId), ['u1', 'u2']);
  assert.ok(actionEvents(s, 'scan').filter(e => e.time > places[0].time).every(e => e.level === 'l2'));
  assert.ok(!s.events.some(e => e.kind === 'perception'));
});

test('local planner timing does not add a trip back to the old L1/L2 look points', () => {
  const { s, br } = world(); Object.assign(br, F.spotApproaches(F.spotById.u1, 'red')[0], { z: .9 });
  const o = s.object('red-E1'); Object.assign(o, { location: 'cargo', holder: br.id, touchedBy: br.id }); br.cargo = [o.id]; observe(s, br);
  const view = s.view(br), tasks = [{ type: 'place', spotId: 'u1', objectId: o.id }];
  const stopped = Planner.specifiedPlan(view, [], tasks);
  assert.equal(stopped.completeSeconds, s.config.placeSeconds);
  const cached = Planner.plan(view, { oneSortie: true, noRecover: true });
  Planner.clearCache(); const fresh = Planner.plan(view, { oneSortie: true, noRecover: true });
  assert.deepEqual(cached, fresh);
});

test('both teams finish 180 seconds with normal/ideal supply and legal stopped scans', () => {
  for (const supplyMode of ['normal', 'ideal']) {
    const s = new S.Simulation({ brObservationMode: 'stopped', supplyMode, redTrPlan: 'stock-e3', blueTrPlan: 'stock-e3', redBrPlan: 'mustika-fast', blueBrPlan: 'earth-late',
      redBrTurns: [EE()], blueBrTurns: [program(['earth', 'u4'], ['earth', 'u2'])] });
    while (!s.ended) s.step(.05, C);
    assert.equal(s.time, 180);
    for (const team of ['red', 'blue']) {
      assert.ok(s.events.some(e => e.robot === `${team}BR` && e.action === 'place' && e.kind === 'action'));
      assert.ok(s.robot(`${team}BR`).brTurn.completed >= 1);
    }
    assert.ok(s.events.filter(e => e.action === 'scan' && e.kind === 'action').every(e => ['l1', 'l2'].includes(e.level)));
    assert.ok(!s.events.some(e => ['rule', 'perception'].includes(e.kind)));
  }
});
