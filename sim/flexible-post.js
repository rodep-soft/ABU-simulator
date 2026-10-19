(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField,
    typeof module === 'object' ? require('./engine.js') : root.RoboSim,
    typeof module === 'object' ? require('./score-planner.js') : root.RoboScorePlanner,
    typeof module === 'object' ? require('./efficient-strategy.js') : root.RoboEfficient,
    typeof module === 'object' ? require('./private-first.js') : root.RoboPrivateFirst);
  if (typeof module === 'object') module.exports = api; else root.RoboFlexiblePost = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, S, Planner, Efficient, Opening) {
  'use strict';
  const ID = 'private-first-short-flexible', OPENING = 'private-first-short';
  const copy = x => JSON.parse(JSON.stringify(x));
  const go = (target, label) => ({ type: 'move', target, label });
  const other = team => team === 'red' ? 'blue' : 'red';
  const current = (v, key) => !v.observation?.visibility || ['current', 'self-action'].includes(v.observation.visibility.entries[key]?.status);
  const active = v => v.observation?.pillar?.location === 'pillar' && v.observation.pillar.placedBy === v.team;
  const lead = v => v.observation?.scores ? v.observation.scores[v.team].total - v.observation.scores[other(v.team)].total : null;
  const opponent = v => current(v, 'opponentBR') ? v.observation.opponentBR : null;
  const approach = (v, task) => F.spotApproaches(F.spotById[task.spotId], v.team)[0];
  const better = (a, b) => a && (!b || a.some((n, i) => n > b[i] + 1e-7 && a.slice(0, i).every((x, j) => Math.abs(x - b[j]) < 1e-7)));
  function segmentDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return S.distance(p, { x: a.x + t * dx, y: a.y + t * dy });
  }
  function finishBudget(v, c) {
    const enemy = opponent(v), points = [v, ...(c.returnObject || c.picked.length ? [F.points[v.team].transferBR] : []), ...c.tasks.map(a => approach(v, a))];
    const crowded = !!enemy && points.slice(1).some((p, i) => F.surface(p).type === F.surface(enemy).type
      && segmentDistance(enemy, points[i], p) < (v.motion.bodySize || .5) + .3);
    const handling = c.tasks.reduce((n, a) => n + S.actionSeconds(v.motion, a.type), 0);
    const reserve = 1 + .25 * Math.max(0, c.completeSeconds - handling)
      + (crowded ? v.motion.scanSeconds + S.actionSeconds(v.motion, 'flip') : 0);
    return { nominalSeconds: c.completeSeconds, reserve, crowded, safeSeconds: c.completeSeconds + reserve,
      fits: Number.isFinite(c.completeSeconds) && c.completeSeconds + reserve < 180 - v.time - .05 };
  }
  function scoreTowers(towers, team) {
    return Planner.scoreState({ towers, mustika: { location: 'source' } }, team);
  }
  function protectedScore(towers, team) {
    const secure = Object.fromEntries(Object.entries(towers).map(([id, t]) => [id, F.spotById[id].team ? t : t.filter(o => o.type !== 'sky')]));
    return scoreTowers(secure, team)[team].tower;
  }
  function evaluator(v) {
    const gap = lead(v), fixedBefore = protectedScore(v.observation.towers, v.team), enemy = opponent(v), memo = new WeakMap();
    return c => {
      if (memo.has(c)) return memo.get(c);
      if (!c.tasks.length || c.tasks.some(a => !a.spotId || !current(v, 'tower:' + a.spotId))
        || c.picked.some(id => !c.tasks.some(a => a.type === 'place' && a.objectId === id))) return null;
      const budget = finishBudget(v, c); if (!budget.fits) return null;
      const fixedGain = protectedScore(c.state.towers, v.team) - fixedBefore, diff = c.gain - c.opponentGain;
      let newExposure = 0, replyLoss = 0;
      for (const p of F.spots.filter(p => !p.team)) {
        const tower = c.state.towers[p.id] || [], top = tower[2];
        if (tower.length !== 3 || top.type !== 'sky' || top.color !== v.team || tower.some(o => o.touchedBy)) continue;
        const before = scoreTowers({ [p.id]: tower }, v.team), flipped = scoreTowers({ [p.id]: tower.map((o, i) => i === 2 ? { ...o, color: other(v.team) } : o) }, v.team);
        const swing = (before[v.team].tower - before[other(v.team)].tower) - (flipped[v.team].tower - flipped[other(v.team)].tower);
        const index = c.tasks.findLastIndex(a => a.spotId === p.id && (a.type === 'flip' || a.objectId === top.id));
        const ready = index < 0 ? 0 : c.taskTimes[index];
        // A single optimistic enemy reply is a stress scenario, not its intention.
        const travel = enemy?.maxSpeed > 0 ? Math.min(...F.spotApproaches(p, other(v.team)).map(q => S.distance(enemy, q))) / enemy.maxSpeed : 0;
        const work = enemy?.placeSeconds > 0 ? enemy.placeSeconds : S.actionSeconds(v.motion, 'flip');
        const exposure = Math.max(0, Math.min(1, (180 - v.time - Math.max(ready, travel) - work) / Math.max(8, 2 * work)));
        const loss = swing * exposure; replyLoss = Math.max(replyLoss, loss);
        if (index >= 0) newExposure += loss;
      }
      const late = 180 - v.time <= 40, riskWeight = gap !== null && gap > 0 ? .65 : .25;
      const netGain = diff - riskWeight * newExposure;
      const projectedMargin = gap === null ? null : gap + diff;
      const replyMargin = gap === null ? null : projectedMargin - replyLoss;
      const category = !late || gap === null ? 0 : replyMargin > 0 ? 2 : projectedMargin > 0 ? 1 : 0;
      const rate = (netGain + .3 * fixedGain) / (budget.safeSeconds + v.motion.scanSeconds);
      const result = { ...budget, lead: gap, diff, fixedGain, newExposure, replyLoss, projectedMargin, replyMargin, netGain,
        rank: [category, late ? netGain + .35 * fixedGain : rate, late ? rate : netGain, fixedGain, -budget.safeSeconds] };
      memo.set(c, result); return result;
    };
  }
  function selectPlan(v, extra = {}) {
    if (!v.observation) return null;
    const assess = evaluator(v), rank = c => assess(c)?.rank || null;
    const options = { efficient: true, oneSortie: true, requirePair: false, noRecover: true, orderSensitive: true,
      allowRefill: true, ...extra, noPickup: !!extra.noPickup || !current(v, 'stock'), rank };
    let best = Planner.plan(v, options);
    if (!v.cargo.length) {
      const flips = Planner.flipBatch(v, { ...options, maxTasks: 4 });
      if (flips && better(rank(flips), best && rank(best))) best = flips;
    }
    if (best) best.assessment = { baseline: ID, ...assess(best), rationale: '全エリアの点差・固定点・1回反撃・完了余裕を比較' };
    return best;
  }
  function returnPlan(v) {
    if (!current(v, 'stock') || S.blockCount(v.cargo) < 2) return null;
    const point = F.points[v.team].transferBR, travel = Planner.travelTo(v, point);
    const local = v.brObservation?.replan === 'after-work', stopped = v.brObservationMode === 'stopped';
    const origin = local || stopped ? point : F.points[v.team].home;
    const prep = travel + (stopped && !local && S.distance(v, point) > .12 ? v.motion.scanSeconds : 0)
      + S.actionSeconds(v.motion, 'return') + Planner.travelTo({ ...v, ...point }, origin) + v.motion.scanSeconds;
    if (!Number.isFinite(prep) || prep + 4 >= 180 - v.time) return null;
    const assess = evaluator(v), types = new Set(); let best = null;
    for (const object of v.cargo.filter(o => o.type !== 'mustika')) {
      if (types.has(object.type)) continue; types.add(object.type);
      const slot = S.Simulation.prototype.freeSlot.call({ stock: () => v.observation.stock }, v.team, object, true);
      if (!slot) continue;
      const stock = [...copy(v.observation.stock), { ...copy(object), location: 'transfer', holder: null, touchedBy: null,
        transferTeam: v.team, slot: slot.id, x: slot.x, y: slot.y, z: slot.z, layer: slot.layer }];
      const future = { ...v, ...origin, z: F.surface(origin).z, time: v.time + prep, cargo: v.cargo.filter(o => o.id !== object.id),
        observation: { ...v.observation, stock } };
      // Compare return AND a scoring follow-up, never a return-only trip near the buzzer.
      const rank = plan => assess({ ...plan, completeSeconds: plan.completeSeconds + prep,
        taskTimes: plan.taskTimes.map(t => t + prep), returnObject: object })?.rank || null;
      const plan = Planner.plan(future, { efficient: true, oneSortie: true, requirePair: false, noRecover: true,
        orderSensitive: true, noPickup: true, rank });
      if (!plan) continue;
      const candidate = { ...plan, completeSeconds: plan.completeSeconds + prep, taskTimes: plan.taskTimes.map(t => t + prep), returnObject: object };
      if (better(assess(candidate)?.rank, best && assess(best)?.rank)) best = candidate;
    }
    if (best) best.assessment = { baseline: ID, ...assess(best), rationale: '1箱返却と続く得点作業まで間に合う場合だけ返却' };
    return best;
  }
  function decorate(v, response, phase, reason) {
    const meta = { activatedAt: v.brain.flexiblePost?.activatedAt ?? v.time, phase, reason,
      intent: phase === 'work' ? response.decision?.tasks?.[0] || null : null };
    const changed = v.brain.flexiblePost?.phase !== phase || v.brain.flexiblePost?.reason !== reason;
    const decision = response.decision || (changed ? { at: v.observation?.at ?? v.time, summary: reason,
      gain: 0, horizonGain: 0, seconds: 0, horizonSeconds: 0, tasks: [], receive: [] } : null);
    return { ...response, brain: { ...response.brain, flexiblePost: meta },
      ...(decision ? { decision: { ...decision, strategy: ID, flexiblePost: meta } } : {}) };
  }
  function observe(v, phase, reason, target = F.scanPoint(v.team, v, v.brObservationMode)) {
    if (v.brObservation?.replan !== 'after-work') target = F.scanPoint(v.team, target, v.brObservationMode);
    const travel = Planner.travelTo(v, target), remaining = 180 - v.time;
    const fits = travel + v.motion.scanSeconds + .15 < remaining;
    const actions = fits ? [...(S.distance(v, target) > .02 ? [go(target, reason)] : []), ...F.scanActions(v, target)]
      : [{ type: 'wait', seconds: Math.max(.05, remaining) }];
    return decorate(v, { brain: { ...v.brain, stage: 'choose' }, actions, status: reason }, fits ? phase : 'hold', reason);
  }
  function arrivedPlan(v) {
    const task = v.brain.flexiblePost?.intent;
    if (!task?.spotId || !current(v, 'tower:' + task.spotId) || S.distance(v, approach(v, task)) > .12) return null;
    const plan = Planner.specifiedPlan(v, [], [task]);
    if (!plan) return null;
    const info = evaluator(v)(plan); if (!info) return null;
    plan.assessment = { baseline: ID, ...info, rationale: '到着先を再観測し合法・時間内なら完了' }; return plan;
  }
  function idleTarget(v) {
    if (v.brObservationMode !== 'stopped' && v.brObservation?.replan !== 'after-work') return undefined;
    for (const p of F.spots.filter(p => p.level === 2)) {
      const points = F.spotApproaches(p, v.team);
      if (S.distance(v, points[0]) > .12) continue;
      const target = points[2], enemy = opponent(v), travel = Planner.travelTo(v, target);
      if (enemy && S.distance(enemy, target) < (v.motion.bodySize || .5) + .1) continue;
      if (travel + v.motion.scanSeconds + 1 < 180 - v.time) return target;
    }
    return undefined;
  }
  function builder(v) {
    if (!active(v)) return Opening.builder({ ...v, brPlan: OPENING }, OPENING);
    if (Efficient.needsScan(v)) return observe(v, 'scan', '停止して点差・残り時間を再評価');
    const arrived = arrivedPlan(v);
    if (arrived) return decorate(v, Efficient.execute(v, arrived, '到着先の合法な作業を完了'), 'work', '到着先を再確認・合法かつ時間内なら完了');
    let plan = selectPlan(v), returned = returnPlan(v);
    if (returned && better(returned.assessment.rank, plan?.assessment.rank)) plan = returned;
    if (plan?.returnObject) {
      const p = F.points[v.team].transferBR;
      return decorate(v, { brain: { ...v.brain, stage: 'choose' }, actions: [go(p, '反転・配置の空き枠を確保'),
        { type: 'return', objectId: plan.returnObject.id }, ...F.scanActions(v, p)], decision: {
        at: v.observation.at, summary: '1箱返却→得点作業を評価', gain: plan.gain, horizonGain: plan.horizonGain,
        seconds: plan.completeSeconds, horizonSeconds: plan.completeSeconds, tasks: plan.tasks, receive: [], assessment: plan.assessment } },
      'return', '返却と続く得点作業が間に合う見込み');
    }
    if (plan) return decorate(v, Efficient.execute(v, plan, '全エリア比較 · ' + plan.tasks.map(a => F.spotName(a.spotId) + (a.type === 'flip' ? 'を反転' : 'へ配置')).join(' → ')),
      plan.picked.length ? 'supply' : 'work', '点差・固定点・再反転リスク・完了余裕で選択');
    if (v.observation.visibility) {
      const unknown = F.spots.find(p => (!p.team || p.team === v.team) && !current(v, 'tower:' + p.id));
      if (unknown) {
        const target = F.points[v.team][unknown.level === 2 ? 'homeL2' : 'home'];
        if (Planner.travelTo(v, target) + v.motion.scanSeconds + S.actionSeconds(v.motion, 'place') + 2 < 180 - v.time)
          return observe(v, 'scout', '未知の盤面を観測して再評価', target);
      }
    }
    const aside = idleTarget(v);
    return observe(v, 'guard', aside ? '得点候補なし・L2の作業位置を空けて再観測' : '完了余裕のある得点候補なし・その場で再観測', aside);
  }
  function details() {
    return [['初動', '短時間待機と同一 / 自チームMustika奉納の観測後だけ切替'],
      ['対象', '①の反転・③/⑤の専有完成・⑦〜⑩を含む全エリア'],
      ['判断', '残り40秒までは点差効率 / 終盤は観測点差と1回反撃の試算'],
      ['リード中', '取り返されないEarth・専有点も評価 / L2固定なし'],
      ['時間', '経路・加減速・階段・受取・観測・作業 / 作業以外の25%＋1秒の余裕'],
      ['混雑', '観測した相手が経路付近なら反転＋観測分を追加 / 終わらない候補を除外'],
      ['受取・返却', '受け取る箱は配置予定のあるものだけ / 反転枠の返却は満載時だけ'],
      ['待機', '同じ階で有料再観測 / L2作業位置は短距離で脇へ / 無目的な補給移動なし'],
      ['限界', '衝突や相手の未来は予測できず、完了/勝利の保証ではない']];
  }
  return { ID, OPENING, active, lead, finishBudget, evaluator, selectPlan, returnPlan, arrivedPlan, idleTarget, builder, details };
});
