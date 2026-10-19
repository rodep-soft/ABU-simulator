const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../field.js');
const S = require('../engine.js');
const C = require('../controllers.js');
const Policy = require('../private-first.js');
const Baseline = require('../ideal-baseline.js');
function world(id = 'private-first-now', team = 'red', extra = {}) {
  const sim = new S.Simulation({ brObservationMode: 'stopped', supplyMode: 'ideal', [team + 'BrPlan']: id, ...extra });
  sim.robots.forEach(r => r.auto = false);
  const br = sim.robot(team + 'BR');
  Object.assign(br, F.points[team].brStandby, { enteredL1: true, z: .6, brain: { stage: 'choose' } });
  sim.time = 35; sim.changed();
  return { sim, br, team };
}
function seed(sim, id, length, team = 'red') {
  const spot = F.spotById[id];
  while (sim.tower(id).length < length) {
    const layer = sim.tower(id).length;
    const o = sim.objects.find(o => o.location === 'source' && o.type === (layer < 2 ? 'earth' : 'sky') && (!o.team || o.team === team));
    Object.assign(o, { location: 'spot', spotId: id, layer, x: spot.x, y: spot.y, z: .6 + layer * .35,
      placedBy: team, color: layer === 2 ? team : null, touchedBy: null });
  }
  sim.changed();
}
function hold(sim, br, types) {
  for (const type of types) {
    const o = sim.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === br.team));
    Object.assign(o, { location: 'cargo', holder: br.id, touchedBy: br.id }); br.cargo.push(o.id);
  }
  sim.changed();
}
function scan(sim, br) { sim.complete(br, { type: 'scan' }); assert.equal(br.failure, null); return sim.view(br); }
const ops = r => (r.actions || []).filter(a => ['place', 'flip', 'receive', 'return'].includes(a.type));
function run(sim, br, response) {
  br.brain = response.brain; sim.enqueue(br.id, response.actions || []);
  for (let n = 0; n < 1800 && (br.job || br.queue.length); n++) sim.step(.05);
  assert.equal(br.failure, null);
}
test('three modes append to the catalog without changing existing defaults or observation settings', () => {
  assert.deepEqual(C.listStrategies('BR').slice(12, 15).map(p => p.id), Policy.modes.map(p => p.id));
  for (const mode of Policy.modes) {
    const { sim } = world(mode.id);
    assert.equal(sim.config.brObservationMode, 'stopped'); assert.equal(sim.config.supplyMode, 'ideal');
    assert.ok(C.strategyDetails('BR', mode.id, 'red').some(row => row[1].includes('2番')));
  }
});
test('both teams build only their near private tower first, using at most two Earths', () => {
  for (const team of ['red', 'blue']) for (const mode of Policy.modes) {
    const { sim, br } = world(mode.id, team); hold(sim, br, ['earth', 'earth']);
    const r = C.next(scan(sim, br));
    assert.equal(ops(r).length, 2);
    assert.ok(ops(r).every(a => a.type === 'place' && a.spotId === (team === 'red' ? 'r2' : 'b2')));
    run(sim, br, r); assert.equal(sim.tower(team === 'red' ? 'r2' : 'b2').length, 2);
  }
});
test('no-wait seeds an empty shared tower while retaining Sky for the additional Earth', () => {
  const { sim, br } = world(); seed(sim, 'r2', 3); hold(sim, br, ['earth', 'sky']);
  const r = C.next(scan(sim, br)); assert.equal(r.brain.privateFirst.phase, 'self-build');
  assert.deepEqual(ops(r).map(a => [a.type, a.spotId]), [['place', 's2']]);
  run(sim, br, r); assert.equal(sim.tower('s2').length, 1); assert.equal(sim.object(br.cargo[0]).type, 'sky');
});
test('short wait observes with a time cost and ends by its finite deadline', () => {
  const { sim, br } = world('private-first-short'); seed(sim, 'r2', 3); hold(sim, br, ['earth', 'sky']);
  let r = C.next(scan(sim, br)); assert.equal(r.brain.privateFirst.phase, 'watch');
  assert.deepEqual(ops(r), []); assert.ok(r.actions.some(a => a.type === 'scan'));
  br.brain = r.brain; sim.time = r.brain.privateFirst.deadline;
  r = C.next(scan(sim, br)); assert.equal(r.brain.privateFirst.phase, 'self-build'); assert.ok(ops(r).some(a => a.type === 'place'));
});
test('observed wait follows visible approach, but not retreat, distant or unknown opponents', () => {
  const { sim, br } = world('private-first-observe'); seed(sim, 'r2', 3); hold(sim, br, ['earth', 'sky']);
  const v = scan(sim, br);
  for (const [actor, before, wait] of [[{ x: 6.8, y: 7.8 }, { at: 34, distance: 2.5 }, true],
    [{ x: 8, y: 6.8 }, { at: 34, distance: 2 }, false], [null, null, false]]) {
    const input = { ...v, brain: { ...v.brain, privateFirst: { opponent: before } }, observation: { ...v.observation, opponentBR: actor } };
    const r = C.next(input); assert.equal(r.brain.privateFirst.phase === 'watch', wait);
  }
});
test('every mode immediately uses an observed opponent Earth foundation instead of waiting', () => {
  for (const mode of Policy.modes) {
    const { sim, br } = world(mode.id); seed(sim, 'r2', 3); seed(sim, 's2', 1, 'blue'); hold(sim, br, ['earth', 'sky']);
    const r = C.next(scan(sim, br));
    assert.deepEqual(ops(r).map(a => [a.type, a.spotId]), [['place', 's2'], ['place', 's2']]);
    run(sim, br, r); assert.equal(sim.tower('s2').at(-1).color, 'red');
    assert.notEqual(sim.sanctuary.red, null); assert.equal(sim.tower('s2')[0].placedBy, 'blue');
  }
});
test('two Earths need only Sky; a completed enemy tower releases one cargo slot before flipping', () => {
  for (const layers of [2, 3]) {
    const { sim, br } = world('private-first-short'); seed(sim, 'r2', 3); seed(sim, 's2', layers, 'blue'); hold(sim, br, ['earth', 'sky']);
    const r = C.next(scan(sim, br));
    assert.deepEqual(ops(r).map(a => a.type), [layers === 2 ? 'place' : 'return']);
    if (layers === 3) {
      run(sim, br, r); assert.equal(br.cargo.length, 1);
      const next = C.next(scan(sim, br)); assert.deepEqual(ops(next).map(a => a.type), ['flip']);
    }
  }
});
test('unobserved ground truth changes do not affect a waiting decision or mutate its input', () => {
  const { sim, br } = world('private-first-observe'); seed(sim, 'r2', 3); hold(sim, br, ['earth', 'sky']);
  const view = scan(sim, br), saved = JSON.stringify(view), before = C.next(view);
  seed(sim, 's2', 1, 'blue'); Object.assign(sim.robot('blueBR'), { x: 5.9, y: 8.2 });
  assert.deepEqual(C.next(view), before); assert.equal(JSON.stringify(view), saved);
  assert.ok(ops(C.next(scan(sim, br))).some(a => a.type === 'place'));
});
test('qualification and race deadline use the identical baseline follow-through', () => {
  for (const qualified of [true, false]) {
    const { sim, br } = world(); seed(sim, 'r2', 3); if (qualified) seed(sim, 's2', 3);
    sim.updateSanctuary(); sim.time = qualified ? 50 : 110;
    const view = scan(sim, br), actual = Policy.builder(view, 'private-first-now'), expected = Baseline.builder(view);
    assert.deepEqual(actual.actions, expected.actions);
    assert.equal(actual.brain.privateFirst.phase, 'baseline');
  }
});
test('stale/unknown shared information is observed rather than treated as an empty tower', () => {
  const { sim, br } = world('private-first-now'); seed(sim, 'r2', 3); hold(sim, br, ['earth', 'sky']);
  const v = scan(sim, br);
  v.observation.visibility = { entries: { 'tower:r2': { status: 'current' }, 'tower:s2': { status: 'unknown' } } };
  const r = C.next(v); assert.equal(r.brain.privateFirst.phase, 'scout'); assert.deepEqual(ops(r), []);
});
test('without rival cooperation all three modes finish both towers with four own Earths and no capacity or legality escape', () => {
  for (const mode of Policy.modes) {
    const sim = new S.Simulation({ supplyMode: 'ideal', brObservationMode: 'stopped', redBrPlan: mode.id });
    sim.robots.filter(r => r.team === 'blue').forEach(r => r.auto = false);
    while (sim.time < 105 && sim.sanctuary.red === null) {
      sim.step(.05, C); assert.ok(S.blockCount(sim.robot('redBR').cargo, id => sim.object(id)) <= 2);
    }
    assert.notEqual(sim.sanctuary.red, null, mode.id);
    assert.equal(sim.tower('r2').at(-1).type, 'sky'); assert.equal(sim.tower('s2').at(-1).type, 'sky');
    assert.equal(sim.objects.filter(o => o.location === 'spot' && o.type === 'earth' && ['r2', 's2'].includes(o.spotId)).length, 4);
    const actions = sim.events.filter(e => e.robot === 'redBR' && e.kind === 'action' && e.action === 'place');
    assert.deepEqual(actions.slice(0, 3).map(e => e.spotId), ['r2', 'r2', 'r2']);
    assert.equal(sim.events.filter(e => ['rule', 'perception', 'unscored', 'unsupported', 'policy'].includes(e.kind)).length, 0);
  }
});
