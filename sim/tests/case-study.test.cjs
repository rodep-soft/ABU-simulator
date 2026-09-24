const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../../tools/case-study-core.cjs');
const Cache = require('../../tools/case-study-cache.cjs');
const S = require('../engine.js');
const F = require('../field.js');

test('finite study covers all fifty profiles and all ordered pairs at five speed conditions', () => {
  assert.equal(Core.profiles().length, 50);
  const cases = Core.scenarios(); assert.equal(cases.length, 12500); assert.equal(new Set(cases.map(s => s.id)).size, 12500);
  for (const [r, b] of [[1, 1], [.75, 1], [1, .75], [.5, 1], [1, .5]]) assert.equal(cases.filter(s => s.config.redSpeed === r && s.config.blueSpeed === b).length, 2500);
});
test('victory uses score then Mustika then Sky, and never invents a referee tiebreak', () => {
  const red = { total: 400, mustika: 0, sky: 2 }, blue = { total: 395, mustika: 250, sky: 3 };
  assert.equal(Core.verdict({ red, blue }).winner, 'red');
  blue.total = 400; assert.equal(Core.verdict({ red, blue }).reason, 'mustika-tiebreak');
  blue.mustika = 0; assert.equal(Core.verdict({ red, blue }).reason, 'sky-tiebreak');
  red.sky = 3; assert.equal(Core.verdict({ red, blue }).winner, null);
});
test('a Mustika alone is not a guaranteed win; a sufficiently protected point floor can be', () => {
  const s = new S.Simulation();
  Object.assign(s.object('M'), { location: 'pillar', placedBy: 'red', touchedBy: null }); s.sanctuary.red = 0;
  assert.equal(Core.secureBounds(s, 'red').floor, 250); assert.equal(Core.secureBounds(s, 'red').guaranteed, false);
  s.transferPoints.red = 160;
  let e = 0, sky = 0;
  for (const p of F.spots.filter(p => p.team !== 'blue')) {
    for (let layer = 0; layer < 2; layer++) Object.assign(s.object(`red-E${++e}`), { location: 'spot', spotId: p.id, layer, placedBy: 'red', touchedBy: null });
    if (p.team === 'red') Object.assign(s.object(`S${++sky}`), { location: 'spot', spotId: p.id, layer: 2, color: 'red', placedBy: 'red', touchedBy: null });
  }
  const bound = Core.secureBounds(s, 'red'); assert.equal(bound.floor, 850); assert.equal(bound.ceiling, 700); assert.ok(bound.guaranteed);
});
test('headless cached study preserves every event, score and final state of an ordinary full match', () => {
  const spec = Core.scenarios().find(s => s.red === 'T5B5' && s.blue === 'T5B6' && s.config.redSpeed === 1 && s.config.blueSpeed === 1);
  Cache.uninstall();
  const original = Core.run(spec, { cache: false, frames: true });
  const cached = Core.run(spec);
  assert.deepEqual(cached.summary, original.summary);
  assert.deepEqual(cached.detail, original.detail);
  assert.ok(original.frames.history.length >= 360);
  assert.equal(cached.frames, null);
  Cache.uninstall();
});
