(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;
  else root.RoboField = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const rect = (x, y, w, h) => ({ x, y, w, h });
  const inside = (p, r, e = 0) => p.x >= r.x - e && p.x <= r.x + r.w + e && p.y >= r.y - e && p.y <= r.y + r.h + e;
  const mirror = p => ({ ...p, x: 11 - p.x });
  const regions = {
    ground: rect(0, 0, 11, 11), l1: rect(2.5, 2.5, 6, 6), l2: rect(4, 4, 3, 3),
    sky: rect(4.9, 9.15, 1.2, 1.2), mustika: rect(5, .75, 1, 1),
    sharedTop: rect(5, 2.55, 1, .75), sharedBottom: rect(5, 7.8, 1, .65),
  };
  const zones = {};
  for (const team of ['red', 'blue']) {
    const left = team === 'red';
    zones[team] = {
      ramp: rect(left ? 1.5 : 8.5, 2.8, 1, 3.5),
      transfer: rect(left ? 1.5 : 8.5, 6.3, 1, 1),
      stairs: rect(left ? 1.5 : 8.5, 7.3, 1, .9),
      upperStairs: rect(left ? 3.7 : 7, 5, .3, 1),
      storage: rect(left ? 0 : 9, 0, 2, 1),
      retry: rect(left ? 3.3 : 7, 2.55, .7, .7),
    };
  }
  const base = {
    startTR: { x: .35, y: 10.65 }, startBR: { x: 1.15, y: 10.65 },
    home: { x: 3.05, y: 5.5 }, homeL2: { x: 4.35, y: 5.5 }, transferTR: { x: 1.8, y: 6.75 },
    stockStandby: { x: 1.8, y: 5.65 },
    brStandby: { x: 3.7, y: 6.8 },
    transferBR: { x: 2.9, y: 6.8 }, storage: { x: 1.05, y: 1.35 },
    sky: { x: 4.55, y: 9.75 }, mustika: { x: 4.9, y: 1.25 },
    retry: { x: 3.65, y: 2.9 }, l2: { x: 4.65, y: 5.5 },
    pillar: { x: 4.9, y: 5.5 }, stairEntry: { x: 1.8, y: 8.65 },
  };
  const points = { red: base, blue: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, mirror(v)])) };
  const spots = [
    { id: 'r1', label: '赤L1上', x: 2.8, y: 2.8, level: 1, team: 'red' },
    { id: 'r2', label: '赤L1下', x: 2.8, y: 8.2, level: 1, team: 'red' },
    { id: 'b1', label: '青L1上', x: 8.2, y: 2.8, level: 1, team: 'blue' },
    { id: 'b2', label: '青L1下', x: 8.2, y: 8.2, level: 1, team: 'blue' },
    { id: 's1', label: 'L1共有上', x: 5.5, y: 2.8, level: 1 },
    { id: 's2', label: 'L1共有下', x: 5.5, y: 8.2, level: 1 },
    { id: 'u1', label: 'L2左上', x: 4.25, y: 4.25, level: 2 },
    { id: 'u2', label: 'L2右上', x: 6.75, y: 4.25, level: 2 },
    { id: 'u3', label: 'L2左下', x: 4.25, y: 6.75, level: 2 },
    { id: 'u4', label: 'L2右下', x: 6.75, y: 6.75, level: 2 },
  ];
  const spotById = Object.fromEntries(spots.map(s => [s.id, s]));
  const spotNumbers = { s2: 1, r2: 2, r1: 3, s1: 4, b1: 5, b2: 6, u3: 7, u1: 8, u2: 9, u4: 10 };
  const spotName = id => `${spotNumbers[id]} · ${spotById[id].label}`;
  function surface(p) {
    if (!inside(p, regions.ground)) return { type: 'outside', z: 0 };
    if (inside(p, regions.l2)) return { type: 'l2', z: .9 };
    for (const team of ['red', 'blue']) {
      const a = zones[team];
      if (inside(p, a.upperStairs)) return { type: 'upperStairs', team, z: .75 };
      if (inside(p, a.transfer)) return { type: 'transfer', team, z: .6 };
      if (inside(p, a.ramp)) return { type: 'ramp', team, z: .6 * (p.y - 2.8) / 3.5 };
      if (inside(p, a.stairs)) return { type: 'stairs', team, z: .15 * Math.ceil((8.2 - p.y) / .3 + 1e-8) };
    }
    if (inside(p, regions.l1)) return { type: 'l1', z: .6 };
    return { type: 'ground', z: 0 };
  }
  function territory(p) {
    if (inside(p, regions.l2) || inside(p, regions.sharedTop) || inside(p, regions.sharedBottom) || inside(p, regions.sky) || inside(p, regions.mustika)) return 'shared';
    return p.x < 5.5 ? 'red' : 'blue';
  }
  function scanPoint(team, from, mode) {
    if (mode === 'stopped') return ['l1', 'l2'].includes(surface(from).type) ? { x: from.x, y: from.y } : points[team].brStandby;
    return points[team][surface(from).type === 'l2' ? 'homeL2' : 'home'];
  }
  function scanActions(v, from = v) {
    const target = scanPoint(v.team, from, v.brObservationMode);
    return [...(v.brObservationMode !== 'stopped' || Math.hypot(target.x - from.x, target.y - from.y) > .02
      ? [{ type: 'move', target, label: v.brObservationMode === 'stopped' ? '受渡そばの待機点へ' : '見渡し場所へ' }] : []), { type: 'scan' }];
  }
  function atScanPoint(team, p) {
    return ['home', 'homeL2'].some(key => Math.hypot(p.x - points[team][key].x, p.y - points[team][key].y) <= .12);
  }
  function transition(a, b) {
    const sa = surface(a), sb = surface(b);
    if (sa.type === sb.type) return true;
    const types = [sa.type, sb.type].sort().join(':');
    const nearY = y => Math.min(a.y, b.y) <= y + 1e-7 && Math.max(a.y, b.y) >= y - 1e-7;
    const nearX = x => Math.min(a.x, b.x) <= x + 1e-7 && Math.max(a.x, b.x) >= x - 1e-7;
    if (types === 'ground:ramp') return nearY(2.8);
    if (types === 'ground:stairs') return nearY(8.2);
    if (types === 'ramp:transfer') return nearY(6.3);
    if (types === 'stairs:transfer') return nearY(7.3);
    if (types === 'l1:transfer') return (nearX(2.5) || nearX(8.5)) && a.y >= 6.3 && a.y <= 7.3 && b.y >= 6.3 && b.y <= 7.3;
    if (types === 'l1:upperStairs') return nearX(3.7) || nearX(7.3);
    if (types === 'l2:upperStairs') return nearX(4) || nearX(7);
    return false;
  }
  const walls = [
    rect(2.5, 2.5, 6, .05), rect(2.5, 8.45, 6, .05),
    rect(2.5, 2.5, .05, 3.8), rect(2.5, 7.3, .05, 1.2),
    rect(8.45, 2.5, .05, 3.8), rect(8.45, 7.3, .05, 1.2),
    rect(5.475, 0, .05, .75), rect(5.475, 1.75, .05, .75),
    rect(5.475, 3.3, .05, .7), rect(5.475, 7, .05, .8),
    rect(5.475, 8.5, .05, .65), rect(5.475, 10.35, .05, .65),
  ];
  function spotApproaches(s, team) {
    if (s.id[0] === 's') return [{ x: team === 'red' ? 4.75 : 6.25, y: s.y }];
    const dx = s.x < 5.5 ? .6 : -.6, dy = s.y < 5.5 ? .6 : -.6;
    return [{ x: s.x + dx, y: s.y + dy }, { x: s.x + dx, y: s.y }, { x: s.x, y: s.y + dy }];
  }
  const stockLimits = { earth: 3, sky: 4 };
  function slots(team) {
    return [6.55, 7.05].map((y, i) => ({ id: `${team}-${i}`, team, type: i === 0 ? 'earth' : 'sky', x: team === 'red' ? 2.275 : 8.725, y, maxLayers: i === 0 ? stockLimits.earth : stockLimits.sky }));
  }
  return { rect, inside, mirror, regions, zones, points, spots, spotById, spotNumbers, spotName, surface, territory, transition, walls, spotApproaches, slots, stockLimits, scanPoint, scanActions, atScanPoint };
});
