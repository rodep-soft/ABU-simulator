(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField,
    typeof module === 'object' ? require('./engine.js') : root.RoboSim);
  if (typeof module === 'object') module.exports = api;
  else root.RoboScorePlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, S) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const go = (target, label) => ({ type: 'move', target, label });
  const STEP = .05;

  function travelSeconds(from, route, motion) {
    let position = { ...from }, seconds = 0;
    for (const target of route) {
      let velocity = 0, distance = S.distance(position, target);
      for (let guard = 0; distance > 1e-8; guard++) {
        if (guard > 20000) return Infinity;
        const surface = F.surface(position), stairs = ['stairs', 'upperStairs'].includes(surface.type);
        const cap = motion.speedFactor * (stairs ? motion.stairSpeed : motion.maxSpeed * (surface.type === 'ramp' ? motion.rampFactor : 1));
        const acceleration = motion.acceleration * motion.speedFactor;
        if (cap <= 0 || acceleration <= 0) return Infinity;
        velocity = Math.min(cap, velocity + acceleration * STEP, Math.sqrt(2 * acceleration * Math.max(distance, .005)));
        const travel = Math.min(distance, velocity * STEP);
        position = { x: position.x + (target.x - position.x) * travel / distance, y: position.y + (target.y - position.y) * travel / distance };
        seconds += STEP;
        const next = F.surface(position);
        if (['stairs', 'upperStairs', 'transfer', 'l2'].includes(next.type) && Math.abs(next.z - surface.z) > .1) {
          seconds += Math.ceil(motion.stairPause / STEP) * STEP; velocity = 0;
        }
        distance = S.distance(position, target);
      }
    }
    return seconds + STEP;
  }
  function initialState(v) {
    return copy({ towers: v.observation.towers, stock: v.observation.stock, cargo: v.cargo,
      sanctuary: v.observation.sanctuary, mustika: v.observation.pillar || { id: 'M', location: 'source', touchedBy: null } });
  }
  function score(state, team) {
    return S.Simulation.prototype.scores.call({ transferPoints: { red: 0, blue: 0 }, tower: id => state.towers[id] || [], object: () => state.mustika,
      sanctuary: { red: team === 'red' && state.sanctuary ? 0 : null, blue: team === 'blue' && state.sanctuary ? 0 : null } });
  }
  function mandate(state, team) {
    const completed = F.spots.filter(spot => {
      const t = state.towers[spot.id] || [];
      return t.length === 3 && t[0].type === 'earth' && t[1].type === 'earth' && t[2].type === 'sky' && t[2].color === team && t.every(o => !o.touchedBy);
    });
    state.sanctuary ||= completed.length >= 2 && completed.some(spot => !spot.team);
  }
  function stateKey(state) {
    const item = o => [o.type, o.team, o.placedBy, o.color, !!o.touchedBy];
    return JSON.stringify([Object.entries(state.towers).sort().map(([id, t]) => [id, t.map(item)]),
      state.stock.map(o => [o.slot, o.layer, ...item(o)]).sort(), state.cargo.map(item).sort(), state.sanctuary, state.mustika.location, state.mustika.placedBy]);
  }
  function context(v) {
    const motion = { ...S.DEFAULTS, speedFactor: 1, ...v.motion };
    const model = new S.Simulation({ ...motion, [`${v.team}Speed`]: motion.speedFactor });
    const robot = { ...model.robot(v.id), enteredL1: true }, home = F.points[v.team].home;
    // Reserve all construction footprints so hypothetical new towers cannot invalidate these routes.
    model.objects = [...copy(v.observation.stock), ...copy(v.observation.source || []), ...F.spots.map(spot => ({
      id: `reserved-${spot.id}`, location: 'spot', type: 'earth', x: spot.x, y: spot.y, z: spot.level === 1 ? .6 : .9, size: .35, height: .9,
    }))];
    model.robots = [robot]; model.changed();
    const routes = new Map(), spots = F.spots.filter(spot => !spot.team || spot.team === v.team);
    const target = action => action.type === 'enshrine' ? F.points[v.team].pillar : F.spotApproaches(F.spotById[action.spotId], v.team)[0];
    const travel = (from, to) => {
      const key = `${from.x},${from.y}:${to.x},${to.y}`;
      if (!routes.has(key)) {
        Object.assign(robot, from, { z: F.surface(from).z });
        const path = model.findPath(robot, to);
        routes.set(key, path ? travelSeconds(from, path, motion) : Infinity);
      }
      return routes.get(key);
    };
    const legal = (state, action, point, budget, ready = true) => {
      const actor = { ...robot, ...point, cargo: state.cargo.map(o => o.id), observation: v.observation, scanLoaded: ready, batchRemaining: budget };
      const judge = { time: v.time || 0, ended: false, config: model.config, sanctuary: { [v.team]: state.sanctuary ? 0 : null },
        object: id => [...state.cargo, ...state.stock].find(o => o.id === id), tower: id => state.towers[id] || [], stock: () => state.stock,
        touchCheck: (r, point) => model.touchCheck(r, point) };
      return S.Simulation.prototype.validate.call(judge, actor, action).ok;
    };
    return { motion, home, spots, target, travel, legal, remaining: Math.max(0, 180 - (v.time ?? v.observation.at)), candidates: 0 };
  }
  function apply(state, action, team) {
    const result = copy(state), t = action.spotId ? (result.towers[action.spotId] ||= []) : null;
    if (action.type === 'place') {
      const index = result.cargo.findIndex(o => o.id === action.objectId), o = result.cargo.splice(index, 1)[0];
      const spot = F.spotById[action.spotId];
      t.push({ ...o, location: 'spot', holder: null, touchedBy: null, placedBy: o.placedBy || team, color: o.type === 'sky' ? team : null,
        spotId: spot.id, layer: t.length, x: spot.x, y: spot.y, z: (spot.level === 1 ? .6 : .9) + t.reduce((sum, b) => sum + b.height, 0) });
    } else if (action.type === 'flip') t.at(-1).color = team;
    else if (action.type === 'recover') result.cargo.push({ ...t.pop(), location: 'cargo', holder: `${team}BR`, touchedBy: `${team}BR` });
    else if (action.type === 'enshrine') {
      const index = result.cargo.findIndex(o => o.id === 'M'), o = result.cargo.splice(index, 1)[0];
      result.mustika = { ...o, location: 'pillar', placedBy: team, touchedBy: null, holder: null };
    }
    mandate(result, team); return result;
  }
  function choices(state, ctx, budget) {
    const out = [], distinct = new Set();
    for (const o of state.cargo) {
      const key = `${o.type}:${o.placedBy}`; if (distinct.has(key)) continue; distinct.add(key);
      if (o.type === 'mustika') out.push({ type: 'enshrine' });
      else for (const spot of ctx.spots) out.push({ type: 'place', objectId: o.id, spotId: spot.id });
    }
    for (const spot of ctx.spots) {
      const t = state.towers[spot.id] || [], top = t.at(-1);
      if (top?.type === 'sky' && top.color !== ctx.team) out.push({ type: 'flip', spotId: spot.id });
      if (top?.type === 'earth') out.push({ type: 'recover', spotId: spot.id });
    }
    return out.filter(action => ctx.legal(state, action, ctx.target(action), budget));
  }
  function pickups(state, ctx) {
    const options = [{ state, picked: [], prep: 0 }], transfer = F.points[ctx.team].transferBR;
    function visit(current, picked) {
      if (current.cargo.length >= 2 || current.cargo.some(o => o.type === 'mustika')) return;
      for (const o of current.stock) {
        if (!ctx.legal(current, { type: 'receive', objectId: o.id }, transfer, 0)) continue;
        const next = copy(current), index = next.stock.findIndex(item => item.id === o.id), item = next.stock.splice(index, 1)[0];
        next.cargo.push({ ...item, location: 'cargo', holder: `${ctx.team}BR`, touchedBy: `${ctx.team}BR` });
        const ids = [...picked, o.id], prep = ctx.travel(ctx.home, transfer) + ctx.travel(transfer, ctx.home) + ids.length * ctx.motion.pickupSeconds + ctx.motion.scanSeconds;
        if (prep < ctx.remaining) options.push({ state: next, picked: ids, prep });
        visit(next, ids);
      }
    }
    visit(state, []); return options;
  }
  function sorties(state, ctx) {
    const frontiers = new Map(), before = score(state, ctx.team), other = ctx.team === 'red' ? 'blue' : 'red';
    for (const option of pickups(state, ctx)) {
      function visit(current, position, tasks, seconds, budget) {
        for (const action of choices(current, ctx, budget)) {
          const point = ctx.target(action), completeSeconds = seconds + ctx.travel(position, point) + ctx.motion.placeSeconds;
          if (!Number.isFinite(completeSeconds) || completeSeconds >= ctx.remaining - 1e-6) continue;
          const next = apply(current, action, ctx.team), sequence = [...tasks, action], after = score(next, ctx.team);
          const candidate = { state: next, tasks: sequence, picked: option.picked, completeSeconds,
            cycleSeconds: completeSeconds + ctx.travel(point, ctx.home) + ctx.motion.scanSeconds,
            gain: after[ctx.team].total - before[ctx.team].total, opponentGain: after[other].total - before[other].total };
          ctx.candidates++;
          const key = stateKey(next), frontier = frontiers.get(key) || [];
          if (!frontier.some(old => old.completeSeconds <= candidate.completeSeconds && old.cycleSeconds <= candidate.cycleSeconds)) {
            frontiers.set(key, [...frontier.filter(old => !(candidate.completeSeconds <= old.completeSeconds && candidate.cycleSeconds <= old.cycleSeconds)), candidate]);
          }
          if (budget > 1 && action.type !== 'recover') visit(next, point, sequence, completeSeconds, budget - 1);
        }
      }
      visit(option.state, ctx.home, [], option.prep, Math.max(1, option.state.cargo.length));
    }
    return [...frontiers.values()].flat();
  }
  function plan(v) {
    const ctx = context(v); ctx.team = v.team;
    const initial = initialState(v), first = sorties(initial, ctx), memo = new Map();
    let best = null;
    const consider = (candidate, gain, seconds, sanctuary, opponentGain) => {
      const rank = [gain, sanctuary && !initial.sanctuary ? 1 : 0, -seconds, -opponentGain];
      const different = best ? rank.findIndex((value, i) => Math.abs(value - best.rank[i]) > 1e-7) : -1;
      if (gain > 0 && (!best || (different >= 0 && rank[different] > best.rank[different]))) best = { candidate, rank, horizonGain: gain, horizonSeconds: seconds };
    };
    for (const candidate of first) {
      consider(candidate, candidate.gain, candidate.completeSeconds, candidate.state.sanctuary, candidate.opponentGain);
      if (candidate.cycleSeconds >= ctx.remaining) continue;
      const key = stateKey(candidate.state);
      if (!memo.has(key)) memo.set(key, sorties(candidate.state, ctx).map(c => ({ gain: c.gain, seconds: c.completeSeconds, sanctuary: c.state.sanctuary, opponentGain: c.opponentGain })));
      for (const after of memo.get(key)) {
        const seconds = candidate.cycleSeconds + after.seconds;
        if (seconds < ctx.remaining - 1e-6) consider(candidate, candidate.gain + after.gain, seconds, after.sanctuary, candidate.opponentGain + after.opponentGain);
      }
    }
    return best ? { ...best.candidate, horizonGain: best.horizonGain, horizonSeconds: best.horizonSeconds, candidates: ctx.candidates } : null;
  }
  function next(v) {
    const home = F.points[v.team].home, scan = () => [go(home, '見渡し場所へ'), { type: 'scan' }];
    if (v.failure || !v.observation || v.brain.stage === 'start' || v.brain.stage === 'return' || S.distance(v, home) > .12) {
      return { brain: { stage: 'choose' }, actions: scan() };
    }
    const selected = plan(v);
    if (!selected) return { brain: { stage: 'return' }, wait: 1, decision: { at: v.observation.at, strategy: 'score-search', summary: '実行可能な加点候補なし', gain: 0, horizonGain: 0, seconds: 0, horizonSeconds: 0 } };
    const summary = selected.tasks.map(a => {
      if (a.type === 'enshrine') return 'Mustika奉納';
      const type = [...v.cargo, ...v.observation.stock].find(o => o.id === a.objectId)?.type;
      return `${F.spotById[a.spotId].label} ${a.type === 'flip' ? 'Sky反転' : a.type === 'recover' ? 'Earth回収' : `${type === 'earth' ? 'Earth' : 'Sky'}配置`}`;
    }).join(' → ');
    const decision = { at: v.observation.at, strategy: 'score-search', summary, gain: selected.gain, horizonGain: selected.horizonGain,
      seconds: +selected.completeSeconds.toFixed(2), horizonSeconds: +selected.horizonSeconds.toFixed(2), candidates: selected.candidates,
      tasks: copy(selected.tasks), receive: [...selected.picked] };
    if (selected.picked.length) return { brain: { stage: 'choose' }, decision, actions: [go(F.points[v.team].transferBR, '探索計画のブロック受取へ'), ...selected.picked.map(id => ({ type: 'receive', objectId: id })), ...scan()] };
    return { brain: { stage: 'return' }, decision, actions: selected.tasks.flatMap(action => [go(action.type === 'enshrine' ? F.points[v.team].pillar : F.spotApproaches(F.spotById[action.spotId], v.team)[0], '探索計画の作業先へ'), action]) };
  }
  return { next, plan, travelSeconds };
});
