(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField,
    typeof module === 'object' ? require('./engine.js') : root.RoboSim,
    typeof module === 'object' ? require('./score-planner.js') : root.RoboScorePlanner,
    typeof module === 'object' ? require('./efficient-strategy.js') : root.RoboEfficient,
    typeof module === 'object' ? require('./ideal-baseline.js') : root.RoboIdealBaseline);
  if (typeof module === 'object') module.exports = api; else root.RoboPrivateFirst = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, S, Planner, Efficient, Baseline) {
  'use strict';
  const modes = [
    { id: 'private-first-now', label: '待機なし', seconds: 0 },
    { id: 'private-first-short', label: '短時間待機', seconds: 5 },
    { id: 'private-first-observe', label: '相手接近を見て待機', seconds: 12 },
  ];
  const go = (target, label) => ({ type: 'move', target, label });
  const ownSpot = team => team === 'red' ? 'r2' : 'b2';
  const current = (v, key) => !v.observation?.visibility || ['current', 'self-action'].includes(v.observation.visibility.entries[key]?.status);
  const completed = (t, team) => t?.length === 3 && t[0].type === 'earth' && t[1].type === 'earth'
    && t[2].type === 'sky' && t[2].color === team && t.every(o => !o.touchedBy);
  function decorate(v, response, state, phase, reason) {
    const meta = { ...state, phase, reason };
    const changed = v.brain.privateFirst?.phase !== phase || v.brain.privateFirst?.reason !== reason;
    const decision = response.decision || (changed ? { at: v.observation?.at ?? v.time, strategy: v.brPlan,
      summary: reason, gain: 0, horizonGain: 0, seconds: 0, horizonSeconds: 0, tasks: [], receive: [] } : null);
    return { ...response, brain: { ...response.brain, privateFirst: meta },
      ...(decision ? { decision: { ...decision, privateFirst: meta } } : {}) };
  }
  function scan(v, state, phase, reason, standby = false) {
    const target = standby ? F.scanPoint(v.team, F.points[v.team].brStandby, v.brObservationMode) : F.scanPoint(v.team, v, v.brObservationMode);
    const actions = [...(S.distance(v, target) > .02 ? [go(target, reason)] : []), ...F.scanActions(v, target)];
    return decorate(v, { brain: { ...v.brain, stage: 'choose' }, actions, status: reason }, state, phase, reason);
  }
  function pickup(v, types) {
    const stock = [...v.observation.stock], held = [...v.cargo], picked = [];
    for (const type of types) {
      const present = held.findIndex(o => o.type === type);
      if (present >= 0) { held.splice(present, 1); continue; }
      if (S.blockCount(v.cargo) + picked.length >= 2) return null;
      const o = stock.find(o => o.type === type && !o.touchedBy && !stock.some(t => t.slot === o.slot && t.layer > o.layer));
      if (!o) return null;
      picked.push(o); stock.splice(stock.indexOf(o), 1);
    }
    return picked;
  }
  function freeSlot(v, state, reason) {
    const object = v.cargo.find(o => o.type === 'sky') || v.cargo.find(o => o.type === 'earth');
    if (!object || !Efficient.canStore(v.team, v.observation.stock, [object])) return scan(v, state, 'supply', '返却枠を再確認', true);
    const transfer = F.points[v.team].transferBR;
    return decorate(v, { brain: { stage: 'choose' }, actions: [go(transfer, reason), { type: 'return', objectId: object.id }, ...F.scanActions(v, transfer)] }, state, 'free-slot', reason);
  }
  function construct(v, state, id, types, phase, reason) {
    const picked = pickup(v, types);
    if (!picked) return S.blockCount(v.cargo) === 2 ? freeSlot(v, state, '必要な箱の受取枠を確保') : scan(v, state, 'supply', '必要な箱が揃うまで再観測', true);
    const material = [...v.cargo, ...picked];
    const tasks = types.map(type => { const i = material.findIndex(o => o.type === type), [o] = material.splice(i, 1); return { type: 'place', objectId: o.id, spotId: id }; });
    const plan = Planner.specifiedPlan(v, picked, tasks);
    return plan ? decorate(v, Efficient.execute(v, plan, reason), state, phase, reason) : scan(v, state, 'replan', '配置先を再観測');
  }
  function opponentApproaching(v, state) {
    if (!current(v, 'opponentBR') || !v.observation.opponentBR) return false;
    const at = v.observation.at, distance = S.distance(v.observation.opponentBR, F.spotById.s2);
    const before = state.opponent;
    const approaching = distance <= 1.4 || distance <= 3 && (!before || distance < before.distance - .08);
    if (!before || at > before.at) state.opponent = { at, distance };
    return approaching;
  }
  function builder(v, id) {
    const mode = modes.find(m => m.id === id) || modes[0], state = { ...v.brain.privateFirst, mode: mode.id };
    const fallBack = reason => decorate(v, Baseline.builder(v), state, 'baseline', reason);
    if (Efficient.needsScan(v) || !v.enteredL1) return scan(v, state, 'scan', '専有先行 · 停止して認識');
    if (v.observation.sanctuary || v.observation.pillar?.placedBy || v.opponentMustikaPickup || v.time >= 110) return fallBack('資格成立・取得競争終了後はV2へ');
    const own = ownSpot(v.team);
    if (!current(v, 'tower:' + own)) return decorate(v, { brain: v.brain, actions: [go(F.spotApproaches(F.spotById[own], v.team)[0], '専有塔を確認'), ...F.scanActions(v, F.spotApproaches(F.spotById[own], v.team)[0])] }, state, 'scout', '専有塔が未確認');
    const privateTower = v.observation.towers[own] || [];
    if (!completed(privateTower, v.team)) {
      if (privateTower.some(o => o.touchedBy)) return scan(v, state, 'private', '専有塔の作業完了待ち');
      const types = privateTower.length < 2 ? Array(2 - privateTower.length).fill('earth') : ['sky'];
      return construct(v, state, own, types, 'private', '専有' + F.spotNumbers[own] + 'を先に完成');
    }
    if (!current(v, 'tower:s2')) return decorate(v, { brain: v.brain, actions: [go(F.spotApproaches(F.spotById.s2, v.team)[0], '共有1を観測へ'), ...F.scanActions(v, F.spotApproaches(F.spotById.s2, v.team)[0])] }, state, 'scout', '共有1が未確認');
    if (!current(v, 'stock')) return decorate(v, { brain: v.brain, actions: [go(F.points[v.team].transferBR, '受渡在庫を確認'), ...F.scanActions(v, F.points[v.team].transferBR)] }, state, 'supply', '在庫が未確認');
    const shared = v.observation.towers.s2 || [];
    if (shared.some(o => o.touchedBy)) return scan(v, state, 'watch', '共有1の操作完了を待つ', true);
    if (completed(shared, v.team)) return scan(v, state, 'confirm', '共有完成・資格を再確認');
    if (shared.length === 3 && shared[2].type === 'sky') {
      if (S.blockCount(v.cargo) >= 2) return freeSlot(v, state, '共有Sky反転用の空きを確保');
      const plan = Planner.specifiedPlan(v, [], [{ type: 'flip', spotId: 's2' }]);
      return plan ? decorate(v, Efficient.execute(v, plan, '共有1を反転して資格取得'), state, 'claim', '共有1を反転して資格取得') : scan(v, state, 'replan', '反転先を再観測');
    }
    if (!state.armed) {
      const picked = pickup(v, ['earth', 'sky']);
      if (!picked) return S.blockCount(v.cargo) >= 2 ? freeSlot(v, state, 'E1+S1の受取枠を確保') : scan(v, state, 'supply', 'E1+S1が揃うまで再観測', true);
      if (picked.length) {
        const plan = Planner.specifiedPlan(v, picked, []);
        return plan ? decorate(v, Efficient.execute(v, plan, 'E1+S1を受取'), state, 'arm', 'E1+S1を受取') : scan(v, state, 'replan', '受取在庫を再観測', true);
      }
      state.armed = true; state.readyAt = v.time; state.deadline = Math.min(110, v.time + mode.seconds);
    }
    if (shared.length === 1 || shared.length === 2) {
      return construct(v, state, 's2', shared.length === 1 ? ['earth', 'sky'] : ['sky'], 'claim', '共有1の土台を利用して完成');
    }
    if (!state.selfBuild) {
      const approaching = mode.id === 'private-first-observe' && opponentApproaching(v, state);
      const target = F.scanPoint(v.team, F.points[v.team].brStandby, v.brObservationMode);
      const cost = Planner.travelTo(v, target) + v.motion.scanSeconds + .05;
      const waiting = v.time + cost <= state.deadline && (mode.id === 'private-first-short' || approaching);
      if (waiting) return scan(v, state, 'watch', mode.id === 'private-first-short' ? 'E1+S1で短時間待機' : '相手の共有1接近を見て待機', true);
      state.selfBuild = true; state.releasedAt = v.time;
    }
    return construct(v, state, 's2', ['earth'], 'self-build', '待機を終了・共有1に自分の土台を置く');
  }
  function details(team, id) {
    const mode = modes.find(m => m.id === id) || modes[0];
    return [['初動', F.spotNumbers[ownSpot(team)] + '番をE2→S1で完成'], ['次の手持ち', 'E1+S1 / 共有1番の土台を利用'],
      ['空の共有', mode.seconds ? mode.label + '・上限' + mode.seconds + '秒（観測・移動時間込み）' : '待たずE1を置き、追加E1で完成'],
      ['接近判断', '停止時の相手位置と前回位置のみ / 相手積載・未来は参照しない'],
      ['取得競争後', '資格成立・奉納確認・110秒以降はV2 / Mustika手渡し・奉納は共通優先']];
  }
  return { modes, builder, details, opponentApproaching };
});
