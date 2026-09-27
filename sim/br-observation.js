(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField);
  if (typeof module === 'object') module.exports = api; else root.RoboBrObservation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F) {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  const WORK = ['place', 'flip', 'receive', 'return', 'enshrine', 'recover'];
  const INFORMATION = 'robot-observation-level-radius-v1';
  function normalizeSignal(value) {
    if (value !== undefined && !['off', 'global-instant'].includes(value)) throw new TypeError('Invalid trMustikaPickupSignal');
    return value ?? 'off';
  }
  function information(config, fallback = 'robot-observation-ideal-v1') {
    const base = config.brObservation?.model === 'level-radius' ? INFORMATION : fallback;
    return normalizeSignal(config.trMustikaPickupSignal) === 'global-instant' ? base + '+tr-mustika-pickup-v1' : base;
  }
  function normalize(value) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('brObservation must be an object');
    for (const k of Object.keys(value)) if (!['model', 'crossLevelRadius', 'replan'].includes(k)) throw new TypeError(`Unknown brObservation field: ${k}`);
    const out = { model: value.model ?? 'ideal', crossLevelRadius: value.crossLevelRadius ?? 3, replan: value.replan ?? 'scan-point' };
    if (!['ideal', 'level-radius'].includes(out.model)) throw new TypeError('Invalid BR observation model');
    if (!['scan-point', 'after-work'].includes(out.replan)) throw new TypeError('Invalid BR replan mode');
    if (!Number.isFinite(out.crossLevelRadius) || out.crossLevelRadius < 0) throw new RangeError('crossLevelRadius must be nonnegative');
    return out;
  }
  function normalizeOpening(value) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('brOpening must select red/blue');
    for (const [key, val] of Object.entries(value)) if (!['red', 'blue'].includes(key) || typeof val !== 'boolean') throw new TypeError('brOpening sides must be booleans');
    return { red: !!value.red, blue: !!value.blue };
  }
  function level(point) {
    const s = F.surface(point);
    return s.type === 'l2' ? 2 : ['l1', 'transfer'].includes(s.type) ? 1 : 0;
  }
  function visible(origin, target, radius = 3, targetLevel = level(target)) {
    return level(origin) === targetLevel || Math.hypot(origin.x - target.x, origin.y - target.y) <= radius + 1e-9;
  }
  const openingSpots = team => team === 'red' ? ['s2', 'r2', 'u3'] : ['s2', 'b2', 'u4'];
  function allowed(view, id) { return !view.brOpeningActive || openingSpots(view.team).includes(id); }
  function cleanObject(o) { const { deliveries, ...rest } = o; return copy(rest); }
  function project(sim, robot, completedTowers, score) {
    const settings = sim.config.brObservation, at = sim.time;
    const old = robot.brKnowledge || { towers: {}, source: [], metadata: {}, sanctuary: false, sanctuaryEvidence: null, delivered: {} };
    const k = copy(old), meta = k.metadata;
    for (const entry of Object.values(meta)) { if (entry.status !== 'unknown') entry.status = 'stale'; }
    const mark = key => { meta[key] = { status: 'current', observedAt: at }; };
    const sees = (p, l) => visible(robot, p, settings.crossLevelRadius, l);
    for (const spot of F.spots) {
      const key = `tower:${spot.id}`;
      meta[key] ||= { status: 'unknown', observedAt: null };
      if (sees(spot, spot.level)) { k.towers[spot.id] = sim.tower(spot.id).map(cleanObject); mark(key); }
    }
    const stockVisible = F.slots(robot.team).every(s => sees(s, 1));
    meta.stock ||= { status: 'unknown', observedAt: null };
    if (stockVisible) {
      k.stock = sim.stock(robot.team).map(cleanObject); mark('stock');
      for (const o of k.stock) k.delivered[o.id] = robot.team;
    }
    // Source sites are static public geometry. Update absence only at visible sites;
    // never use the new (hidden) position of a removed object to erase memory.
    const sites = sim.brSourceSites;
    const currentSource = sim.objects.filter(o => o.location === 'source' && (!o.team || o.team === robot.team));
    for (const site of sites.filter(s => !s.team || s.team === robot.team)) {
      const key = `source:${site.id}`; meta[key] ||= { status: 'unknown', observedAt: null };
      if (sees(site, 0)) {
        k.source = k.source.filter(o => o.id !== site.id);
        const o = currentSource.find(o => o.id === site.id); if (o) k.source.push(cleanObject(o));
        mark(key);
      }
    }
    for (const [key, id] of [['partner', `${robot.team}TR`], ['opponentBR', `${robot.team === 'red' ? 'blue' : 'red'}BR`]]) {
      meta[key] ||= { status: 'unknown', observedAt: null };
      const actor = sim.robot(id);
      if (sees(actor)) {
        k[key] = { x: actor.x, y: actor.y, z: actor.z,
          ...(key === 'partner' ? { cargo: actor.cargo.map(id => cleanObject(sim.object(id))) }
            : { maxSpeed: sim.config.maxSpeed * sim.config[`${actor.team}Speed`], placeSeconds: sim.config.placeSeconds }) };
        mark(key);
      }
    }
    meta.pillar ||= { status: 'unknown', observedAt: null };
    if (sees({ x: 5.5, y: 5.5 }, 2)) { k.pillar = sim.object('M').location === 'pillar' ? cleanObject(sim.object('M')) : null; mark('pillar'); }
    meta.handoff ||= { status: 'unknown', observedAt: null };
    if (stockVisible && meta.partner.status === 'current') { k.handoff = copy(sim.mustikaOffer(robot.team)); mark('handoff'); }
    const currentTowers = id => meta[`tower:${id}`]?.status === 'current' ? k.towers[id] || [] : [];
    const complete = completedTowers(currentTowers, robot.team);
    if (!k.sanctuary && complete.length >= 2 && complete.some(s => !s.team)) {
      k.sanctuary = true; k.sanctuaryEvidence = { at, towers: complete.map(s => s.id), evidence: 'visible-simultaneous-completion' };
    }
    const estimate = score(k);
    robot.brKnowledge = k;
    return { at, origin: { x: robot.x, y: robot.y }, towers: copy(k.towers), stock: copy(k.stock || []), source: copy(k.source),
      partner: copy(k.partner || null), opponentBR: copy(k.opponentBR || null), pillar: k.pillar === undefined ? undefined : copy(k.pillar),
      handoff: copy(k.handoff || null), sanctuary: k.sanctuary, sanctuaryEvidence: copy(k.sanctuaryEvidence),
      // A last-seen subtotal is not an exact global score or a proven bound.
      scores: null, estimatedScores: estimate, scoreStatus: 'partial-last-known',
      information: information(sim.config), visibility: { model: settings.model, crossLevelRadius: settings.crossLevelRadius, entries: copy(meta) } };
  }
  function ownWork(sim, r, job) {
    if (!r.brKnowledge) return;
    const k = r.brKnowledge;
    if (job.spotId && WORK.includes(job.type)) {
      k.towers[job.spotId] = sim.tower(job.spotId).map(cleanObject);
      k.metadata[`tower:${job.spotId}`] = { status: 'self-action', observedAt: sim.time };
    }
    if (job.type === 'enshrine') { k.pillar = cleanObject(sim.object('M')); k.metadata.pillar = { status: 'self-action', observedAt: sim.time }; }
    if (job.type === 'receive') {
      k.stock = (k.stock || []).filter(o => o.id !== job.objectId);
      if (job.objectId === 'M') { k.handoff = null; if (k.partner) k.partner.cargo = k.partner.cargo.filter(o => o.id !== 'M'); }
    }
    if (job.type === 'return') { k.stock ||= []; k.stock.push(cleanObject(sim.object(job.objectId))); }
  }
  return { normalizeSignal, information, normalize, normalizeOpening, level, visible, openingSpots, allowed, project, ownWork, WORK, INFORMATION };
});
