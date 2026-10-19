'use strict';
// Read-only sidecar. Ground-truth diagnostics are never passed back to a controller.
const E = require('../sim/efficient-strategy.js');
const counts = items => Object.fromEntries(['earth', 'sky', 'mustika'].map(type => [type, items.filter(o => o?.type === type).length]));
const round = n => +n.toFixed(2);
function context(response = {}) {
  if (response.brain?.privateFirst?.phase === 'supply') return 'br-box-supply';
  const status = response.status || '';
  if (status.includes('終盤締切')) return 'tr-delivery-deadline';
  if (status.includes('終盤補給')) return 'tr-useful-supply';
  if (status.includes('TR荷下ろし完了待ち')) return 'br-unload-wait';
  if (status.includes('受渡位置で在庫を再確認')) return 'br-transfer-refresh';
  if (status.includes('BR受取中')) return 'tr-br-clearance';
  if (status.includes('種類別置場待ち')) return 'tr-slot-capacity';
  if (status.includes('直接受渡待ち')) return 'tr-mustika-handoff';
  if (status.includes('条件達成待ち')) return 'tr-mustika-qualification';
  if (status.includes('在庫消費待ち')) return 'tr-stock-target';
  if (status.includes('供給物なし')) return 'tr-no-source';
  if (status.includes('補給待ち') || status.includes('配置計画待ち')) return 'br-other-supply-plan';
  return 'other';
}
function category(r) {
  if (r.trRestartPending || r.retryPending) return 'recovery-pending';
  if (r.status === '同時操作の競合' && !r.job) return 'manipulation-conflict';
  if (r.job?.type === 'move') {
    if (r.trCollisionStall) return 'opposing-tr-collision';
    if (r.wait > 0) return r.status === '段差で姿勢合わせ' ? 'terrain-pause' : 'movement-yield';
    if (r.status === '障害物待ち') return 'movement-obstacle';
    return 'movement';
  }
  if (r.job) return r.job.type;
  return r.wait > 0 ? 'controller-wait' : 'dispatch';
}
class Diagnostics {
  constructor(sim, controllers) {
    this.sim = sim; this.decisions = []; this.active = {}; this.robots = {};
    this.controller = { next: v => {
      const response = controllers.next(v), r = sim.robot(v.id);
      const pickup = v.role === 'TR' && response.actions?.find(a => a.type === 'pickup' && a.objectId !== 'M');
      const picked = pickup && v.observation?.source.find(o => o.id === pickup.objectId);
      const entry = { time: v.time, robot: v.id, context: context(response), status: response.status || '',
        phase: response.brain?.privateFirst?.phase || null, reason: response.brain?.privateFirst?.reason || null,
        observedAt: v.observation?.at ?? null, observedStock: counts(v.observation?.stock || []),
        actualStock: counts(sim.stock(v.team)), cargo: counts(v.cargo),
        partnerCargo: counts(sim.robot(v.team + (v.role === 'BR' ? 'TR' : 'BR')).cargo.map(id => sim.object(id))),
        manifest: response.brain?.manifest || null, trip: r.transport?.completed.length || 0,
        preposition: response.brain?.prepositionUntil === undefined ? null : {
          since: response.brain.prepositionSince, until: response.brain.prepositionUntil, priority: response.brain.prepositionPriority },
        observedTransferWork: v.observation?.transferWork || null,
        selectedBoxTrip: picked ? E.deliveryBudget(v, picked) : null,
        supplyAssessment: response.supplyAssessment || null,
        actions: response.actions || [], wait: response.wait || 0 };
      this.active[v.id] = entry; this.decisions.push(entry);
      return response;
    } };
  }
  sample(dt) {
    const sim = this.sim;
    for (const r of sim.robots) {
      const data = this.robots[r.id] ||= { categories: {}, contexts: {}, segments: [] };
      const kind = category(r), decision = this.active[r.id], ctx = decision?.context || 'other';
      data.categories[kind] = (data.categories[kind] || 0) + dt;
      data.contexts[ctx] = (data.contexts[ctx] || 0) + dt;
      const last = data.segments.at(-1), key = kind + '|' + ctx;
      if (last?.key === key) { last.end = sim.time + dt; last.seconds += dt; }
      else data.segments.push({ key, category: kind, context: ctx, start: sim.time, end: sim.time + dt, seconds: dt,
        position: { x: round(r.x), y: round(r.y) }, status: r.status, target: r.job?.destination || null,
        cargo: counts(r.cargo.map(id => sim.object(id))), stock: counts(sim.stock(r.team)),
        decisionAt: decision?.time ?? null, reason: decision?.reason || decision?.status || '' });
    }
  }
  finish() {
    return { sampling: 'Pre-step state at 0.05s; categories partition 180s per robot. Contexts are separate, overlapping physical categories. Boundaries may differ by one step; dispatch includes boundary overhead.',
      robots: Object.fromEntries(Object.entries(this.robots).map(([id, data]) => [id, {
        categories: Object.fromEntries(Object.entries(data.categories).map(([k, v]) => [k, round(v)])),
        contexts: Object.fromEntries(Object.entries(data.contexts).map(([k, v]) => [k, round(v)])),
        segments: data.segments.map(s => ({ ...s, start: round(s.start), end: round(s.end), seconds: round(s.seconds) }))
      }])), decisions: this.decisions };
  }
}
module.exports = { Diagnostics, category, context, counts };
