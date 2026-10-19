const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../field.js'), S = require('../engine.js'), C = require('../controllers.js');
const P = require('../score-planner.js'), Policy = require('../flexible-post.js'), Opening = require('../private-first.js');
function seed(sim, id, n, team = 'red') {
  const p = F.spotById[id];
  while (sim.tower(id).length < n) {
    const layer = sim.tower(id).length, o = sim.objects.find(o => o.location === 'source' && o.type === (layer < 2 ? 'earth' : 'sky') && (!o.team || o.team === team));
    Object.assign(o, { location: 'spot', spotId: id, layer, x: p.x, y: p.y, z: (p.level === 1 ? .6 : .9) + layer * .35,
      placedBy: team, color: layer === 2 ? team : null, touchedBy: null });
  }
  sim.changed();
}
function world(team = 'red', enshrined = true, extra = {}) {
  const sim = new S.Simulation({ supplyMode: 'ideal', brObservationMode: 'stopped', [team + 'BrPlan']: Policy.ID, ...extra });
  sim.robots.forEach(r => r.auto = false); const br = sim.robot(team + 'BR');
  Object.assign(br, F.points[team].brStandby, { enteredL1: true, z: .6, brain: { stage: 'choose' } });
  if (enshrined) { seed(sim, team === 'red' ? 'r2' : 'b2', 3, team); sim.sanctuary[team] = 20;
    Object.assign(sim.object('M'), { location: 'pillar', placedBy: team, touchedBy: null }); }
  sim.time = 145; sim.changed(); return { sim, br };
}
function hold(sim, br, types) {
  for (const type of types) {
    const o = sim.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === br.team));
    Object.assign(o, { location: 'cargo', holder: br.id, touchedBy: br.id }); br.cargo.push(o.id);
  }
  sim.changed();
}
function scan(sim, br) { sim.complete(br, { type: 'scan' }); assert.equal(br.failure, null); return sim.view(br); }
const ops = r => r.actions.filter(a => ['place', 'flip', 'return', 'receive'].includes(a.type));
function execute(sim, br, response) {
  br.brain = response.brain; sim.enqueue(br.id, response.actions);
  for (let i = 0; i < 1800 && (br.job || br.queue.length) && !sim.ended; i++) sim.step(.05);
  assert.equal(br.failure, null);
}
test('B17 appends without changing old IDs, default observation or supply settings', () => {
  assert.equal(C.listStrategies('BR')[16].id, Policy.ID); assert.equal(C.listStrategies('BR')[15].id, 'private-first-short-l2-defense');
  const { sim } = world(); assert.equal(sim.config.supplyMode, 'ideal'); assert.equal(sim.config.brObservationMode, 'stopped');
  assert.ok(C.strategyDetails('BR', Policy.ID, 'red').some(row => row[1].includes('①')));
});
test('both colors preserve exactly the short-wait behavior before their own observed enshrinement', () => {
  for (const team of ['red', 'blue']) {
    const { sim, br } = world(team, false); sim.sanctuary[team] = 40; hold(sim, br, ['earth', 'earth']);
    const v = scan(sim, br); assert.equal(Policy.active(v), false);
    assert.deepEqual(Policy.builder(v), Opening.builder({ ...v, brPlan: Policy.OPENING }, Policy.OPENING));
    Object.assign(sim.object('M'), { location: 'pillar', placedBy: team === 'red' ? 'blue' : 'red' }); sim.changed();
    assert.equal(Policy.active(scan(sim, br)), false);
  }
});
test('a near L1 shared Sky is flipped rather than forcing a climb to L2', () => {
  for (const team of ['red', 'blue']) {
    const { sim, br } = world(team); seed(sim, 's2', 3, team === 'red' ? 'blue' : 'red');
    Object.assign(br, F.spotApproaches(F.spotById.s2, team)[0]);
    const r = C.next(scan(sim, br)); assert.deepEqual(ops(r).map(a => [a.type, a.spotId]), [['flip', 's2']]);
    execute(sim, br, r); assert.equal(sim.tower('s2')[2].color, team);
  }
});
test('the far private tower can be completed with a carried Sky on either color', () => {
  for (const team of ['red', 'blue']) {
    const { sim, br } = world(team), id = team === 'red' ? 'r1' : 'b1'; seed(sim, id, 2, team); hold(sim, br, ['sky']);
    Object.assign(br, F.spotApproaches(F.spotById[id], team)[0]);
    const r = C.next(scan(sim, br)); assert.deepEqual(ops(r).map(a => [a.type, a.spotId]), [['place', id]]);
    execute(sim, br, r); assert.equal(sim.tower(id)[2].color, team);
  }
});
test('observed lead changes the ranking of secure Earth versus exposed shared Sky', () => {
  const { sim, br } = world(); seed(sim, 'u1', 2); hold(sim, br, ['earth', 'sky']);
  const v = scan(sim, br); v.observation.opponentBR = { x: 4.85, y: 4.85, maxSpeed: 7, placeSeconds: 2.5 };
  const earth = P.specifiedPlan(v, [], [{ type: 'place', spotId: 'r1', objectId: v.cargo.find(o => o.type === 'earth').id }]);
  const sky = P.specifiedPlan(v, [], [{ type: 'place', spotId: 'u1', objectId: v.cargo.find(o => o.type === 'sky').id }]);
  assert.ok(earth && sky);
  v.observation.scores = { red: { total: 500 }, blue: { total: 400 } };
  let evalPlan = Policy.evaluator(v); assert.ok(evalPlan(earth).rank[1] > evalPlan(sky).rank[1]);
  v.observation.scores = { red: { total: 200 }, blue: { total: 400 } };
  evalPlan = Policy.evaluator(v); assert.ok(evalPlan(sky).rank[1] > evalPlan(earth).rank[1]);
  v.observation.scores = null; assert.equal(Policy.evaluator(v)(earth).lead, null);
});
test('completion allowance rejects a late move even if nominal travel and flip fit', () => {
  const { sim, br } = world(); const v = scan(sim, br); Object.assign(v, { x: 6.15, y: 4.85, time: 172.55 });
  v.observation.opponentBR = { x: 6.15, y: 4.85, maxSpeed: 7, placeSeconds: 2.5 };
  const c = { tasks: [{ type: 'flip', spotId: 'u1' }], picked: [], completeSeconds: 5.15 };
  const budget = Policy.finishBudget(v, c); assert.ok(c.completeSeconds < 180 - v.time); assert.equal(budget.crowded, true); assert.equal(budget.fits, false);
});
test('stale or unknown opponent pose never supplies precise route congestion information', () => {
  const { sim, br } = world(); const v = scan(sim, br); v.observation.opponentBR = { x: 4.85, y: 4.85 };
  const c = { tasks: [{ type: 'flip', spotId: 'u1' }], picked: [], completeSeconds: 5 };
  v.observation.visibility = { entries: { opponentBR: { status: 'stale' } } };
  const a = Policy.finishBudget(v, c); v.observation.opponentBR = { x: 10, y: 10 };
  assert.deepEqual(Policy.finishBudget(v, c), a); assert.equal(a.crowded, false);
});
test('last seconds hold locally rather than start an unfinishable supply or scoring trip', () => {
  const { sim, br } = world(); seed(sim, 'u1', 3, 'blue'); sim.time = 179.5;
  const r = C.next(scan(sim, br)); assert.ok(r.actions.every(a => a.type === 'wait')); assert.deepEqual(ops(r), []);
});
test('full unplaceable Sky cargo returns one box only when the scoring follow-up also fits', () => {
  const { sim, br } = world();
  for (const p of F.spots.filter(p => !p.team || p.team === 'red')) if (!sim.tower(p.id).length) seed(sim, p.id, 3, p.team === 'red' ? 'red' : 'blue');
  hold(sim, br, ['sky', 'sky']); sim.time = 110; const v = scan(sim, br), plan = Policy.returnPlan(v);
  assert.ok(plan?.returnObject); assert.ok(plan.tasks.some(a => a.type === 'flip'));
  const r = C.next(v); assert.deepEqual(ops(r).map(a => a.type), ['return']); execute(sim, br, r);
  assert.equal(S.blockCount(br.cargo, id => sim.object(id)), 1);
  const late = { ...v, time: 178 }; assert.equal(Policy.returnPlan(late), null);
});
test('a legal arrived task is completed, but a newly filled destination invalidates the commitment', () => {
  const { sim, br } = world(); seed(sim, 'r1', 2); hold(sim, br, ['sky']); Object.assign(br, F.spotApproaches(F.spotById.r1, 'red')[0]);
  br.brain.flexiblePost = { intent: { type: 'place', objectId: br.cargo[0], spotId: 'r1' } };
  const v = scan(sim, br); assert.ok(Policy.arrivedPlan(v));
  const r = C.next(v); assert.match(r.decision.flexiblePost.reason, /到着先/);
  seed(sim, 'r1', 3); assert.equal(Policy.arrivedPlan(scan(sim, br)), null);
});
test('hidden world changes neither alter a saved view decision nor mutate that input', () => {
  const { sim, br } = world(); seed(sim, 's2', 3, 'blue');
  const v = scan(sim, br), original = JSON.stringify(v), r = C.next(v);
  sim.tower('s2')[2].color = 'red'; Object.assign(sim.robot('blueBR'), { x: 4.85, y: 4.85 }); sim.changed();
  assert.deepEqual(C.next(v), r); assert.equal(JSON.stringify(v), original);
});
test('unknown towers and null scores do not become a fabricated empty board or certain lead', () => {
  const { sim, br } = world(); hold(sim, br, ['earth']); const v = scan(sim, br);
  v.observation.scores = null; v.observation.visibility = { entries: Object.fromEntries(F.spots.map(p => ['tower:' + p.id, { status: 'unknown' }])) };
  assert.equal(Policy.lead(v), null); assert.equal(Policy.selectPlan(v), null); assert.deepEqual(ops(C.next(v)), []);
});
test('flip-only work never picks up unused boxes just to delay completion, and one held box is not returned for a flip', () => {
  const { sim, br } = world();
  for (const p of F.spots.filter(p => !p.team || p.team === 'red')) if (!sim.tower(p.id).length) seed(sim, p.id, 3, p.team === 'red' ? 'red' : 'blue');
  Object.assign(br, F.points.red.transferBR); sim.time = 155;
  const v = scan(sim, br), plan = Policy.selectPlan(v); assert.ok(plan); assert.deepEqual(plan.picked, []);
  assert.ok(plan.tasks.every(a => a.type === 'flip'));
  hold(sim, br, ['earth']); assert.equal(Policy.returnPlan(scan(sim, br)), null);
});
test('idle L2 robot makes only a short feasible step aside instead of blocking the shared task approach', () => {
  const { sim, br } = world();
  for (const p of F.spots.filter(p => !p.team || p.team === 'red')) if (!sim.tower(p.id).length) seed(sim, p.id, 3);
  Object.assign(br, F.spotApproaches(F.spotById.u2, 'red')[0], { z: .9 }); sim.time = 174.95;
  const v = scan(sim, br), target = Policy.idleTarget(v), r = C.next(v);
  assert.ok(target); assert.ok(S.distance(target, v) > sim.config.bodySize); assert.ok(S.distance(target, v) < .7);
  assert.ok(r.actions.some(a => a.type === 'scan')); assert.deepEqual(ops(r), []);
  execute(sim, br, r); assert.ok(S.distance(br, target) < .02);
  assert.equal(Policy.idleTarget(scan(sim, br)), undefined);
  const late = { ...v, time: 179.5 }; assert.equal(Policy.idleTarget(late), undefined);
});
