const assert = require('node:assert/strict');
const F = require('../sim/field.js');
const S = require('../sim/engine.js');
const C = require('../sim/controllers.js');
const Planner = require('../sim/score-planner.js');
const Cache = require('./case-study-cache.cjs');
const clone = x => JSON.parse(JSON.stringify(x));
const round = n => Math.round(n * 100) / 100;
const teams = ['red', 'blue'];

function profiles() {
  return C.listStrategies('TR').flatMap((tr, ti) => C.listStrategies('BR').map((br, bi) => ({
    id: `T${ti + 1}B${bi + 1}`, tr: tr.id, br: br.id, trName: tr.shortName, brName: br.shortName,
  })));
}
function scenarios() {
  const all = profiles(), out = [];
  for (const [redSpeed, blueSpeed] of [[1, 1], [.75, 1], [1, .75], [.5, 1], [1, .5]]) {
    for (const red of all) for (const blue of all) out.push({
      id: `${red.id}-${blue.id}-r${redSpeed}-b${blueSpeed}`, red: red.id, blue: blue.id,
      config: { redTrPlan: red.tr, redBrPlan: red.br, blueTrPlan: blue.tr, blueBrPlan: blue.br, redSpeed, blueSpeed },
    });
  }
  return out;
}
function verdict(score) {
  for (const [key, reason] of [['total', 'score'], ['mustika', 'mustika-tiebreak'], ['sky', 'sky-tiebreak']]) {
    if (score.red[key] !== score.blue[key]) return { winner: score.red[key] > score.blue[key] ? 'red' : 'blue', reason };
  }
  // Attribution of mixed towers in the remaining official tiebreaks is unresolved.
  return { winner: null, reason: 'unresolved-L2-L1-referee-tiebreak' };
}
function points(o, p) { return o.type === 'sky' ? 40 * p.level : [10, 20][o.layer] * p.level; }
function validBlocks(s, p) {
  const t = s.tower(p.id);
  return t.filter((o, i) => !o.touchedBy && o.layer === i && (i < 2 ? o.type === 'earth' : i === 2 && o.type === 'sky')
    && t.slice(0, i).every((a, j) => a.type === 'earth' && a.layer === j));
}
function secureBounds(s, team) {
  const enemy = team === 'red' ? 'blue' : 'red', score = s.scores(), remaining = Math.max(0, 180 - s.time);
  let floor = score[team].transfer + score[team].mustika, earthCeiling = 0, skyCeiling = 0;
  for (const p of F.spots) {
    const valid = validBlocks(s, p);
    for (const o of valid) if (o.type === 'earth' && o.placedBy === team || o.type === 'sky' && p.team === team && o.color === team) floor += points(o, p);
    if (p.team && p.team !== enemy) continue;
    for (let layer = 0; layer < 2; layer++) {
      if (!valid.some(o => o.type === 'earth' && o.layer === layer && o.placedBy === team)) earthCeiling += [10, 20][layer] * p.level;
    }
    skyCeiling += 40 * p.level;
  }
  const mAvailable = s.object('M').location !== 'pillar';
  const absolute = 160 + earthCeiling + skyCeiling + (score[enemy].mustika || (mAvailable ? 250 : 0));
  // Deliberately optimistic enemy bound: no travel, no perception, unlimited ready material,
  // plus one free in-progress operation. Our shared Sky points are all discarded from the floor.
  const trActions = Math.floor(remaining / s.config.pickupSeconds) + 1;
  const brActions = Math.floor(remaining / s.config.placeSeconds) + 1;
  const trGain = Math.min(160 - score[enemy].transfer, trActions * 5);
  const brGain = brActions * 80 + (mAvailable ? 170 : 0);
  const ceiling = Math.min(absolute, score[enemy].total + trGain + brGain);
  return { floor, ceiling, guaranteed: floor > ceiling };
}
function run(spec, options = {}) {
  if (options.cache !== false) Cache.install();
  Planner.clearCache();
  const s = new S.Simulation(spec.config);
  if (!options.frames) { s.capture = () => {}; s.history = []; }
  const metrics = Object.fromEntries(teams.map(team => [team, { normalOne: 0, localOne: 0, two: 0, flipPlans: [],
    plannedPastBuzzer: 0, noGainPlans: 0, phaseTime: Array.from({ length: 6 }, () => ({ TR: {}, BR: {} })), starts: [],
    firstCertificate: null, finalCargo: {}, deliveries: [], phases: Array.from({ length: 6 }, () => ({ earth: 0, sky: 0, flip: 0, recover: 0, scan: 0, return: 0, enshrine: 0, unload: 0 })) }]));
  const timeline = [], actions = [], decisions = []; let step = 0;
  const controller = { next(v) {
    const response = options.cache !== false ? Cache.next(C, v) : C.next(v), m = metrics[v.team], work = response.actions || [];
    if (v.role === 'BR') {
      if (work.some(a => a.type === 'place')) {
        if (v.cargo.length === 1) m[v.brain.stage === 'local-plan' ? 'localOne' : 'normalOne']++;
        if (v.cargo.length === 2) m.two++;
      }
      const flips = work.filter(a => a.type === 'flip');
      if (flips.length >= 2) m.flipPlans.push({ at: v.time, spots: flips.map(a => a.spotId) });
      if (response.decision?.seconds && response.decision.seconds > 180 - v.time) m.plannedPastBuzzer++;
      if (response.decision?.horizonGain === 0) m.noGainPlans++;
    }
    if (work.some(a => ['place', 'flip', 'enshrine', 'receive', 'return', 'pickup'].includes(a.type))) decisions.push({
      at: v.time, robot: v.id, observationAt: v.observation?.at ?? null, cargo: v.cargo.map(o => o.id), stage: v.brain.stage,
      actions: clone(work), prediction: response.decision || null,
    });
    return response;
  } };
  const sample = () => {
    const scores = s.scores(), bounds = teams.map(team => secureBounds(s, team));
    timeline.push([s.time, scores.red.total, scores.blue.total, scores.red.transfer, scores.blue.transfer,
      scores.red.mustika, scores.blue.mustika, bounds[0].floor, bounds[0].ceiling, bounds[1].floor, bounds[1].ceiling]);
    teams.forEach((team, i) => { if (bounds[i].guaranteed && metrics[team].firstCertificate === null) metrics[team].firstCertificate = s.time; });
  };
  sample();
  while (!s.ended) {
    const phase = Math.min(5, Math.floor(s.time / 30)), eventStart = s.events.length;
    const before = s.robots.map(r => ({ x: r.x, y: r.y, job: r.job?.type, status: r.status, wait: r.wait }));
    s.step(.05, controller); step++;
    for (let i = 0; i < s.robots.length; i++) {
      const r = s.robots[i], b = before[i], job = b.job || r.job?.type;
      const category = S.distance(b, r) > 1e-7 ? 'move' : job === 'scan' ? 'scan'
        : ['place', 'flip', 'enshrine', 'pickup', 'unload', 'receive', 'return', 'recover'].includes(job) ? 'handling'
          : r.stall || r.status === '障害物待ち' ? 'blocked' : b.status === '段差で姿勢合わせ' && b.wait ? 'stairs' : 'idle';
      const bucket = metrics[r.team].phaseTime[phase][r.role]; bucket[category] = (bucket[category] || 0) + .05;
      assert.ok(r.cargo.length <= (r.role === 'TR' ? 3 : 2), 'cargo capacity');
    }
    for (const e of s.events.slice(eventStart)) {
      if (e.kind !== 'action' || !e.robot) continue;
      const team = e.robot.startsWith('red') ? 'red' : 'blue', m = metrics[team];
      const p = m.phases[Math.min(5, Math.floor(e.time / 30))];
      const type = e.action === 'place' ? e.objectType : e.action;
      if (Object.hasOwn(p, type)) p[type]++;
      if (['place', 'flip', 'enshrine', 'return', 'recover', 'retry', 'pickup', 'handoff'].includes(e.action)) actions.push({
        at: e.time, robot: e.robot, action: e.action, type: e.objectType, object: e.objectId, spot: e.spotId,
      });
      if (e.action === 'pickup' && e.objectId === 'M') {
        assert.ok(e.sanctuaryEvidence && e.sanctuaryEvidence.at <= e.time);
        const completed = S.completedTowers(id => e.sanctuaryEvidence.towers.find(t => t.id === id)?.objects || [], team);
        assert.ok(completed.length >= 2 && completed.some(p => !p.team), 'Mustika mandate');
      }
    }
    if (step % 20 === 0 || s.ended) {
      assert.equal(new Set(s.objects.map(o => o.id)).size, 53);
      assert.notEqual(s.object('M').location, 'transfer');
      for (const r of s.robots) {
        assert.ok(s.footprintAllowed(r, r), 'body zone');
        for (const id of r.cargo) assert.equal(s.object(id).holder, r.id, 'cargo owner');
      }
      for (const team of teams) for (const slot of F.slots(team)) {
        const stack = s.stock(team).filter(o => o.slot === slot.id);
        assert.ok(stack.length <= slot.maxLayers && stack.every(o => o.type === slot.type), 'stock');
      }
      sample();
    }
  }
  const score = s.scores();
  for (const team of teams) {
    const m = metrics[team], tr = s.robot(`${team}TR`), br = s.robot(`${team}BR`);
    m.phaseTime = m.phaseTime.map(p => Object.fromEntries(Object.entries(p).map(([role, time]) => [role, Object.fromEntries(Object.entries(time).map(([k, v]) => [k, round(v)]))])));
    m.deliveries = clone(tr.transport.completed);
    m.sanctuary = s.sanctuary[team];
    m.mustikaPickup = actions.find(a => a.robot === tr.id && a.action === 'pickup' && a.object === 'M')?.at ?? null;
    m.mustikaEnshrine = actions.find(a => a.robot === br.id && a.action === 'enshrine')?.at ?? null;
    m.retry = actions.filter(a => a.robot === br.id && a.action === 'retry').length;
    m.finalCargo = { TR: tr.cargo.map(id => s.object(id).type), BR: br.cargo.map(id => s.object(id).type) };
    m.finalJobs = { TR: tr.job ? { type: tr.job.type, remaining: tr.job.remaining, destination: tr.job.destination } : null,
      BR: br.job ? { type: br.job.type, remaining: br.job.remaining, spot: br.job.spotId, destination: br.job.destination } : null };
    m.failures = s.events.filter(e => e.robot?.startsWith(team) && !['action', 'plan', 'setup', 'milestone'].includes(e.kind)).reduce((out, e) => { out[e.text] = (out[e.text] || 0) + 1; return out; }, {});
  }
  const summary = { id: spec.id, red: spec.red, blue: spec.blue, config: spec.config, score, ...verdict(score), teams: metrics, timeline, actions };
  return { summary, detail: { id: spec.id, config: s.config, decisions, events: s.events, final: s.snapshot() }, frames: options.frames ? s.export() : null };
}
module.exports = { profiles, scenarios, verdict, secureBounds, run };
