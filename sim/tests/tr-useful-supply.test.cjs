const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../engine.js'), F = require('../field.js'), C = require('../controllers.js'), E = require('../efficient-strategy.js');
function scenario(team = 'red', time = 130, config = {}) {
  const sim = new S.Simulation({ supplyMode: 'normal', brObservationMode: 'stopped', ...config });
  sim.time = time;
  const tr = sim.robot(team + 'TR'), br = sim.robot(team + 'BR');
  Object.assign(tr, F.points[team].transferTR, { brain: { stage: 'collect', manifest: { earth: 2, sky: 1 }, trip: 0 } });
  Object.assign(br, F.points[team].transferBR, { enteredL1: true });
  sim.observe(tr); const v = sim.view(tr);
  v.observation.sanctuary = true;
  v.observation.pillar = { id: 'M', location: 'pillar', placedBy: team };
  v.observation.source = v.observation.source.filter(o => o.id !== 'M');
  const earth = v.observation.source.filter(o => o.type === 'earth').sort((a, b) => b.y - a.y)[0];
  const sky = v.observation.source.find(o => o.type === 'sky' && (team === 'red' ? o.x < 5.49 : o.x > 5.51));
  v.observation.towers = Object.fromEntries(F.spots.filter(p => !p.team || p.team === team).map(p => [p.id,
    [earth, earth, sky].map((o, layer) => ({ ...o, id: p.id + '-' + layer, location: 'spot', spotId: p.id,
      x: p.x, y: p.y, z: (p.level === 2 ? .9 : .6) + layer * .35, layer, touchedBy: null, placedBy: team, color: team }))]));
  const id = team === 'red' ? 'u3' : 'u4';
  v.observation.towers[id].pop();
  return { sim, tr, br, v, id, earth, sky };
}
const pickup = r => r.actions?.find(a => a.type === 'pickup');
test('TR prefers a usable Sky completion over more Earth in both colors without reading the BR strategy', () => {
  for (const team of ['red', 'blue']) {
    const { v, earth, sky } = scenario(team);
    assert.deepEqual(E.usableSupply(v, earth).used, []);
    const use = E.usableSupply(v, sky);
    assert.ok(use.used.includes(sky.id)); assert.ok(use.tasks.every(t => t.at < 180));
    assert.equal(v.observation.source.find(o => o.id === pickup(C.next(v)).objectId).type, 'sky');
    assert.deepEqual(C.next(v), C.next({ ...v, brPlan: 'unknown-private-controller', brTurnPlan: { secret: true } }));
  }
});
test('Earth enabling a stock Sky completion is valued while another surplus Sky is not', () => {
  const { v, id, earth, sky } = scenario();
  v.observation.towers[id].pop();
  const slot = F.slots('red').find(s => s.type === 'sky');
  v.observation.stock.push({ ...sky, ...slot, id: 'existing-sky', slot: slot.id, layer: 0, z: .6, location: 'transfer', transferTeam: 'red', touchedBy: null });
  const use = E.usableSupply(v, earth);
  assert.ok(use.used.includes(earth.id)); assert.ok(use.gain >= 120);
  assert.deepEqual(E.usableSupply(v, sky).used, []);
  assert.equal(v.observation.source.find(o => o.id === pickup(C.next(v)).objectId).type, 'earth');
});
test('a box can fit the delivery deadline yet be refused when BR cannot receive and place it before 180', () => {
  const { v, sky } = scenario('red', 165);
  Object.assign(v, C.sourceApproach(sky, 'red'));
  assert.ok(E.deliveryBudget(v, sky).fits);
  assert.deepEqual(E.usableSupply(v, sky).used, []);
  const result = C.next(v); assert.ok(!pickup(result)); assert.match(result.status, /BRが使える追加箱なし|終盤締切/);
});
test('BR known motion, scans, fixed observation and cargo capacity all affect the hypothetical workload', () => {
  const { v, sky, earth } = scenario('red', 145);
  const use = E.usableSupply(v, sky); assert.ok(use.used.length);
  const slow = { ...v, partnerMotion: { ...v.partnerMotion, speedFactor: .25 } };
  assert.ok(!E.usableSupply(slow, sky).used.length);
  const scan = { ...v, partnerMotion: { ...v.partnerMotion, scanSeconds: 30 } };
  assert.ok(!E.usableSupply(scan, sky).used.length);
  const fixed = E.usableSupply({ ...v, partnerObservation: { mode: 'fixed', replan: 'sortie' } }, sky);
  assert.ok(!fixed.used.length || fixed.tasks[0].at >= use.tasks[0].at);
  const full = structuredClone(v); full.observation.partner.cargo = [earth, { ...earth, id: 'carried-2' }];
  assert.deepEqual(E.usableSupply(full, sky).used, []);
});
test('missing or stale observations and Mustika handoff never manufacture a known box forecast', () => {
  const { v, sky } = scenario();
  for (const key of ['partner', 'stock']) {
    const partial = { ...v, observation: { ...v.observation, visibility: { entries: { partner: { status: 'current' }, stock: { status: 'current' }, [key]: { status: 'stale' } } } } };
    assert.equal(E.usableSupply(partial, sky).known, false);
  }
  const partial = structuredClone(v);
  partial.observation.visibility = { entries: { partner: { status: 'current' }, stock: { status: 'current' } } };
  assert.deepEqual(E.usableSupply(partial, sky).used, []);
  partial.observation.partner.cargo = [{ id: 'M', type: 'mustika' }];
  assert.equal(E.usableSupply(partial, sky).known, false);
  assert.equal(E.usableSupply({ ...v, partnerMotion: undefined }, sky).known, false);
});
test('forecasts are bounded, immutable and unchanged by hidden BR commands or later world changes', () => {
  const { sim, br, v, sky } = scenario(); const before = JSON.stringify(v);
  const use = E.usableSupply(v, sky), selected = C.next(v);
  br.queue = [{ type: 'place', spotId: 'u1' }]; br.brain = { secret: 'u2' }; br.job = { type: 'wait', remaining: 50 };
  sim.objects.forEach(o => { o.location = 'removed'; });
  assert.deepEqual(E.usableSupply(v, sky), use); assert.deepEqual(C.next(v), selected); assert.equal(JSON.stringify(v), before);
  assert.ok(use.tasks.length <= 6);
  assert.ok(!['brain', 'queue', 'job', 'eta', 'destination', 'request'].some(k => Object.hasOwn(v.observation.partner, k)));
});
test('partner timing is pre-match configuration, never live action duration or plan', () => {
  const { sim, tr, br } = scenario('red', 130, { robotTiming: { redBR: { maxSpeed: 2, receive: 4, place: 6 } } });
  const v = sim.view(tr); assert.equal(v.partnerMotion.maxSpeed, 2); assert.equal(v.partnerMotion.actionSeconds.receive, 4);
  assert.equal(v.partnerMotion.actionSeconds.place, 6);
  br.job = { type: 'place', remaining: 60, seconds: 60 }; br.queue = [{ type: 'wait', seconds: 90 }];
  assert.deepEqual(sim.view(tr).partnerMotion, v.partnerMotion);
  assert.equal(sim.view(br).partnerMotion, undefined);
});
test('the narrower time reserve remains explicit, while pre-120 and specified trips keep their collection rules', () => {
  const { v, sky } = scenario();
  const b = E.deliveryBudget(v, sky);
  assert.ok(Math.abs(b.reserve - (.1 + .02 * b.travel + .5)) < 1e-8);
  assert.ok(b.reserve < 1 + .25 * b.travel + 2);
  assert.equal(v.observation.source.find(o => o.id === pickup(C.next({ ...v, time: 119 })).objectId).type, 'earth');
  const explicit = C.next({ ...v, time: 179, trTrips: [['earth', 'earth', 'earth']] });
  assert.ok(pickup(explicit)); assert.equal(explicit.supplyAssessment, undefined);
});
