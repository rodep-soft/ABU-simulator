const test = require('node:test'), assert = require('node:assert/strict');
const F = require('../field.js'), S = require('../engine.js');
const A = require('../../vendor/astar.js');

function exhaustivePath(sim, robot, target, dynamic) {
  if (!sim.footprintAllowed(robot, target)) return null;
  const graph = sim.graph(robot, dynamic);
  const nearest = p => {
    const candidates = [];
    for (let x = Math.max(0, Math.floor(p.x * 10) - 2); x <= Math.min(109, Math.floor(p.x * 10) + 2); x++)
      for (let y = Math.max(0, Math.floor(p.y * 10) - 2); y <= Math.min(109, Math.floor(p.y * 10) + 2); y++) {
        const node = graph.grid[x][y], point = { x: (x + .5) / 10, y: (y + .5) / 10 };
        if (node.weight && sim.segmentAllowed(robot, p, point, dynamic)) candidates.push({ node, d: S.distance(p, point) });
      }
    return candidates.sort((a, b) => a.d - b.d)[0]?.node;
  };
  const start = nearest(robot), end = nearest(target); if (!start || !end) return null;
  const nodes = A.astar.search(graph, start, end); graph.markDirty(start);
  if (!nodes.length && start !== end) return null;
  const raw = [start, ...nodes].map(n => ({ x: (n.x + .5) / 10, y: (n.y + .5) / 10 })); raw.push(target);
  const result = []; let anchor = { x: robot.x, y: robot.y };
  for (let i = 0; i < raw.length;) {
    let j = i;
    while (j + 1 < raw.length && F.surface(anchor).type === F.surface(raw[j + 1]).type && sim.segmentAllowed(robot, anchor, raw[j + 1], dynamic)) j++;
    if (S.distance(anchor, raw[j]) > .005) result.push(raw[j]); anchor = raw[j]; i = j + 1;
  }
  return result;
}

test('lazy nearest-node validation produces the identical ordered route as checking all candidates first', () => {
  for (const team of ['red', 'blue']) for (const dynamic of [false, true]) {
    const sim = new S.Simulation(), br = sim.robot(team + 'BR'), tr = sim.robot(team + 'TR'), p = F.points[team];
    Object.assign(br, p.brStandby, { enteredL1: true, z: .6 });
    for (const target of F.spots.filter(s => !s.team || s.team === team).map(s => F.spotApproaches(s, team)[0]))
      assert.deepEqual(sim.findPath(br, target, dynamic), exhaustivePath(sim, br, target, dynamic));
    assert.deepEqual(sim.findPath(tr, p.transferTR, dynamic), exhaustivePath(sim, tr, p.transferTR, dynamic));
  }
});

test('cached grid footprints and neighbor order exactly match direct terrain checks for all roles and sides', () => {
  S.clearTerrainCache();
  for (const bodySize of [.35, .5, .7]) for (const team of ['red', 'blue']) for (const role of ['TR', 'BR']) {
    const sim = new S.Simulation({ bodySize }); sim.objects = [];
    const r = sim.robot(team + role);
    for (const entered of (role === 'BR' ? [false, true] : [false])) {
      r.enteredL1 = entered; sim.changed(); const graph = sim.graph(r);
      for (let x = 0; x < 110; x++) for (let y = 0; y < 110; y++) {
        const node = graph.grid[x][y], point = { x: (x + .5) / 10, y: (y + .5) / 10 };
        const type = F.surface(point).type;
        const weight = !sim.footprintAllowed(r, point) ? 0 : ['stairs', 'upperStairs'].includes(type) ? 7 : type === 'ramp' ? 1 / sim.config.rampFactor : 1;
        assert.equal(node.weight, weight, `${team}/${role}/${entered}/${bodySize}/${x}/${y}`);
        if (x % 7 || y % 7) continue;
        const expected = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => graph.grid[a]?.[b]
          && F.transition(point, { x: (a + .5) / 10, y: (b + .5) / 10 }));
        assert.deepEqual(graph.neighbors(node).map(n => [n.x, n.y]), expected);
      }
    }
  }
});

test('terrain reuse never caches boxes, robot collisions or changed ramp weights', () => {
  const sim = new S.Simulation(), r = sim.robot('redBR'); r.enteredL1 = true; sim.objects = [];
  const point = { x: 3.25, y: 6.05 }, node = graph => graph.grid[32][60].weight;
  sim.changed(); assert.ok(node(sim.graph(r)));
  sim.objects.push({ type: 'earth', location: 'spot', ...point, z: .6, size: .35, height: .35 });
  sim.changed(); assert.equal(node(sim.graph(r)), 0);
  sim.objects = []; sim.changed(); assert.ok(node(sim.graph(r)));
  Object.assign(sim.robot('blueBR'), point, { z: .6 }); assert.equal(node(sim.graph(r, true)), 0);
  Object.assign(sim.robot('blueBR'), { x: 7.8, y: 8.2 }); assert.ok(node(sim.graph(r, true)));
  const tr = sim.robot('redTR');
  sim.config.rampFactor = .25; sim.changed(); assert.equal(sim.graph(tr).grid[20][40].weight, 4);
  sim.config.rampFactor = .5; sim.changed(); assert.equal(sim.graph(tr).grid[20][40].weight, 2);
});

test('custom footprint and transition implementations bypass the shared cache', () => {
  const sim = new S.Simulation(), r = sim.robot('redBR'); r.enteredL1 = true; sim.objects = [];
  sim.changed(); assert.ok(sim.graph(r).grid[32][60].weight);
  sim.footprintAllowed = () => false; sim.changed(); assert.equal(sim.graph(r).grid[32][60].weight, 0);
  delete sim.footprintAllowed;
  const original = F.transition;
  try {
    F.transition = () => false; sim.changed(); const graph = sim.graph(r);
    assert.deepEqual(graph.neighbors(graph.grid[32][60]), []);
  } finally { F.transition = original; }
});

test('field shape is included in cache identity and memory is bounded and clearable', () => {
  const sim = new S.Simulation(), r = sim.robot('redBR'); r.enteredL1 = true; sim.objects = [];
  sim.changed(); assert.ok(sim.graph(r).grid[32][60].weight);
  F.walls.push(F.rect(3, 5.8, .5, .5));
  try { sim.changed(); assert.equal(sim.graph(r).grid[32][60].weight, 0); }
  finally { F.walls.pop(); }
  for (let i = 0; i < 20; i++) { sim.config.bodySize = .3 + i * .01; sim.changed(); sim.graph(r); }
  assert.ok(S.terrainCacheInfo().entries <= 16); assert.ok(S.terrainCacheInfo().bytes <= 968000);
  S.clearTerrainCache(); assert.deepEqual(S.terrainCacheInfo(), { entries: 0, bytes: 0 });
});
