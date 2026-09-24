(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField,
    typeof module === 'object' ? require('./engine.js') : root.RoboSim,
    typeof module === 'object' ? require('./score-planner.js') : root.RoboScorePlanner,
    typeof module === 'object' ? require('./efficient-strategy.js') : root.RoboEfficient);
  if (typeof module === 'object') module.exports = api;
  else root.RoboMatchStrategies = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, S, Planner, Efficient) {
  'use strict';
  const SWITCH_AT = 150;
  const presets = [
    { id: 'mustika-fast', name: 'Mustika最速案', tr: 'stock-e3', br: 'mustika-fast' },
    { id: 'earth-late', name: 'Earth固定点 → 終盤Sky', tr: 'stock-e3', br: 'earth-late' },
    { id: 'l2-earth', name: 'L2 Earth最優先', tr: 'stock-e3', br: 'l2-earth' },
  ];
  const seedSpots = team => team === 'red' ? ['s2', 'r2'] : ['s1', 'b2'];
  const phase = (id, time, sanctuary) => id === 'l2-earth' ? '全時間帯 · L2 Earth最優先' : time >= SWITCH_AT ? '終盤 · Sky配置・連続反転'
    : id === 'earth-late' ? '前半 · L2 Earthで固定点' : id === 'mustika-fast' && !sanctuary ? '条件形成 · 共有＋専有' : '前半 · 新規配置優先';
  function goalDistance(towers, team) {
    const complete = new Set(S.completedTowers(id => towers[id] || [], team).map(p => p.id));
    const costs = F.spots.filter(p => !p.team || p.team === team).map(p => {
      const t = towers[p.id] || [];
      return { shared: !p.team, cost: complete.has(p.id) ? 0 : t.length === 3 && t.at(-1).type === 'sky' ? 1 : Math.max(1, 3 - t.length) };
    });
    let best = Infinity;
    for (let i = 0; i < costs.length; i++) for (let j = i + 1; j < costs.length; j++) if (costs[i].shared || costs[j].shared) best = Math.min(best, costs[i].cost + costs[j].cost);
    return best;
  }
  function metrics(v, candidate) {
    const items = [...v.cargo, ...v.observation.stock], places = candidate.tasks.filter(a => a.type === 'place');
    const type = a => items.find(o => o.id === a.objectId)?.type;
    const earths = places.filter(a => type(a) === 'earth');
    const earthPoints = a => {
      const final = candidate.state.towers[a.spotId].find(o => o.id === a.objectId);
      return (final.layer === 1 ? 20 : 10) * F.spotById[a.spotId].level;
    };
    return {
      placed: places.length, privatePlaced: places.filter(a => F.spotById[a.spotId].team === v.team).length,
      earth: earths.reduce((n, a) => n + earthPoints(a), 0),
      l2Earth: earths.filter(a => F.spotById[a.spotId].level === 2).reduce((n, a) => n + earthPoints(a), 0),
      privateEarth: earths.filter(a => F.spotById[a.spotId].team === v.team).reduce((n, a) => n + earthPoints(a), 0),
      sky: places.filter(a => type(a) === 'sky').length + candidate.tasks.filter(a => a.type === 'flip').length,
      diff: candidate.gain - candidate.opponentGain,
    };
  }
  function ranker(v, policy) {
    const targets = seedSpots(v.team), unseeded = targets.filter(id => !v.observation.towers[id]?.length);
    const beforeDistance = goalDistance(v.observation.towers, v.team);
    return candidate => {
      const m = metrics(v, candidate), seconds = candidate.completeSeconds;
      if (policy === 'earth') return m.earth ? [m.l2Earth, m.privateEarth, m.earth, -seconds] : null;
      if (policy === 'build') return m.placed ? [m.placed, m.privatePlaced, m.diff / (seconds + 1), -seconds] : null;
      if (policy === 'late') return [m.sky > 0 ? 1 : 0, m.diff, -seconds];
      const distance = goalDistance(candidate.state.towers, v.team);
      const seeded = unseeded.filter(id => candidate.state.towers[id]?.some(o => o.type === 'earth' && o.placedBy === v.team)).length;
      const completed = candidate.state.sanctuary && !v.observation.sanctuary;
      if (!completed && !seeded && distance >= beforeDistance) return null;
      const privateProgress = candidate.state.towers[targets[1]]?.length || 0;
      return [seeded, completed ? 1 : 0, -distance, completed ? -seconds : privateProgress, -seconds, m.diff];
    };
  }
  function better(a, b, rank) {
    if (!a) return b; if (!b) return a;
    const ar = rank(a), br = rank(b);
    if (!ar) return b; if (!br) return a;
    const i = ar.findIndex((n, j) => Math.abs(n - br[j]) > 1e-7);
    return i < 0 || ar[i] >= br[i] ? a : b;
  }
  function selectPlan(v, id, extra = {}) {
    const options = { efficient: true, requirePair: true, noRecover: true, oneSortie: true, ...extra };
    const choose = (policy, overrides = {}) => {
      const rank = ranker(v, policy);
      const build = Planner.plan(v, { ...options, ...overrides, rank, onlyPlace: policy !== 'mustika' });
      const flips = !options.onlyPlace && !v.cargo.length && ['late', 'mustika'].includes(policy)
        ? Planner.flipBatch(v, { ...options, rank, stopOnMandate: policy === 'mustika' }) : null;
      return better(build, flips, rank);
    };
    if (id === 'l2-earth') {
      // Keep Earth ahead of Sky for the whole match; a stranded single must not block progress.
      const build = choose('earth') || choose('earth', { requirePair: false })
        || choose('build') || choose('build', { requirePair: false });
      if (build) return build;
      return !options.onlyPlace && !v.cargo.length ? Planner.flipBatch(v, options) : null;
    }
    if (v.time >= SWITCH_AT) return choose('late');
    if (id === 'mustika-fast' && !v.observation.sanctuary && v.observation.source.some(o => o.id === 'M')) {
      const fast = choose('mustika'); if (fast) return fast;
    }
    if (id === 'earth-late') { const earth = choose('earth'); if (earth) return earth; }
    const build = choose('build'); if (build) return build;
    // With no useful building batch, an observed flip route is preferable to blind idle time.
    return !options.onlyPlace && !v.cargo.length ? Planner.flipBatch(v, options) : null;
  }
  function builder(v, id) {
    const response = Efficient.builder(v, (view, extra) => selectPlan(view, id, extra));
    if (response.decision) response.decision.phase = phase(id, v.time, v.observation?.sanctuary);
    return response;
  }
  return { builder, selectPlan, phase, seedSpots, SWITCH_AT, presets: () => presets.map(p => ({ ...p })) };
});
