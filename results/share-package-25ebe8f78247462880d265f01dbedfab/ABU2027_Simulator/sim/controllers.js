(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField,
    typeof module === 'object' ? require('./score-planner.js') : root.RoboScorePlanner);
  if (typeof module === 'object') module.exports = api;
  else root.RoboControllers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, Planner) {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  const go = (target, label) => ({ type: 'move', target, label });
  function spotOrder(team) { return team === 'red' ? ['r2', 's2', 'r1', 's1', 'u3', 'u1', 'u4', 'u2'] : ['b2', 's1', 'b1', 's2', 'u2', 'u4', 'u1', 'u3']; }
  function placement(type, team, towers) {
    return spotOrder(team).find(id => {
      const t = towers[id] || [];
      return type === 'earth' ? t.length < 2 && t.every(o => o.type === 'earth') : type === 'sky' && t.length === 2 && t.every(o => o.type === 'earth');
    });
  }
  function sourceApproach(o, team) {
    if (o.type === 'earth') return { x: Math.max(.35, Math.min(10.65, o.x)), y: o.y + .65 };
    if (o.type === 'mustika') return F.points[team].mustika;
    return { x: o.x + (team === 'red' ? -.65 : .65), y: o.y };
  }
  function transportPlan(id, completed = 0) {
    const strategy = resolveStrategy('TR', id), opening = completed < strategy.opening.length;
    return { ...(opening ? strategy.opening[completed] : strategy.repeat), opening };
  }
  function courier(v) {
    const brain = { ...v.brain }, p = F.points[v.team];
    const plan = transportPlan(v.trPlan, v.transport?.completed.length || 0);
    const targetCount = plan.earth + plan.sky;
    if (brain.stage === 'start') brain.stage = v.transport?.pending.length || v.cargo.length >= targetCount || v.cargo.some(o => o.type === 'mustika') ? 'deliver' : 'collect';
    if (v.failure) return { brain, wait: 1.5 };
    if (brain.stage === 'deliver') {
      if (v.cargo.length) return { brain, actions: [go(p.transferTR, '受け渡しへ'), { type: 'unload' }] };
      brain.stage = 'collect';
    }
    const source = v.observation?.source || [];
    if (!plan.opening && !v.cargo.length && v.observation?.sanctuary && source.some(o => o.type === 'mustika')) {
      return { brain: { stage: 'deliver' }, actions: [go(p.mustika, 'Mustikaへ'), { type: 'pickup', objectId: 'M' }] };
    }
    if (v.cargo.length >= targetCount) return { brain: { stage: 'deliver' }, actions: [go(p.transferTR, '受け渡しへ')] };
    const type = v.cargo.filter(o => o.type === 'earth').length < plan.earth ? 'earth' : 'sky';
    const eligible = source.filter(o => o.type === type && !o.touchedBy && (!o.column || !source.some(t => t.column === o.column && t.layer > o.layer)) && (o.type !== 'sky' || (v.team === 'red' ? o.x <= 5.51 : o.x >= 5.49)));
    eligible.sort((a, b) => b.y - a.y || Math.abs(a.x - v.x) - Math.abs(b.x - v.x));
    if (!eligible.length) {
      if (v.cargo.length && !plan.opening) return { brain: { stage: 'deliver' }, actions: [go(p.transferTR, '受け渡しへ')] };
      return { brain, wait: 2 };
    }
    const o = eligible[0];
    return { brain, actions: [go(sourceApproach(o, v.team), `${o.type === 'earth' ? 'Earth' : 'Sky'}採集へ`), { type: 'pickup', objectId: o.id }] };
  }
  function builder(v) {
    const brain = { ...v.brain }, p = F.points[v.team], scan = () => [go(p.home, '見渡し場所へ'), { type: 'scan' }];
    if (v.failure || brain.stage === 'start' || brain.stage === 'return') return { brain: { stage: v.cargo.length ? 'loaded' : 'choose' }, actions: scan() };
    if (brain.stage === 'loaded') {
      const towers = copy(v.observation?.towers || {}), actions = [];
      for (const o of v.cargo) {
        if (o.type === 'mustika') { actions.push(go(p.pillar, '中央柱へ'), { type: 'enshrine' }); break; }
        const id = placement(o.type, v.team, towers); if (!id) continue;
        actions.push(go(F.spotApproaches(F.spotById[id], v.team)[0], `${F.spotById[id].label}へ`), { type: 'place', spotId: id, objectId: o.id });
        (towers[id] ||= []).push({ type: o.type, color: v.team });
      }
      return actions.length ? { brain: { stage: 'return' }, actions } : { brain: { stage: 'return' }, wait: 2 };
    }
    const stock = copy(v.observation?.stock || []), towers = copy(v.observation?.towers || {}), selected = [];
    const mustika = stock.find(o => o.type === 'mustika');
    if (mustika && v.observation.sanctuary) selected.push(mustika);
    else for (let i = 0; i < 2; i++) {
      const tops = stock.filter(o => o.type !== 'mustika' && !stock.some(t => t.slot === o.slot && t.layer > o.layer));
      let choice = null;
      for (const id of spotOrder(v.team)) {
        const t = towers[id] || [], type = t.length < 2 ? 'earth' : t.length === 2 ? 'sky' : null;
        const o = tops.find(item => item.type === type); if (!o) continue;
        choice = o; (towers[id] ||= []).push({ type }); break;
      }
      if (!choice) break;
      selected.push(choice); stock.splice(stock.findIndex(o => o.id === choice.id), 1);
    }
    if (selected.length) return { brain: { stage: 'loaded' }, actions: [go(p.transferBR, '受け渡しへ'), ...selected.map(o => ({ type: 'receive', objectId: o.id })), ...scan()] };
    const flip = spotOrder(v.team).find(id => { const t = towers[id]; return t?.length === 3 && t[2].type === 'sky' && t[2].color !== v.team; });
    if (flip) return { brain: { stage: 'return' }, actions: [go(F.spotApproaches(F.spotById[flip], v.team)[0], 'Sky反転へ'), { type: 'flip', spotId: flip }] };
    return { brain: { stage: 'return' }, wait: 1 };
  }
  function splitTargets(team) { return team === 'red' ? ['s2', 'r2'] : ['s1', 'b2']; }
  function splitPlan(v, cargo, allowFallback = false) {
    // Lexicographic policy priorities: flip, seed, shared cap, private cap, private Earth, later work.
    const towers = copy(v.observation?.towers || {}), held = [...cargo], tasks = [], rank = [0, 0, 0, 0, 0, 0];
    const [shared, privateSpot] = splitTargets(v.team), limit = Math.max(1, cargo.length);
    const tower = id => towers[id] || [];
    const free = id => tower(id).every(o => !o.touchedBy);
    const earthTower = id => tower(id).every(o => o.type === 'earth');
    const complete = id => tower(id).length === 3 && tower(id)[0].type === 'earth' && tower(id)[1].type === 'earth' && tower(id)[2].type === 'sky' && tower(id)[2].color === v.team;
    const place = (o, id, priority) => {
      tasks.push({ type: 'place', objectId: o.id, spotId: id });
      held.splice(held.indexOf(o), 1); (towers[id] ||= []).push({ ...o, color: v.team, touchedBy: null }); rank[priority]++;
    };
    while (tasks.length < limit) {
      const top = tower(shared).at(-1), earth = held.find(o => o.type === 'earth'), sky = held.find(o => o.type === 'sky');
      if (free(shared) && tower(shared).length === 3 && tower(shared).slice(0, 2).every(o => o.type === 'earth') && top.type === 'sky' && ['red', 'blue'].includes(top.color) && top.color !== v.team && held.length < 2) {
        tasks.push({ type: 'flip', spotId: shared }); top.color = v.team; rank[0]++; continue;
      }
      const empty = [shared, privateSpot].find(id => !tower(id).length);
      if (empty && earth) { place(earth, empty, 1); continue; }
      // The remaining shared Earth is carried only with a Sky to finish that tower.
      if (!empty && free(shared) && earthTower(shared) && tower(shared).length === 1 && earth && sky && limit - tasks.length >= 2) {
        place(earth, shared, 5); place(sky, shared, 2); continue;
      }
      const ready = [shared, privateSpot].find(id => free(id) && earthTower(id) && tower(id).length === 2);
      if (sky && ready) { place(sky, ready, ready === shared ? 2 : 3); continue; }
      if (!empty && free(privateSpot) && earthTower(privateSpot) && tower(privateSpot).length === 1 && earth) { place(earth, privateSpot, 4); continue; }
      if (allowFallback || [shared, privateSpot].every(complete)) {
        let placed = false;
        for (const o of held) {
          const id = spotOrder(v.team).find(id => free(id) && earthTower(id) && (o.type === 'earth' ? tower(id).length < 2 && id !== shared : o.type === 'sky' && tower(id).length === 2));
          if (id) { place(o, id, 5); placed = true; break; }
        }
        if (placed) continue;
        const flip = spotOrder(v.team).find(id => {
          const t = tower(id);
          return !F.spotById[id].team && free(id) && t.length === 3 && t[0].type === 'earth' && t[1].type === 'earth' && t[2].type === 'sky' && ['red', 'blue'].includes(t[2].color) && t[2].color !== v.team;
        });
        if (flip && held.length < 2) { tasks.push({ type: 'flip', spotId: flip }); tower(flip)[2].color = v.team; rank[5]++; continue; }
      }
      break;
    }
    return { tasks, rank };
  }
  function splitPickup(v, carried = []) {
    const stock = v.observation?.stock || [], seedBoth = splitTargets(v.team).every(id => !(v.observation?.towers?.[id] || []).length);
    let best = null;
    // Enumerate only physically removable batches of at most two from the observed stock.
    function visit(remaining, picked) {
      if (picked.length) {
        const cargo = [...carried, ...picked], plan = splitPlan(v, cargo), used = new Set(plan.tasks.filter(task => task.type === 'place').map(task => task.objectId));
        const firstDifference = best ? plan.rank.findIndex((n, i) => n !== best.plan.rank[i]) : -1;
        if (cargo.every(o => used.has(o.id)) && (!seedBoth || plan.rank[1] === 2) && (!best || (firstDifference >= 0 && plan.rank[firstDifference] > best.plan.rank[firstDifference]))) best = { picked, plan };
      }
      if (carried.length + picked.length === 2) return;
      for (const o of remaining) {
        if (!['earth', 'sky'].includes(o.type) || o.touchedBy || remaining.some(other => other.slot === o.slot && other.layer > o.layer)) continue;
        visit(remaining.filter(other => other.id !== o.id), [...picked, o]);
      }
    }
    visit(stock, []); return best?.picked || [];
  }
  function splitBuilder(v) {
    const p = F.points[v.team], scan = () => [go(p.home, '見渡し場所へ'), { type: 'scan' }];
    const execute = tasks => ({ brain: { stage: 'return' }, actions: tasks.flatMap(task => [go(F.spotApproaches(F.spotById[task.spotId], v.team)[0], `${F.spotById[task.spotId].label}へ`), task]) });
    const receive = picked => ({ brain: { stage: 'loaded' }, actions: [go(p.transferBR, '受け渡しへ'), ...picked.map(o => ({ type: 'receive', objectId: o.id })), ...scan()] });
    if (v.failure || !v.observation || v.brain.stage === 'start' || v.brain.stage === 'return') return { brain: { stage: v.cargo.length ? 'loaded' : 'choose' }, actions: scan() };
    if (v.brain.stage === 'loaded') {
      if (v.cargo.some(o => o.type === 'mustika') && v.observation.sanctuary) return { brain: { stage: 'return' }, actions: [go(p.pillar, '中央柱へ'), { type: 'enshrine' }] };
      const plan = splitPlan(v, v.cargo, true);
      if (plan.tasks.length) return execute(plan.tasks);
      const extra = splitPickup(v, v.cargo);
      return extra.length ? receive(extra) : { brain: { stage: 'return' }, wait: 1 };
    }
    const mustika = v.observation.stock.find(o => o.type === 'mustika' && !o.touchedBy);
    const flip = splitPlan(v, []).tasks;
    if (flip.length && !(mustika && v.observation.sanctuary)) return execute(flip);
    const picked = mustika && v.observation.sanctuary ? [mustika] : splitPickup(v);
    if (picked.length) return receive(picked);
    return { brain: { stage: 'return' }, wait: 1 };
  }
  // One catalog drives both the strategy menu and controller dispatch.
  const catalog = {
    TR: [
      { id: 'balanced', name: '基本補給 · E2+S1', shortName: '毎便 E2+S1', opening: [], repeat: { earth: 2, sky: 1, label: 'E2+S1' }, run: courier },
      { id: 'e3-e1s2', name: 'Earth先行 · E3 → E1+S2', shortName: 'E3 → E1+S2', opening: [{ earth: 3, sky: 0, label: 'E3' }, { earth: 1, sky: 2, label: 'E1+S2' }], repeat: { earth: 2, sky: 1, label: 'E2+S1' }, run: courier },
    ],
    BR: [
      { id: 'score-search', name: '得点探索 · 2往復先読み', shortName: '得点探索', run: Planner.next,
        details: () => [['評価対象', '見渡し時の盤面・在庫 / 最大2往復の自チーム加点'], ['候補', '受取・配置・Sky反転・自分のEarth回収・Mustika奉納'], ['所要時間', '移動・段差・作業・見渡し / 残り時間内'], ['再計画', '見渡し場所で認識後 / 出発前に最大2操作を決定']] },
      { id: 'basic', name: '基本建設 · 専有→共有', shortName: '基本建設', run: builder,
        details: team => [['配置優先', spotOrder(team).slice(0, 2).map(id => F.spotById[id].label).join(' → ')], ['見渡し', '受取前・受取後 / 1回で最大2個を配置']] },
      { id: 'split-seed', name: '分散先置き · 共有1＋専有1', shortName: '共有1＋専有1', run: splitBuilder,
        details: team => [['初動', splitTargets(team).map(id => `${F.spotById[id].label}にE1`).join(' / ')], ['相手が完成', '共有のSkyを自色へ反転'], ['共有が未完成', 'Earth1段: E1+S1 / 2段: S1'], ['見渡し', '受取前・受取後 / 最大2個を計画']] },
    ],
  };
  function resolveStrategy(role, id) {
    const entries = catalog[role];
    if (!entries) throw new Error(`Unknown robot role: ${role}`);
    return entries.find(entry => entry.id === id) || entries[0];
  }
  function listStrategies(role) { return (catalog[role] || []).map(({ run, details, ...entry }) => copy(entry)); }
  function strategyDetails(role, id, team) {
    const strategy = resolveStrategy(role, id);
    if (role === 'TR') {
      const blocks = plan => [plan.earth ? `Earth ${plan.earth}個` : '', plan.sky ? `Sky ${plan.sky}個` : ''].filter(Boolean).join(' + ');
      const count = Math.max(2, strategy.opening.length);
      return [
        ...Array.from({ length: count }, (_, index) => [`${index + 1}便目`, blocks(transportPlan(id, index))]),
        [`${count + 1}便目以降`, blocks(strategy.repeat)], ['Mustika', strategy.opening.length ? `開幕${strategy.opening.length}便の完了・条件達成後に優先` : '条件達成後に優先'],
      ];
    }
    return strategy.details(team);
  }
  function next(view) { return resolveStrategy(view.role, view.role === 'TR' ? view.trPlan : view.brPlan).run(view); }
  return { next, sourceApproach, spotOrder, transportPlan, listStrategies, strategyDetails };
});
