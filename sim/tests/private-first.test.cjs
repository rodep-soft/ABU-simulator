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
    Object.assign(o, { location: 'spot', spotId: id, layer, x: spot.x, y: spot.y, z: (spot.level === 2 ? .9 : .6) + layer * .35,
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

test('any observed shared tower can supply immediate qualification before waiting or taking more boxes', () => {
  for (const team of ['red', 'blue']) for (const mode of Policy.modes) for (const id of ['s1', 's2', 'u1', 'u2', 'u3', 'u4']) {
    const { sim, br } = world(mode.id, team);
    seed(sim, team === 'red' ? 'r2' : 'b2', 3, team); seed(sim, id, 3, team === 'red' ? 'blue' : 'red');
    const response = C.next(scan(sim, br));
    assert.deepEqual(ops(response).map(a => [a.type, a.spotId]), [['flip', id]], `${team}/${mode.id}/${id}`);
  }
});

test('unknown stock does not delay a qualification flip with one free cargo slot', () => {
  for (const team of ['red', 'blue']) {
    const { sim, br } = world('private-first-short', team), own = team === 'red' ? 'r2' : 'b2';
    seed(sim, own, 3, team); seed(sim, 's2', 3, team === 'red' ? 'blue' : 'red'); hold(sim, br, ['earth']);
    const v = scan(sim, br);
    v.observation.visibility = { entries: { ['tower:' + own]: { status: 'current' }, 'tower:s2': { status: 'current' }, stock: { status: 'unknown' } } };
    assert.deepEqual(ops(C.next(v)).map(a => [a.type, a.spotId]), [['flip', 's2']]);
  }
});

test('another own completed tower can qualify without first rebuilding the usual private opening', () => {
  const { sim, br } = world('private-first-short'); seed(sim, 'r1', 3); seed(sim, 's1', 3, 'blue'); hold(sim, br, ['earth']);
  assert.deepEqual(ops(C.next(scan(sim, br))).map(a => [a.type, a.spotId]), [['flip', 's1']]);
});

function fillStock(sim, team, type, amount) {
  for (let i = 0; i < amount; i++) {
    const o = sim.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === team));
    const slot = sim.freeSlot(team, o, true); assert.ok(slot);
    Object.assign(o, { location: 'transfer', transferTeam: team, slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z, holder: null, touchedBy: null });
  }
  sim.changed();
}

test('a full BR returns Earth if Sky return stock is full, then physically flips to qualify', () => {
  for (const team of ['red', 'blue']) {
    const { sim, br } = world('private-first-short', team, { supplyMode: 'normal' });
    seed(sim, team === 'red' ? 'r2' : 'b2', 3, team); seed(sim, 's1', 3, team === 'red' ? 'blue' : 'red');
    hold(sim, br, ['earth', 'sky']); fillStock(sim, team, 'sky', 4);
    const response = C.next(scan(sim, br));
    assert.equal(ops(response)[0]?.type, 'return'); assert.equal(sim.object(ops(response)[0].objectId).type, 'earth');
    run(sim, br, response); assert.equal(S.blockCount(br.cargo, id => sim.object(id)), 1);
    const flip = C.next(scan(sim, br)); assert.deepEqual(ops(flip).map(a => [a.type, a.spotId]), [['flip', 's1']]);
    run(sim, br, flip); assert.notEqual(sim.sanctuary[team], null); assert.equal(sim.tower('s1').at(-1).color, team);
    assert.ok(sim.events.every(e => !['rule', 'perception', 'unsupported', 'unscored'].includes(e.kind)));
  }
});

test('if both return piles are full, a legal placement frees the hand rather than waiting forever', () => {
  const { sim, br } = world('private-first-short', 'red', { supplyMode: 'normal' });
  seed(sim, 'r2', 3); seed(sim, 's1', 3, 'blue'); hold(sim, br, ['earth', 'sky']);
  fillStock(sim, 'red', 'earth', 3); fillStock(sim, 'red', 'sky', 4);
  const response = C.next(scan(sim, br));
  assert.ok(ops(response).some(a => a.type === 'place')); assert.ok(!ops(response).some(a => a.type === 'flip'));
  run(sim, br, response); assert.ok(S.blockCount(br.cargo, id => sim.object(id)) < 2);
  const rescan = C.next(sim.view(br)); assert.ok(rescan.actions.some(a => a.type === 'scan'));
  run(sim, br, rescan);
  assert.deepEqual(ops(C.next(sim.view(br))).map(a => [a.type, a.spotId]), [['flip', 's1']]);
});

test('stale or touched qualification evidence cannot trigger the new flip priority', () => {
  for (const stale of ['r2', 's1']) {
    const { sim, br } = world('private-first-short'); seed(sim, 'r2', 3); seed(sim, 's1', 3, 'blue'); hold(sim, br, ['earth', 'sky']);
    const v = scan(sim, br); v.observation.visibility = { entries: Object.fromEntries(Object.keys(v.observation.towers).map(id => ['tower:' + id, { status: id === stale ? 'stale' : 'current' }])) };
    assert.ok(!ops(C.next(v)).some(a => a.type === 'flip' && a.spotId === 's1'));
  }
  const { sim, br } = world('private-first-short'); seed(sim, 'r2', 3); seed(sim, 's1', 3, 'blue');
  sim.tower('s1').at(-1).touchedBy = 'blueBR';
  assert.ok(!ops(C.next(scan(sim, br))).some(a => a.type === 'flip'));
});

test('qualification flip uses immutable paid observations, not later world changes or a hidden partner plan', () => {
  const { sim, br } = world('private-first-short'); seed(sim, 'r2', 3); seed(sim, 's1', 3, 'blue');
  const v = scan(sim, br), before = JSON.stringify(v), result = C.next(v);
  sim.tower('s1').at(-1).color = 'red'; sim.robot('redTR').brain = { secret: 'do-not-share' };
  assert.deepEqual(C.next(v), result); assert.equal(JSON.stringify(v), before);
  assert.deepEqual(ops(result).map(a => [a.type, a.spotId]), [['flip', 's1']]);
  assert.ok(!ops(C.next({ ...v, brain: { ...v.brain, stage: 'return' } })).some(a => a.type === 'flip'));
});

test('qualifying flips do not require a new private tower or obey the old 110-second construction cutoff', () => {
  const { sim, br } = world('private-first-short'); seed(sim, 'r2', 3); seed(sim, 's1', 3, 'blue'); sim.time = 115;
  assert.deepEqual(ops(C.next(scan(sim, br))).map(a => [a.type, a.spotId]), [['flip', 's1']]);
  sim.time = 179.9;
  assert.ok(!ops(C.next(scan(sim, br))).some(a => a.type === 'flip'));
});
