'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation } = require('../engine.js');
const Field = require('../field.js');
const Perception = require('../br-observation.js');
const Baseline = require('../tactical-baseline.js');
const Controllers = require('../controllers.js');

const ID = 'tactical-baseline-v1';
const other = team => team === 'red' ? 'blue' : 'red';
function world(team = 'red', model = 'level-radius') {
  const sim = new Simulation({ [`${team}BrPlan`]: ID,
    brObservation: { model, replan: 'after-work', crossLevelRadius: 3 },
    trMustikaPickupSignal: 'global-instant' });
  for (const robot of sim.robots) robot.auto = false;
  const br = sim.robot(team + 'BR');
  Object.assign(br, Field.points[team].transferBR, { z: .6, enteredL1: true, brain: { stage: 'choose' } });
  return { sim, br, team };
}
function seed(sim, id, count, team, skyColor = team) {
  const point = Field.spotById[id];
  for (let layer = 0; layer < count; layer++) {
    const type = layer === 2 ? 'sky' : 'earth';
    const object = sim.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === team));
    assert.ok(object);
    Object.assign(object, { location: 'spot', spotId: id, layer, x: point.x, y: point.y,
      z: (point.level === 2 ? .9 : .6) + .35 * layer, placedBy: team,
      color: type === 'sky' ? skyColor : null, touchedBy: null, holder: null });
  }
  sim.changed();
}
function hold(sim, br, id) {
  Object.assign(sim.object(id), { location: 'cargo', holder: br.id, touchedBy: br.id });
  br.cargo.push(id); sim.changed();
}
function scan(sim, br) {
  sim.complete(br, { type: 'scan', local: true });
  assert.equal(br.failure, null);
  return sim.view(br);
}
function endgame(team = 'red') {
  const w = world(team), target = team === 'red' ? 'u1' : 'u2';
  seed(w.sim, team === 'red' ? 'u3' : 'u4', 1, team);
  seed(w.sim, target, 3, other(team));
  scan(w.sim, w.br); // Last observed supply at the receiving edge.
  Object.assign(w.br, Field.spotApproaches(Field.spotById[target], team)[0], { z: .9 });
  w.sim.time = 155;
  const view = scan(w.sim, w.br);
  assert.equal(view.observation.visibility.entries.stock.status, 'stale');
  return { ...w, target, view };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

test('baseline flips observed Sky locally before returning to inspect stale supply, on either color', () => {
  for (const team of ['red', 'blue']) {
    const { sim, br, target, view } = endgame(team), response = Baseline.builder(view);
    assert.ok(response.actions?.some(a => a.type === 'flip' && a.spotId === target));
    assert.ok(!response.actions.some(a => a.type === 'receive' || a.type === 'return'));
    assert.ok(!response.actions.some(a => a.type === 'move' && a.target.x === Field.points[team].transferBR.x && a.target.y === Field.points[team].transferBR.y));
    br.brain = response.brain; sim.enqueue(br.id, response.actions);
    for (let n = 0; n < 500 && (br.job || br.queue.length); n++) sim.step(.05);
    assert.equal(br.failure, null); assert.equal(sim.tower(target).at(-1).color, team);
    assert.equal(br.needsWorkScan, true);
  }
});

test('baseline still requires the work-completion scan before any local action', () => {
  const { view } = endgame();
  for (const state of [{ needsWorkScan: true, scanLoaded: false }, { failure: { action: 'flip' } }, { brain: { stage: 'return' } }]) {
    const response = Baseline.builder({ ...view, ...state });
    assert.deepEqual(response.actions, [{ type: 'scan', local: true }]);
  }
});

test('first own placement stays within mirrored 1/2/7 even if opponent pickup already released engine opening mask', () => {
  for (const team of ['red', 'blue']) {
    const { sim, br } = world(team);
    hold(sim, br, team + '-E1');
    Object.assign(br, Field.spotApproaches(Field.spotById[team === 'red' ? 'u1' : 'u2'], team)[0], { z: .9 });
    sim.time = 25;
    br.opponentMustikaPickup = { acquiredAt: 20, receivedAt: 20, sender: team + 'TR', opponent: other(team) + 'TR' };
    const view = scan(sim, br);
    assert.equal(view.brOpeningActive, false);
    const response = Baseline.builder(view);
    const placement = response.actions?.find(a => a.type === 'place');
    assert.ok(placement, JSON.stringify(response));
    assert.ok(Perception.openingSpots(team).includes(placement.spotId));
  }
});

test('baseline input is immutable and hidden ground-truth changes cannot alter its decision', () => {
  const { sim, br } = world();
  Object.assign(br, { x: 3.4, y: 7.6 });
  hold(sim, br, 'red-E1');
  const view = scan(sim, br), before = structuredClone(view);
  const response = Baseline.builder(freeze(view));
  assert.deepEqual(view, before);
  assert.equal(view.observation.towers.u1, undefined);
  seed(sim, 'u1', 2, 'blue');
  sim.transferPoints.blue = 9999;
  sim.robot('blueBR').brain = { secretTarget: 'u3' };
  assert.deepEqual(sim.view(br), before);
  assert.deepEqual(Baseline.builder(sim.view(br)), response);
  // Even a fresh local scan cannot reveal a distant, different-level tower.
  assert.deepEqual(scan(sim, br).observation, before.observation);
});

test('unknown and stale opponent poses are not consumed as exact current threat positions', () => {
  const { view } = endgame();
  for (const status of ['unknown', 'stale']) {
    const a = structuredClone(view), b = structuredClone(view);
    for (const v of [a, b]) v.observation.visibility.entries.opponentBR = { status, observedAt: status === 'unknown' ? null : 1 };
    a.observation.opponentBR = { x: 4.85, y: 4.85, maxSpeed: 1, placeSeconds: 2 };
    b.observation.opponentBR = { x: 100, y: 100, maxSpeed: 10, placeSeconds: .1 };
    const pa = Baseline.selectPlan(a, { noPickup: true }), pb = Baseline.selectPlan(b, { noPickup: true });
    assert.ok(pa); assert.ok(pb);
    assert.deepEqual(pa.tasks, pb.tasks);
    assert.deepEqual(pa.assessment, pb.assessment);
  }
});

test('held Mustika keeps enshrine priority with both normal cargo slots occupied', () => {
  const { sim, br } = world('red', 'ideal');
  sim.sanctuary.red = 0; sim.time = 100;
  hold(sim, br, 'M'); hold(sim, br, 'red-E1'); hold(sim, br, 'S1');
  const response = Baseline.builder(scan(sim, br));
  assert.deepEqual(response.actions.filter(a => a.type !== 'move'), [{ type: 'enshrine' }]);
  assert.deepEqual(br.cargo, ['M', 'red-E1', 'S1']);
});

test('named baseline is registered and accepted by the Windows simulation view', () => {
  assert.ok(Controllers.listStrategies('BR').some(entry => entry.id === ID));
  const simulator = new Simulation({ redBrPlan: ID, blueBrPlan: ID,
    brObservation: { model: 'level-radius', replan: 'after-work' }, brOpening: { red: true, blue: true },
    trMustikaPickupSignal: 'global-instant' });
  for (let i = 0; i < 20; i++) simulator.step(.05, Controllers);
  assert.equal(simulator.ended, false);
  assert.equal(simulator.view(simulator.robot('redBR')).brPlan, ID);
  assert.equal(simulator.view(simulator.robot('blueBR')).brPlan, ID);
});

test('normal supply advances on both sides: waiting BR leaves room for TR unloading and then builds', () => {
  // Windows-native trips replace the WSL API and trip-policy schema in this integration case.
  const simulator = new Simulation({ supplyMode: 'normal', redBrPlan: ID, blueBrPlan: ID,
    redTrPlan: 'stock-e3', blueTrPlan: 'stock-e3',
    redTrTrips: [['earth', 'earth', 'sky'], ['earth', 'earth', 'sky']], blueTrTrips: [['earth', 'earth', 'sky'], ['earth', 'earth', 'sky']],
    brObservation: { model: 'level-radius', replan: 'after-work', crossLevelRadius: 3 },
    brOpening: { red: true, blue: true }, trMustikaPickupSignal: 'global-instant',
  });
  for (let i = 0; i < 1500; i++) simulator.step(.05, Controllers);
  const state = simulator.snapshot(), events = simulator.events;
  assert.ok(Math.abs(state.time - 75) < 1e-7);
  for (const team of ['red', 'blue']) {
    const unloaded = events.filter(e => e.robot === team + 'TR' && e.kind === 'action' && e.action === 'unload');
    const placed = events.filter(e => e.robot === team + 'BR' && e.kind === 'action' && e.action === 'place');
    assert.ok(unloaded.length > 0, team + ' TR must not wait forever for BR to clear the transfer area');
    assert.ok(placed.length > 0, team + ' BR must receive actual transported blocks and build');
    assert.ok(Perception.openingSpots(team).includes(placed[0].spotId));
    assert.ok(state.scores[team].tower > 0);
    assert.equal(events.some(e => e.robot === team + 'BR' && e.kind === 'policy'), false);
  }
});
