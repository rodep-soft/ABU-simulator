const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation } = require('../engine.js');
const F = require('../field.js');
const controllers = require('../controllers.js');

function world(config = {}) {
  const sim = new Simulation({ redTrPlan: 'e3-e1s2', blueTrPlan: 'balanced', redBrPlan: 'score-search', blueBrPlan: 'score-search', ...config });
  for (const robot of sim.robots) robot.auto = false;
  return sim;
}
function carry(sim, robot, ids) {
  robot.cargo = ids;
  for (const id of ids) Object.assign(sim.object(id), { location: 'cargo', holder: robot.id, touchedBy: robot.id });
  sim.changed();
}
function decide(sim, robot) { sim.observe(robot); return controllers.next(sim.view(robot)); }
function unload(sim, robot) {
  sim.startJob(robot, { type: 'unload' });
  assert.ok(robot.job, JSON.stringify(robot.failure));
  while (robot.job) sim.step(.05);
  assert.equal(robot.failure, null);
}
function types(delivery) { return delivery.items.map(o => o.type); }

test('strategy catalog separates roles and returns isolated menu metadata', () => {
  const tr = controllers.listStrategies('TR'), br = controllers.listStrategies('BR');
  assert.deepEqual(tr.map(s => s.id), ['balanced', 'e3-e1s2', 'adaptive', 'adaptive-e3-e1s2', 'stock-e3']);
  assert.deepEqual(br.map(s => s.id), ['score-search', 'basic', 'split-seed', 'efficient', 'mustika-fast', 'earth-late', 'second-layer', 'score-adaptive', 'endgame', 'l2-earth']);
  for (const entry of [...tr, ...br]) {
    assert.ok(entry.name); assert.ok(entry.shortName); assert.equal(entry.run, undefined);
  }
  for (const entry of tr) for (const plan of [...entry.opening, entry.repeat]) {
    assert.ok(Number.isInteger(plan.earth) && plan.earth >= 0);
    assert.ok(Number.isInteger(plan.sky) && plan.sky >= 0);
    assert.ok(plan.earth + plan.sky >= 1 && plan.earth + plan.sky <= 3);
  }
  tr[1].opening[0].earth = 0;
  assert.equal(controllers.transportPlan('e3-e1s2', 0).earth, 3);
  assert.equal(controllers.transportPlan('unknown', 0).label, 'E2+S1');
});

test('strategy details reflect the selected manifest and team placement order', () => {
  assert.deepEqual(controllers.strategyDetails('TR', 'e3-e1s2', 'red').slice(0, 2), [['1便目', 'Earth 3個'], ['2便目', 'Earth 1個 + Sky 2個']]);
  for (const team of ['red', 'blue']) {
    const expected = controllers.spotOrder(team).slice(0, 2).map(id => F.spotById[id].label).join(' → ');
    assert.equal(controllers.strategyDetails('BR', 'basic', team)[0][1], expected);
  }
});

test('BR selection is exported and does not change its perception or initial action', () => {
  const sim = world(), r = sim.robot('blueBR');
  const view = sim.view(r); assert.equal(view.brPlan, 'score-search');
  const selected = controllers.next(view);
  delete view.brPlan;
  assert.deepEqual(controllers.next(view), selected);
  assert.equal(selected.actions.at(-1).type, 'scan');
  assert.equal(sim.export().config.blueBrPlan, 'score-search');
});

test('opening manifest is E3 then E1+S2, with the existing fallback afterwards', () => {
  assert.deepEqual(controllers.transportPlan('e3-e1s2', 0), { earth: 3, sky: 0, label: 'E3', opening: true });
  assert.deepEqual(controllers.transportPlan('e3-e1s2', 1), { earth: 1, sky: 2, label: 'E1+S2', opening: true });
  assert.equal(controllers.transportPlan('e3-e1s2', 2).label, 'E2+S1');
  assert.equal(controllers.transportPlan('balanced', 0).label, 'E2+S1');
});

test('team settings are independent and source choices follow the manifest', () => {
  const sim = world(), red = sim.robot('redTR'), blue = sim.robot('blueTR');
  for (const r of [red, blue]) carry(sim, r, [`${r.team}-E12`, `${r.team}-E11`]);
  assert.equal(sim.object(decide(sim, red).actions.at(-1).objectId).type, 'earth');
  assert.equal(sim.object(decide(sim, blue).actions.at(-1).objectId).type, 'sky');
  red.transport.completed.push({ number: 1, items: [], time: 0 });
  carry(sim, red, ['red-E12']);
  assert.equal(sim.object(decide(sim, red).actions.at(-1).objectId).type, 'sky');
});

test('a failed pickup retries collection instead of shipping a partial opening', () => {
  const sim = world(), r = sim.robot('redTR');
  carry(sim, r, ['red-E12']); r.brain.stage = 'collect'; r.failure = { reason: 'busy' };
  const retry = decide(sim, r);
  assert.equal(retry.brain.stage, 'collect'); assert.ok(retry.wait > 0);
  r.brain = retry.brain; r.failure = null;
  assert.equal(decide(sim, r).actions.at(-1).type, 'pickup');
});

test('missing required supply does not silently replace or shorten the opening', () => {
  const sim = world(), r = sim.robot('redTR');
  carry(sim, r, ['red-E12']); sim.observe(r);
  r.observation.source = r.observation.source.filter(o => o.type !== 'earth');
  const response = controllers.next(sim.view(r));
  assert.equal(response.actions, undefined); assert.ok(response.wait > 0);
});

test('Mustika does not preempt the two prescribed trips; its later priority is preserved', () => {
  const sim = world(), r = sim.robot('redTR'); sim.sanctuary.red = 0;
  assert.equal(sim.object(decide(sim, r).actions.at(-1).objectId).type, 'earth');
  r.transport.completed = [{}, {}];
  assert.equal(decide(sim, r).actions.at(-1).objectId, 'M');
});

test('unload history advances only after the entire cargo is delivered, survives restart and exports', () => {
  const sim = world(), r = sim.robot('redTR');
  Object.assign(r, F.points.red.transferTR, { z: .6 });
  carry(sim, r, ['red-E12', 'red-E11', 'red-E14']);
  unload(sim, r); assert.equal(r.transport.completed.length, 0);
  assert.deepEqual(r.transport.pending, [{ id: 'red-E12', type: 'earth' }]);
  r.brain = { stage: 'start' };
  assert.equal(decide(sim, r).actions.at(-1).type, 'unload');
  unload(sim, r);
  assert.ok(sim.freeSlot('red', sim.object('red-E14')));
  unload(sim, r);
  assert.deepEqual(types(r.transport.completed[0]), ['earth', 'earth', 'earth']);
  assert.equal(r.transport.pending.length, 0);
  r.brain = { stage: 'start' }; carry(sim, r, ['red-E13']);
  assert.equal(sim.object(decide(sim, r).actions.at(-1).objectId).type, 'sky');
  const exported = sim.export();
  assert.equal(exported.config.redTrPlan, 'e3-e1s2');
  assert.equal(exported.events.filter(e => e.action === 'delivery-complete').length, 1);
  assert.equal(exported.events.filter(e => e.action === 'unload').at(-1).objectType, 'earth');
  const view = sim.view(r); view.transport.completed[0].items.length = 0;
  assert.equal(r.transport.completed[0].items.length, 3);
});

test('a full handover area cannot increment the trip or discard retained cargo', () => {
  const sim = world(), r = sim.robot('redTR');
  Object.assign(r, F.points.red.transferTR, { z: .6 });
  for (const slot of F.slots('red')) for (let layer = 0; layer < slot.maxLayers; layer++) {
    const o = sim.objects.find(o => o.type === slot.type && (!o.team || o.team === 'red') && o.location === 'source');
    Object.assign(o, { location: 'transfer', transferTeam: 'red', slot: slot.id, x: slot.x, y: slot.y, z: .6 + layer * .35, layer });
  }
  carry(sim, r, ['red-E12', 'red-E11', 'red-E14']); r.brain.stage = 'deliver';
  sim.startJob(r, { type: 'unload' });
  assert.match(r.failure.reason, /空き/);
  assert.equal(r.transport.completed.length, 0); assert.equal(r.transport.pending.length, 0); assert.equal(r.cargo.length, 3);
  assert.equal(decide(sim, r).brain.stage, 'deliver');
});

test('both TRs actually deliver E3 and E1+S2 at all four relative speeds', () => {
  for (const speed of [1, .75, .5, .25]) {
    const sim = new Simulation({ redTrPlan: 'e3-e1s2', blueTrPlan: 'e3-e1s2', redBrPlan: 'score-search', blueBrPlan: 'score-search', redSpeed: speed });
    const trs = sim.robots.filter(r => r.role === 'TR');
    while (!sim.ended && trs.some(r => r.transport.completed.length < 2)) {
      sim.step(.05, controllers);
      for (const r of sim.robots) assert.ok(r.cargo.length <= (r.role === 'TR' ? 3 : 2));
    }
    for (const tr of trs) {
      assert.ok(tr.transport.completed.length >= 2, `${tr.id} speed ${speed}: no second delivery`);
      assert.deepEqual(types(tr.transport.completed[0]), ['earth', 'earth', 'earth']);
      assert.deepEqual(types(tr.transport.completed[1]), ['earth', 'sky', 'sky']);
      assert.ok(tr.transport.completed[1].time < 180);
    }
    assert.equal(new Set(sim.objects.map(o => o.id)).size, 53);
  }
});

test('one robot can clear the transfer entry while the approaching robot yields', () => {
  for (const reverse of [false, true]) {
    const sim = world({ redSpeed: .25 }), tr = sim.robot('redTR'), br = sim.robot('redBR');
    Object.assign(tr, { x: 1.7632949731137806, y: 6.456359784910246, z: .6 });
    Object.assign(br, { x: 2.2450039400656734, y: 6.971899486910366, z: .6 });
    for (const [r, target] of [[tr, F.points.red.transferTR], [br, { x: 2.45, y: 7.05 }]]) {
      r.job = { type: 'move', route: [target], destination: target }; r.velocity = .2;
    }
    if (reverse) sim.robots.reverse();
    const before = br.x;
    sim.step(.05);
    assert.ok(br.x > before, 'BR must be able to leave the entry');
    const { box, overlap } = require('../engine.js');
    assert.equal(overlap(box(tr, sim.config.bodySize + .015), box(br, sim.config.bodySize + .015)), false);
  }
});
