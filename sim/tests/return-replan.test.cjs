const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, completedTowers, mandateHeld } = require('../engine.js');
const F = require('../field.js');
const C = require('../controllers.js');
const P = require('../score-planner.js');

function world(team = 'red', config = {}) {
  const s = new Simulation(config); for (const r of s.robots) r.auto = false;
  const tr = s.robot(`${team}TR`), br = s.robot(`${team}BR`);
  Object.assign(tr, F.points[team].transferTR, { z: .6 });
  Object.assign(br, F.points[team].home, { z: .6, enteredL1: true, brain: { stage: 'choose' } });
  return { s, tr, br, team };
}
function source(s, type, team) { return s.objects.find(o => o.location === 'source' && o.type === type && (!o.team || o.team === team)); }
function hold(s, r, type) {
  const o = source(s, type, r.team); assert.ok(o);
  Object.assign(o, { location: 'cargo', holder: r.id, touchedBy: r.id }); r.cargo.push(o.id); s.changed(); return o;
}
function stock(s, team, type) {
  const o = source(s, type, team), slot = s.freeSlot(team, o); assert.ok(slot);
  Object.assign(o, { location: 'transfer', transferTeam: team, slot: slot.id, layer: slot.layer, x: slot.x, y: slot.y, z: slot.z });
  s.changed(); return o;
}
function seed(s, id, count, team = 'red') {
  const p = F.spotById[id];
  while (s.tower(id).length < count) {
    const layer = s.tower(id).length, o = source(s, layer === 2 ? 'sky' : 'earth', team);
    Object.assign(o, { location: 'spot', spotId: id, layer, x: p.x, y: p.y, z: (p.level === 1 ? .6 : .9) + .35 * layer,
      placedBy: team, color: layer === 2 ? team : null });
  }
  s.changed();
}
function scan(s, br) { s.observe(br); br.scanLoaded = true; br.batchRemaining = Math.max(1, br.cargo.length); return s.view(br); }
function run(s, r, response) {
  if (response.brain) r.brain = response.brain;
  s.enqueue(r.id, response.actions);
  for (let i = 0; i < 3500 && (r.queue.length || r.job) && !s.ended; i++) s.step(.05);
  assert.equal(r.failure, null); assert.equal(r.job, null); assert.equal(r.queue.length, 0);
}

test('one shared tower alone never grants Mustika pickup, for either team or shared level', () => {
  for (const team of ['red', 'blue']) for (const id of ['s1', 's2', 'u1', 'u2', 'u3', 'u4']) {
    const { s, tr } = world(team); seed(s, id, 3, team); s.updateSanctuary();
    Object.assign(tr, F.points[team].mustika);
    assert.equal(s.sanctuary[team], null); assert.equal(s.sanctuaryEvidence[team], null);
    assert.equal(s.validate(tr, { type: 'pickup', objectId: 'M' }).ok, false);
    s.startJob(tr, { type: 'pickup', objectId: 'M' });
    assert.equal(s.object('M').location, 'source'); assert.equal(tr.job, null);
  }
});

test('two towers at different times do not qualify; simultaneous private/shared completion latches with evidence', () => {
  const { s, tr, br } = world(); seed(s, 'r2', 3); s.updateSanctuary();
  s.tower('r2').at(-1).color = 'blue'; seed(s, 's2', 3); s.time = 20; s.updateSanctuary();
  assert.equal(s.sanctuary.red, null);
  s.tower('r2').at(-1).color = 'red'; s.time = 25; s.updateSanctuary();
  assert.equal(s.sanctuary.red, 25);
  const evidence = JSON.stringify(s.sanctuaryEvidence.red);
  assert.deepEqual(s.sanctuaryEvidence.red.towers.map(t => t.id).sort(), ['r2', 's2']);
  s.tower('r2').at(-1).color = 'blue'; s.time = 30; s.updateSanctuary();
  assert.equal(completedTowers(id => s.tower(id), 'red').length, 1);
  assert.equal(JSON.stringify(s.sanctuaryEvidence.red), evidence);
  scan(s, br).observation.sanctuaryEvidence.towers.length = 0;
  s.snapshot().sanctuaryEvidence.red.towers.length = 0;
  assert.equal(JSON.stringify(s.sanctuaryEvidence.red), evidence);
  Object.assign(tr, F.points.red.mustika);
  run(s, tr, { actions: [{ type: 'pickup', objectId: 'M' }] });
  const event = s.events.find(e => e.action === 'pickup' && e.kind === 'action');
  assert.equal(event.sanctuaryAt, 25); assert.equal(JSON.stringify(event.sanctuaryEvidence), evidence);
});

test('malformed layers and actively touched towers cannot establish eligibility', () => {
  const { s } = world(); seed(s, 'r2', 3); seed(s, 's2', 3);
  s.tower('s2')[1].layer = 4; s.updateSanctuary(); assert.equal(s.sanctuary.red, null);
  s.objects.find(o => o.spotId === 's2' && o.layer === 4).layer = 1;
  s.tower('s2')[2].touchedBy = 'blueBR'; s.updateSanctuary(); assert.equal(s.sanctuary.red, null);
  s.tower('s2')[2].touchedBy = null; s.updateSanctuary(); assert.equal(s.sanctuary.red, 0);
});

test('eligibility requires a valid past timestamp and is rechecked at pickup completion', () => {
  for (const value of [null, undefined, false, true, '0', -1, NaN, Infinity, 5]) assert.equal(mandateHeld({ red: value }, 'red', 0), false);
  assert.equal(mandateHeld({ red: 0 }, 'red', 0), true);
  const { s, tr } = world(); Object.assign(tr, F.points.red.mustika); s.sanctuary.red = 0;
  s.startJob(tr, { type: 'pickup', objectId: 'M' }); assert.ok(tr.job);
  s.sanctuary.red = null;
  while (tr.job) s.step(.05);
  assert.match(tr.failure.reason, /未達成/); assert.equal(s.object('M').location, 'source'); assert.equal(s.object('M').touchedBy, null);
});

test('two unusable Sky blocks return to their own typed stack and BR resumes with useful E2', () => {
  for (const team of ['red', 'blue']) {
    const { s, tr, br } = world(team), ids = [hold(s, br, 'sky').id, hold(s, br, 'sky').id];
    stock(s, team, 'earth'); stock(s, team, 'earth');
    const decision = C.next(scan(s, br)); assert.deepEqual(decision.actions.filter(a => a.type === 'return').map(a => a.objectId), ids);
    const points = s.transferPoints[team], history = JSON.stringify(tr.transport);
    run(s, br, decision);
    assert.equal(br.cargo.length, 0); assert.equal(s.stock(team).length, 4);
    assert.equal(s.transferPoints[team], points); assert.equal(JSON.stringify(tr.transport), history);
    for (const id of ids) { const o = s.object(id); assert.equal(o.slot, F.slots(team).find(p => p.type === 'sky').id); assert.equal(o.holder, null); }
    const refill = C.next(s.view(br)); assert.equal(refill.actions.filter(a => a.type === 'receive').length, 2);
    run(s, br, refill); assert.ok(br.cargo.every(id => s.object(id).type === 'earth'));
    const build = C.next(s.view(br)); assert.equal(build.actions.filter(a => a.type === 'place').length, 2); run(s, br, build);
    assert.equal(br.cargo.length, 0); assert.equal(s.objects.length, 53);
  }
});

test('TR cannot consume return reservations; placing a held block releases its reservation', () => {
  const { s, tr, br } = world(); stock(s, 'red', 'earth');
  const a = hold(s, br, 'earth'), b = hold(s, br, 'earth');
  const incoming = hold(s, tr, 'earth');
  assert.equal(s.freeSlot('red', incoming), null); assert.ok(s.freeSlot('red', a, true));
  scan(s, br);
  run(s, br, { actions: [{ type: 'move', target: F.spotApproaches(F.spotById.r2, 'red')[0] }, { type: 'place', objectId: a.id, spotId: 'r2' }] });
  assert.ok(s.freeSlot('red', incoming));
  run(s, tr, { actions: [{ type: 'unload' }] });
  assert.equal(s.freeSlot('red', source(s, 'earth', 'red')), null);
  run(s, br, { actions: [{ type: 'move', target: F.points.red.transferBR }, { type: 'return', objectId: b.id }] });
  assert.equal(s.stock('red').filter(o => o.type === 'earth').length, 3);
});

test('return rejects wrong role, location, ownership, full typed stack and Mustika', () => {
  const { s, tr, br } = world(), held = hold(s, br, 'earth'), a = { type: 'return', objectId: held.id };
  assert.equal(s.validate(br, a).ok, false); Object.assign(br, F.points.red.transferBR);
  assert.equal(s.validate(br, a).ok, true); assert.equal(s.validate(tr, a).ok, false);
  assert.equal(s.validate(s.robot('blueBR'), a).ok, false);
  assert.equal(s.validate(br, { ...a, objectId: 'red-E20' }).ok, false);
  for (let layer = 0; layer < F.stockLimits.earth; layer++) {
    const o = source(s, 'earth', 'red'), slot = F.slots('red')[0];
    Object.assign(o, { location: 'transfer', transferTeam: 'red', slot: slot.id, x: slot.x, y: slot.y, layer, z: .6 + .35 * layer });
  }
  assert.equal(s.validate(br, a).ok, false);
  hold(s, br, 'mustika'); assert.equal(s.validate(br, { type: 'return', objectId: 'M' }).ok, false);
});

test('two Sky blocks with only one suitable foundation are not accepted as a useful pair', () => {
  const { s, br } = world(); seed(s, 'u1', 2); stock(s, 'red', 'sky'); stock(s, 'red', 'sky');
  const decision = C.next(scan(s, br)); assert.ok(decision.wait > 0); assert.equal(decision.actions, undefined);
  stock(s, 'red', 'earth');
  const useful = C.next(scan(s, br)); assert.equal(useful.actions.filter(a => a.type === 'receive').length, 2);
  assert.deepEqual(useful.actions.filter(a => a.type === 'receive').map(a => s.object(a.objectId).type).sort(), ['earth', 'sky']);
});

test('failed placement scans in place for one second, then uses another nearby site without a home detour', () => {
  const { s, br } = world(); const a = hold(s, br, 'earth'); hold(s, br, 'earth'); scan(s, br);
  Object.assign(br, F.spotApproaches(F.spotById.u1, 'red')[0], { z: .9 });
  seed(s, 'u1', 3, 'blue'); const stale = JSON.stringify(br.observation);
  s.startJob(br, { type: 'place', objectId: a.id, spotId: 'u1' }); assert.ok(br.failure);
  const response = C.next(s.view(br)); assert.deepEqual(response.actions, [{ type: 'scan', local: true }]);
  br.brain = response.brain; const x = br.x, y = br.y; s.startJob(br, response.actions[0]);
  for (let i = 0; i < 10; i++) s.step(.05);
  assert.equal(JSON.stringify(br.observation), stale); assert.equal(br.x, x); assert.equal(br.y, y);
  while (br.job) s.step(.05);
  assert.ok(s.time >= 1 && s.time < 1.1); assert.equal(br.observation.local, true);
  assert.equal(br.observation.towers.u1.length, 3); assert.equal(br.localRescanAllowed, false);
  const alternate = C.next(s.view(br)); assert.ok(alternate.actions.some(a => a.type === 'place'));
  assert.equal(alternate.actions.some(a => a.type === 'move' && a.target.x === F.points.red.home.x && a.target.y === F.points.red.home.y), false);
  const began = s.time; run(s, br, alternate);
  assert.ok(Math.abs(s.time - began - alternate.decision.seconds) < .25);
});

test('failed Sky placement with no alternative returns directly from the local observation', () => {
  const { s, br } = world(), a = hold(s, br, 'sky'); hold(s, br, 'sky'); scan(s, br);
  Object.assign(br, F.spotApproaches(F.spotById.r2, 'red')[0]);
  s.startJob(br, { type: 'place', objectId: a.id, spotId: 'r2' });
  run(s, br, C.next(s.view(br))); const back = C.next(s.view(br));
  assert.deepEqual(back.actions[0].target, F.points.red.transferBR);
  assert.equal(back.actions.filter(a => a.type === 'return').length, 2); run(s, br, back);
  assert.equal(br.cargo.length, 0);
});

test('local observation is limited to failed work, and Retry revokes permission', () => {
  const { s, br } = world(); assert.equal(s.validate(br, { type: 'scan', local: true }).ok, false);
  Object.assign(br, F.spotApproaches(F.spotById.r2, 'red')[0]);
  s.startJob(br, { type: 'flip', spotId: 'r2' }); assert.equal(br.localRescanAllowed, true);
  assert.equal(s.relocateForRetry(br, 1).ok, true); assert.equal(br.localRescanAllowed, false);
  assert.equal(s.validate(br, { type: 'scan', local: true }).ok, false);
});

test('planner caches are bounded, clearable and isolated from changed settings and returned plans', () => {
  P.clearCache(); assert.deepEqual(P.cacheInfo(), { geometries: 0, routes: 0 });
  const { s, br } = world(); hold(s, br, 'earth'); hold(s, br, 'earth'); const v = scan(s, br);
  const first = P.plan(v, { requirePair: true }), baseline = JSON.stringify(first);
  first.state.cargo.length = 0; first.tasks[0].spotId = 'invalid';
  assert.equal(JSON.stringify(P.plan(v, { requirePair: true })), baseline);
  const slow = P.plan({ ...v, motion: { ...v.motion, speedFactor: .5 } }, { requirePair: true });
  assert.ok(slow.completeSeconds > JSON.parse(baseline).completeSeconds);
  for (let i = 0; i < 10; i++) P.travelTo({ ...v, motion: { ...v.motion, scanSeconds: i + 1 } }, F.points.red.transferBR);
  assert.ok(P.cacheInfo().geometries <= 6); assert.ok(P.cacheInfo().routes <= 6 * 512);
  P.clearCache(); assert.deepEqual(P.cacheInfo(), { geometries: 0, routes: 0 });
  assert.equal(JSON.stringify(P.plan(v, { requirePair: true })), baseline);
});

test('routes do not graze wall or stock corners between sampling points at different speeds', () => {
  for (const speed of [1, .75, .5, .25]) for (const scenario of ['wall', 'stock']) {
    const { s, tr } = world(scenario === 'wall' ? 'red' : 'blue', { redSpeed: speed, blueSpeed: speed });
    const target = scenario === 'wall' ? F.points.red.mustika : F.points.blue.transferTR;
    if (scenario === 'wall') Object.assign(tr, { x: 2.248939807862075, y: 2.262406901501908, z: 0 });
    else { stock(s, 'blue', 'earth'); Object.assign(tr, { x: 9.141015035748296, y: 6.976954892755113, z: .6 }); }
    const route = s.findPath(tr, target, true); assert.ok(route);
    let previous = tr;
    for (const point of route) {
      const n = Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) / .001);
      for (let i = 0; i <= n; i++) {
        const p = { x: previous.x + (point.x - previous.x) * i / n, y: previous.y + (point.y - previous.y) * i / n };
        assert.ok(s.footprintAllowed(tr, p)); assert.ok(s.obstacleFree(tr, p));
      }
      previous = point;
    }
    run(s, tr, { actions: [{ type: 'move', target }] });
    assert.ok(Math.hypot(tr.x - target.x, tr.y - target.y) < .01);
  }
});
