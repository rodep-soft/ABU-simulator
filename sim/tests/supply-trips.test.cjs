const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, normalizeTrTrips, transportTripIndex } = require('../engine.js');
const F = require('../field.js');
const C = require('../controllers.js');
const E = ['earth', 'earth', 'earth'], ES = ['earth', 'sky', 'sky'];
function world(config = {}) {
  const s = new Simulation(config);
  for (const r of s.robots) r.auto = false;
  return s;
}
function carry(s, r, ids) {
  r.cargo = ids;
  for (const id of ids) Object.assign(s.object(id), { location: 'cargo', holder: r.id, touchedBy: r.id });
  s.changed();
}
function decide(s, r) { s.observe(r); return C.next(s.view(r)); }
function enter(s, team) { Object.assign(s.robot(`${team}BR`), F.points[team].home, { enteredL1: true, z: .6 }); }
function perform(s, r, action) {
  s.startJob(r, action); assert.ok(r.job, JSON.stringify(r.failure));
  while (r.job) s.step(.05);
  assert.equal(r.failure, null);
}

test('trip settings validate three slots and retain independent copies through reset/export', () => {
  const trips = [E.slice(), ES.slice()], s = world({ redTrTrips: trips });
  trips[0][0] = 'sky'; assert.equal(s.config.redTrTrips[0][0], 'earth');
  assert.deepEqual(s.config.blueTrTrips, []);
  const r = new Simulation(s.export().config); r.config.redTrTrips[0][0] = 'none';
  assert.equal(s.config.redTrTrips[0][0], 'earth');
  for (const bad of [null, {}, [['earth']], [['earth', 'sky', 'mustika']], [['none', 'none', 'none']]]) assert.throws(() => normalizeTrTrips(bad), TypeError);
  assert.throws(() => world({ supplyMode: 'typo' }), TypeError);
});

test('all 26 nonempty slot combinations select exact cargo counts, independently of the named TR plan', () => {
  for (const a of ['earth', 'sky', 'none']) for (const b of ['earth', 'sky', 'none']) for (const c of ['earth', 'sky', 'none']) {
    const slots = [a, b, c]; if (slots.every(t => t === 'none')) continue;
    const s = world({ redTrPlan: 'stock-e3', redTrTrips: [slots] }), r = s.robot('redTR');
    for (let i = 0; i < slots.filter(t => t !== 'none').length; i++) {
      const response = decide(s, r), action = response.actions.at(-1);
      assert.equal(action.type, 'pickup'); r.brain = response.brain;
      carry(s, r, [...r.cargo, action.objectId]);
    }
    assert.deepEqual(r.cargo.map(id => s.object(id).type).sort(), slots.filter(t => t !== 'none').sort());
    assert.equal(decide(s, r).brain.stage, 'deliver');
  }
});

test('box trip progress advances only after final unload; Mustika and controller resets do not consume slots', () => {
  const s = world({ redTrTrips: [E, ES] }), r = s.robot('redTR'); enter(s, 'red');
  Object.assign(r, F.points.red.transferTR, { z: .6 }); carry(s, r, ['red-E2', 'red-E1', 'red-E4']);
  perform(s, r, { type: 'unload' }); assert.equal(transportTripIndex(r.transport), 0);
  r.brain = { stage: 'start' };
  perform(s, r, { type: 'unload' }); assert.equal(transportTripIndex(r.transport), 0);
  perform(s, r, { type: 'unload' }); assert.equal(transportTripIndex(r.transport), 1);
  r.transport.completed.push({ items: [{ id: 'M', type: 'mustika' }], number: 2, time: s.time });
  r.brain = { stage: 'start' }; carry(s, r, ['red-E6']);
  assert.equal(s.object(decide(s, r).actions.at(-1).objectId).type, 'sky');
  assert.equal(transportTripIndex(r.transport), 1);
  assert.equal(C.transportPlan('stock-e3', 2, [E, ES]).opening, false);
});

test('source exhaustion ships a partial specified load or explicitly skips an empty exhausted trip', () => {
  const s = world({ redTrTrips: [E, ES] }), r = s.robot('redTR');
  carry(s, r, ['red-E2']);
  for (const o of s.objects) if (o.type === 'earth' && o.team === 'red' && o.location === 'source') o.location = 'unavailable';
  assert.equal(decide(s, r).brain.stage, 'deliver');
  r.cargo = []; s.object('red-E2').location = 'unavailable';
  assert.equal(decide(s, r).skipTrip, true); s.skipExhaustedTrip(r);
  assert.equal(transportTripIndex(r.transport), 1);
  assert.equal(s.object(decide(s, r).actions.at(-1).objectId).type, 'sky');
  s.skipExhaustedTrip(r); assert.equal(transportTripIndex(r.transport), 1);
});

test('Mustika may interrupt between specified box trips but not truncate a collected box load', () => {
  const s = world({ redTrTrips: [E] }), r = s.robot('redTR'); s.sanctuary.red = 0;
  assert.equal(decide(s, r).actions.at(-1).objectId, 'M');
  carry(s, r, ['red-E2']); r.brain = { stage: 'start' };
  assert.equal(s.object(decide(s, r).actions.at(-1).objectId).type, 'earth');
});

test('a temporarily contested source does not shorten a specified trip or count as exhausted', () => {
  const s = world({ redTrTrips: [ES] }), r = s.robot('redTR'); carry(s, r, ['red-E2', 'S10']);
  for (const o of s.objects) if (o.type === 'sky' && o.location === 'source' && o.id !== 'S8') o.location = 'used';
  s.object('S8').touchedBy = 'blueTR';
  const response = decide(s, r);
  assert.equal(response.actions, undefined); assert.ok(response.wait); assert.equal(response.brain.stage, 'collect');
  assert.equal(response.skipTrip, undefined);
  s.object('S8').touchedBy = null; r.brain = response.brain;
  assert.equal(decide(s, r).actions.at(-1).objectId, 'S8');
});

test('normal mode is untouched and ideal starts after BR entry with symmetric finite stock and no fake deliveries', () => {
  const normal = world(); enter(normal, 'red'); normal.replenishIdealSupply(); assert.equal(normal.stock('red').length, 0);
  const s = world({ supplyMode: 'ideal' }); s.replenishIdealSupply(); assert.equal(s.stock('red').length, 0);
  for (const team of ['red', 'blue']) enter(s, team);
  s.replenishIdealSupply();
  for (const team of ['red', 'blue']) {
    assert.deepEqual(['earth', 'sky'].map(t => s.stock(team).filter(o => o.type === t).length), [3, 4]);
    assert.equal(s.objects.filter(o => o.type === 'sky' && o.supplyTeam === team).length, 6);
    assert.equal(s.transferPoints[team], 0); assert.deepEqual(s.robot(`${team}TR`).transport.completed, []);
  }
  assert.equal(s.objects.length, 53); assert.equal(new Set(s.objects.map(o => o.id)).size, 53);
  assert.equal(s.object('M').location, 'source');
  assert.equal(s.export().config.supplyMode, 'ideal');
});

test('ideal supply preserves entry footprint, reserved returns, receive order and old observation snapshots', () => {
  const s = world({ supplyMode: 'ideal' }), br = s.robot('redBR'); enter(s, 'red');
  carry(s, br, ['red-E2', 'red-E4']); s.observe(br); const obs = structuredClone(br.observation);
  s.replenishIdealSupply();
  assert.deepEqual(br.observation, obs); assert.equal(s.stock('red').filter(o => o.type === 'earth').length, 1);
  Object.assign(br, F.points.red.transferBR);
  perform(s, br, { type: 'return', objectId: 'red-E2' }); perform(s, br, { type: 'return', objectId: 'red-E4' });
  assert.equal(s.stock('red').filter(o => o.type === 'earth').length, 3);
  const top = s.stock('red').filter(o => o.type === 'sky').at(-1);
  perform(s, br, { type: 'receive', objectId: top.id });
  enter(s, 'red'); br.queue = [{ type: 'receive', objectId: s.stock('red').filter(o => o.type === 'sky').at(-1).id }];
  const stock = structuredClone(s.stock('red')); s.replenishIdealSupply(); assert.deepEqual(s.stock('red'), stock);
  assert.equal(s.scores().red.transfer, 0);
});

test('ideal stock is finite and does not create new objects on exhaustion or after match end', () => {
  const s = world({ supplyMode: 'ideal' }); enter(s, 'red'); enter(s, 'blue');
  for (let i = 0; i < 25; i++) {
    s.replenishIdealSupply();
    for (const o of s.objects) if (o.location === 'transfer') o.location = 'used';
  }
  assert.equal(s.objects.filter(o => o.location === 'used').length, 52);
  assert.equal(s.events.filter(e => e.action === 'ideal-supply').length, 52);
  assert.equal(s.objects.length, 53);
  const end = world({ supplyMode: 'ideal' }); enter(end, 'red'); end.time = 180; end.ended = true; end.replenishIdealSupply(); assert.equal(end.stock('red').length, 0);
});

test('ideal TR approaches Mustika without early pickup and retains normal legal direct handoff', () => {
  const s = world({ supplyMode: 'ideal', redTrTrips: [E] }), tr = s.robot('redTR'), br = s.robot('redBR');
  assert.deepEqual(decide(s, tr).actions[0].target, F.points.red.mustika);
  Object.assign(tr, F.points.red.mustika);
  assert.ok(decide(s, tr).wait); assert.equal(s.validate(tr, { type: 'pickup', objectId: 'M' }).ok, false);
  s.sanctuary.red = 0; perform(s, tr, { type: 'pickup', objectId: 'M' });
  assert.equal(s.validate(tr, { type: 'unload' }).ok, false);
  Object.assign(tr, F.points.red.transferTR, { z: .6 }); Object.assign(br, F.points.red.transferBR, { z: .6, enteredL1: true });
  perform(s, br, { type: 'receive', objectId: 'M' });
  assert.deepEqual(br.cargo, ['M']); assert.equal(transportTripIndex(tr.transport), 0); assert.equal(s.object('M').holder, br.id);
});

test('real match executes different specified trips for both teams without exceeding cargo capacity', () => {
  const s = new Simulation({ redTrTrips: [E, ES], blueTrTrips: [['earth', 'earth', 'sky'], ['earth', 'none', 'none']], redBrPlan: 'basic', blueBrPlan: 'basic' });
  while (!s.ended && s.robots.filter(r => r.role === 'TR').some(r => transportTripIndex(r.transport) < 2)) {
    s.step(.05, C);
    for (const r of s.robots) assert.ok(r.cargo.length <= (r.role === 'TR' ? 3 : 2));
  }
  for (const team of ['red', 'blue']) {
    const deliveries = s.robot(`${team}TR`).transport.completed.filter(d => d.items.every(o => o.type !== 'mustika'));
    assert.ok(deliveries.length >= 2, `${team}: ${JSON.stringify(deliveries)}`);
    assert.deepEqual(deliveries.slice(0, 2).map(d => d.items.map(o => o.type).sort()), s.config[`${team}TrTrips`].map(slots => slots.filter(t => t !== 'none').sort()));
  }
});

test('ideal full match enters L1, places blocks, and keeps qualification checks and cargo limits', () => {
  const s = new Simulation({ supplyMode: 'ideal', redBrPlan: 'mustika-fast', blueBrPlan: 'l2-earth' });
  while (!s.ended) {
    s.step(.05, C);
    for (const r of s.robots) assert.ok(r.cargo.length <= (r.role === 'TR' ? 3 : 2));
    for (const team of ['red', 'blue']) assert.ok(s.stock(team).length <= 7);
  }
  for (const team of ['red', 'blue']) {
    assert.ok(s.robot(`${team}BR`).enteredL1);
    assert.ok(s.events.some(e => e.robot === `${team}BR` && e.action === 'place'));
  }
  for (const e of s.events.filter(e => e.action === 'pickup' && e.objectId === 'M' && e.kind === 'action')) assert.ok(Number.isFinite(e.sanctuaryAt) && e.sanctuaryAt <= e.time);
  assert.ok(!s.events.some(e => e.action === 'pickup' && e.objectType !== 'mustika' && e.kind === 'action'));
  assert.equal(s.time, 180); assert.equal(s.objects.length, 53);
});
