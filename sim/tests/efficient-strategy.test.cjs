const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation } = require('../engine.js');
const F = require('../field.js');
const C = require('../controllers.js');
const E = require('../efficient-strategy.js');

function world(team = 'red') {
  const s = new Simulation(); for (const r of s.robots) r.auto = false;
  const tr = s.robot(`${team}TR`), br = s.robot(`${team}BR`);
  Object.assign(tr, F.points[team].transferTR, { z: .6, brain: { stage: 'collect' } });
  Object.assign(br, F.points[team].home, { z: .6, enteredL1: true, brain: { stage: 'choose' } });
  return { s, tr, br, team };
}
function hold(s, r, id) { const o = s.object(id); Object.assign(o, { location: 'cargo', holder: r.id, touchedBy: r.id }); r.cargo.push(id); s.changed(); return o; }
function source(s, type, team) { return s.objects.find(o => o.type === type && o.location === 'source' && (!o.team || o.team === team)); }
function stock(s, team, type) {
  const o = source(s, type, team), p = s.freeSlot(team, o); assert.ok(p);
  Object.assign(o, { location: 'transfer', transferTeam: team, slot: p.id, layer: p.layer, z: p.z, x: p.x, y: p.y }); s.changed(); return o;
}
function seed(s, id, length, color = 'red') {
  const p = F.spotById[id];
  for (let i = 0; i < length; i++) {
    const o = source(s, i === 2 ? 'sky' : 'earth', color);
    Object.assign(o, { location: 'spot', x: p.x, y: p.y, z: (p.level === 1 ? .6 : .9) + i * .35, spotId: id, layer: i, placedBy: color, color: i === 2 ? color : null });
  }
  s.changed();
}
function scan(s, r) { s.observe(r); r.scanLoaded = true; r.batchRemaining = Math.max(1, r.cargo.length); return s.view(r); }
function run(s, r, response) {
  r.brain = response.brain; s.enqueue(r.id, response.actions);
  for (let n = 0; n < 3600 && (r.job || r.queue.length) && !s.ended; n++) s.step(.05);
  assert.equal(r.failure, null); assert.equal(r.job, null); assert.equal(r.queue.length, 0);
}

test('Mustika direct handoff works on both sides with a completely full stock; no floor frame or transfer points', () => {
  for (const team of ['red', 'blue']) for (const reverse of [false, true]) {
    const { s, tr, br } = world(team); if (reverse) s.robots.reverse();
    for (const [type, limit] of Object.entries(F.stockLimits)) for (let i = 0; i < limit; i++) stock(s, team, type);
    hold(s, tr, 'M'); s.sanctuary[team] = 0; Object.assign(br, F.points[team].transferBR);
    assert.equal(s.validate(tr, { type: 'unload' }).ok, false);
    s.startJob(br, { type: 'receive', objectId: 'M' }); assert.ok(br.job);
    assert.equal(s.validate(tr, { type: 'move', target: F.points[team].mustika }).ok, false);
    for (let n = 0; n < 40 && br.job; n++) {
      s.step(.05); assert.equal(s.object('M').location, 'cargo');
      assert.equal(s.robots.filter(r => r.cargo.includes('M')).length, 1);
    }
    assert.equal(br.failure, null); assert.deepEqual(tr.cargo, []); assert.deepEqual(br.cargo, ['M']);
    assert.equal(s.object('M').holder, br.id); assert.equal(br.scanLoaded, false);
    assert.equal(s.transferPoints[team], 0); assert.equal(s.stock(team).length, 7);
    assert.deepEqual(tr.transport.completed[0].items, [{ id: 'M', type: 'mustika' }]);
    assert.equal(s.events.filter(e => e.action === 'handoff').length, 1);
  }
});
test('direct handoff rejects wrong position, opposite team, mixed cargo, missing mandate and moving TR', () => {
  const { s, tr, br } = world(); hold(s, tr, 'M'); s.sanctuary.red = 0;
  const receive = { type: 'receive', objectId: 'M' };
  assert.equal(s.validate(br, receive).ok, false);
  Object.assign(br, F.points.red.transferBR); assert.equal(s.validate(br, receive).ok, true);
  assert.equal(s.validate(s.robot('blueBR'), receive).ok, false);
  hold(s, br, 'red-E1'); assert.equal(s.validate(br, receive).ok, false);
  br.cargo = []; s.sanctuary.red = null; assert.equal(s.validate(br, receive).ok, false);
  s.sanctuary.red = 0; tr.job = { type: 'move' }; assert.equal(s.validate(br, receive).ok, false);
  tr.job = null; tr.x -= .5; assert.equal(s.validate(br, receive).ok, false);
});
test('handoff visibility remains a home snapshot and excludes partner intentions', () => {
  const { s, tr, br } = world(); s.sanctuary.red = 0;
  const before = scan(s, br); assert.equal(before.observation.handoff, null);
  hold(s, tr, 'M'); assert.equal(s.view(br).observation.handoff, null);
  const fresh = scan(s, br); assert.equal(fresh.observation.handoff.objectId, 'M');
  assert.deepEqual(Object.keys(fresh.observation.partner).sort(), ['cargo', 'x', 'y']);
  fresh.observation.partner.cargo.length = 0; assert.deepEqual(tr.cargo, ['M']);
  assert.equal(C.next(s.view(br)).actions.some(a => a.type === 'receive' && a.objectId === 'M'), true);
});
test('Mustika is received before ordinary blocks, scanned, enshrined and followed by further work', () => {
  const { s, tr, br } = world(); hold(s, tr, 'M'); s.sanctuary.red = 0; stock(s, 'red', 'earth');
  run(s, br, C.next(scan(s, br))); assert.deepEqual(br.cargo, ['M']); assert.equal(br.scanLoaded, true);
  const decision = C.next(s.view(br)); assert.equal(decision.actions.at(-1).type, 'enshrine'); run(s, br, decision);
  assert.equal(s.scores().red.mustika, 250); assert.equal(s.ended, false);
  run(s, br, C.next(s.view(br))); seed(s, 's2', 3, 'blue');
  assert.ok(C.next(scan(s, br)).actions.some(a => ['flip', 'receive'].includes(a.type)));
});
test('useful E2 is selected from a complete first E3 delivery', () => {
  for (const team of ['red', 'blue']) {
    const { s, br } = world(team); for (let i = 0; i < 3; i++) stock(s, team, 'earth');
    const decision = C.next(scan(s, br)); assert.equal(decision.actions.filter(a => a.type === 'receive').length, 2);
    run(s, br, decision); const batch = C.next(s.view(br));
    assert.equal(batch.actions.filter(a => a.type === 'place').length, 2);
    run(s, br, batch); assert.equal(br.cargo.length, 0);
  }
});
test('a single Sky completion waits for a useful second block', () => {
  const { s, br } = world(); seed(s, 'u1', 2); stock(s, 'red', 'sky');
  const decision = C.next(scan(s, br)); assert.equal((decision.actions || []).filter(a => a.type === 'receive').length, 0);
  assert.ok(decision.wait > 0);
});
test('Mustika preparation returns held Sky before receiving the ball', () => {
  const { s, tr, br } = world(); seed(s, 'r2', 1); hold(s, br, 'S1'); stock(s, 'red', 'earth');
  hold(s, tr, 'M'); s.sanctuary.red = 0;
  const response = C.next(scan(s, br)); assert.ok(response.actions.some(a => a.type === 'return' && a.objectId === 'S1'));
  run(s, br, response); assert.equal(br.cargo.length, 0);
  run(s, br, C.next(s.view(br))); assert.deepEqual(br.cargo, ['M']);
});
test('TR prioritizes achieved Mustika even while BR has returnable Sky cargo', () => {
  const { s, tr, br } = world(); seed(s, 'r2', 1); hold(s, br, 'S1'); s.sanctuary.red = 0;
  const response = C.next(scan(s, tr)); assert.equal(response.actions.at(-1).objectId, 'M');
});
test('TR prioritizes achieved Mustika, but preposition never picks it before mandate', () => {
  const { s, tr } = world(); seed(s, 'r2', 3); seed(s, 's2', 2); stock(s, 'red', 'sky');
  const v = scan(s, tr); assert.equal(E.oneActionAway(v), true);
  const approach = C.next(v); assert.ok(approach.actions.some(a => a.type === 'move')); assert.equal(approach.actions.some(a => a.type === 'pickup'), false);
  tr.brain = approach.brain; Object.assign(tr, F.points.red.mustika);
  const wait = C.next(scan(s, tr)); assert.ok(wait.wait > 0);
  s.sanctuary.red = 0; assert.equal(C.next(scan(s, tr)).actions.at(-1).objectId, 'M');
});
test('preposition is bounded and cannot wait forever for an unrealized condition', () => {
  const { s, tr } = world(); seed(s, 'r2', 3); seed(s, 's2', 2); stock(s, 'red', 'sky');
  tr.brain = C.next(scan(s, tr)).brain; s.time = 20;
  const response = C.next(scan(s, tr)); assert.notEqual(response.status, 'Mustika前待機 · 条件達成待ち');
});
test('handoff is independent of TR policy and BR legacy policy remains usable', () => {
  for (const trPlan of C.listStrategies('TR')) for (const brPlan of C.listStrategies('BR')) {
    const { s, tr, br } = world(); s.config.redTrPlan = trPlan.id; s.config.redBrPlan = brPlan.id;
    hold(s, tr, 'M'); s.sanctuary.red = 0;
    assert.equal(C.next(scan(s, tr)).actions, undefined);
    assert.ok(C.next(scan(s, br)).actions.some(a => a.type === 'receive' && a.objectId === 'M'));
  }
});
test('supply pauses while BR occupies the receiving side; locked stack cannot be covered', () => {
  const { s, tr, br } = world(); const lower = stock(s, 'red', 'earth');
  hold(s, tr, 'red-E2'); tr.brain = { stage: 'deliver', trip: 0, manifest: { earth: 1, sky: 0 } };
  Object.assign(br, F.points.red.transferBR);
  assert.ok(C.next(scan(s, tr)).wait > 0);
  s.startJob(br, { type: 'receive', objectId: lower.id }); assert.ok(br.job);
  assert.equal(s.freeSlot('red', s.object('red-E2')), null);
});
test('waiting rechecks supply but never relaxes the two-block departure requirement', () => {
  const { s, tr, br } = world(); hold(s, tr, 'red-E2'); stock(s, 'red', 'earth');
  const wait = C.next(scan(s, br)); assert.ok(wait.wait > 0);
  br.brain = { ...wait.brain, stage: 'choose' }; s.time = 8;
  assert.equal((C.next(scan(s, br)).actions || []).some(a => a.type === 'receive'), false);
  br.brain = { stage: 'choose' }; s.time = 170;
  assert.equal((C.next(scan(s, br)).actions || []).some(a => a.type === 'receive'), false);
  s.time = 20; br.brain = { stage: 'choose' }; stock(s, 'red', 'earth');
  Object.assign(tr, F.points.red.startTR);
  assert.equal(C.next(scan(s, br)).actions.filter(a => a.type === 'receive').length, 2);
});
