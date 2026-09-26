(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField,
    typeof module === 'object' ? require('./engine.js') : root.RoboSim,
    typeof module === 'object' ? require('./score-planner.js') : root.RoboScorePlanner);
  if (typeof module === 'object') module.exports = api;
  else root.RoboEfficient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, S, Planner) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const go = (target, label) => ({ type: 'move', target, label });
  const count = (items, type) => items.filter(o => o.type === type).length;
  const near = (a, b, radius = .14) => a && S.distance(a, b) <= radius;
  const homeScan = F.scanActions;
  const waitAtHome = (v, response) => v.brObservationMode === 'stopped'
    ? { ...response, brain: { ...response.brain, stage: 'choose' }, actions: [...(near(v, F.points[v.team].brStandby) ? [] : [go(F.points[v.team].brStandby, '受渡そばで動作待ち')]), { type: 'scan' }] }
    : F.surface(v).type === 'l2' ? { ...response, brain: { ...response.brain, stage: 'choose' }, actions: homeScan(v, F.points[v.team].home) } : response;

  function canStore(team, stock, cargo, reserved = []) {
    const state = copy(stock);
    for (const o of cargo) {
      const slot = S.Simulation.prototype.freeSlot.call({ stock: () => state, robot: () => ({ cargo: reserved.map((_, i) => i) }), object: i => reserved[i] }, team, o);
      if (!slot) return false;
      state.push({ ...o, slot: slot.id, layer: slot.layer, touchedBy: null });
    }
    return true;
  }
  function oneActionAway(v) {
    const obs = v.observation;
    if (!obs || obs.sanctuary) return false;
    const material = [...obs.stock, ...(obs.partner?.cargo || [])];
    const spots = F.spots.filter(p => !p.team || p.team === v.team).map(p => {
      const t = obs.towers[p.id] || [], ready = t.length === 3 && t[2].type === 'sky';
      return { shared: !p.team, done: ready && t[2].color === v.team,
        canFinish: ready && t[2].color !== v.team || t.length === 2 && t.every(o => o.type === 'earth') && material.some(o => o.type === 'sky') };
    });
    return spots.some(a => a.done && spots.some(b => b !== a && b.canFinish && (a.shared || b.shared)));
  }
  function demand(v) {
    const obs = v.observation, available = [...obs.stock, ...(obs.partner?.cargo || [])];
    const targets = F.spots.filter(p => (!p.team || p.team === v.team) && (obs.towers[p.id] || []).length < 3)
      .sort((a, b) => {
        const priority = p => (obs.towers[p.id]?.length || 0) * 4 + p.level;
        return priority(b) - priority(a) || S.distance(v, a) - S.distance(v, b);
      }).slice(0, 2);
    const need = { earth: Math.max(0, targets.reduce((n, p) => n + Math.max(0, 2 - (obs.towers[p.id]?.length || 0)), 0) - count(available, 'earth')),
      sky: Math.max(0, targets.length - count(available, 'sky')) };
    const selected = [];
    for (let i = 0; i < 3; i++) {
      const types = ['earth', 'sky'].filter(type => count(selected, type) < need[type])
        .sort((a, b) => need[b] / (count(selected, b) + 1) - need[a] / (count(selected, a) + 1));
      const type = types.find(type => {
        const o = { type, size: type === 'earth' ? .35 : .2, height: type === 'earth' ? .35 : .2 };
        return obs.source.some(item => item.type === type) && canStore(v.team, obs.stock, [...selected, o].sort((a, b) => b.size - a.size), obs.partner?.cargo || []);
      });
      if (!type) break;
      selected.push({ type, size: type === 'earth' ? .35 : .2, height: type === 'earth' ? .35 : .2 });
    }
    return { earth: count(selected, 'earth'), sky: count(selected, 'sky') };
  }
  function stockDemand(v) {
    const available = [...v.observation.stock, ...(v.observation.partner?.cargo || [])], chosen = { earth: count(v.cargo, 'earth'), sky: count(v.cargo, 'sky') };
    for (let i = v.cargo.length; i < 3; i++) {
      const types = ['earth', 'sky'].filter(type => v.observation.source.some(o => o.type === type && (!o.team || o.team === v.team) && (type !== 'sky' || (v.team === 'red' ? o.x <= 5.51 : o.x >= 5.49)))
        && count(available, type) + chosen[type] < F.stockLimits[type]);
      // Refill the least-covered buffer first; break ties towards Earth for stable points.
      types.sort((a, b) => v.brPlan === 'l2-earth' || v.brPlan === 'earth-late' && v.time < 150 ? (a === 'earth' ? -1 : 1)
        : (count(available, a) + chosen[a]) / F.stockLimits[a] - (count(available, b) + chosen[b]) / F.stockLimits[b]);
      if (!types.length) break;
      chosen[types[0]]++;
    }
    return chosen;
  }
  function mustikaDelivery(v) {
    if (!v.cargo.some(o => o.type === 'mustika')) return null;
    const p = F.points[v.team];
    return near(v, p.transferTR) ? { brain: { ...v.brain, stage: 'handoff' }, wait: .25, status: 'Mustika直接受渡待ち · TRが保持中' }
      : { brain: { ...v.brain, stage: 'handoff' }, actions: [go(p.transferTR, 'Mustika直接受渡へ')] };
  }
  function courier(v, opening, options = {}) {
    const delivery = mustikaDelivery(v); if (delivery) return delivery;
    const obs = v.observation, p = F.points[v.team], brain = { ...v.brain };
    const source = obs?.source || [], mustika = source.find(o => o.id === 'M');
    const mayDivert = !options.lockOpening || !opening.opening;
    const urgent = mayDivert && !!mustika && obs.sanctuary;
    const soon = mayDivert && !!mustika && oneActionAway(v) && v.time < 145;
    const completed = v.transport?.completed.length || 0;
    if (brain.trip !== completed || brain.stage === 'handoff') { delete brain.manifest; brain.stage = 'collect'; brain.trip = completed; }
    if (urgent && !v.cargo.length) return { brain: { ...brain, stage: 'mustika' }, actions: [go(p.mustika, '条件達成済 · Mustika取得へ'), { type: 'pickup', objectId: 'M' }] };
    if (soon && !v.cargo.length && (!brain.prepositionUntil || v.time < brain.prepositionUntil)) {
      brain.prepositionUntil ||= v.time + 16;
      if (!near(v, p.mustika)) return { brain, actions: [go(p.mustika, '条件達成に備えMustika前へ')] };
      return { brain, wait: .5, status: 'Mustika前待機 · 条件達成待ち' };
    }
    if (!soon) delete brain.prepositionUntil;
    if (v.cargo.length && (urgent || soon || v.transport?.pending.length)) brain.stage = 'deliver';
    if (options.stockTarget && !opening.opening && brain.stage !== 'deliver') brain.manifest = stockDemand(v);
    if (!brain.manifest) brain.manifest = opening.opening ? { earth: opening.earth, sky: opening.sky } : options.stockTarget ? stockDemand(v) : demand(v);
    const plan = brain.manifest, target = plan.earth + plan.sky;
    if (v.cargo.length >= target && v.cargo.length) brain.stage = 'deliver';
    if (brain.stage === 'deliver') {
      if (!v.cargo.length) { delete brain.manifest; brain.stage = 'collect'; return { brain, wait: .05 }; }
      const item = v.cargo.find(o => canStore(v.team, obs.stock, [o], obs.partner?.cargo || []));
      if (options.stockTarget && (!item || near(obs.partner, p.transferBR, .75))) {
        return near(v, p.stockStandby) ? { brain, wait: .75, status: '在庫待機 · 返却枠・BR動線を確保' }
          : { brain, actions: [go(p.stockStandby, '受渡位置を空けて待機')] };
      }
      if (!near(v, p.transferTR)) return { brain, actions: [go(p.transferTR, '必要なブロックを受け渡しへ')] };
      // A shared physical protocol: leave the stack unchanged while BR is at the receiving side.
      if (near(obs.partner, p.transferBR, .75)) return { brain, wait: .5, status: 'BR受取中 · 積み増し待機' };
      if (!item) return { brain, wait: .75, status: '種類別置場待ち · BR返却分を確保' };
      return { brain, actions: [{ type: 'unload', objectId: item.id }] };
    }
    if (!target) {
      delete brain.manifest;
      if (options.stockTarget && near(v, p.transferTR)) return { brain, actions: [go(p.stockStandby, '在庫充足 · 受渡位置を空ける')] };
      return { brain, wait: 2, status: '補給抑制 · 在庫消費待ち' };
    }
    const needed = ['earth', 'sky'].filter(type => count(v.cargo, type) < plan[type]);
    for (const type of needed) {
      const eligible = source.filter(o => o.type === type && !o.touchedBy && (!o.column || !source.some(t => t.column === o.column && t.layer > o.layer))
        && (type !== 'sky' || (v.team === 'red' ? o.x <= 5.51 : o.x >= 5.49)))
        .sort((a, b) => b.y - a.y || Math.abs(a.x - v.x) - Math.abs(b.x - v.x));
      if (!eligible.length) continue;
      const o = eligible[0], target = type === 'earth' ? { x: Math.max(.35, Math.min(10.65, o.x)), y: o.y + .65 } : { x: o.x + (v.team === 'red' ? -.65 : .65), y: o.y };
      return { brain, actions: [go(target, `${type === 'earth' ? 'Earth' : 'Sky'}必要数を採集`), { type: 'pickup', objectId: o.id }] };
    }
    if (v.cargo.length) return { brain: { ...brain, stage: 'deliver' }, wait: .05 };
    delete brain.manifest;
    return { brain, wait: 2, status: '必要な供給物なし' };
  }
  function execute(v, selected, note = '') {
    const summary = note || selected.tasks.map(a => a.type === 'enshrine' ? 'Mustika最優先奉納'
      : `${F.spotById[a.spotId].label} ${a.type === 'flip' ? 'Sky反転' : a.type === 'recover' ? 'Earth回収' : '配置'}`).join(' → ');
    const decision = { at: v.observation.at, strategy: v.brPlan || 'efficient', summary, gain: selected.gain, horizonGain: selected.horizonGain,
      seconds: +selected.completeSeconds.toFixed(2), horizonSeconds: +selected.horizonSeconds.toFixed(2), candidates: selected.candidates,
      tasks: copy(selected.tasks), receive: [...selected.picked], ...(selected.assessment ? { assessment: copy(selected.assessment) } : {}) };
    if (selected.picked.length) return { brain: { stage: 'choose' }, decision,
      actions: [go(F.points[v.team].transferBR, 'まとめ受取へ'), ...selected.picked.map(objectId => ({ type: 'receive', objectId })), ...homeScan(v, F.points[v.team].transferBR)] };
    return { brain: { stage: 'return' }, decision, actions: selected.tasks.flatMap(a => [go(a.type === 'enshrine' ? F.points[v.team].pillar : F.spotApproaches(F.spotById[a.spotId], v.team)[0], a.type === 'enshrine' ? 'Mustika奉納へ' : '効率化計画の作業先へ'), a]) };
  }
  function needsScan(v) { return v.failure || !v.observation || ['start', 'return'].includes(v.brain.stage) || v.brObservationMode !== 'stopped' && !F.atScanPoint(v.team, v); }
  function returnCargo(v, note = '置けない荷物を種類別置場へ返却') {
    const cargo = v.cargo.filter(o => o.type !== 'mustika');
    if (!cargo.length || !canStore(v.team, v.observation.stock, cargo)) return null;
    return { brain: { stage: 'choose' }, status: note, actions: [go(F.points[v.team].transferBR, note), ...cargo.map(o => ({ type: 'return', objectId: o.id })), ...homeScan(v, F.points[v.team].transferBR)] };
  }
  function handoffNext(v) {
    if (needsScan(v)) return null;
    if (!v.cargo.length && v.observation.sanctuary && v.observation.handoff) return {
      brain: { stage: 'loaded' }, actions: [go(F.points[v.team].transferBR, 'MustikaをTRから直接受取'), { type: 'receive', objectId: 'M' }, ...homeScan(v, F.points[v.team].transferBR)],
    };
    return null;
  }
  function defaultPlan(v, extra = {}) {
    const options = { efficient: true, requirePair: true, noRecover: true, ...extra };
    const build = v.time < 150 ? Planner.plan(v, { ...options, onlyPlace: true }) : null;
    if (build) return build;
    const selected = Planner.plan(v, options);
    if (selected && !v.cargo.length && !selected.picked.length && selected.tasks.every(a => a.type === 'flip')) return Planner.flipBatch(v, options) || selected;
    return selected;
  }
  function builder(v, selectPlan = defaultPlan, options = {}) {
    if (v.brObservationMode !== 'stopped' && v.failure && ['place', 'flip'].includes(v.failure.action) && v.enteredL1 && ['l1', 'l2'].includes(F.surface(v).type)) {
      return { brain: { stage: 'local-plan' }, actions: [{ type: 'scan', local: true }], status: '配置先変更 · その場で再認識' };
    }
    if (v.brain.stage === 'local-plan' && !v.failure && v.observation?.local) {
      const selected = selectPlan(v, { noPickup: true, oneSortie: true, origin: { x: v.x, y: v.y }, clearCargo: !!v.cargo.length, requirePair: false });
      const back = returnCargo(v), returnSeconds = Planner.travelTo(v, F.points[v.team].transferBR) + v.cargo.length * v.motion.pickupSeconds;
      if (selected && (!back || selected.completeSeconds <= returnSeconds + v.motion.scanSeconds + 4)) return execute(v, selected, '現地再計画 · 別の配置先へ');
      if (back) return back;
      return { brain: { stage: 'choose' }, actions: homeScan(v) };
    }
    if (needsScan(v)) return { brain: { ...v.brain, stage: 'choose' }, actions: homeScan(v) };
    const obs = v.observation, partner = obs.partner, p = F.points[v.team];
    const incoming = partner?.cargo.some(o => o.type === 'mustika');
    if (v.cargo.some(o => o.type === 'mustika')) {
      const plan = Planner.plan(v, { efficient: true, clearCargo: true });
      return plan ? execute(v, plan) : { brain: { ...v.brain, stage: 'return' }, wait: 1, status: 'Mustika奉納の残り時間不足' };
    }
    const handoff = handoffNext(v); if (handoff) return handoff;
    if (obs.sanctuary && (incoming || obs.source.some(o => o.id === 'M') && !partner?.cargo.length) && v.cargo.length) {
      const back = returnCargo(v, 'Mustika受取準備 · 通常ブロックを返却');
      if (back) return back;
    }
    const sourceMustika = obs.source.some(o => o.id === 'M');
    if (obs.sanctuary && !v.cargo.length && (incoming || sourceMustika && !partner?.cargo.length)) {
      const since = v.brain.mustikaWaitSince ?? v.time;
      if (v.time - since < 18 && v.time < 163) return waitAtHome(v, { brain: { ...v.brain, stage: 'return', mustikaWaitSince: since }, wait: 1, status: 'Mustika受取準備 · 空手で待機' });
    }
    const normalDelivery = partner?.cargo.filter(o => o.type !== 'mustika') || [];
    const loading = v.cargo.length < 2 && near(partner, p.transferTR, .3) && normalDelivery.length && canStore(v.team, obs.stock, [normalDelivery[0]], v.cargo);
    const canWaitForPair = !v.cargo.length && normalDelivery.length && obs.stock.length < 2 && S.distance(partner, p.transferTR) < 2.5;
    if (!options.skipSupplyWait && (loading || canWaitForPair) && !incoming && v.time < 158) {
      const since = v.brain.supplyWaitSince ?? v.time;
      if (v.time - since < 6) return waitAtHome(v, { brain: { ...v.brain, stage: 'return', supplyWaitSince: since }, wait: 1, status: '補給待ち · まとめ受取の準備' });
    }
    const clearSupply = obs.sanctuary && sourceMustika && normalDelivery.length && !canStore(v.team, obs.stock, [normalDelivery[0]], v.cargo);
    const selected = selectPlan(v, { onlyPlace: !!clearSupply });
    if (selected) return execute(v, selected);
    if (v.cargo.length) {
      const back = returnCargo(v); if (back) return back;
    }
    return waitAtHome(v, { brain: { stage: 'return' }, wait: 2, status: '配置計画待ち · 補給・盤面を再確認' });
  }
  return { courier, builder, mustikaDelivery, handoffNext, oneActionAway, demand, stockDemand, canStore, returnCargo, execute, waitAtHome, needsScan };
});
