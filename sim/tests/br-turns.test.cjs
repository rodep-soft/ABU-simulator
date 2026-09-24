const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation } = require('../engine.js');
const F = require('../field.js');
const C = require('../controllers.js');
function world() {
  const s = new Simulation({ redBrTurns: ['l2-earth', 'mustika-fast'], redBrPlan: 'endgame' });
  s.robots.forEach(r => { r.auto = false; });
  const br = s.robot('redBR');
  Object.assign(br, F.points.red.home, { z: .6, enteredL1: true, brain: { stage: 'choose' } });
  return { s, br };
}
function run(s, br, actions) {
  s.enqueue(br.id, actions);
  for (let i = 0; i < 3600 && (br.queue.length || br.job); i++) s.step(.05);
  assert.equal(br.failure, null); assert.equal(br.queue.length, 0); assert.equal(br.job, null);
}
function scan(s, br) { run(s, br, [{ type: 'move', target: F.scanPoint(br.team, br) }, { type: 'scan' }]); }
function hold(s, br) {
  const o = s.objects.find(o => o.type === 'earth' && o.team === br.team && o.location === 'source');
  Object.assign(o, { location: 'cargo', holder: br.id, touchedBy: br.id }); br.cargo.push(o.id); s.changed(); return o;
}
function place(s, br, o, spotId = 'u1') {
  run(s, br, [{ type: 'move', target: F.spotApproaches(F.spotById[spotId], br.team)[0] }, { type: 'place', objectId: o.id, spotId }]);
}
test('turn settings are independent copies, with base strategy after the specified sequence', () => {
  const config = { redBrTurns: ['l2-earth'], redBrPlan: 'endgame', blueBrTurns: ['basic'] }, s = new Simulation(config);
  config.redBrTurns.push('basic'); assert.deepEqual(s.config.redBrTurns, ['l2-earth']);
  assert.equal(s.view(s.robot('redBR')).brPlan, 'l2-earth');
  assert.equal(s.view(s.robot('redTR')).brPlan, 'l2-earth');
  assert.equal(s.view(s.robot('blueBR')).brPlan, 'basic');
  assert.deepEqual(new Simulation().config.redBrTurns, []);
});
test('scans and partial two-block work do not consume a turn; finished work switches at the next home scan', () => {
  const { s, br } = world(); const a = hold(s, br), b = hold(s, br);
  scan(s, br); scan(s, br); assert.equal(s.brStrategy('red'), 'l2-earth');
  place(s, br, a); assert.equal(s.brStrategy('red'), 'l2-earth');
  scan(s, br); assert.equal(br.brTurn.completed, 0);
  place(s, br, b); assert.equal(s.brStrategy('red'), 'l2-earth');
  scan(s, br);
  assert.equal(br.brTurn.completed, 1); assert.equal(s.brStrategy('red'), 'mustika-fast');
  assert.equal(s.view(s.robot('redTR')).brPlan, 'mustika-fast');
  const c = hold(s, br); scan(s, br); place(s, br, c, 'r2'); scan(s, br);
  assert.equal(s.brStrategy('red'), 'endgame'); assert.equal(br.brTurn.completed, 2);
  assert.deepEqual(s.events.filter(e => e.action === 'br-turn-complete').map(e => [e.turn, e.strategy, e.nextStrategy]), [[1, 'l2-earth', 'mustika-fast'], [2, 'mustika-fast', 'endgame']]);
});
test('Retry, rejected work and local recovery keep the current strategy and progress', () => {
  const { s, br } = world(); const a = hold(s, br), b = hold(s, br);
  scan(s, br); place(s, br, a);
  assert.equal(s.relocateForRetry(br, 1).ok, true);
  assert.equal(br.brTurn.completed, 0); assert.equal(br.brTurn.worked, true); assert.deepEqual(br.cargo, [b.id]);
  scan(s, br); place(s, br, b);
  s.startJob(br, { type: 'flip', spotId: 'u1' });
  assert.ok(br.failure); assert.equal(br.brTurn.completed, 0);
  run(s, br, [{ type: 'scan', local: true }]);
  assert.equal(br.brTurn.completed, 0); assert.equal(s.brStrategy('red'), 'l2-earth');
  scan(s, br); assert.equal(br.brTurn.completed, 1);
});
test('a series of empty-handed flips counts as one turn, not one per flipped Sky', () => {
  const { s, br } = world(); let earth = 0, sky = 0;
  for (const id of ['u1', 'u2']) {
    const p = F.spotById[id];
    for (let layer = 0; layer < 3; layer++) {
      const o = s.object(layer < 2 ? `blue-E${++earth}` : `S${++sky}`);
      Object.assign(o, { location: 'spot', spotId: id, layer, placedBy: 'blue', color: layer === 2 ? 'blue' : null, x: p.x, y: p.y, z: .9 + layer * .35 });
    }
  }
  s.changed(); scan(s, br);
  for (const id of ['u1', 'u2']) {
    run(s, br, [{ type: 'move', target: F.spotApproaches(F.spotById[id], 'red')[0] }, { type: 'flip', spotId: id }]);
    assert.equal(br.brTurn.completed, 0);
  }
  scan(s, br); assert.equal(br.brTurn.completed, 1);
});
test('without a schedule existing strategies do not gain turn events', () => {
  const { s, br } = world(); s.config.redBrTurns = [];
  const a = hold(s, br); scan(s, br); place(s, br, a); scan(s, br);
  assert.equal(br.brTurn, undefined);
  assert.ok(!s.events.some(e => e.action === 'br-turn-complete'));
});
test('real 180-second scheduled match switches policies only between completed sorties', () => {
  const s = new Simulation({ redTrPlan: 'stock-e3', redBrTurns: ['l2-earth', 'mustika-fast'], redBrPlan: 'earth-late' });
  s.robots.filter(r => r.team === 'blue').forEach(r => { r.auto = false; });
  while (!s.ended) s.step(.05, C);
  const places = s.events.filter(e => e.robot === 'redBR' && e.kind === 'action' && e.action === 'place');
  assert.ok(places.slice(0, 2).length === 2 && places.slice(0, 2).every(e => F.spotById[e.spotId].level === 2 && e.objectType === 'earth'));
  assert.equal(s.time, 180);
  const completed = s.events.filter(e => e.action === 'br-turn-complete');
  assert.ok(completed.length >= 2); assert.equal(completed[0].nextStrategy, 'mustika-fast'); assert.equal(completed[1].nextStrategy, 'earth-late');
  const decisions = s.events.filter(e => e.robot === 'redBR' && e.kind === 'plan');
  for (const [start, end, policy] of [[0, completed[0].time, 'l2-earth'], [completed[0].time, completed[1].time, 'mustika-fast'], [completed[1].time, 180, 'earth-late']]) {
    const batch = decisions.filter(e => e.time >= start && e.time < end);
    assert.ok(batch.length); assert.ok(batch.every(e => e.decision.strategy === policy));
  }
  const output = s.export(); assert.deepEqual(output.config.redBrTurns, ['l2-earth', 'mustika-fast']);
  assert.ok(output.history.some(frame => frame.robots.find(r => r.id === 'redBR').brTurn?.completed === 1));
});
