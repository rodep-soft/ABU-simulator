// Bounded Windows smoke comparison, not an evolutionary search or WSL parity test.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Simulation, blockCount } = require('../engine.js');
const C = require('../controllers.js');
const output = path.resolve(__dirname, '../../results', `baseline-v2-comparison-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const results = [];
for (const supplyMode of ['normal', 'ideal']) for (const candidateTeam of ['red', 'blue']) {
  const config = { supplyMode, redBrPlan: 'mustika-fast', blueBrPlan: 'mustika-fast',
    redTrPlan: 'stock-e3', blueTrPlan: 'stock-e3', redSpeed: 1, blueSpeed: 1,
    redTrTrips: [['earth', 'earth', 'sky'], ['earth', 'earth', 'sky']],
    blueTrTrips: [['earth', 'earth', 'sky'], ['earth', 'earth', 'sky']],
    brObservationMode: 'stopped', brObservation: { model: 'level-radius', crossLevelRadius: 3, replan: 'after-work' },
    trMustikaPickupSignal: 'global-instant' };
  config[candidateTeam + 'BrPlan'] = 'tactical-baseline-v2';
  const s = new Simulation(config), start = performance.now();
  while (!s.ended) {
    s.step(.05, C);
    for (const r of s.robots) assert.ok(blockCount(r.cargo, id => s.object(id)) <= (r.role === 'BR' ? 2 : 3));
  }
  assert.equal(s.events.some(e => e.kind === 'policy'), false);
  for (const team of ['red', 'blue']) assert.ok(s.events.some(e => e.robot === team + 'BR' && e.kind === 'action' && e.action === 'place'));
  const scores = s.scores(), rival = candidateTeam === 'red' ? 'blue' : 'red';
  const result = { supplyMode, candidateTeam, scores, difference: scores[candidateTeam].total - scores[rival].total,
    sanctuary: s.sanctuary, mustika: s.events.filter(e => e.kind === 'action' && (e.objectId === 'M' || e.action === 'enshrine')),
    elapsedMs: performance.now() - start };
  fs.writeFileSync(path.join(output, `${supplyMode}-${candidateTeam}.json`), JSON.stringify({ result, export: s.export() }));
  results.push(result); console.log(JSON.stringify(result));
}
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ timeStep: .05, note: 'Four finite Windows conditions, not a general win-rate estimate.', results }, null, 2));
console.log(JSON.stringify({ output }));
