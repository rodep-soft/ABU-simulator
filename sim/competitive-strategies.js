(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField,
    typeof module === 'object' ? require('./engine.js') : root.RoboSim,
    typeof module === 'object' ? require('./score-planner.js') : root.RoboScorePlanner,
    typeof module === 'object' ? require('./efficient-strategy.js') : root.RoboEfficient,
    typeof module === 'object' ? require('./match-strategies.js') : root.RoboMatchStrategies);
  if (typeof module === 'object') module.exports = api;
  else root.RoboCompetitive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, S, Planner, Efficient, Match) {
  'use strict';
  const ENDGAME_AT = 150;
  const ids = ['second-layer', 'score-adaptive', 'endgame'];
  const other = team => team === 'red' ? 'blue' : 'red';
  function lead(v) {
    const scores = v.observation?.scores;
    return scores ? scores[v.team].total - scores[other(v.team)].total : null;
  }
  function phase(id, time, observation, team) {
    if (id === 'endgame') return time >= ENDGAME_AT ? '終盤 · 応答時間・1個運搬' : '前半 · 共有＋専有から条件形成';
    if (id === 'second-layer') return time >= ENDGAME_AT ? '終盤 · Sky配置・連続反転' : '建設 · L2の2段目＋Sky';
    const gap = lead({ observation, team });
    return gap === null ? '点差未観測 · 新規配置' : gap > 0 ? 'リード · 専有・固定点優先' : '同点・追走 · 点差改善優先';
  }
  function metrics(v, candidate) {
    const items = [...v.cargo, ...v.observation.stock];
    let fixed = 0, privateGain = 0, secondLayer = 0, combo = 0, borrowed = 0, placed = 0;
    for (const a of candidate.tasks.filter(a => a.type === 'place')) {
      const p = F.spotById[a.spotId], o = items.find(o => o.id === a.objectId), final = candidate.state.towers[p.id].find(o => o.id === a.objectId);
      const points = (o.type === 'earth' ? [10, 20][final.layer] : 40) * p.level;
      placed++; if (p.team === v.team) privateGain += points;
      if (o.type === 'earth' || p.team === v.team) fixed += points;
      const initial = v.observation.towers[p.id] || [];
      if (o.type === 'earth' && final.layer === 1 && initial.length === 1 && initial[0].type === 'earth') {
        secondLayer += points;
        if (candidate.tasks.some(b => b.type === 'place' && b.spotId === p.id && items.find(o => o.id === b.objectId)?.type === 'sky')) {
          combo += points; if (initial[0].placedBy !== v.team) borrowed += points;
        }
      }
    }
    return { fixed, privateGain, secondLayer, combo, borrowed, placed, diff: candidate.gain - candidate.opponentGain };
  }
  function better(a, b, rank) {
    if (!a) return b; if (!b) return a;
    const ar = rank(a), br = rank(b); if (!ar) return b; if (!br) return a;
    const i = ar.findIndex((n, j) => Math.abs(n - br[j]) > 1e-7);
    return i < 0 || ar[i] >= br[i] ? a : b;
  }
  function replyDamage(v, candidate) {
    const opponent = v.observation.opponentBR;
    const speed = opponent?.maxSpeed > 0 ? opponent.maxSpeed : Infinity;
    const handling = opponent?.placeSeconds > 0 ? opponent.placeSeconds : v.motion.placeSeconds;
    const age = Math.max(0, v.time - v.observation.at), remaining = 180 - v.time;
    const targets = F.spots.filter(p => !p.team).flatMap(p => {
      const t = candidate.state.towers[p.id] || [], top = t[2];
      if (t.length !== 3 || top.type !== 'sky' || top.color !== v.team || t.some(o => o.touchedBy)) return [];
      const last = candidate.tasks.findLastIndex(a => a.spotId === p.id && (a.type === 'flip' || a.type === 'place' && a.objectId === top.id));
      return [{ point: p, points: p.level * 40, ready: last < 0 ? 0 : candidate.taskTimes[last] }];
    });
    // Give the opponent optimistic straight-line travel, no scan, empty hands and a free ongoing flip.
    // This is a Sky-only stress test, not a full opponent search or a guaranteed winning margin.
    const states = new Map([['0:-1', { mask: 0, last: -1, time: 0 }]]);
    let worst = 0;
    for (let depth = 0; depth < targets.length; depth++) for (const state of [...states.values()].filter(s => bitCount(s.mask) === depth)) {
      const removed = targets.reduce((n, t, i) => n + ((state.mask & (1 << i)) ? 2 * t.points : 0), 0);
      for (let i = 0; i < targets.length; i++) {
        if (state.mask & (1 << i)) continue;
        const t = targets[i];
        const travel = state.last < 0 ? opponent ? Math.max(0, (S.distance(opponent, t.point) - 1.05) / speed - age) : 0
          : Math.max(0, S.distance(targets[state.last].point, t.point) - 2.1) / speed;
        const start = Math.max(t.ready, state.time + travel);
        if (start >= remaining - 1e-7) continue;
        worst = Math.max(worst, removed + t.points);
        const freeOngoing = state.last < 0 && t.ready === 0;
        const finish = start + (freeOngoing ? 0 : handling);
        if (finish >= remaining - 1e-7) continue;
        worst = Math.max(worst, removed + 2 * t.points);
        const mask = state.mask | (1 << i), key = `${mask}:${i}`;
        if (!states.has(key) || states.get(key).time > finish) states.set(key, { mask, last: i, time: finish });
      }
    }
    return worst;
  }
  function bitCount(n) { let count = 0; for (; n; n &= n - 1) count++; return count; }
  function endgameRank(v, candidate) {
    const gap = lead(v) ?? 0, m = metrics(v, candidate), predicted = gap + m.diff;
    const reply = predicted - replyDamage(v, candidate);
    const category = reply > 0 ? 2 : predicted > 0 ? 1 : 0;
    return [category, category === 2 ? -candidate.completeSeconds : reply, predicted, -candidate.state.cargo.length, -candidate.completeSeconds];
  }
  function selectPlan(v, id, extra = {}) {
    if (id === 'endgame' && v.time < ENDGAME_AT) return Match.selectPlan(v, 'mustika-fast', extra);
    if (id === 'second-layer' && v.time >= ENDGAME_AT) return Match.selectPlan(v, 'earth-late', extra);
    const late = id === 'endgame', gap = lead(v);
    const options = { efficient: true, requirePair: !late, noRecover: true, oneSortie: true, orderSensitive: late, ...extra };
    const rank = candidate => {
      const m = metrics(v, candidate), seconds = candidate.completeSeconds;
      if (late) return endgameRank(v, candidate);
      if (id === 'second-layer') return m.placed ? [m.combo, m.secondLayer, m.borrowed, m.fixed, m.diff / (seconds + 1), -seconds] : null;
      if (gap === null) return m.placed ? [m.fixed, m.placed, m.diff, -seconds] : null;
      if (gap > 0) return [m.privateGain > 0 ? 1 : 0, m.fixed / (seconds + 1), m.diff / (seconds + 1), -seconds];
      const mandate = !v.observation.sanctuary && candidate.state.sanctuary && v.observation.source.some(o => o.id === 'M') && 180 - v.time - seconds > 30;
      return [m.diff / (seconds + 1), mandate ? 1 : 0, m.fixed, -seconds];
    };
    const build = Planner.plan(v, { ...options, rank, onlyPlace: id === 'second-layer' || options.onlyPlace });
    const flips = !v.cargo.length && !options.onlyPlace && id !== 'second-layer' ? Planner.flipBatch(v, { ...options, rank }) : null;
    let selected = better(build, flips, rank);
    if (!selected && id === 'second-layer') selected = Match.selectPlan(v, 'earth-late', extra);
    if (selected) {
      const m = metrics(v, selected);
      selected.assessment = { observedAt: v.observation.at, lead: gap, predictedMargin: gap === null ? null : gap + m.diff,
        skyReplyMargin: late && gap !== null ? gap + m.diff - replyDamage(v, selected) : null,
        single: late && v.cargo.length + selected.picked.length === 1,
        rationale: id === 'second-layer' ? m.combo ? '既存の土台にEarth2段目＋Sky' : '2段目・固定点を優先'
          : late ? '終了前に完了する候補を比較 · Sky再反転を試算' : gap === null ? '点差未観測 · 固定点から建設' : gap > 0 ? '観測時リード · 専有と固定点を優先' : '観測時同点・追走 · 時間あたりの点差改善を優先' };
    }
    return selected;
  }
  function builder(v, id) {
    const response = Efficient.builder(v, (view, extra) => selectPlan(view, id, extra), { skipSupplyWait: id === 'endgame' && v.time >= ENDGAME_AT });
    if (response.decision) response.decision.phase = phase(id, v.time, v.observation, v.team);
    return response;
  }
  const presets = () => [
    { id: 'second-layer', name: '2段目狙い · E1＋S1', tr: 'stock-e3', br: 'second-layer' },
    { id: 'score-adaptive', name: '点差対応 · 専有／共有', tr: 'stock-e3', br: 'score-adaptive' },
    { id: 'endgame', name: '終盤対応 · 反転順序＋1個運搬', tr: 'stock-e3', br: 'endgame' },
  ];
  return { ids, presets, builder, selectPlan, phase, lead, replyDamage, endgameRank, ENDGAME_AT };
});
