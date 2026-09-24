const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation } = require('../engine.js');
const F = require('../field.js');
const controllers = require('../controllers.js');

const block = (type, id) => ({ type, id, touchedBy: null });
const tower = (earths, color) => [...Array.from({ length: earths }, (_, i) => block('earth', `foundation-${i}`)), ...(color ? [{ ...block('sky', 'cap'), color }] : [])];
function view({ team = 'red', cargo = [], towers = {}, stock = [], stage = 'loaded' } = {}) {
  return { id: `${team}BR`, role: 'BR', team, brPlan: 'split-seed', brain: { stage }, cargo, observation: { at: 10, towers, stock, sanctuary: false }, ...F.points[team].home };
}
function operations(response) { return (response.actions || []).filter(a => a.type !== 'move'); }
function world() {
  const sim = new Simulation({ redTrPlan: 'e3-e1s2', redBrPlan: 'split-seed' });
  for (const robot of sim.robots) robot.auto = false;
  const br = sim.robot('redBR');
  Object.assign(br, F.points.red.home, { z: .6, enteredL1: true, brain: { stage: 'loaded' } });
  return sim;
}
function takeSource(sim, type, team = 'red') { return sim.objects.find(o => o.location === 'source' && o.type === type && (type !== 'earth' || o.team === team)); }
function seed(sim, id, earthTeams, color) {
  const p = F.spotById[id];
  const items = earthTeams.map(team => takeSourceAndPlace('earth', team));
  if (color) items.push(takeSourceAndPlace('sky', color));
  function takeSourceAndPlace(type, team) {
    const o = takeSource(sim, type, team), layer = sim.tower(id).length;
    Object.assign(o, { location: 'spot', spotId: id, placedBy: team, color: type === 'sky' ? team : null, x: p.x, y: p.y, layer, z: .6 + layer * .35, touchedBy: null });
    return o;
  }
  sim.changed(); return items;
}
function hold(sim, types) {
  const r = sim.robot('redBR');
  for (const type of types) {
    const o = takeSource(sim, type);
    Object.assign(o, { location: 'cargo', holder: r.id, touchedBy: r.id }); r.cargo.push(o.id);
  }
  sim.changed(); return r.cargo.map(id => sim.object(id));
}
function scan(sim) {
  const r = sim.robot('redBR'); sim.observe(r); r.scanLoaded = true; r.batchRemaining = Math.max(1, r.cargo.length);
}
function execute(sim, response) {
  const r = sim.robot('redBR'); r.brain = response.brain; sim.enqueue(r.id, response.actions);
  for (let i = 0; i < 2000 && (r.job || r.queue.length); i++) sim.step(.05);
  assert.equal(r.job, null); assert.equal(r.queue.length, 0);
}

test('split opening places one Earth in shared and one in private, from a single scan', () => {
  for (const team of ['red', 'blue']) {
    const v = view({ team, cargo: [block('earth', 'A'), block('earth', 'B')] });
    const response = controllers.next(v), ops = operations(response);
    assert.deepEqual(ops.map(o => [o.type, o.spotId]), [['place', team === 'red' ? 's2' : 's1'], ['place', team === 'red' ? 'r2' : 'b2']]);
    assert.equal(response.brain.stage, 'return');
    assert.deepEqual(v.observation.towers, {});
  }
});

test('opening waits for two removable Earth blocks and scans again after reception', () => {
  const bottom = { ...block('earth', 'E1'), slot: 'a', layer: 0 }, top = { ...block('earth', 'E2'), slot: 'a', layer: 1 };
  const v = view({ stage: 'choose', stock: [bottom] });
  assert.ok(controllers.next(v).wait > 0);
  v.observation.stock.push(top);
  const ops = operations(controllers.next(v));
  assert.deepEqual(ops.map(o => o.type), ['receive', 'receive', 'scan']);
  assert.deepEqual(ops.slice(0, 2).map(o => o.objectId), ['E2', 'E1']);
});

test('third Earth raises the private foundation, leaving shared at one Earth', () => {
  const ops = operations(controllers.next(view({ cargo: [block('earth', 'E')], towers: { s2: tower(1), r2: tower(1) } })));
  assert.deepEqual(ops, [{ type: 'place', objectId: 'E', spotId: 'r2' }]);
});

test('no cooperation: E1+S1 completes shared in Earth/Sky order even when Sky was picked first', () => {
  const v = view({ cargo: [block('sky', 'S'), block('earth', 'E')], towers: { s2: tower(1), r2: tower(2) } });
  assert.deepEqual(operations(controllers.next(v)), [{ type: 'place', objectId: 'E', spotId: 's2' }, { type: 'place', objectId: 'S', spotId: 's2' }]);
});

test('reception enumerates top-down S/E batches without needing live TR information', () => {
  const v = view({ stage: 'choose', towers: { s2: tower(1), r2: tower(2) }, stock: [
    { ...block('earth', 'E'), slot: 'a', layer: 0 }, { ...block('sky', 'S'), slot: 'a', layer: 1 },
  ] });
  assert.deepEqual(operations(controllers.next(v)).map(o => o.objectId || o.type), ['S', 'E', 'scan']);
  v.observation.stock[1].touchedBy = 'redTR';
  assert.ok(controllers.next(v).wait > 0);
});

test('Earth-only shared completion is deferred when the private foundation is ready', () => {
  const v = view({ stage: 'choose', towers: { s2: tower(1), r2: tower(2) }, stock: [{ ...block('earth', 'E'), slot: 'a', layer: 0 }] });
  assert.ok(controllers.next(v).wait > 0);
});

test('two Earths provided on shared require only one Sky', () => {
  const v = view({ stage: 'choose', towers: { s2: tower(2), r2: tower(2, 'red') }, stock: [{ ...block('sky', 'S'), slot: 'a', layer: 0 }] });
  assert.deepEqual(operations(controllers.next(v)).map(o => o.objectId || o.type), ['S', 'scan']);
  v.brain.stage = 'loaded'; v.cargo = [v.observation.stock[0]];
  assert.deepEqual(operations(controllers.next(v)), [{ type: 'place', objectId: 'S', spotId: 's2' }]);
});

test('opponent completion is flipped before collecting available building blocks', () => {
  const v = view({ stage: 'choose', towers: { s2: tower(2, 'blue'), r2: tower(1) }, stock: [{ ...block('earth', 'E'), slot: 'a', layer: 0 }] });
  assert.deepEqual(operations(controllers.next(v)), [{ type: 'flip', spotId: 's2' }]);
  v.observation.towers.s2[2].color = 'red';
  assert.equal(operations(controllers.next(v))[0].type, 'receive');
  v.observation.towers.s2[2].color = null;
  assert.ok(operations(controllers.next(v)).every(a => a.type !== 'flip'));
  v.observation.towers.s2[2].color = 'blue'; v.observation.towers.s2[2].touchedBy = 'blueBR';
  assert.ok(operations(controllers.next(v)).every(a => a.type !== 'flip'));
});

test('with two held blocks, place Sky on private before flipping to free a hand', () => {
  const v = view({ cargo: [block('earth', 'E'), block('sky', 'S')], towers: { s2: tower(2, 'blue'), r2: tower(2) } });
  assert.deepEqual(operations(controllers.next(v)), [{ type: 'place', objectId: 'S', spotId: 'r2' }, { type: 'flip', spotId: 's2' }]);
});

test('a leftover Sky can be paired with a newly received Earth after a fresh scan', () => {
  const v = view({ cargo: [block('sky', 'S')], towers: { s2: tower(1), r2: tower(1) }, stock: [{ ...block('earth', 'E'), slot: 'a', layer: 0 }] });
  assert.deepEqual(operations(controllers.next(v)).map(a => a.objectId || a.type), ['E', 'scan']);
});

test('existing observations stay authoritative until returning home to scan', () => {
  const sim = world(), r = sim.robot('redBR');
  seed(sim, 's2', ['red']); seed(sim, 'r2', ['red', 'red']); hold(sim, ['earth', 'sky']); scan(sim);
  const before = sim.view(r), response = controllers.next(before);
  seed(sim, 's2', ['blue'], 'blue');
  assert.deepEqual(controllers.next(sim.view(r)), response);
  execute(sim, response);
  assert.equal(r.failure.kind, 'unscored');
  const recover = controllers.next(sim.view(r));
  assert.deepEqual(operations(recover), [{ type: 'scan' }]);
  execute(sim, recover); assert.equal(r.failure, null);
  assert.deepEqual(operations(controllers.next(sim.view(r))).map(o => o.type), ['place', 'flip']);
});

test('physical execution completes shared without cooperation and preserves IDs', () => {
  const sim = world(), r = sim.robot('redBR');
  seed(sim, 's2', ['red']); seed(sim, 'r2', ['red', 'red'], 'red');
  hold(sim, ['sky', 'earth']); scan(sim);
  execute(sim, controllers.next(sim.view(r)));
  assert.equal(r.failure, null);
  assert.deepEqual(sim.tower('s2').map(o => o.type), ['earth', 'earth', 'sky']);
  assert.equal(sim.tower('s2')[2].color, 'red'); assert.notEqual(sim.sanctuary.red, null);
  const placements = sim.events.filter(e => e.robot === r.id && e.action === 'place');
  assert.equal(placements[0].observationAt, placements[1].observationAt);
  assert.equal(r.cargo.length, 0); assert.equal(new Set(sim.objects.map(o => o.id)).size, 53);
});

test('physical flip changes only Sky ownership, latches sanctuary and does not end play', () => {
  const sim = world(), r = sim.robot('redBR');
  const shared = seed(sim, 's2', ['red', 'blue'], 'blue'); seed(sim, 'r2', ['red', 'red'], 'red');
  const owners = shared.slice(0, 2).map(o => o.placedBy); r.brain.stage = 'choose'; scan(sim);
  execute(sim, controllers.next(sim.view(r)));
  assert.equal(r.failure, null); assert.equal(sim.tower('s2')[2].color, 'red');
  assert.deepEqual(sim.tower('s2').slice(0, 2).map(o => o.placedBy), owners);
  assert.notEqual(sim.sanctuary.red, null); assert.equal(sim.ended, false);
  const next = controllers.next(sim.view(r)); assert.deepEqual(operations(next), [{ type: 'scan' }]);
});

test('Mustika retains priority after eligibility; completed towers do not stop further building', () => {
  const v = view({ stage: 'choose', towers: { s2: tower(2, 'red'), r2: tower(2, 'red') }, stock: [
    { ...block('earth', 'E1'), slot: 'a', layer: 0 }, { ...block('earth', 'E2'), slot: 'a', layer: 1 },
  ] });
  assert.equal(operations(controllers.next(v)).filter(o => o.type === 'receive').length, 2);
  v.observation.sanctuary = true; v.observation.stock.push({ ...block('mustika', 'M'), slot: 'b', layer: 0 });
  assert.deepEqual(operations(controllers.next(v)).map(o => o.objectId || o.type), ['M', 'scan']);
});

test('four speeds run 180 seconds with actual shared/private opening and all capacity limits', () => {
  for (const speed of [1, .75, .5, .25]) {
    const sim = new Simulation({ redTrPlan: 'e3-e1s2', redBrPlan: 'split-seed', redSpeed: speed });
    while (!sim.ended) {
      sim.step(.05, controllers);
      for (const r of sim.robots) { assert.ok(r.cargo.length <= (r.role === 'TR' ? 3 : 2)); assert.ok(sim.footprintAllowed(r, r)); }
    }
    const opening = sim.events.filter(e => e.robot === 'redBR' && e.action === 'place' && e.kind === 'action').slice(0, 2);
    assert.deepEqual(opening.map(e => e.spotId), ['s2', 'r2']);
    assert.ok(opening.every(e => e.objectType === 'earth')); assert.equal(opening[0].observationAt, opening[1].observationAt);
    const held = sim.robots.flatMap(r => r.cargo); assert.equal(new Set(held).size, held.length);
    for (const o of sim.objects) assert.equal(o.location === 'cargo', held.includes(o.id));
    assert.equal(sim.time, 180); assert.equal(sim.objects.length, 53);
  }
});
