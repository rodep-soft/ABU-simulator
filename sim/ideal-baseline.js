(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField,
    typeof module === 'object' ? require('./engine.js') : root.RoboSim,
    typeof module === 'object' ? require('./score-planner.js') : root.RoboScorePlanner,
    typeof module === 'object' ? require('./efficient-strategy.js') : root.RoboEfficient,
    typeof module === 'object' ? require('./tactical-baseline.js') : root.RoboTacticalBaseline);
  if (typeof module === 'object') module.exports = api; else root.RoboIdealBaseline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, S, Planner, Efficient, Previous) {
  'use strict';
  const ID = 'tactical-baseline-v2';
  const firstSpots = team => team === 'red' ? ['r2', 's2', 'u3'] : ['b2', 's2', 'u4'];
  const firstPlaced = v => !!v.brain?.idealBaseline?.firstPlaced || Previous.firstPlaced(v);
  const prepared = v => firstPlaced(v) ? v : { ...v, brOpeningActive: true };
  const raceActive = v => v.time < 110 && !v.observation?.sanctuary && !v.observation?.pillar?.placedBy && !v.opponentMustikaPickup;
  const progress = (tower = [], team) => tower.filter(o => o.type === 'earth' && !o.touchedBy).length
    + (tower[2]?.type === 'sky' && tower[2].color === team && !tower[2].touchedBy ? 1 : 0);
  function better(a, b) {
    if (!a) return false;
    if (!b) return true;
    const i = a.findIndex((x, j) => Math.abs(x - b[j]) > 1e-7);
    return i >= 0 && a[i] > b[i];
  }
  function rankFor(v) {
    const ordinary = Previous.rankFor(v), racing = raceActive(v);
    const own = v.team === 'red' ? 'r2' : 'b2';
    const focus = progress(v.observation.towers[own], v.team) < 3 ? own : 's2';
    const before = progress(v.observation.towers[focus], v.team);
    return c => {
      const fallback = ordinary(c); if (!fallback) return null;
      if (!firstPlaced(v) && c.tasks.some(a => a.spotId && !firstSpots(v.team).includes(a.spotId))) return null;
      if (!racing) return fallback;
      const advanced = progress(c.state.towers[focus], v.team) - before;
      const seconds = c.completeSeconds + v.motion.scanSeconds;
      const usefulPair = S.distance(v, F.points[v.team].transferBR) < .3 && advanced > 0
        && c.tasks.filter(a => a.type === 'place').length >= 2;
      // Qualification outranks fixed-point farming. Any observed shared tower
      // can finish the mandate; the default construction pair is own L1 + s2.
      return [c.state.sanctuary ? 1 : 0, c.state.sanctuary ? -seconds : 0,
        usefulPair ? 1 : 0,
        advanced > 0 && progress(c.state.towers[focus], v.team) === 3 ? 1 : 0,
        advanced / seconds, ...fallback];
    };
  }
  function selectPlan(input, extra = {}) {
    if (!input.observation) return null;
    const v = prepared(input), evaluate = rankFor(v);
    const own = v.team === 'red' ? 'r2' : 'b2';
    const focus = progress(v.observation.towers[own], v.team) < 3 ? own : 's2';
    const rank = c => extra.noPickup && raceActive(v) && v.cargo.length && !c.state.sanctuary
      && progress(c.state.towers[focus], v.team) <= progress(v.observation.towers[focus], v.team) ? null : evaluate(c);
    const current = !v.observation.visibility || v.observation.visibility.entries.stock?.status === 'current';
    const options = { efficient: true, oneSortie: true, requirePair: false, noRecover: true, orderSensitive: true, allowRefill: true, ...extra,
      noPickup: !!extra.noPickup || !current, rank };
    let selected = Planner.plan(v, options);
    if (!v.cargo.length) {
      const flips = Planner.flipBatch(v, { ...options, maxTasks: 3, stopOnMandate: raceActive(v) });
      if (flips && better(rank(flips), selected && rank(selected))) selected = flips;
    }
    if (selected) selected.assessment = { baseline: ID, race: raceActive(v), rank: rank(selected),
      focus: raceActive(v) ? (progress(v.observation.towers[v.team === 'red' ? 'r2' : 'b2'], v.team) < 3 ? 'own-L1-bottom' : 'shared-L1-bottom') : 'score',
      local: !selected.picked.length };
    return selected;
  }
  function builder(input) {
    const v = prepared(input), local = v.brObservation?.replan === 'after-work', transfer = F.points[v.team].transferBR;
    const standby = { x: transfer.x, y: transfer.y - .9 };
    if (local && !v.enteredL1) return { brain: { stage: 'choose', initialSupplyWait: true },
      actions: [{ type: 'move', target: transfer, label: '受渡位置で初回の在庫確認へ' }, { type: 'scan', local: true }] };
    const current = !v.observation?.visibility || v.observation.visibility.entries.stock?.status === 'current';
    // In the last 30 seconds, do not abandon a usable observed placement/flip
    // for a longer supply trip whose later rewards may disappear before arrival.
    const finishCargo = raceActive(v) && S.blockCount(v.cargo) > 0 && S.distance(v, transfer) > .3;
    let response = Efficient.builder(v, selectPlan, { preferLocalWork: !current || finishCargo || v.time >= 150,
      skipSupplyWait: true, pursueMustika: false });
    if (local && response.wait && S.distance(v, transfer) < .8 && !v.cargo.some(o => o.type === 'mustika')) {
      response = { brain: { ...response.brain, stage: 'choose' }, actions: [
        { type: 'move', target: standby, label: '受渡脇へ待避' }, { type: 'scan', local: true }], status: '受渡脇で補給待ち' };
    }
    return { ...response, brain: { ...response.brain, idealBaseline: { firstPlaced: firstPlaced(input) } },
      status: response.status || '戦術ベースライン v2 · 資格と点差を評価' };
  }
  return { ID, builder, selectPlan, rankFor, raceActive };
});
