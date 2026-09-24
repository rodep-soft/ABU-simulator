const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { Simulation, distance, completedTowers } = require('../sim/engine.js');
const F = require('../sim/field.js');
const C = require('../sim/controllers.js');
const efficient = process.argv.includes('--efficient');
const modes = process.argv.includes('--modes');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'results', `efficiency-audit-${new Date().toISOString().replace(/[:.]/g, '-')}`));
fs.mkdirSync(output, { recursive: false });
const round = n => Math.round(n * 100) / 100;
const clone = value => JSON.parse(JSON.stringify(value));
const counts = objects => Object.fromEntries(['earth', 'sky', 'mustika'].map(type => [type, objects.filter(o => o.type === type).length]));
const robotState = (s, r) => ({ x: r.x, y: r.y, cargo: counts(r.cargo.map(id => s.object(id))), cargoIds: [...r.cargo],
  job: clone(r.job), queue: clone(r.queue), stage: r.brain.stage, status: r.status, deliveries: r.transport.completed.length });
function completionDistance(towers, team) {
  const options = F.spots.filter(p => !p.team || p.team === team).map(p => {
    const t = towers[p.id] || [];
    const complete = t.length === 3 && t[2].type === 'sky' && t[2].color === team && t.every(o => !o.touchedBy);
    return { id: p.id, shared: !p.team, cost: complete ? 0 : t.length >= 2 ? 1 : 3 - t.length };
  });
  let best = Infinity;
  for (const a of options) for (const b of options) if (a.id !== b.id && (a.shared || b.shared)) best = Math.min(best, a.cost + b.cost);
  return best;
}
function auditScenario(spec) {
  const s = new Simulation(spec.config), decisions = [], starts = [], milestones = {}, time = {};
  for (const r of s.robots) time[r.id] = { moving: 0, scan: 0, handling: 0, blocked: 0, stairPause: 0, moveGap: 0, idle: 0, retry: 0 };
  const samples = Object.fromEntries(['red', 'blue'].map(team => [team, { fullStockSeconds: 0, unloadBlockedSeconds: 0, mustikaUnloadBlockedSeconds: 0, handoffWaitSeconds: 0, stockSamples: [] }]));
  const originalStart = s.startJob.bind(s);
  s.startJob = (r, action) => {
    const before = robotState(s, r); originalStart(r, action);
    starts.push({ time: s.time, robot: r.id, action: clone(action), accepted: !!r.job, before,
      routeMetres: r.job?.route ? round(r.job.route.reduce((acc, p, i, list) => acc + distance(i ? list[i - 1] : r, p), 0)) : null });
  };
  const controllers = { next(v) {
    const response = C.next(v);
    if ((efficient || modes) && v.role === 'BR' && v.brain.stage !== 'local-plan' && response.actions?.some(a => a.type === 'place')) {
      assert.equal(v.cargo.length, 2, `${spec.id}: one-block construction departure at ${s.time}`);
      assert.equal(response.actions.filter(a => a.type === 'place').length, 2, `${spec.id}: incomplete two-block plan`);
    }
    decisions.push({ time: s.time, robot: v.id, cargo: counts(v.cargo), cargoIds: v.cargo.map(o => o.id), stage: v.brain.stage,
      observationAt: v.observation?.at, observedStock: clone(v.observation?.stock || []),
      observedSanctuary: v.observation?.sanctuary || false,
      observedStepsToMandate: v.observation ? completionDistance(v.observation.towers, v.team) : null,
      response: clone(response) });
    return response;
  } };
  while (!s.ended) {
    const previous = s.robots.map(r => ({ id: r.id, x: r.x, y: r.y, job: r.job?.type, wait: r.wait, status: r.status, stall: !!r.stall, retry: !!r.retryPending }));
    const eventStart = s.events.length;
    s.step(.05, controllers);
    const newEvents = s.events.slice(eventStart);
    assert.equal(new Set(s.objects.map(o => o.id)).size, 53);
    for (const r of s.robots) {
      assert.ok(r.cargo.length <= (r.role === 'TR' ? 3 : 2));
      assert.ok(s.footprintAllowed(r, r), `${r.id}: illegal body position`);
      for (const id of r.cargo) { assert.equal(s.object(id).holder, r.id); assert.equal(s.object(id).location, 'cargo'); }
    }
    assert.notEqual(s.object('M').location, 'transfer');
    for (const team of ['red', 'blue']) for (const slot of F.slots(team)) {
      const stack = s.stock(team).filter(o => o.slot === slot.id);
      assert.ok(stack.length <= slot.maxLayers); assert.ok(stack.every(o => o.type === slot.type));
    }
    for (const e of newEvents.filter(e => e.kind === 'action' && e.action === 'pickup' && e.objectId === 'M')) {
      const team = s.robot(e.robot).team, evidence = e.sanctuaryEvidence;
      assert.ok(evidence && evidence.at <= e.time);
      const towers = completedTowers(id => evidence.towers.find(t => t.id === id)?.objects || [], team);
      assert.ok(towers.length >= 2 && towers.some(p => !p.team), `${spec.id}: invalid Mustika eligibility`);
    }
    for (const r of s.robots) {
      const before = previous.find(p => p.id === r.id), job = before.job || r.job?.type;
      const retried = newEvents.some(e => e.robot === r.id && e.action === 'retry');
      const category = retried || before.retry ? 'retry' : distance(before, r) > 1e-7 ? 'moving'
        : job === 'scan' ? 'scan' : ['pickup', 'unload', 'receive', 'return', 'place', 'flip', 'recover', 'enshrine'].includes(job) ? 'handling'
          : before.stall || r.stall || r.status.startsWith('障害物待ち') ? 'blocked'
            : before.wait > 0 && before.status === '段差で姿勢合わせ' ? 'stairPause' : job === 'move' ? 'moveGap' : 'idle';
      time[r.id][category] += .05;
    }
    for (const team of ['red', 'blue']) {
      const tr = s.robot(`${team}TR`), br = s.robot(`${team}BR`), metrics = samples[team];
      if (s.stock(team).length >= F.stockLimits.earth + F.stockLimits.sky) metrics.fullStockSeconds += .05;
      if (distance(tr, F.points[team].transferTR) < .14 && tr.cargo.includes('M')) metrics.handoffWaitSeconds += .05;
      if (distance(tr, F.points[team].transferTR) < .14 && tr.cargo.length && !tr.cargo.includes('M') && !s.freeSlot(team, s.object(tr.cargo[0]))) {
        metrics.unloadBlockedSeconds += .05;
        if (tr.cargo.includes('M')) metrics.mustikaUnloadBlockedSeconds += .05;
      }
      if (s.sanctuary[team] !== null && !milestones[team]) milestones[team] = {
        at: s.sanctuary[team], tr: robotState(s, tr), br: robotState(s, br), stock: clone(s.stock(team)), mustika: clone(s.object('M')),
      };
    }
  }
  const result = { id: spec.id, config: s.config, score: s.scores(), teams: {} };
  for (const team of ['red', 'blue']) {
    const trId = `${team}TR`, brId = `${team}BR`, tr = s.robot(trId), br = s.robot(brId);
    const trDecisions = decisions.filter(d => d.robot === trId), brDecisions = decisions.filter(d => d.robot === brId);
    const events = s.events.filter(e => e.robot === brId), actions = events.filter(e => e.kind === 'action');
    const trEvents = s.events.filter(e => e.robot === trId && e.kind === 'action');
    const firstMustikaMove = trDecisions.find(d => d.response.actions?.some(a => a.type === 'pickup' && a.objectId === 'M'));
    const receiving = brDecisions.filter(d => d.response.actions?.some(a => a.type === 'receive')).map(d => {
      const ids = d.response.actions.filter(a => a.type === 'receive').map(a => a.objectId);
      const nextDelivery = trEvents.find(e => e.action === 'unload' && e.time > d.time);
      return { ...d, receivedIds: ids, finalCargoCount: ids.length + d.cargoIds.length,
        nextDeliveryAfter: nextDelivery ? round(nextDelivery.time - d.time) : null,
        nextDelivery: nextDelivery ? { at: nextDelivery.time, type: nextDelivery.objectType } : null };
    });
    const construction = brDecisions.filter(d => !d.response.actions?.some(a => a.type === 'receive') && d.response.actions?.some(a => a.type === 'place'));
    const one = construction.filter(d => d.cargoIds.length === 1);
    const near = trDecisions.find(d => !d.observedSanctuary && d.observedStepsToMandate === 1);
    const mandate = s.sanctuary[team];
    const firstTime = (list, type, id) => list.find(e => e.action === type && (!id || e.objectId === id))?.time ?? null;
    const noGain = brDecisions.filter(d => d.response.decision?.horizonGain === 0);
    const flips = actions.filter(e => e.action === 'flip');
    const recaptures = flips.map(e => {
      const next = s.events.find(x => x.time > e.time && x.kind === 'action' && x.spotId === e.spotId && x.action === 'flip' && x.robot !== brId);
      return { at: e.time, spot: e.spotId, opponentFlipAfter: next ? round(next.time - e.time) : null };
    });
    result.teams[team] = {
      speed: s.config[`${team}Speed`], score: s.scores()[team], time: Object.fromEntries(['TR', 'BR'].map(role => [role, Object.fromEntries(Object.entries(time[`${team}${role}`]).map(([k, v]) => [k, round(v)]))])),
      sanctuary: mandate, sanctuarySnapshot: milestones[team] || null, observedOneStepToSanctuary: near?.time ?? null,
      mustikaMove: firstMustikaMove?.time ?? null, mustikaPickup: firstTime(trEvents, 'pickup', 'M'),
      mustikaUnload: firstTime(trEvents, 'unload', 'M'), mustikaReceive: firstTime(actions, 'receive', 'M'), mustikaEnshrine: firstTime(actions, 'enshrine'),
      postMandateNormalPickups: mandate === null ? [] : trEvents.filter(e => e.action === 'pickup' && e.objectId !== 'M' && e.time >= mandate && e.time < (firstMustikaMove?.time ?? 180)),
      deliveries: clone(tr.transport.completed), receiving, construction,
      chainedFlipPlans: brDecisions.filter(d => (d.response.actions || []).filter(a => a.type === 'flip').length >= 2).map(d => ({ at: d.time, tasks: d.response.actions.filter(a => a.type === 'flip') })),
      oneBlockConstructionTrips: one.length, localOneBlockRecoveryTrips: one.filter(d => d.stage === 'local-plan').length,
      normalOneBlockConstructionTrips: one.filter(d => d.stage !== 'local-plan').length,
      twoBlockConstructionTrips: construction.filter(d => d.cargoIds.length === 2).length,
      oneBlockReceiptTrips: receiving.filter(d => !d.receivedIds.includes('M') && d.finalCargoCount === 1),
      noGainDecisions: noGain, scans: actions.filter(e => e.action === 'scan').length,
      scanWithEmptyCargo: actions.filter(e => e.action === 'scan' && !e.cargo.length).length,
      localScans: actions.filter(e => e.action === 'scan' && e.local).length,
      sanctuaryEvidence: clone(s.sanctuaryEvidence[team]),
      operations: Object.fromEntries(['place', 'flip', 'recover', 'return', 'enshrine', 'receive'].map(type => [type, actions.filter(e => e.action === type).length])),
      flips: recaptures, retries: events.filter(e => e.action === 'retry'), failures: events.filter(e => !['action', 'plan', 'setup', 'milestone'].includes(e.kind)),
      fullStockSeconds: round(samples[team].fullStockSeconds), unloadBlockedSeconds: round(samples[team].unloadBlockedSeconds),
      mustikaUnloadBlockedSeconds: round(samples[team].mustikaUnloadBlockedSeconds),
      mustikaHandoff: firstTime(trEvents, 'handoff', 'M'), handoffWaitSeconds: round(samples[team].handoffWaitSeconds),
      finalStock: counts(s.stock(team)), finalTR: robotState(s, tr), finalBR: robotState(s, br),
      placements: actions.filter(e => e.action === 'place').map(e => ({ time: e.time, type: e.objectType, spot: e.spotId, level: F.spotById[e.spotId].level })),
    };
  }
  fs.writeFileSync(path.join(output, `${spec.id}.audit.json`), JSON.stringify({ ...result, decisions, starts, events: s.events }, null, 2));
  fs.writeFileSync(path.join(output, `${spec.id}.replay.json.gz`), zlib.gzipSync(JSON.stringify(s.export())));
  return result;
}

const scenarios = [];
if (modes) {
  for (const redBrPlan of ['mustika-fast', 'earth-late']) for (const blueBrPlan of ['mustika-fast', 'earth-late']) for (const redSpeed of [1, .75, .5]) {
    scenarios.push({ id: `${redBrPlan}-vs-${blueBrPlan}-r${redSpeed}`, config: { redSpeed, blueSpeed: 1, redTrPlan: 'stock-e3', blueTrPlan: 'stock-e3', redBrPlan, blueBrPlan } });
  }
} else for (const plan of efficient ? ['adaptive', 'adaptive-e3-e1s2'] : ['balanced', 'e3-e1s2']) {
  for (const [redSpeed, blueSpeed] of [[1, 1], [.75, 1], [1, .75], [.5, 1], [1, .5]]) {
    scenarios.push({ id: `${plan}-r${redSpeed}-b${blueSpeed}`, config: { redSpeed, blueSpeed, redTrPlan: plan, blueTrPlan: plan, redBrPlan: efficient ? 'efficient' : 'score-search', blueBrPlan: efficient ? 'efficient' : 'score-search' } });
  }
}
const hashes = Object.fromEntries(['engine.js', 'field.js', 'controllers.js', 'score-planner.js', 'efficient-strategy.js', 'match-strategies.js'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'sim', name))).digest('hex')]));
const manifest = { createdAt: new Date().toISOString(), purpose: 'Policy diagnosis under the current engine including direct Mustika handoff; no exhaustive search or probabilistic win-rate estimate.',
  dt: .05, duration: 180, sourceHashes: hashes, scenarios,
  metricNotes: ['Robot-time categories are sampled every 0.05 simulated seconds.', 'Construction departures contain at least one place instruction; flip-only and Mustika trips are excluded from one/two-block counts.',
    'Diagnostics may inspect actual future arrivals, but that information is never passed to a controller.', 'One-step-to-sanctuary refers only to observed tower shape and ownership, not cargo availability or a guaranteed completion time.',
    'All scenarios are deterministic. Color-swapped scenarios change both the slow side and physical initial positions.',
    'Each step checks object IDs, cargo ownership/capacity, legal body position and typed stock. Mustika pickups require recorded two-tower/shared evidence.',
    'Efficient ordinary construction departures must carry and place two blocks; local recovery is counted separately.'] };
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
const results = [];
for (const spec of scenarios) {
  const start = Date.now(), result = auditScenario(spec); results.push(result);
  console.log(JSON.stringify({ done: results.length, total: scenarios.length, id: result.id, seconds: round((Date.now() - start) / 1000),
    red: result.score.red.total, blue: result.score.blue.total, sanctuary: [result.teams.red.sanctuary, result.teams.blue.sanctuary],
    enshrine: [result.teams.red.mustikaEnshrine, result.teams.blue.mustikaEnshrine] }));
}
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ manifest, results }, null, 2));
const columns = ['run', 'team', 'speed', 'opponent_speed', 'score', 'opponent_score', 'sanctuary', 'mustika_move', 'mustika_pickup', 'mustika_unload', 'mustika_enshrine',
  'build_1', 'build_2', 'scan_seconds', 'blocked_seconds', 'tr_full_stock_wait', 'tr_mustika_wait', 'br_no_gain_decisions', 'flips', 'retries', 'mustika_handoff', 'handoff_wait'];
const rows = results.flatMap(r => ['red', 'blue'].map(team => {
  const t = r.teams[team], other = r.teams[team === 'red' ? 'blue' : 'red'];
  return [r.id, team, t.speed, other.speed, t.score.total, other.score.total, t.sanctuary, t.mustikaMove, t.mustikaPickup, t.mustikaUnload, t.mustikaEnshrine,
    t.oneBlockConstructionTrips, t.twoBlockConstructionTrips, t.time.BR.scan, t.time.BR.blocked, t.unloadBlockedSeconds, t.mustikaUnloadBlockedSeconds,
    t.noGainDecisions.length, t.operations.flip, t.retries.length, t.mustikaHandoff, t.handoffWaitSeconds];
}));
fs.writeFileSync(path.join(output, 'summary.csv'), [columns, ...rows].map(row => row.map(value => value ?? '').join(',')).join('\n') + '\n');
console.log(JSON.stringify({ output, finished: results.length }));
