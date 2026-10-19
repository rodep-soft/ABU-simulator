const test = require('node:test'), assert = require('node:assert/strict');
const { Diagnostics, category, context } = require('../../tools/transport-diagnostics.cjs');
const S = require('../engine.js'), C = require('../controllers.js'), P = require('../score-planner.js');
test('diagnostics distinguish movement collision, manipulation competition and ordinary waits', () => {
  assert.equal(category({ status: '同時操作の競合', wait: .5 }), 'manipulation-conflict');
  assert.equal(category({ job: { type: 'move' }, trCollisionStall: { since: 2 } }), 'opposing-tr-collision');
  assert.equal(category({ job: { type: 'move' }, wait: .6, status: '段差で姿勢合わせ' }), 'terrain-pause');
  assert.equal(category({ job: { type: 'unload' } }), 'unload');
  assert.equal(context({ status: 'BR受取中 · 積み増し待機' }), 'tr-br-clearance');
  assert.equal(context({ brain: { privateFirst: { phase: 'supply' } } }), 'br-box-supply');
});
test('read-only observer preserves exact competitive state, events and category accounting', () => {
  const config = { supplyMode: 'normal', redBrPlan: 'private-first-short', blueBrPlan: 'tactical-baseline-v2', recordActions: true };
  P.clearCache(); const normal = new S.Simulation(config);
  while (!normal.ended) normal.step(.05, C);
  P.clearCache(); const measured = new S.Simulation(config), observer = new Diagnostics(measured, C);
  while (!measured.ended) { observer.sample(.05); measured.step(.05, observer.controller); }
  assert.deepEqual(measured.export(), normal.export());
  const result = observer.finish();
  for (const robot of Object.values(result.robots)) {
    assert.ok(Math.abs(Object.values(robot.categories).reduce((a, b) => a + b, 0) - 180) < .011);
    assert.equal(robot.segments[0].start, 0); assert.equal(robot.segments.at(-1).end, 180);
  }
  assert.ok(result.decisions.some(d => d.robot === 'redBR' && d.context === 'br-box-supply'));
});
