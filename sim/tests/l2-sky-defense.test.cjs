const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../field.js');
const S = require('../engine.js');
const C = require('../controllers.js');
const Policy = require('../l2-sky-defense.js');
const Opening = require('../private-first.js');
function world(team = 'red', enshrined = true, extra = {}) {
  const sim = new S.Simulation({ supplyMode: 'ideal', brObservationMode: 'stopped', [team + 'BrPlan']: Policy.ID, ...extra });
  sim.robots.forEach(r => r.auto = false);
  const br = sim.robot(team + 'BR');
  Object.assign(br, F.points[team].homeL2, { enteredL1: true, z: .9, brain: { stage: 'choose' } });
  if (enshrined) {
    seed(sim, team === 'red' ? 'r2' : 'b2', 3, team); sim.sanctuary[team] = 25;
    Object.assign(sim.object('M'), { location: 'pillar', placedBy: team, touchedBy: null });
  }
  sim.time = 155; sim.changed(); return { sim, br };
}
function seed(sim, id, length, team = 'red') {
  const p = F.spotById[id];
  while (sim.tower(id).length < length) {
    const layer = sim.tower(id).length;
    const o = sim.objects.find(o => o.location === 'source' && o.type === (layer < 2 ? 'earth' : 'sky') && (!o.team || o.team === team));
    assert.ok(o);
    Object.assign(o, { location: 'spot', spotId: id, layer, x: p.x, y: p.y, z: .9 + layer * .35,
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
const work = r => (r.actions || []).filter(a => ['flip', 'place', 'return', 'receive'].includes(a.type));

test('new policy appends B16 without changing defaults or previous B13-B15 IDs', () => {
  assert.equal(C.listStrategies('BR')[15].id, Policy.ID);
  assert.deepEqual(C.listStrategies('BR').slice(12, 15).map(p => p.id), Opening.modes.map(m => m.id));
  const { sim } = world(); assert.equal(sim.config.supplyMode, 'ideal'); assert.equal(sim.config.brObservationMode, 'stopped');
  assert.ok(C.strategyDetails('BR', Policy.ID, 'blue').some(row => row[1].includes('奉納')));
});
test('before own observed enshrinement, every decision is exactly the short-wait opening, even qualified or late', () => {
  for (const team of ['red', 'blue']) for (const qualified of [false, true]) {
    const { sim, br } = world(team, false); if (qualified) sim.sanctuary[team] = 40;
    Object.assign(br, F.points[team].brStandby, { z: .6 }); hold(sim, br, ['earth', 'earth']);
    const view = scan(sim, br);
    assert.deepEqual(Policy.builder(view), Opening.builder({ ...view, brPlan: Policy.OPENING }, Policy.OPENING));
    Object.assign(sim.object('M'), { location: 'pillar', placedBy: team === 'red' ? 'blue' : 'red' }); sim.changed();
    assert.equal(Policy.active(scan(sim, br)), false);
  }
});
test('both colors choose observed enemy L2 Sky over L1 Sky without touching the input', () => {
  for (const team of ['red', 'blue']) {
    const enemy = team === 'red' ? 'blue' : 'red', { sim, br } = world(team);
    seed(sim, 'u1', 3, enemy); seed(sim, 's2', 3, enemy);
    const view = scan(sim, br), saved = JSON.stringify(view), r = C.next(view);
    assert.ok(work(r).length); assert.ok(work(r).every(a => a.type === 'flip' && a.spotId === 'u1'), JSON.stringify(r));
    assert.equal(r.decision.l2Defense.phase, 'work'); assert.equal(JSON.stringify(view), saved);
  }
});
test('one carried Sky is used on L2 immediately rather than requiring a pair or resupply', () => {
  const { sim, br } = world(); seed(sim, 'u1', 2); hold(sim, br, ['sky']);
  const r = C.next(scan(sim, br)); assert.deepEqual(work(r).map(a => [a.type, a.spotId]), [['place', 'u1']]);
});
test('full box cargo cannot flip and returns just one box if all L2 towers are complete', () => {
  const { sim, br } = world(); for (const id of ['u1', 'u2', 'u3', 'u4']) seed(sim, id, 3, 'blue');
  hold(sim, br, ['earth', 'sky']); const r = C.next(scan(sim, br));
  assert.deepEqual(work(r).map(a => a.type), ['return']); assert.equal(r.decision.l2Defense.phase, 'free-hand');
  br.brain = r.brain; sim.enqueue(br.id, r.actions);
  for (let i = 0; i < 700 && (br.job || br.queue.length); i++) sim.step(.05);
  assert.equal(br.failure, null); assert.equal(S.blockCount(br.cargo, id => sim.object(id)), 1);
  const next = C.next(scan(sim, br)); assert.ok(work(next).some(a => a.type === 'flip'));
});
test('late owned L2 Sky is guarded with paid scans on L2, not idle resupply trips', () => {
  const { sim, br } = world(); seed(sim, 'u1', 3);
  const v = scan(sim, br), r = C.next(v);
  assert.equal(r.decision.l2Defense.phase, 'guard'); assert.deepEqual(work(r), []);
  assert.ok(r.actions.some(a => a.type === 'scan'));
  assert.ok(r.actions.filter(a => a.type === 'move').every(a => F.surface(a.target).type === 'l2'));
  const p = Policy.guardTarget(v);
  assert.equal(F.surface(p).type, 'l2');
  for (const spot of F.spots.filter(s => s.level === 2)) for (const a of F.spotApproaches(spot, v.team)) assert.ok(S.distance(p, a) > sim.config.bodySize);
});
test('guarding before 150 seconds requires a current observed nearby L2 opponent', () => {
  const { sim, br } = world(); seed(sim, 'u1', 3); const v = scan(sim, br); v.time = 120;
  v.observation.opponentBR = { x: 4.9, y: 4.9 };
  assert.equal(Policy.shouldGuard(v), true);
  v.observation.opponentBR = null; assert.equal(Policy.shouldGuard(v), false);
  v.observation.opponentBR = { x: 4.9, y: 4.9 };
  v.observation.visibility = { entries: { 'tower:u1': { status: 'current' }, opponentBR: { status: 'stale' } } };
  assert.equal(Policy.shouldGuard(v), false);
});
test('unobserved world changes cannot activate the policy or change the chosen defense', () => {
  const { sim, br } = world('red', false); seed(sim, 'u1', 3, 'blue');
  const before = scan(sim, br), result = Policy.builder(before);
  Object.assign(sim.object('M'), { location: 'pillar', placedBy: 'red' }); sim.changed();
  assert.deepEqual(Policy.builder(before), result); assert.equal(Policy.active(before), false);
  const now = scan(sim, br), next = Policy.builder(now); assert.equal(Policy.active(now), true);
  sim.tower('u1')[2].color = 'red'; sim.changed(); assert.deepEqual(Policy.builder(now), next);
});
test('unknown L2 towers trigger a real observation action rather than an empty-tower assumption', () => {
  const { sim, br } = world(); const v = scan(sim, br);
  v.observation.visibility = { entries: { 'tower:u1': { status: 'unknown' } } };
  const r = Policy.builder(v); assert.equal(r.decision.l2Defense.phase, 'scout');
  assert.deepEqual(work(r), []); assert.ok(r.actions.some(a => a.type === 'scan'));
});
test('an observed legal task at the arrived L2 destination completes instead of oscillating between targets', () => {
  const { sim, br } = world(); seed(sim, 'u1', 2); seed(sim, 'u3', 2); hold(sim, br, ['sky']);
  Object.assign(br, F.spotApproaches(F.spotById.u1, 'red')[0]);
  br.brain.l2Defense = { activatedAt: 100, intent: { type: 'place', objectId: br.cargo[0], spotId: 'u1' } };
  const r = C.next(scan(sim, br));
  assert.equal(r.decision.l2Defense.reason, '到着先を再確認・合法なら作業を完了');
  assert.deepEqual(work(r).map(a => [a.type, a.spotId]), [['place', 'u1']]);
  br.brain = r.brain; sim.enqueue(br.id, r.actions);
  for (let i = 0; i < 80 && (br.job || br.queue.length); i++) sim.step(.05);
  assert.equal(sim.tower('u1').at(-1).color, 'red'); assert.equal(br.cargo.length, 0);
});
test('arrival commitment is discarded if a new observation shows the tower already filled', () => {
  const { sim, br } = world(); seed(sim, 'u1', 3, 'blue'); seed(sim, 'u3', 2); hold(sim, br, ['sky']);
  Object.assign(br, F.spotApproaches(F.spotById.u1, 'red')[0]);
  br.brain.l2Defense = { intent: { type: 'place', objectId: br.cargo[0], spotId: 'u1' } };
  const v = scan(sim, br); assert.equal(Policy.arrivedPlan(v), null);
  const r = C.next(v); assert.ok(work(r).length);
  assert.ok(work(r).every(a => !(a.type === 'place' && a.spotId === 'u1')));
});
