const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const S = require('../sim/engine.js'), C = require('../sim/controllers.js'), P = require('../sim/score-planner.js');
const args = process.argv.slice(2), option = key => args[args.indexOf(key) + 1];
if (!args.includes('--out')) throw new Error('Specify a new --out directory');
const output = path.resolve(option('--out')), against = args.includes('--against') ? path.resolve(option('--against')) : null;
if (fs.existsSync(output)) throw new Error('Output directory already exists');
fs.mkdirSync(output, { recursive: true });
const results = [];
for (const supplyMode of ['normal', 'ideal']) {
  P.clearCache(); S.clearTerrainCache?.();
  const sim = new S.Simulation({ brObservationMode: 'stopped', supplyMode, blueBrPlan: 'private-first-short',
    redTrPlan: 'adaptive', blueTrPlan: 'adaptive', recordActions: true });
  const decisions = [], steps = [];
  const controller = { next(view) {
    const start = performance.now(), response = C.next(view);
    decisions.push({ robot: view.id, time: view.time, ms: performance.now() - start }); return response;
  } };
  const start = performance.now();
  while (!sim.ended) { const at = performance.now(); sim.step(.05, controller); steps.push(performance.now() - at); }
  const elapsedMs = performance.now() - start, data = sim.export(), serialized = JSON.stringify(data);
  let identical = null;
  if (against) {
    const previous = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(against, supplyMode + '.json.gz'))));
    assert.ok(serialized === JSON.stringify(previous), supplyMode + ': events, all frames and final state must match'); identical = true;
  }
  fs.writeFileSync(path.join(output, supplyMode + '.json.gz'), zlib.gzipSync(serialized));
  const sorted = [...steps].sort((a, b) => a - b);
  const record = { supplyMode, elapsedMs, scores: sim.scores(), identical, steps: steps.length, decisions: decisions.length,
    p95StepMs: sorted[Math.floor(sorted.length * .95)], maxStepMs: sorted.at(-1),
    longestDecisions: decisions.sort((a, b) => b.ms - a.ms).slice(0, 12),
    hash: crypto.createHash('sha256').update(serialized).digest('hex') };
  results.push(record); console.log(JSON.stringify(record));
}
fs.writeFileSync(path.join(output, 'measurement.json'), JSON.stringify({ against, results }, null, 2));
