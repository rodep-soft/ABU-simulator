'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const S = require('../sim/engine.js'), C = require('../sim/controllers.js'), P = require('../sim/score-planner.js');
const { Diagnostics } = require('./transport-diagnostics.cjs');
const root = path.resolve(__dirname, '..'), args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
if (!args.includes('--out')) throw new Error('Use --out NEW_DIRECTORY');
const out = path.resolve(root, value('--out')); if (fs.existsSync(out)) throw new Error('Use a new output directory');
fs.mkdirSync(out, { recursive: true });
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceHashes = Object.fromEntries(fs.readdirSync(path.join(root, 'sim')).filter(f => f.endsWith('.js')).map(f => [f, hash(fs.readFileSync(path.join(root, 'sim', f)))]));
const fixtures = [1, .75, .5].map(blueSpeed => ({ id: 'gui-blue-' + blueSpeed, blueSpeed, redBrPlan: 'efficient' }))
  .concat({ id: 'earth-heavy', blueSpeed: 1, redBrPlan: 'l2-earth' });
const summary = { sourceHashes, timeStep: .05, rows: [] }, started = performance.now();
for (const fixture of fixtures) {
  P.clearCache(); S.clearTerrainCache(); const at = performance.now();
  const sim = new S.Simulation({ supplyMode: 'normal', brObservationMode: 'stopped', scanSeconds: 1, recordActions: true,
    redSpeed: 1, blueSpeed: fixture.blueSpeed, redBrPlan: fixture.redBrPlan, blueBrPlan: 'private-first-short',
    redTrPlan: 'adaptive', blueTrPlan: 'adaptive' });
  const diag = new Diagnostics(sim, C);
  while (!sim.ended) {
    diag.sample(.05); sim.step(.05, diag.controller);
    for (const r of sim.robots) assert.ok(S.blockCount(r.cargo, id => sim.object(id)) <= (r.role === 'BR' ? 2 : 3));
  }
  const events = sim.events, diagnostics = diag.finish(), first = (robot, action) => events.find(e => e.robot === robot && e.kind === 'action' && e.action === action)?.time ?? null;
  const byTeam = Object.fromEntries(['red', 'blue'].map(team => {
    const delivered = events.filter(e => e.robot === team + 'TR' && e.kind === 'action' && e.action === 'unload');
    const used = delivered.filter(d => events.some(e => e.robot === team + 'BR' && e.kind === 'action' && e.action === 'place' && e.objectId === d.objectId && e.time >= d.time));
    return [team, { sanctuary: sim.sanctuary[team], enshrine: first(team + 'BR', 'enshrine'), firstPlace: first(team + 'BR', 'place'),
      brContexts: diagnostics.robots[team + 'BR'].contexts, trCategories: diagnostics.robots[team + 'TR'].categories,
      trips: sim.robot(team + 'TR').transport.completed.map(t => ({ ...t, types: t.items.map(o => o.type) })),
      delivered: delivered.length, placedDeliveries: used.length, unusedDeliveries: delivered.length - used.length,
      finalCargo: sim.robot(team + 'TR').cargo }];
  }));
  const row = { ...fixture, scores: sim.scores(), byTeam,
    rejections: events.filter(e => ['rule', 'perception', 'physical', 'unsupported', 'unscored', 'policy'].includes(e.kind)),
    recoveries: events.filter(e => e.kind === 'recovery'), elapsedMs: performance.now() - at };
  fs.writeFileSync(path.join(out, fixture.id + '.json.gz'), zlib.gzipSync(JSON.stringify(sim.export())));
  fs.writeFileSync(path.join(out, fixture.id + '-diagnostics.json'), JSON.stringify(diagnostics));
  summary.rows.push(row); summary.elapsedMs = performance.now() - started;
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ id: row.id, scores: row.scores, teams: Object.fromEntries(Object.entries(byTeam).map(([team, t]) => [team,
    { firstPlace: t.firstPlace, sanctuary: t.sanctuary, enshrine: t.enshrine, brContexts: t.brContexts, delivered: t.delivered, unused: t.unusedDeliveries }])) }));
}
for (const [file, checksum] of Object.entries(sourceHashes)) assert.equal(hash(fs.readFileSync(path.join(root, 'sim', file))), checksum);
console.log(JSON.stringify({ out, elapsedMs: summary.elapsedMs, matches: summary.rows.length }));
