'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation } = require('../engine.js');
const Field = require('../field.js');
const Perception = require('../br-observation.js');
const Baseline = require('../ideal-baseline.js');
const Controllers = require('../controllers.js');

const ID = 'tactical-baseline-v2';
const other = team => team === 'red' ? 'blue' : 'red';
function world(team = 'red', model = 'level-radius') {
  const sim = new Simulation({ [`${team}BrPlan`]: ID,
    brObservation: { model, replan: 'after-work', crossLevelRadius: 3 },
    trMustikaPickupSignal: 'global-instant' });
  sim.robots.forEach(r => { r.auto = false; });
  const br = sim.robot(team + 'BR');
  Object.assign(br, Field.points[team].transferBR, { z: .6, enteredL1: true, brain: { stage: 'choose' } });
  return { sim, br, team };
}
function hold(sim, br, id) {
  Object.assign(sim.object(id), { location: 'cargo', holder: br.id, touchedBy: br.id });
  br.cargo.push(id); sim.changed();
}
function stock(sim, team, id) {
  const object = sim.object(id), slot = sim.freeSlot(team, object);
  assert.ok(slot);
  Object.assign(object, { location: 'transfer', transferTeam: team, holder: null, touchedBy: null,
    slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z });
  sim.changed();
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
function scan(sim, br) {
  sim.complete(br, { type: 'scan', local: true });
  assert.equal(br.failure, null);
  return sim.view(br);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('after own L1 completion, qualification construction on shared L1 outranks empty L2 Earth farming', () => {
  for (const team of ['red', 'blue']) {
    const { sim, br } = world(team);
    seed(sim, team === 'red' ? 'r2' : 'b2', 3, team);
    hold(sim, br, team + '-E3'); hold(sim, br, team + '-E4');
    sim.time = 35;
    const view = scan(sim, br), plan = Baseline.selectPlan(view, { noPickup: true });
    assert.equal(view.observation.sanctuary, false);
    assert.ok(plan); assert.equal(plan.assessment.race, true);
    assert.equal(plan.assessment.focus, 'shared-L1-bottom');
    assert.equal(plan.tasks[0].type, 'place'); assert.equal(plan.tasks[0].spotId, 's2');
  }
});

test('an observed shared flip that immediately qualifies takes precedence over starting another tower', () => {
  for (const team of ['red', 'blue']) {
    const { sim, br } = world(team);
    seed(sim, team === 'red' ? 'r2' : 'b2', 3, team);
    seed(sim, 's2', 3, other(team));
    hold(sim, br, team + '-E3'); sim.time = 45;
    const view = scan(sim, br), response = Baseline.builder(view);
    assert.equal(view.observation.sanctuary, false);
    assert.deepEqual(response.actions.filter(a => a.type !== 'move'), [{ type: 'flip', spotId: 's2' }]);
    br.brain = response.brain; sim.enqueue(br.id, response.actions);
    for (let n = 0; n < 400 && (br.job || br.queue.length); n++) sim.step(.05);
    assert.equal(br.failure, null); assert.equal(sim.tower('s2').at(-1).color, team);
    assert.notEqual(sim.sanctuary[team], null);
    assert.equal(scan(sim, br).observation.sanctuary, true);
  }
});

test('opponent acquisition history ends race priority without claiming current Mustika possession', () => {
  const { sim, br } = world(); seed(sim, 'r2', 3, 'red');
  hold(sim, br, 'red-E3'); hold(sim, br, 'red-E4'); sim.time = 35;
  const view = scan(sim, br), prior = Baseline.selectPlan(view, { noPickup: true });
  const signaled = { ...view, opponentMustikaPickup: { acquiredAt: 34, receivedAt: 34, sender: 'redTR', opponent: 'blueTR' } };
  const after = Baseline.selectPlan(signaled, { noPickup: true });
  assert.equal(prior.assessment.race, true); assert.equal(after.assessment.race, false);
  assert.equal(after.assessment.focus, 'score');
  assert.equal(prior.tasks[0].spotId, 's2');
  assert.notEqual(after.tasks[0].spotId, 's2');
  // The notification is sufficient; it does not need hidden possession or source-state reads.
  assert.deepEqual(signaled.observation, view.observation);
});

test('race near the receiving point takes a second useful block, but immediate qualification never waits for that pair', () => {
  for (const immediate of [false, true]) {
    const { sim, br } = world();
    seed(sim, 'r2', immediate ? 3 : 2, 'red');
    if (immediate) seed(sim, 's2', 2, 'blue');
    const sky = sim.objects.find(o => o.type === 'sky' && o.location === 'source');
    hold(sim, br, sky.id); stock(sim, 'red', 'red-E3'); sim.time = 30;
    const view = scan(sim, br), plan = Baseline.selectPlan(view);
    assert.ok(plan); assert.equal(plan.assessment.race, true);
    if (immediate) {
      assert.equal(plan.state.sanctuary, true);
      assert.deepEqual(plan.picked, []);
      assert.deepEqual(plan.tasks, [{ type: 'place', objectId: sky.id, spotId: 's2' }]);
    } else {
      assert.deepEqual(plan.picked, ['red-E3']);
      assert.equal(plan.tasks.filter(a => a.type === 'place').length, 2);
      assert.ok(plan.tasks.some(a => a.objectId === sky.id && a.spotId === 'r2'));
      assert.equal(plan.state.cargo.length, 0);
    }
  }
});

test('once away from supply, the remaining Earth is placed before returning for Sky to complete that tower', () => {
  for (const team of ['red', 'blue']) {
    const { sim, br } = world(team), own = team === 'red' ? 'r2' : 'b2';
    seed(sim, own, 1, team); hold(sim, br, team + '-E2'); stock(sim, team, 'S1');
    Object.assign(br, Field.spotApproaches(Field.spotById[own], team)[0]); sim.time = 20;
    const view = scan(sim, br);
    assert.equal(view.observation.visibility.entries.stock.status, 'current');
    const unrestricted = Baseline.selectPlan(view);
    assert.ok(unrestricted.picked.includes('S1'), 'fixture must otherwise prefer a Sky resupply trip');
    const response = Baseline.builder(view);
    assert.deepEqual(response.actions.filter(a => a.type !== 'move'), [{ type: 'place', objectId: team + '-E2', spotId: own }]);
    assert.deepEqual(response.decision.receive, []);
  }
});

test('holding Earth does not force irrelevant local work when qualification needs a supplied Sky', () => {
  const { sim, br } = world();
  seed(sim, 'r2', 3, 'red'); seed(sim, 's2', 2, 'blue'); hold(sim, br, 'red-E3');
  const sky = sim.objects.find(o => o.type === 'sky' && o.location === 'source');
  stock(sim, 'red', sky.id);
  Object.assign(br, Field.spotApproaches(Field.spotById.s2, 'red')[0]); sim.time = 45;
  const view = scan(sim, br);
  assert.equal(view.observation.sanctuary, false);
  assert.equal(Baseline.selectPlan(view, { noPickup: true }), null);
  const response = Baseline.builder(view);
  assert.deepEqual(response.actions.filter(a => a.type !== 'move'), [{ type: 'receive', objectId: sky.id }]);
  assert.ok(response.decision.tasks.some(a => a.type === 'place' && a.spotId === 's2' && a.objectId === sky.id));
});

test('after 150 seconds a useful local flip precedes even a currently observed supply trip with larger projected gains', () => {
  const { sim, br } = world();
  seed(sim, 'r2', 1, 'red'); seed(sim, 's2', 3, 'blue');
  stock(sim, 'red', 'red-E2'); stock(sim, 'red', 'red-E3');
  Object.assign(br, Field.spotApproaches(Field.spotById.s2, 'red')[0]); sim.time = 155;
  const view = scan(sim, br);
  assert.equal(view.observation.visibility.entries.stock.status, 'current');
  const unrestricted = Baseline.selectPlan(view);
  assert.ok(unrestricted.picked.length > 0, 'fixture must offer a tempting supply-dependent plan');
  const response = Baseline.builder(view);
  assert.deepEqual(response.actions.filter(a => a.type !== 'move'), [{ type: 'flip', spotId: 's2' }]);
  assert.deepEqual(response.decision.receive, []);
});

test('the v2 planner preserves immutable input and cannot see unobserved changes', () => {
  const { sim, br } = world(); Object.assign(br, { x: 3.4, y: 7.6 });
  hold(sim, br, 'red-E1'); const view = scan(sim, br), before = structuredClone(view);
  const response = Baseline.builder(freeze(view)); assert.deepEqual(view, before);
  assert.equal(view.observation.towers.u1, undefined);
  seed(sim, 'u1', 2, 'blue'); sim.transferPoints.blue = 9999;
  sim.robot('blueBR').brain = { secretTarget: 'u3' };
  assert.deepEqual(sim.view(br), before);
  assert.deepEqual(Baseline.builder(sim.view(br)), response);
  assert.deepEqual(scan(sim, br).observation, before.observation);
});

test('work completion still requires a local scan before constructing or flipping', () => {
  const { sim, br } = world(); hold(sim, br, 'red-E1'); const view = scan(sim, br);
  for (const state of [{ needsWorkScan: true, scanLoaded: false }, { failure: { action: 'place' } }, { brain: { stage: 'return' } }]) {
    assert.deepEqual(Baseline.builder({ ...view, ...state }).actions, [{ type: 'scan', local: true }]);
  }
});

test('v2 enshrines held Mustika while retaining both normal blocks', () => {
  const { sim, br } = world('red', 'ideal'); sim.sanctuary.red = 0; sim.time = 100;
  hold(sim, br, 'M'); hold(sim, br, 'red-E1'); hold(sim, br, 'S1');
  const response = Baseline.builder(scan(sim, br));
  assert.deepEqual(response.actions.filter(a => a.type !== 'move'), [{ type: 'enshrine' }]);
  assert.deepEqual(br.cargo, ['M', 'red-E1', 'S1']);
});

test('first placements remain in mirrored 1/2/7 even after early acquisition notification', () => {
  for (const team of ['red', 'blue']) {
    const { sim, br } = world(team); hold(sim, br, team + '-E1'); sim.time = 25;
    Object.assign(br, Field.spotApproaches(Field.spotById[team === 'red' ? 'u1' : 'u2'], team)[0], { z: .9 });
    br.opponentMustikaPickup = { acquiredAt: 20, receivedAt: 20, sender: team + 'TR', opponent: other(team) + 'TR' };
    const view = scan(sim, br); assert.equal(view.brOpeningActive, false);
    const placement = Baseline.builder(view).actions?.find(a => a.type === 'place');
    assert.ok(placement); assert.ok(Perception.openingSpots(team).includes(placement.spotId));
  }
});

test('normal supply compatibility: registered v2 leaves receiving space and both teams build within 75 seconds', () => {
  assert.ok(Controllers.listStrategies('BR').some(entry => entry.id === ID));
  // Windows-native trips replace the WSL API and trip-policy schema in this integration case.
  const sim = new Simulation({ supplyMode: 'normal', redBrPlan: ID, blueBrPlan: ID,
    redTrPlan: 'stock-e3', blueTrPlan: 'stock-e3',
    redTrTrips: [['earth', 'earth', 'sky'], ['earth', 'earth', 'sky']], blueTrTrips: [['earth', 'earth', 'sky'], ['earth', 'earth', 'sky']],
    brObservation: { model: 'level-radius', replan: 'after-work', crossLevelRadius: 3 },
    brOpening: { red: true, blue: true }, trMustikaPickupSignal: 'global-instant' });
  for (let i = 0; i < 1500; i++) sim.step(.05, Controllers);
  const state = sim.snapshot(), events = sim.events;
  assert.ok(Math.abs(state.time - 75) < 1e-7);
  for (const team of ['red', 'blue']) {
    assert.ok(events.some(e => e.robot === team + 'TR' && e.action === 'unload' && e.kind === 'action'));
    const first = events.find(e => e.robot === team + 'BR' && e.action === 'place' && e.kind === 'action');
    assert.ok(first); assert.ok(Perception.openingSpots(team).includes(first.spotId));
    assert.ok(state.scores[team].tower > 0);
    assert.equal(events.some(e => e.robot === team + 'BR' && e.kind === 'policy'), false);
  }
});
