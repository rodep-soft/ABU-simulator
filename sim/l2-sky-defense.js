(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField,
    typeof module === 'object' ? require('./engine.js') : root.RoboSim,
    typeof module === 'object' ? require('./score-planner.js') : root.RoboScorePlanner,
    typeof module === 'object' ? require('./efficient-strategy.js') : root.RoboEfficient,
    typeof module === 'object' ? require('./ideal-baseline.js') : root.RoboIdealBaseline,
    typeof module === 'object' ? require('./private-first.js') : root.RoboPrivateFirst);
  if (typeof module === 'object') module.exports = api; else root.RoboL2Defense = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, S, Planner, Efficient, Baseline, Opening) {
  'use strict';
  const ID = 'private-first-short-l2-defense', OPENING = 'private-first-short';
  const l2 = F.spots.filter(s => s.level === 2);
  const go = (target, label) => ({ type: 'move', target, label });
  const current = (v, key) => !v.observation?.visibility || ['current', 'self-action'].includes(v.observation.visibility.entries[key]?.status);
  const skyOwned = (tower, team) => tower?.length === 3 && tower[0].type === 'earth' && tower[1].type === 'earth'
    && tower[2].type === 'sky' && tower[2].color === team && tower.every(o => !o.touchedBy);
  const active = v => v.observation?.pillar?.location === 'pillar' && v.observation.pillar.placedBy === v.team;
  function better(a, b) {
    if (!a) return false;
    if (!b) return true;
    const i = a.findIndex((x, j) => Math.abs(x - b[j]) > 1e-7);
    return i >= 0 && a[i] > b[i];
  }
  function rankFor(v) {
    const ordinary = Baseline.rankFor(v);
    const before = l2.filter(s => skyOwned(v.observation.towers[s.id], v.team)).length;
    return c => {
      if (!c.tasks.length || c.tasks.some(a => !a.spotId || F.spotById[a.spotId].level !== 2)
        || S.blockCount(c.state.cargo) >= 2) return null;
      const base = ordinary(c); if (!base) return null;
      const gained = l2.filter(s => skyOwned(c.state.towers[s.id], v.team)).length - before;
      // This is policy preference, not additional game points. Scores/risk stay in V2.
      return [gained > 0 ? 1 : 0, ...base];
    };
  }
  function selectPlan(v, extra = {}) {
    if (!v.observation) return null;
    const rank = rankFor(v);
    const options = { efficient: true, oneSortie: true, requirePair: false, noRecover: true,
      orderSensitive: true, allowRefill: false, ...extra,
      noPickup: !!extra.noPickup || S.blockCount(v.cargo) > 0 || !current(v, 'stock'), rank };
    let selected = Planner.plan(v, options);
    if (!v.cargo.length) {
      const flips = Planner.flipBatch(v, { ...options, maxTasks: 4 });
      if (flips && better(rank(flips), selected && rank(selected))) selected = flips;
    }
    if (selected) selected.assessment = { baseline: ID, focus: 'L2-Sky', rank: rank(selected),
      local: !selected.picked.length, rationale: 'L2のSky取得を優先し、点差・時間・再反転リスクで比較' };
    return selected;
  }
  function decorate(v, response, phase, reason) {
    const intent = phase === 'work' ? response.decision?.tasks?.[0] || null : null;
    const state = { ...v.brain.l2Defense, activatedAt: v.brain.l2Defense?.activatedAt ?? v.time, phase, reason, intent };
    const changed = v.brain.l2Defense?.phase !== phase || v.brain.l2Defense?.reason !== reason;
    const decision = response.decision || (changed ? { at: v.observation?.at ?? v.time, summary: reason,
      gain: 0, horizonGain: 0, seconds: 0, horizonSeconds: 0, tasks: [], receive: [] } : null);
    return { ...response, brain: { ...response.brain, l2Defense: state },
      ...(decision ? { decision: { ...decision, strategy: ID, l2Defense: state } } : {}) };
  }
  function observe(v, target, reason) {
    return { brain: { ...v.brain, stage: 'choose' }, status: reason,
      actions: [...(S.distance(v, target) > .02 ? [go(target, reason)] : []), ...F.scanActions(v, target)] };
  }
  function guardTarget(v) {
    const home = F.points[v.team].homeL2;
    // Wait away from the shared task approaches rather than blocking their access.
    return v.brObservationMode === 'fixed' && v.brObservation?.replan !== 'after-work'
      ? home : { x: home.x + (v.team === 'red' ? -.05 : .05), y: home.y };
  }
  function shouldGuard(v) {
    const owned = l2.filter(s => current(v, 'tower:' + s.id) && skyOwned(v.observation.towers[s.id], v.team));
    if (!owned.length) return false;
    if (v.time >= 150 || owned.length === l2.length) return true;
    const opponent = current(v, 'opponentBR') ? v.observation.opponentBR : null;
    return !!opponent && F.surface(opponent).type === 'l2' && owned.some(s => S.distance(opponent, s) <= 2.8);
  }
  function freeHand(v) {
    if (!current(v, 'stock')) return observe(v, F.points[v.team].transferBR, '反転用の返却枠を確認');
    const object = v.cargo.find(o => o.type === 'earth') || v.cargo.find(o => o.type === 'sky');
    if (!object || !Efficient.canStore(v.team, v.observation.stock, [object])) return null;
    const p = F.points[v.team].transferBR;
    return { brain: { ...v.brain, stage: 'choose' }, actions: [go(p, 'Sky反転の空き1枠を確保'),
      { type: 'return', objectId: object.id }, ...F.scanActions(v, p)] };
  }
  function arrivedPlan(v) {
    const task = v.brain.l2Defense?.intent, spot = task?.spotId && F.spotById[task.spotId];
    if (!spot || spot.level !== 2 || !current(v, 'tower:' + spot.id)
      || S.distance(v, F.spotApproaches(spot, v.team)[0]) > .12) return null;
    // Revalidate against the new observation; do not chase a new target just
    // because its reply-risk estimate changed while travelling here.
    const plan = Planner.specifiedPlan(v, [], [task]);
    return plan && rankFor(v)(plan) ? plan : null;
  }
  function builder(v) {
    // Normalize the name as well: pre-delivery decisions/events must match the control.
    if (!active(v)) return Opening.builder({ ...v, brPlan: OPENING }, OPENING);
    if (Efficient.needsScan(v)) return decorate(v, { brain: { ...v.brain, stage: 'choose' }, actions: F.scanActions(v) }, 'scan', 'L2防衛・停止して再観測');
    if (l2.some(s => !current(v, 'tower:' + s.id))) {
      return decorate(v, observe(v, F.points[v.team].homeL2, 'L2の未確認盤面を観測'), 'scout', 'L2の未確認盤面を観測');
    }
    const arrived = arrivedPlan(v);
    if (arrived) return decorate(v, Efficient.execute(v, arrived, '到着先の合法なL2作業を完了'), 'work', '到着先を再確認・合法なら作業を完了');
    const local = selectPlan(v, { noPickup: true });
    if (local) return decorate(v, Efficient.execute(v, local, 'L2優先 · ' + local.tasks.map(a => F.spotName(a.spotId) + (a.type === 'flip' ? 'を反転' : 'へ配置')).join(' → ')), 'work', '手持ち・現地のL2作業を優先');
    if (S.blockCount(v.cargo) >= 2) {
      const back = freeHand(v);
      if (back) return decorate(v, back, 'free-hand', 'L2の反転に備え空き1枠を確保');
    }
    const guard = guardTarget(v), guardSeconds = Planner.travelTo(v, guard) + v.motion.scanSeconds;
    if (shouldGuard(v) && guardSeconds < 180 - v.time) {
      return decorate(v, observe(v, guard, 'L2で再観測・Skyの再奪取に備える'), 'guard', 'L2で再観測・Skyの再奪取に備える');
    }
    const plan = selectPlan(v);
    if (plan) return decorate(v, Efficient.execute(v, plan, 'L2のSky・土台を優先'), 'supply-work', 'L2のSky・土台を優先');
    return decorate(v, Baseline.builder(v), 'fallback', '間に合うL2作業なし・V2で残り得点を評価');
  }
  function details() {
    return [['初動', '短時間待機案と同一（②/⑥を完成→E1+S1・上限5秒）'],
      ['切替', '自チームのMustika奉納を観測してから / 資格成立だけでは切替しない'],
      ['奉納後', 'L2のSky反転・Sky配置→L2土台 / 手持ち作業を先に使用'],
      ['防衛', '150秒以降または相手L2接近時は補給よりL2再観測・再奪取'],
      ['到着時', '再観測して配置・反転が合法なら完了 / 塔が変われば再計画'],
      ['空き枠', '2箱が使えない場合は1個返却 / 通路・作業点を塞がない待機'],
      ['評価と情報', 'V2の点差・時間・再反転リスクを再利用 / 観測外の状態・未来は参照しない']];
  }
  return { ID, OPENING, active, builder, selectPlan, rankFor, shouldGuard, guardTarget, arrivedPlan, details };
});
