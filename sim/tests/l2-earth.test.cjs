const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, scanBudget } = require('../engine.js');
const F = require('../field.js');
const C = require('../controllers.js');
const M = require('../match-strategies.js');
const E = require('../efficient-strategy.js');

function world(team = 'red') {
  const s = new Simulation({ [`${team}TrPlan`]: 'stock-e3', [`${team}BrPlan`]: 'l2-earth' });
  s.robots.forEach(r => { r.auto = false; });
  const br = s.robot(`${team}BR`), tr = s.robot(`${team}TR`);
  Object.assign(br, F.points[team].home, { z: .6, enteredL1: true, brain: { stage: 'choose' } });
  Object.assign(tr, F.points[team].storage);
  return { s, br, tr };
}
function source(s, type, team = 'red') {
  return s.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === team));
}
function stock(s, team, type) {
  const o = source(s, type, team), slot = s.freeSlot(team, o);
  assert.ok(slot);
  Object.assign(o, { location: 'transfer', transferTeam: team, slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z });
  s.changed(); return o;
}
function seed(s, id, length, team = 'blue') {
  const p = F.spotById[id];
  while (s.tower(id).length < length) {
    const layer = s.tower(id).length, o = source(s, layer < 2 ? 'earth' : 'sky', team);
    Object.assign(o, { location: 'spot', spotId: id, layer, x: p.x, y: p.y,
      z: (p.level === 1 ? .6 : .9) + layer * .35, placedBy: team, color: layer < 2 ? null : team });
  }
  s.changed();
}
function observe(s, br) {
  s.observe(br); br.scanLoaded = true; br.batchRemaining = scanBudget(br); br.batchFlips = [];
  return s.view(br);
}
const places = p => p.tasks.filter(a => a.type === 'place');

test('L2 Earth mode is registered independently and prefers two Earth over Sky before and after 150 seconds', () => {
  assert.ok(C.listStrategies('BR').some(s => s.id === 'l2-earth'));
  assert.deepEqual(C.listPresets().find(p => p.id === 'l2-earth'), { id: 'l2-earth', name: 'L2 Earth最優先', tr: 'stock-e3', br: 'l2-earth' });
  for (const team of ['red', 'blue']) for (const time of [0, 150]) {
    const { s, br } = world(team);
    seed(s, 'u1', 2); seed(s, 'u2', 3);
    for (const type of ['earth', 'earth', 'sky', 'sky']) stock(s, team, type);
    s.time = time;
    const p = M.selectPlan(observe(s, br), 'l2-earth');
    assert.equal(p.picked.length, 2); assert.equal(places(p).length, 2);
    assert.ok(places(p).every(a => F.spotById[a.spotId].level === 2 && s.object(a.objectId).type === 'earth'));
    assert.match(C.phase('l2-earth', time, false), /L2 Earth/);
  }
});

test('filled L2 foundations fall back to private L1 Earth, then shared L1 Earth', () => {
  const { s, br } = world();
  for (const p of F.spots.filter(p => p.level === 2)) seed(s, p.id, 2);
  stock(s, 'red', 'earth'); stock(s, 'red', 'earth'); stock(s, 'red', 'sky'); stock(s, 'red', 'sky');
  let p = M.selectPlan(observe(s, br), 'l2-earth');
  assert.ok(places(p).every(a => F.spotById[a.spotId].team === 'red' && s.object(a.objectId).type === 'earth'));
  seed(s, 'r1', 2, 'red'); seed(s, 'r2', 2, 'red');
  p = M.selectPlan(observe(s, br), 'l2-earth');
  assert.ok(places(p).every(a => ['s1', 's2'].includes(a.spotId) && s.object(a.objectId).type === 'earth'));
});

test('no Earth in the observed supply permits Sky building, then empty-handed flips', () => {
  const { s, br } = world(); seed(s, 'u1', 2); seed(s, 'u2', 2);
  const skies = [stock(s, 'red', 'sky'), stock(s, 'red', 'sky')];
  let p = M.selectPlan(observe(s, br), 'l2-earth');
  assert.equal(places(p).length, 2);
  assert.ok(places(p).every(a => s.object(a.objectId).type === 'sky'));
  skies.forEach(o => { o.location = 'source'; }); seed(s, 'u1', 3); seed(s, 'u2', 3);
  p = M.selectPlan(observe(s, br), 'l2-earth');
  assert.equal(p.tasks.length, 2); assert.ok(p.tasks.every(a => a.type === 'flip'));
});

test('a single useful Earth is not stranded when no useful pair can be formed', () => {
  const { s, br } = world(); const earth = stock(s, 'red', 'earth');
  const p = M.selectPlan(observe(s, br), 'l2-earth');
  assert.deepEqual(p.picked, [earth.id]); assert.equal(p.tasks.length, 1);
  assert.equal(F.spotById[p.tasks[0].spotId].level, 2);
});

test('late stock replenishment keeps Earth first only for the new mode', () => {
  const { s, tr } = world(); stock(s, 'red', 'earth'); s.time = 155;
  s.observe(tr);
  assert.deepEqual(E.stockDemand(s.view(tr)), { earth: 2, sky: 1 });
  s.config.redBrPlan = 'earth-late';
  assert.deepEqual(E.stockDemand(s.view(tr)), { earth: 1, sky: 2 });
});

test('planning uses the last observation and cannot schedule work after the buzzer', () => {
  const { s, br } = world(); stock(s, 'red', 'earth'); stock(s, 'red', 'earth');
  const v = observe(s, br), before = M.selectPlan(v, 'l2-earth');
  for (const p of F.spots.filter(p => p.level === 2)) seed(s, p.id, 2);
  assert.deepEqual(M.selectPlan(s.view(br), 'l2-earth'), before);
  s.time = 179.5;
  assert.equal(M.selectPlan(s.view(br), 'l2-earth'), null);
});

test('real 180-second solo matches start with two L2 Earth and keep placing Earth after 150 seconds', () => {
  for (const team of ['red', 'blue']) {
    const s = new Simulation({ [`${team}TrPlan`]: 'stock-e3', [`${team}BrPlan`]: 'l2-earth' });
    for (const r of s.robots) if (r.team !== team) r.auto = false;
    while (!s.ended) s.step(.05, C);
    const placed = s.events.filter(e => e.robot === `${team}BR` && e.kind === 'action' && e.action === 'place');
    assert.ok(placed.slice(0, 2).length === 2 && placed.slice(0, 2).every(e => e.objectType === 'earth' && F.spotById[e.spotId].level === 2));
    assert.ok(placed.filter(e => e.objectType === 'earth' && F.spotById[e.spotId].level === 2).length >= 5);
    assert.ok(placed.some(e => e.objectType === 'earth' && e.time >= 150));
    assert.equal(s.time, 180); assert.ok(s.scores()[team].tower >= 240);
  }
});
