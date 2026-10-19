'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const F = require('../sim/field.js'), S = require('../sim/engine.js'), C = require('../sim/controllers.js');
const P = require('../sim/score-planner.js'), { Diagnostics } = require('./transport-diagnostics.cjs');
const root = path.resolve(__dirname, '..');
const options = { out: 'results/transport-study-' + Date.now(), speeds: '1,0.75,0.5' };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (!Object.hasOwn(options, key) || !process.argv[i + 1]) throw new Error('Use --out PATH --speeds 1,0.75,0.5');
  options[key] = process.argv[i + 1];
}
const speeds = [...new Set(options.speeds.split(',').map(Number))];
if (!speeds.length || speeds.some(s => ![1, .75, .5].includes(s))) throw new Error('Unsupported speed');
const output = path.resolve(root, options.out);
if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Use a new output directory');
fs.mkdirSync(output, { recursive: true });
const hash = x => createHash('sha256').update(x).digest('hex');
const files = fs.readdirSync(path.join(root, 'sim')).filter(n => n.endsWith('.js')).map(n => 'sim/' + n)
  .concat(['tools/compare-transport.cjs', 'tools/transport-diagnostics.cjs']);
const hashes = Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
const ids = ['private-first-short', 'private-first-short-l2-defense', 'private-first-short-flexible'];
const labels = ['後半V2', 'L2防衛', '全エリア・点差対応'];
const first = (events, robot, action, pred = () => true) => events.find(e => e.robot === robot && e.kind === 'action' && e.action === action && pred(e))?.time ?? null;
const rows = [], started = performance.now();
for (const redSpeed of speeds) {
  let control;
  for (const [i, redBrPlan] of ids.entries()) {
    P.clearCache(); const begin = performance.now();
    const sim = new S.Simulation({ supplyMode: 'normal', brObservationMode: 'stopped', scanSeconds: 1,
      maxSpeed: 7, acceleration: 3.5, redSpeed, blueSpeed: 1, redTrPlan: 'adaptive', blueTrPlan: 'adaptive',
      redBrPlan, blueBrPlan: 'tactical-baseline-v2', recordActions: true });
    const observer = new Diagnostics(sim, C);
    while (!sim.ended) {
      observer.sample(.05); sim.step(.05, observer.controller);
      for (const r of sim.robots) assert.ok(S.blockCount(r.cargo, id => sim.object(id)) <= (r.role === 'BR' ? 2 : 3));
    }
    const diagnostics = observer.finish();
    for (const r of Object.values(diagnostics.robots)) assert.ok(Math.abs(Object.values(r.categories).reduce((a, b) => a + b, 0) - 180) < .011);
    const events = sim.events, enshrine = first(events, 'redBR', 'enshrine');
    const prefix = events.filter(e => e.time <= (enshrine ?? 180)).map(e => e.robot === 'redBR' && ids.includes(e.decision?.strategy)
      ? { ...e, decision: { ...e.decision, strategy: ids[0] } } : e);
    const scores = sim.scores(), byTeam = {};
    for (const team of ['red', 'blue']) byTeam[team] = {
      sanctuary: sim.sanctuary[team], pickup: first(events, team + 'TR', 'pickup', e => e.objectId === 'M'),
      receive: first(events, team + 'BR', 'receive', e => e.objectId === 'M'), enshrine: first(events, team + 'BR', 'enshrine'),
      deliveries: events.filter(e => e.robot === team + 'TR' && e.action === 'unload' && e.kind === 'action'),
      placements: events.filter(e => e.robot === team + 'BR' && e.kind === 'action' && ['place', 'flip', 'enshrine'].includes(e.action))
        .map(e => ({ time: e.time, action: e.action, number: F.spotNumbers[e.spotId] || null, type: e.objectType, objectId: e.objectId })),
      categories: { TR: diagnostics.robots[team + 'TR'].categories, BR: diagnostics.robots[team + 'BR'].categories },
      contexts: { TR: diagnostics.robots[team + 'TR'].contexts, BR: diagnostics.robots[team + 'BR'].contexts }
    };
    const row = { strategy: redBrPlan, label: labels[i], redSpeed, scores,
      difference: scores.red.total - scores.blue.total, byTeam, enshrine, prefixHash: hash(JSON.stringify(prefix)),
      recoveries: events.filter(e => e.kind === 'recovery'),
      rejections: events.filter(e => ['rule', 'perception', 'physical', 'unsupported', 'unscored', 'policy'].includes(e.kind)),
      perSpot: F.spots.map(p => ({ number: F.spotNumbers[p.id], layers: sim.tower(p.id).map(o => ({ type: o.type, team: o.placedBy, color: o.color })) })).sort((a, b) => a.number - b.number),
      finalRobots: sim.snapshot().robots, elapsedMs: +(performance.now() - begin).toFixed(2) };
    if (!control) control = { prefix, enshrine };
    else { assert.equal(enshrine, control.enshrine); assert.deepEqual(prefix, control.prefix, 'Pre-enshrinement behavior must match'); }
    const stem = redBrPlan + '-speed-' + redSpeed;
    fs.writeFileSync(path.join(output, stem + '.json.gz'), zlib.gzipSync(JSON.stringify({ result: row, match: sim.export() })));
    fs.writeFileSync(path.join(output, stem + '-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    rows.push(row);
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ options, timeStep: .05, hashes, elapsedMs: performance.now() - started, rows }, null, 2));
    console.log(JSON.stringify({ strategy: row.label, redSpeed, scores, enshrine, sanctuary: sim.sanctuary, elapsedMs: row.elapsedMs }));
  }
}
for (const file of files) assert.equal(hash(fs.readFileSync(path.join(root, file))), hashes[file], 'Sources changed while running');
console.log(JSON.stringify({ output, matches: rows.length, elapsedMs: performance.now() - started }));
