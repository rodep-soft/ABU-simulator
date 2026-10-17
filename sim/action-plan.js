(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField);
  if (typeof module === 'object') module.exports = api; else root.RoboActionPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const ids = ['redTR', 'redBR', 'blueTR', 'blueBR'];
  const names = { move: '移動', scan: '観測', pickup: '採集', receive: '受取', unload: '納品', return: '返却', place: '配置', flip: 'Sky反転', recover: '自Earth回収', enshrine: '奉納', wait: '待機' };
  const roles = { TR: ['move', 'pickup', 'unload', 'scan', 'wait'], BR: ['move', 'scan', 'receive', 'place', 'flip', 'return', 'recover', 'enshrine', 'wait'] };
  const workTypes = ['scan', 'pickup', 'receive', 'unload', 'return', 'place', 'flip', 'recover', 'enshrine'];
  const motionKeys = ['maxSpeed', 'acceleration', 'stairSpeed', 'stairPause', 'rampFactor'];
  function bounded(value, low, high, name) {
    if (!Number.isFinite(value) || value < low || value > high) throw new TypeError(`${name}: ${low}〜${high}で指定してください`);
    return value;
  }
  function normalizeTiming(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('robotTimingはオブジェクトです');
    const out = {};
    for (const [id, row] of Object.entries(input)) {
      if (!ids.includes(id) || !row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('不明なロボット時間設定です');
      const target = {};
      for (const [key, value] of Object.entries(row)) {
        if (![...motionKeys, ...workTypes].includes(key)) throw new TypeError(`不明な時間設定: ${key}`);
        target[key] = bounded(value, key === 'rampFactor' ? .05 : key === 'stairPause' ? 0 : .05, key === 'rampFactor' ? 1 : workTypes.includes(key) ? 60 : key === 'stairPause' ? 10 : 15, key);
      }
      out[id] = target;
    }
    return out;
  }
  function duration(motion, type) {
    return motion.actionSeconds?.[type] ?? (type === 'scan' ? motion.scanSeconds : ['place', 'flip', 'recover', 'enshrine'].includes(type) ? motion.placeSeconds : motion.pickupSeconds);
  }
  function effectiveMotion(config, id) {
    const base = Object.fromEntries(['maxSpeed', 'acceleration', 'bodySize', 'rampFactor', 'stairSpeed', 'stairPause', 'scanSeconds', 'pickupSeconds', 'placeSeconds'].map(key => [key, config[key]]));
    const row = config.robotTiming?.[id];
    if (row) {
      for (const k of motionKeys) if (row[k] !== undefined) base[k] = row[k];
      base.actionSeconds = Object.fromEntries(workTypes.map(type => [type, row[type] ?? duration(base, type)]));
      base.scanSeconds = base.actionSeconds.scan; base.pickupSeconds = base.actionSeconds.pickup; base.placeSeconds = base.actionSeconds.place;
    }
    return base;
  }
  function destinations(id) {
    const team = id.startsWith('red') ? 'red' : 'blue', role = id.endsWith('TR') ? 'TR' : 'BR', p = F.points[team];
    return [
      ['standby', '受渡そば待機', p.brStandby], ['transfer', '受け渡し位置', p[role === 'BR' ? 'transferBR' : 'transferTR']],
      ['start', '開始位置', p['start' + role]], ['home', 'L1見渡し', p.home], ['homeL2', 'L2見渡し', p.homeL2],
      ['mustika', 'Mustika前', p.mustika], ['pillar', '奉納位置', p.pillar],
      ...F.spots.filter(s => !s.team || s.team === team).map(s => ['spot:' + s.id, F.spotName(s.id), F.spotApproaches(s, team)[0]]),
      ['source:earth', 'Earth採集位置', null], ['source:sky', 'Sky採集位置', null], ['source:mustika', 'Mustika採集位置', null], ['coordinates', '座標指定', null],
    ];
  }
  function normalizePrograms(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('robotProgramsはオブジェクトです');
    const out = {};
    for (const [id, p] of Object.entries(input)) {
      if (!ids.includes(id) || !p || typeof p !== 'object' || !Array.isArray(p.steps) || p.steps.length > 200) throw new TypeError('手順はロボットごとに最大200行で指定してください');
      if (p.enabled !== undefined && typeof p.enabled !== 'boolean') throw new TypeError('手順の有効設定が不正です');
      if (p.end !== undefined && !['wait', 'strategy'].includes(p.end)) throw new TypeError('手順終了時の設定が不正です');
      out[id] = { enabled: !!p.enabled, end: p.end || 'wait', steps: p.steps.map(a => {
        if (!a || !roles[id.slice(-2)].includes(a.type)) throw new TypeError(`${id}の動作を確認してください`);
        const row = { type: a.type };
        if (a.type === 'move') {
          if (!destinations(id).some(([key]) => key === a.destination)) throw new TypeError('移動先を確認してください');
          row.destination = a.destination;
          if (a.destination === 'coordinates') row.target = { x: bounded(a.target?.x, 0, 11, 'x'), y: bounded(a.target?.y, 0, 11, 'y') };
        }
        if (['pickup', 'receive', 'place', 'unload', 'return'].includes(a.type)) {
          row.objectType = a.objectType || 'earth';
          if (!['earth', 'sky', 'mustika'].includes(row.objectType)) throw new TypeError('対象はEarth / Sky / Mustikaです');
          if (a.objectId) { if (typeof a.objectId !== 'string' || a.objectId.length > 40) throw new TypeError('物体IDが不正です'); row.objectId = a.objectId; }
        }
        if (['place', 'flip', 'recover'].includes(a.type)) {
          const s = F.spotById[a.spotId]; if (!s || s.team && s.team !== id.slice(0, -2)) throw new TypeError('配置先を確認してください'); row.spotId = a.spotId;
        }
        if (a.type === 'wait') row.seconds = bounded(a.seconds ?? 1, .05, 180, '待機秒数');
        else if (workTypes.includes(a.type) && a.seconds !== undefined) row.seconds = bounded(a.seconds, .05, 60, 'この手の作業秒数');
        return row;
      }) };
    }
    return out;
  }
  function next(v, sourceApproach) {
    const plan = v.programPlan;
    if (!plan?.enabled) return null;
    const progress = v.program || { index: 0 }, row = plan.steps[progress.index];
    const status = text => ({ brain: v.brain, wait: .5, status: text });
    if (progress.error) return status(`手順${progress.index + 1}停止 · ${progress.error.reason}`);
    if (!row) return plan.end === 'strategy' ? null : status('手順完了 · 待機');
    const action = { type: row.type, programStep: progress.index };
    if (row.type === 'move') {
      action.target = row.destination === 'coordinates' ? row.target : destinations(v.id).find(([id]) => id === row.destination)[2];
      if (row.destination.startsWith('source:')) {
        const type = row.destination.split(':')[1], source = v.observation?.source || [];
        const candidates = source.filter(o => o.type === type && !o.touchedBy && !source.some(t => t.column && t.column === o.column && t.layer > o.layer));
        candidates.sort((a, b) => type === 'earth' ? b.y - a.y || Math.abs(a.x - v.x) - Math.abs(b.x - v.x) : (v.team === 'red' ? a.x - b.x : b.x - a.x));
        const o = candidates[0];
        if (!o) return status('採集元の観測・供給待ち');
        action.target = sourceApproach(o, v.team);
      }
      action.label = `手順${progress.index + 1} · 移動`;
    }
    if (row.objectType) {
      const from = ['place', 'unload', 'return'].includes(row.type) ? v.cargo : row.type === 'pickup' ? v.observation?.source || [] : v.observation?.stock || [];
      const o = row.type === 'receive' && row.objectType === 'mustika' && v.observation?.handoff ? { id: 'M' }
        : [...from].sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y)).find(o => o.type === row.objectType && (!row.objectId || o.id === row.objectId) && (!o.touchedBy || o.holder === v.id)
          && (o.location === 'cargo' || !from.some(t => (o.column && t.column === o.column || o.slot && t.slot === o.slot) && t.layer > o.layer)));
      if (!o) {
        if (['place', 'unload', 'return'].includes(row.type) || row.type === 'receive' && !v.enteredL1) {
          return { brain: v.brain, actions: [{ ...action, objectId: row.objectId || '', spotId: row.spotId }] };
        }
        if (row.type === 'receive' && v.enteredL1 && ['l1', 'l2'].includes(F.surface(v).type) && (v.brObservationMode === 'stopped' || v.brObservation?.replan === 'after-work')) {
          return { brain: v.brain, actions: [{ type: 'scan', local: true }], status: `手順${progress.index + 1} · 在庫を再観測` };
        }
        return status(`手順${progress.index + 1} · 対象${row.objectType}待ち`);
      }
      action.objectId = o.id;
    }
    if (row.spotId) action.spotId = row.spotId;
    if (row.type === 'scan' && (v.brObservationMode === 'stopped' || v.brObservation?.replan === 'after-work' || v.failure)) action.local = true;
    if (row.seconds !== undefined) action.seconds = row.seconds;
    return { brain: v.brain, actions: [action], status: `手順${progress.index + 1} · ${names[row.type]}` };
  }
  function template(id) {
    if (id.endsWith('TR')) return [{ type: 'move', destination: 'source:earth' }, { type: 'pickup', objectType: 'earth' }, { type: 'move', destination: 'transfer' }, { type: 'unload', objectType: 'earth' }];
    const steps = [{ type: 'move', destination: 'standby' }, { type: 'scan' }, { type: 'move', destination: 'transfer' }, { type: 'scan' }];
    for (let i = 0; i < 2; i++) steps.push({ type: 'receive', objectType: 'earth' }, { type: 'scan' });
    for (const spotId of ['s2', id.startsWith('red') ? 'r2' : 'b2']) steps.push({ type: 'move', destination: 'spot:' + spotId }, { type: 'scan' }, { type: 'place', objectType: 'earth', spotId }, { type: 'scan' });
    return steps;
  }
  return { ids, names, roles, workTypes, motionKeys, normalizeTiming, normalizePrograms, effectiveMotion, duration, destinations, next, template, copy };
});
