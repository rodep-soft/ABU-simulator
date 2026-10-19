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
  const localMode = v => v.brObservation?.replan === 'after-work';
  const homeScan = F.scanActions;
  const waitAtHome = (v, response) => localMode(v) ? response : v.brObservationMode === 'stopped'
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
  function qualificationForecast(v) {
    const obs = v.observation;
    if (!obs || obs.sanctuary || obs.pillar?.placedBy) return null;
    const material = [...obs.stock, ...(obs.partner?.cargo || [])].filter(o => !o.touchedBy || o.holder || o.touchedBy === v.team + 'BR');
    const spots = F.spots.filter(p => !p.team || p.team === v.team).map(p => ({ ...p, tower: obs.towers[p.id] || [] }));
    const done = spots.filter(p => p.tower.length === 3 && p.tower[2].type === 'sky' && p.tower[2].color === v.team && p.tower.every(o => !o.touchedBy));
    const candidates = spots.filter(p => done.some(a => a.id !== p.id && (!a.team || !p.team)) && p.tower.every(o => !o.touchedBy));
    if (oneActionAway(v)) return { priority: 3, seconds: 16, reason: '反転またはSky配置で資格成立' };
    if (candidates.some(p => p.tower.length === 1 && p.tower[0].type === 'earth' && count(material, 'earth') && count(material, 'sky')))
      return { priority: 2, seconds: 24, reason: 'E1+S1で資格成立' };
    // A short speculative window for an opponent foundation, never assumed to exist.
    if (candidates.some(p => !p.team && !p.tower.length) && count(material, 'earth') && count(material, 'sky'))
      return { priority: 1, seconds: 16, reason: '共有土台待ちのE1+S1を準備済' };
    return null;
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
    if (!need.sky) {
      const room = F.spots.filter(p => (!p.team || p.team === v.team) && Object.hasOwn(obs.towers, p.id)
        && (!obs.visibility || ['current', 'self-action'].includes(obs.visibility.entries[`tower:${p.id}`]?.status)))
        .reduce((sum, p) => { const t = obs.towers[p.id]; return sum + (t.length < 2 && t.every((o, i) => o.type === 'earth' && o.layer === i && !o.touchedBy) ? 2 - t.length : 0); }, 0);
      // Keep a small Earth buffer beyond the two currently most-developed towers.
      need.earth = Math.max(need.earth, Math.min(2, room) - count(available, 'earth'));
    }
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
  function sourcePoint(o, team) {
    return o.type === 'earth' ? { x: Math.max(.35, Math.min(10.65, o.x)), y: o.y + .65 }
      : { x: o.x + (team === 'red' ? -.65 : .65), y: o.y };
  }
  function deliveryBudget(v, extra = null) {
    const motion = { ...S.DEFAULTS, ...v.motion }, transfer = F.points[v.team].transferTR;
    let travel = 0, from = v;
    if (extra) {
      const point = sourcePoint(extra, v.team);
      travel += Planner.travelTo(v, point);
      from = { ...v, ...point, observation: { ...v.observation, source: v.observation.source.filter(o => o.id !== extra.id) } };
    }
    travel += near(from, transfer) ? 0 : Planner.travelTo(from, transfer);
    const pickupSeconds = extra ? S.actionSeconds(motion, 'pickup') : 0;
    const unloadSeconds = S.actionSeconds(motion, 'unload') + .05;
    const reserve = .1 + .02 * travel + (near(v.observation.partner, F.points[v.team].transferBR, .75) ? .5 : 0);
    const count = v.cargo.filter(o => o.type !== 'mustika').length + (extra ? 1 : 0);
    const seconds = travel + pickupSeconds + count * unloadSeconds + reserve;
    return { seconds, travel, reserve, count, fits: v.time + seconds < 180 - .05,
      deliverable: Math.max(0, Math.min(count, Math.floor((180 - v.time - travel - pickupSeconds - reserve - .05) / unloadSeconds))) };
  }
  function usableSupply(v, extra = null) {
    const obs = v.observation, partner = obs?.partner, visibility = obs?.visibility?.entries;
    const current = key => !visibility || ['current', 'self-action'].includes(visibility[key]?.status);
    if (!partner || !Number.isFinite(partner.x) || !Number.isFinite(partner.y) || !v.partnerMotion
      || !current('partner') || !current('stock') || !['l1', 'l2', 'upperStairs', 'transfer'].includes(F.surface(partner).type)
      || partner.cargo.some(o => o.type === 'mustika')) return { known: false };
    const incoming = [...v.cargo.filter(o => o.type !== 'mustika'), ...(extra ? [extra] : [])];
    const stock = copy(obs.stock), cargo = copy(partner.cargo);
    for (const item of incoming) {
      const slot = S.Simulation.prototype.freeSlot.call({ stock: () => stock,
        robot: () => ({ cargo: cargo.map(o => o.id) }), object: id => cargo.find(o => o.id === id) }, v.team, item);
      if (!slot) return { known: false };
      stock.push({ ...copy(item), ...slot, id: item.id, slot: slot.id, location: 'transfer', transferTeam: v.team, touchedBy: null });
    }
    const budget = incoming.length ? deliveryBudget(v, extra) : { seconds: 0 };
    const mode = v.partnerObservation?.mode || v.brObservationMode;
    const model = { id: `${v.team}BR`, role: 'BR', team: v.team, ...partner, cargo, motion: v.partnerMotion, enteredL1: true,
      brObservationMode: mode, brObservation: v.partnerObservation?.replan === 'after-work' ? { replan: 'after-work' } : undefined,
      time: v.time + budget.seconds,
      observation: { ...copy(obs), stock, source: obs.source.filter(o => !incoming.some(i => i.id === o.id)),
        towers: Object.fromEntries(Object.entries(copy(obs.towers)).filter(([id]) => current(`tower:${id}`))) } };
    const scanPoint = F.scanPoint(v.team, partner, model.brObservation?.replan === 'after-work' ? 'stopped' : mode);
    model.time += (near(model, scanPoint, .02) ? 0 : Planner.travelTo(model, scanPoint)) + model.motion.scanSeconds;
    Object.assign(model, scanPoint);
    const introduced = new Set(incoming.map(o => o.id)), used = [], tasks = [];
    let gain = 0;
    // This is a bounded hypothetical workload, not the partner's controller or queue.
    for (let round = 0; round < 3 && model.time < 180; round++) {
      const plan = Planner.plan(model, { oneSortie: true, onlyPlace: true, noRecover: true, requirePair: false, allowRefill: true,
        rank: (c, h) => [ (h.gain - h.opponentGain) / (c.completeSeconds + model.motion.scanSeconds), h.gain - h.opponentGain, -c.completeSeconds ] });
      if (!plan) break;
      for (const [i, action] of plan.tasks.entries()) if (action.type === 'place' && introduced.has(action.objectId)) {
        used.push(action.objectId); tasks.push({ objectId: action.objectId, spotId: action.spotId, at: model.time + plan.taskTimes[i] });
      }
      gain += plan.gain - plan.opponentGain;
      model.time += plan.cycleSeconds;
      Object.assign(model, plan.returnPoint, { cargo: plan.state.cargo,
        observation: { ...model.observation, towers: plan.state.towers, stock: plan.state.stock, sanctuary: plan.state.sanctuary } });
    }
    return { known: true, used, tasks, gain, arrival: v.time + budget.seconds, end: model.time };
  }
  function courier(v, opening, options = {}) {
    const delivery = mustikaDelivery(v); if (delivery) return delivery;
    const obs = v.observation, p = F.points[v.team], brain = { ...v.brain };
    const source = obs?.source || [], mustika = source.find(o => o.id === 'M' && !o.touchedBy);
    const mayDivert = !options.lockOpening || !opening.opening;
    const urgent = mayDivert && !!mustika && obs.sanctuary;
    const forecast = mayDivert && mustika && v.time < 145 ? qualificationForecast(v) : null;
    const completed = v.transport?.completed.length || 0;
    if (brain.trip !== completed || brain.stage === 'handoff') { delete brain.manifest; brain.stage = 'collect'; brain.trip = completed; }
    if (urgent && !v.cargo.length) return { brain: { ...brain, stage: 'mustika' }, actions: [go(p.mustika, '条件達成済 · Mustika取得へ'), { type: 'pickup', objectId: 'M' }] };
    if (forecast && !v.cargo.length && (!brain.prepositionUntil || forecast.priority > (brain.prepositionPriority || 0))) {
      brain.prepositionSince ??= v.time;
      brain.prepositionUntil = Math.min(brain.prepositionSince + 40, v.time + forecast.seconds);
      brain.prepositionPriority = forecast.priority;
    }
    const soon = !!forecast && (brain.prepositionUntil === undefined ? v.cargo.length > 0 : v.time < brain.prepositionUntil);
    if (soon && !v.cargo.length) {
      if (!near(v, p.mustika)) return { brain, actions: [go(p.mustika, '条件達成に備えMustika前へ')] };
      return { brain, wait: .5, status: 'Mustika前待機 · 条件達成待ち' };
    }
    if (!forecast) for (const key of ['prepositionUntil', 'prepositionSince', 'prepositionPriority']) delete brain[key];
    if (v.cargo.length && (urgent || soon || v.transport?.pending.length)) brain.stage = 'deliver';
    if (options.stockTarget && !opening.opening && brain.stage !== 'deliver') brain.manifest = stockDemand(v);
    if (!brain.manifest) brain.manifest = opening.opening ? { earth: opening.earth, sky: opening.sky } : options.stockTarget ? stockDemand(v) : demand(v);
    const plan = brain.manifest, target = plan.earth + plan.sky;
    if (v.cargo.length >= target && v.cargo.length) brain.stage = 'deliver';
    const deadline = v.supplyMode === 'normal' && !opening.opening && !v.trTrips?.length;
    const endgame = deadline && v.time >= 120;
    if (brain.stage === 'deliver') {
      if (!v.cargo.length) { delete brain.manifest; brain.stage = 'collect'; return { brain, wait: .05 }; }
      if (deadline && !deliveryBudget(v).deliverable) return { brain, wait: Math.min(2, Math.max(.05, 180 - v.time)), status: '終盤締切 · 納品完了の時間不足' };
      const use = endgame && near(v, p.transferTR) ? usableSupply(v) : null;
      const order = id => { const i = use?.tasks?.findIndex(t => t.objectId === id); return i >= 0 ? i : 100; };
      const item = [...v.cargo].sort((a, b) => order(a.id) - order(b.id))
        .find(o => canStore(v.team, obs.stock, [o], obs.partner?.cargo || []));
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
    const directUse = endgame ? usableSupply(v) : null;
    const needed = ['earth', 'sky'].filter(type => directUse?.known ? v.cargo.length < 3 : count(v.cargo, type) < plan[type]);
    let latePickup = false, noUse = false;
    const candidates = [];
    const assessment = endgame ? { at: v.observation.at, direct: directUse, candidates: [] } : null;
    for (const type of needed) {
      const eligible = source.filter(o => o.type === type && !o.touchedBy && (!o.column || !source.some(t => t.column === o.column && t.layer > o.layer))
        && (type !== 'sky' || (v.team === 'red' ? o.x <= 5.51 : o.x >= 5.49)))
        .sort((a, b) => b.y - a.y || Math.abs(a.x - v.x) - Math.abs(b.x - v.x));
      if (!eligible.length) continue;
      const o = eligible[0], target = sourcePoint(o, v.team);
      if (endgame && !canStore(v.team, obs.stock, [...v.cargo, o].sort((a, b) => b.size - a.size), obs.partner?.cargo || [])) continue;
      const budget = deadline ? deliveryBudget(v, o) : null;
      if (budget && !budget.fits) {
        assessment?.candidates.push({ objectId: o.id, type: o.type, budget, reason: 'delivery-deadline' });
        latePickup = true; continue;
      }
      const use = endgame ? usableSupply(v, o) : null;
      const useful = !use?.known || use.used.includes(o.id) && (!directUse?.known || use.gain > directUse.gain);
      assessment?.candidates.push({ objectId: o.id, type: o.type, budget, use, reason: useful ? 'usable-or-unknown' : 'no-marginal-work' });
      if (!useful) { noUse = true; continue; }
      candidates.push({ o, target, gain: use?.known && directUse?.known ? use.gain - directUse.gain : 0,
        seconds: budget?.seconds || 0 });
      if (!endgame) break;
    }
    candidates.sort((a, b) => b.gain / Math.max(1, b.seconds) - a.gain / Math.max(1, a.seconds));
    if (candidates.length) {
      const { o, target } = candidates[0];
      if (directUse?.known) {
        brain.manifest = { earth: count(v.cargo, 'earth'), sky: count(v.cargo, 'sky') }; brain.manifest[o.type]++;
        for (const type of ['earth', 'sky']) brain.manifest[type] += Math.min(Math.max(0, plan[type] - brain.manifest[type]), 3 - brain.manifest.earth - brain.manifest.sky);
      }
      return { brain, ...(assessment ? { supplyAssessment: { ...assessment, selected: o.id } } : {}),
        actions: [go(target, `${o.type === 'earth' ? 'Earth' : 'Sky'}必要数を採集`), { type: 'pickup', objectId: o.id }] };
    }
    if (v.cargo.length) {
      if (deadline && !deliveryBudget(v).deliverable) return { brain, wait: Math.min(2, Math.max(.05, 180 - v.time)), status: '終盤締切 · 手持ち箱の納品も時間不足' };
      return { brain: { ...brain, stage: 'deliver' }, wait: .05, ...(assessment ? { supplyAssessment: assessment } : {}), ...(latePickup ? { status: '終盤締切 · 追加採集をやめ手持ちを納品' }
        : noUse ? { status: '終盤補給 · 使える手持ちを先に納品' } : {}) };
    }
    delete brain.manifest;
    if (latePickup) return { brain, ...(assessment ? { supplyAssessment: assessment } : {}), wait: Math.min(2, Math.max(.05, 180 - v.time)), status: '終盤締切 · 次便を見送る' };
    if (noUse) return { brain, supplyAssessment: assessment, wait: Math.min(2, Math.max(.05, 180 - v.time)), status: '終盤補給 · BRが使える追加箱なし' };
    return { brain, wait: 2, status: '必要な供給物なし' };
  }
  function execute(v, selected, note = '') {
    const summary = note || selected.tasks.map(a => a.type === 'enshrine' ? 'Mustika最優先奉納'
      : `${F.spotById[a.spotId].label} ${a.type === 'flip' ? 'Sky反転' : a.type === 'recover' ? 'Earth回収' : '配置'}`).join(' → ');
    const decision = { at: v.observation.at, strategy: v.brPlan || 'efficient', summary, gain: selected.gain, horizonGain: selected.horizonGain,
      seconds: +selected.completeSeconds.toFixed(2), horizonSeconds: +selected.horizonSeconds.toFixed(2), candidates: selected.candidates,
      tasks: copy(selected.tasks), receive: [...selected.picked], ...(selected.assessment ? { assessment: copy(selected.assessment) } : {}) };
    if (selected.picked.length) return { brain: { stage: 'choose' }, decision,
      actions: [go(F.points[v.team].transferBR, 'まとめ受取へ'), ...(localMode(v) ? selected.picked.slice(0, 1) : selected.picked).map(objectId => ({ type: 'receive', objectId })), ...(localMode(v) ? [] : homeScan(v, F.points[v.team].transferBR))] };
    return { brain: { stage: 'return' }, decision, actions: (localMode(v) ? selected.tasks.slice(0, 1) : selected.tasks).flatMap(a => [go(a.type === 'enshrine' ? F.points[v.team].pillar : F.spotApproaches(F.spotById[a.spotId], v.team)[0], a.type === 'enshrine' ? 'Mustika奉納へ' : '効率化計画の作業先へ'), a]) };
  }
  function receiveAtTransfer(v, response) {
    if (v.role !== 'BR' || v.supplyMode !== 'normal' || v.brObservationMode !== 'stopped' && !localMode(v)) return response;
    const index = response.actions?.findIndex(a => a.type === 'receive' && a.objectId !== 'M');
    if (!(index >= 0)) return response;
    const transfer = F.points[v.team].transferBR;
    const here = near(v, transfer), observedHere = near(v.observation?.origin, transfer);
    const work = v.observation?.transferWork;
    const busy = work?.unloading && (!v.observation.visibility || v.observation.visibility.entries.transferWork?.status === 'current');
    if (here && observedHere && !busy) return response;
    // Do not carry source-side object IDs through a changing transfer stack.
    return { ...response, brain: { ...response.brain, stage: 'choose' },
      actions: [...(!here ? [go(transfer, '受渡到着後に箱を選び直す')] : []), { type: 'scan', ...(localMode(v) ? { local: true } : {}) }],
      status: busy ? 'TR荷下ろし完了待ち · 在庫を再観測' : '受渡位置で在庫を再確認' };
  }
  function needsScan(v) {
    if (localMode(v)) return v.failure || !v.observation || v.needsWorkScan || !v.scanLoaded || v.brain.stage === 'return';
    return v.failure || !v.observation || ['start', 'return'].includes(v.brain.stage) || v.brObservationMode !== 'stopped' && !F.atScanPoint(v.team, v);
  }
  function returnCargo(v, note = '置けない荷物を種類別置場へ返却') {
    const cargo = v.cargo.filter(o => o.type !== 'mustika');
    if (!cargo.length || !canStore(v.team, v.observation.stock, cargo)) return null;
    return { brain: { stage: 'choose' }, status: note, actions: [go(F.points[v.team].transferBR, note), ...(localMode(v) ? cargo.slice(0, 1) : cargo).map(o => ({ type: 'return', objectId: o.id })), ...(localMode(v) ? [] : homeScan(v, F.points[v.team].transferBR))] };
  }
  function handoffNext(v) {
    if (needsScan(v)) return null;
    if (!v.cargo.some(o => o.type === 'mustika') && v.observation.sanctuary && v.observation.handoff) return {
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
    if (localMode(v) && !v.enteredL1) return { brain: { ...v.brain, stage: 'choose', initialSupplyWait: true }, actions: homeScan(v) };
    if (v.observation && !v.observation.partner) v = { ...v, observation: { ...v.observation, partner: { x: Infinity, y: Infinity, cargo: [] } } };
    if (localMode(v) && needsScan(v)) return { brain: { ...v.brain, stage: 'choose' }, actions: homeScan(v) };
    if (!localMode(v) && v.brObservationMode !== 'stopped' && v.failure && ['place', 'flip'].includes(v.failure.action) && v.enteredL1 && ['l1', 'l2'].includes(F.surface(v).type)) {
      return { brain: { stage: 'local-plan' }, actions: [{ type: 'scan', local: true }], status: '配置先変更 · その場で再認識' };
    }
    if (v.brain.stage === 'local-plan' && !v.failure && v.observation?.local) {
      const selected = selectPlan(v, { noPickup: true, oneSortie: true, origin: { x: v.x, y: v.y }, clearCargo: !!v.cargo.length, requirePair: false });
      const back = returnCargo(v), returnSeconds = Planner.travelTo(v, F.points[v.team].transferBR) + v.cargo.length * S.actionSeconds(v.motion, 'return');
      if (selected && (!back || selected.completeSeconds <= returnSeconds + v.motion.scanSeconds + 4)) return execute(v, selected, '現地再計画 · 別の配置先へ');
      if (back) return back;
      return { brain: { stage: 'choose' }, actions: homeScan(v) };
    }
    if (needsScan(v)) return { brain: { ...v.brain, stage: 'choose' }, actions: homeScan(v) };
    const obs = v.observation, partner = obs.partner, p = F.points[v.team], pursueMustika = options.pursueMustika !== false;
    const incoming = partner?.cargo.some(o => o.type === 'mustika');
    if (v.cargo.some(o => o.type === 'mustika')) {
      const plan = Planner.plan(v, { efficient: true, noPickup: true, oneSortie: true, onlyEnshrine: true });
      return plan ? execute(v, plan) : { brain: { ...v.brain, stage: 'return' }, wait: 1, status: 'Mustika奉納の残り時間不足' };
    }
    const handoff = pursueMustika ? handoffNext(v) : null; if (handoff) return handoff;
    const sourceMustika = pursueMustika && obs.source.some(o => o.id === 'M');
    if (pursueMustika && obs.sanctuary && !v.cargo.length && (incoming || sourceMustika && !partner?.cargo.length)) {
      const since = v.brain.mustikaWaitSince ?? v.time;
      if (v.time - since < 18 && v.time < 163) return waitAtHome(v, { brain: { ...v.brain, stage: 'return', mustikaWaitSince: since }, wait: 1, status: 'Mustika受取準備 · 空手で待機' });
    }
    if (options.preferLocalWork) {
      const local = selectPlan(v, { noPickup: true, oneSortie: true, requirePair: false, noRecover: true });
      if (local && !local.picked.length) return execute(v, local, '現地の作業を優先');
    }
    const normalDelivery = partner?.cargo.filter(o => o.type !== 'mustika') || [];
    const loading = v.cargo.length < 2 && near(partner, p.transferTR, .3) && normalDelivery.length && canStore(v.team, obs.stock, [normalDelivery[0]], v.cargo);
    const canWaitForPair = !v.cargo.length && normalDelivery.length && obs.stock.length < 2 && S.distance(partner, p.transferTR) < 2.5;
    if (!options.skipSupplyWait && (loading || canWaitForPair) && !incoming && v.time < 158) {
      const since = v.brain.supplyWaitSince ?? v.time;
      if (v.time - since < 6) return waitAtHome(v, { brain: { ...v.brain, stage: 'return', supplyWaitSince: since }, wait: 1, status: '補給待ち · まとめ受取の準備' });
    }
    const clearSupply = obs.sanctuary && sourceMustika && normalDelivery.length && !canStore(v.team, obs.stock, [normalDelivery[0]], v.cargo);
    if (obs.visibility && !v.cargo.length && obs.visibility.entries.stock?.status !== 'current') {
      return { brain: { stage: 'choose' }, actions: [go(p.transferBR, '在庫を確認へ'), ...homeScan(v, p.transferBR)] };
    }
    const selected = selectPlan(v, { onlyPlace: !!clearSupply });
    if (selected) return execute(v, selected);
    if (v.cargo.length) {
      const back = returnCargo(v); if (back) return back;
    }
    if (localMode(v) && v.brain.initialSupplyWait && !v.cargo.length) return { brain: { ...v.brain, stage: 'return' }, wait: 1, status: '受渡そばで初回補給待ち' };
    const scout = scoutNext(v); if (scout) return scout;
    return waitAtHome(v, { brain: { stage: 'return' }, wait: 2, status: '配置計画待ち · 補給・盤面を再確認' });
  }
  function scoutNext(v) {
    if (!v.observation?.visibility) return null;
    const allowed = v.brOpeningActive ? (v.team === 'red' ? ['s2', 'r2', 'u3'] : ['s2', 'b2', 'u4']) : F.spots.filter(s => !s.team || s.team === v.team).map(s => s.id);
    const candidates = localMode(v) ? allowed.map(id => F.spotApproaches(F.spotById[id], v.team)[0]) : [F.points[v.team].home, F.points[v.team].homeL2];
    const entries = v.observation.visibility.entries, radius = v.brObservation.crossLevelRadius;
    const value = point => allowed.reduce((sum, id) => {
      const s = F.spotById[id], m = entries[`tower:${id}`], seen = (F.surface(point).type === 'l2' ? 2 : 1) === s.level || S.distance(point, s) <= radius;
      return sum + (seen && m?.status !== 'current' ? (m?.status === 'unknown' ? 1000 : Math.min(180, v.time - (m?.observedAt ?? 0))) : 0);
    }, 0);
    const target = candidates.filter(p => S.distance(v, p) > .15).sort((a, b) => value(b) - value(a) || S.distance(v, a) - S.distance(v, b))[0];
    if (!target || value(target) <= 0 || !Number.isFinite(Planner.travelTo(v, target))) return null;
    return { brain: { ...v.brain, stage: 'choose' }, actions: [go(target, '未確認の盤面を観測へ'), { type: 'scan', ...(localMode(v) ? { local: true } : {}) }], status: '情報不足のため観測移動' };
  }
  return { courier, builder, mustikaDelivery, handoffNext, oneActionAway, qualificationForecast, receiveAtTransfer, demand, stockDemand, canStore, deliveryBudget, usableSupply, returnCargo, execute, waitAtHome, needsScan };
});
