(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./field.js') : root.RoboField,
    typeof module === 'object' ? require('../vendor/astar.js') : { Graph: root.Graph, astar: root.astar });
  if (typeof module === 'object') module.exports = api;
  else root.RoboSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, A) {
  'use strict';
  const clone = x => JSON.parse(JSON.stringify(x));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const overlap = (a, b) => a.x < b.x + b.w - 1e-7 && a.x + a.w > b.x + 1e-7 && a.y < b.y + b.h - 1e-7 && a.y + a.h > b.y + 1e-7;
  const box = (p, side) => F.rect(p.x - side / 2, p.y - side / 2, side, side);
  const fail = (reason, rule, kind = 'rule') => ({ ok: false, reason, rule, kind });
  const success = { ok: true };
  const claimKey = a => ['place', 'flip', 'recover'].includes(a.type) ? `spot:${a.spotId}` : ['pickup', 'receive'].includes(a.type) ? `object:${a.objectId}` : null;
  const DEFAULTS = { maxSpeed: 7, acceleration: 3.5, redSpeed: 1, blueSpeed: 1, redTrPlan: 'balanced', blueTrPlan: 'balanced', redBrPlan: 'score-search', blueBrPlan: 'score-search', bodySize: .5, rampFactor: .55, stairSpeed: .25, stairPause: .6, scanSeconds: 3, pickupSeconds: 1.5, placeSeconds: 2.5 };
  const labels = { earth: 'Earth', sky: 'Sky', mustika: 'Mustika', scan: '停止・見渡し', unload: '受け渡しへ配置', receive: 'ブロック受取', place: 'タワーへ配置', flip: 'Sky反転', enshrine: 'Mustika奉納', pickup: '採集', move: '移動', retry: 'リトライ', recover: '自Earth回収' };
  function initialObjects() {
    const objects = [];
    for (const team of ['red', 'blue']) for (let c = 0; c < 10; c++) for (let layer = 0; layer < 2; layer++) {
      const p = { x: .2 + (c % 5) * .39, y: .22 + Math.floor(c / 5) * .48 };
      objects.push({ id: `${team}-E${c * 2 + layer + 1}`, type: 'earth', team, location: 'source', ...team === 'red' ? p : F.mirror(p), z: layer * .35, size: .35, height: .35, layer, column: `${team}-${c}`, placedBy: null, touchedBy: null, deliveries: [] });
    }
    let id = 0;
    for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
      if ((row + col) % 2 || (row === 2 && col === 2)) continue;
      objects.push({ id: `S${++id}`, type: 'sky', location: 'source', x: 5.02 + col * .24, y: 9.27 + row * .24, z: 0, size: .2, height: .2, color: col < 2 ? 'red' : 'blue', placedBy: null, touchedBy: null, deliveries: [] });
    }
    objects.push({ id: 'M', type: 'mustika', location: 'source', x: 5.5, y: 1.25, z: .5, size: .21, height: .21, placedBy: null, touchedBy: null, deliveries: [] });
    return objects;
  }
  class Simulation {
    constructor(config = {}) {
      this.config = { ...DEFAULTS, ...config };
      this.time = 0; this.ended = false; this.events = []; this.history = []; this.lastFrame = -1; this.version = 0; this.graphs = new Map();
      this.objects = initialObjects(); this.sanctuary = { red: null, blue: null }; this.transferPoints = { red: 0, blue: 0 };
      this.robots = [];
      for (const team of ['red', 'blue']) for (const role of ['TR', 'BR']) {
        this.robots.push({ id: `${team}${role}`, team, role, ...F.points[team][`start${role}`], z: 0, enteredL1: false, cargo: [], queue: [], job: null, auto: true, velocity: 0, wait: 0, blocked: 0, status: '開始待ち', observation: null, scanLoaded: false, batchRemaining: 0, brain: { stage: 'start' }, transport: { completed: [], pending: [] }, failure: null });
      }
      this.log(null, '開始', '初期配置を確認しました', 'setup'); this.capture();
    }
    robot(id) { return this.robots.find(r => r.id === id); }
    object(id) { return this.objects.find(o => o.id === id); }
    stock(team) { return this.objects.filter(o => o.location === 'transfer' && o.transferTeam === team); }
    tower(id) { return this.objects.filter(o => o.location === 'spot' && o.spotId === id).sort((a, b) => a.layer - b.layer); }
    log(robot, action, text, kind = 'action', rule = '', extra = {}) {
      this.events.push({ time: +this.time.toFixed(3), robot: robot?.id || null, action, text, kind, rule, ...extra });
    }
    footprintAllowed(robot, p) {
      const half = this.config.bodySize / 2, b = box(p, this.config.bodySize);
      if (b.x < 0 || b.y < 0 || b.x + b.w > 11 || b.y + b.h > 11) return false;
      const surface = F.surface(p);
      if (F.walls.some(w => overlap(b, w))) return false;
      for (const dx of [-half, 0, half]) for (const dy of [-half, 0, half]) {
        const q = { x: p.x + dx, y: p.y + dy }, s = F.surface(q), territory = F.territory(q);
        if (territory !== robot.team && territory !== 'shared') return false;
        if (robot.role === 'TR' && ['l1', 'l2', 'upperStairs'].includes(s.type)) return false;
        if (robot.role === 'BR' && ((robot.enteredL1 && ['ground', 'ramp', 'stairs'].includes(s.type)) || (!robot.enteredL1 && s.type === 'ground' && q.y < 8.2) || s.type === 'ramp')) return false;
        if (!F.transition(p, q)) return false;
      }
      const pillars = [{ x: 5.5, y: 1.25, z: 0 }, { x: 5.5, y: 5.5, z: .9 }];
      if (pillars.some(pillar => Math.abs(surface.z - pillar.z) < .2 && overlap(b, box(pillar, .27)))) return false;
      return true;
    }
    obstacleFree(robot, p, robots = false) {
      const b = box(p, this.config.bodySize), z = F.surface(p).z;
      if (this.objects.some(o => ['source', 'transfer', 'spot'].includes(o.location) && o.type !== 'mustika' && o.z + o.height > z + .03 && o.z < z + 1.2 && overlap(b, box(o, o.size)))) return false;
      // Match the moving-body clearance so a robot stopped at that boundary can reroute away.
      return !robots || !this.robots.some(r => r !== robot && Math.abs(r.z - z) < .4 && overlap(box(p, this.config.bodySize + .015), box(r, this.config.bodySize + .015)));
    }
    segmentAllowed(robot, from, to, dynamic = false) {
      const n = Math.max(1, Math.ceil(distance(from, to) / .045)); let prev = from;
      for (let i = 1; i <= n; i++) {
        const p = { x: from.x + (to.x - from.x) * i / n, y: from.y + (to.y - from.y) * i / n };
        if (!this.footprintAllowed(robot, p) || !F.transition(prev, p) || !this.obstacleFree(robot, p, dynamic)) return false;
        prev = p;
      }
      return true;
    }
    graph(robot, dynamic = false) {
      const key = `${robot.id}:${robot.enteredL1}:${this.version}`;
      if (!dynamic && this.graphs.has(key)) return this.graphs.get(key);
      const graph = new A.Graph(Array.from({ length: 110 }, (_, x) => Array.from({ length: 110 }, (_, y) => {
        const p = { x: (x + .5) / 10, y: (y + .5) / 10 };
        if (!this.footprintAllowed(robot, p) || !this.obstacleFree(robot, p, dynamic)) return 0;
        const type = F.surface(p).type;
        return ['stairs', 'upperStairs'].includes(type) ? 7 : type === 'ramp' ? 1 / this.config.rampFactor : 1;
      })));
      const neighbors = graph.neighbors.bind(graph);
      graph.neighbors = node => neighbors(node).filter(next => F.transition({ x: (node.x + .5) / 10, y: (node.y + .5) / 10 }, { x: (next.x + .5) / 10, y: (next.y + .5) / 10 }));
      if (!dynamic) { if (this.graphs.size > 12) this.graphs.clear(); this.graphs.set(key, graph); }
      return graph;
    }
    findPath(robot, target, dynamic = false) {
      if (!this.footprintAllowed(robot, target)) return null;
      const graph = this.graph(robot, dynamic);
      const nearest = p => {
        const candidates = [];
        for (let x = Math.max(0, Math.floor(p.x * 10) - 2); x <= Math.min(109, Math.floor(p.x * 10) + 2); x++)
          for (let y = Math.max(0, Math.floor(p.y * 10) - 2); y <= Math.min(109, Math.floor(p.y * 10) + 2); y++) {
            const node = graph.grid[x][y], q = { x: (x + .5) / 10, y: (y + .5) / 10 };
            if (node.weight && this.segmentAllowed(robot, p, q, dynamic)) candidates.push({ node, d: distance(p, q) });
          }
        return candidates.sort((a, b) => a.d - b.d)[0]?.node;
      };
      const start = nearest(robot), end = nearest(target);
      if (!start || !end) return null;
      const nodes = A.astar.search(graph, start, end);
      // Bundled A* leaves its start node closed; reset it before reusing this graph.
      graph.markDirty(start);
      if (!nodes.length && start !== end) return null;
      const raw = [start, ...nodes].map(n => ({ x: (n.x + .5) / 10, y: (n.y + .5) / 10 }));
      raw.push(target);
      const path = []; let anchor = { x: robot.x, y: robot.y };
      // Simplification never skips a terrain boundary or cuts across an obstacle.
      for (let i = 0; i < raw.length;) {
        let j = i;
        while (j + 1 < raw.length && F.surface(anchor).type === F.surface(raw[j + 1]).type && this.segmentAllowed(robot, anchor, raw[j + 1], dynamic)) j++;
        if (distance(anchor, raw[j]) > .005) path.push(raw[j]);
        anchor = raw[j]; i = j + 1;
      }
      return path;
    }
    touchCheck(robot, target) {
      const s = this.config.bodySize, dx = Math.abs(robot.x - target.x), dy = Math.abs(robot.y - target.y);
      const a = dx + s / 2 + (target.size || 0) / 2, b = dy + s / 2 + (target.size || 0) / 2;
      if (Math.max(a, b) > 1.4 || Math.min(a, b) > 1 || distance(robot, target) > 1.05) return fail('アームの作業範囲外です', '11.5–11.6', 'physical');
      const n = Math.ceil(distance(robot, target) / .04);
      for (let i = 1; i <= n; i++) {
        const p = { x: robot.x + (target.x - robot.x) * i / n, y: robot.y + (target.y - robot.y) * i / n };
        for (const dx of [-.04, .04]) for (const dy of [-.04, .04]) {
          const q = { x: p.x + dx, y: p.y + dy };
          if (![robot.team, 'shared'].includes(F.territory(q))) return fail('アームが相手専有領域へ入ります', '6.2.2');
          if (robot.role === 'TR' && ['l1', 'l2', 'upperStairs'].includes(F.surface(q).type)) return fail('TRのアームが活動範囲を越えます', '6.2.1');
        }
      }
      return success;
    }
    availableSource(robot, type) {
      return this.objects.filter(o => o.type === type && o.location === 'source' && (!o.team || o.team === robot.team) && !o.touchedBy && !this.objects.some(t => t !== o && t.location === 'source' && t.column && t.column === o.column && t.layer > o.layer));
    }
    observe(robot) {
      robot.observation = { at: this.time, stock: clone(this.stock(robot.team)), towers: Object.fromEntries(F.spots.filter(s => !s.team || s.team === robot.team).map(s => [s.id, clone(this.tower(s.id))])), source: clone(this.objects.filter(o => o.location === 'source' && (!o.team || o.team === robot.team))), sanctuary: this.sanctuary[robot.team] !== null, pillar: this.object('M').location === 'pillar' ? clone(this.object('M')) : null };
    }
    view(robot) {
      const motion = Object.fromEntries(['maxSpeed', 'acceleration', 'bodySize', 'rampFactor', 'stairSpeed', 'stairPause', 'scanSeconds', 'pickupSeconds', 'placeSeconds'].map(key => [key, this.config[key]]));
      motion.speedFactor = this.config[`${robot.team}Speed`];
      return clone({ id: robot.id, role: robot.role, team: robot.team, x: robot.x, y: robot.y, enteredL1: robot.enteredL1, cargo: robot.cargo.map(id => this.object(id)), observation: robot.observation, failure: robot.failure, brain: robot.brain, transport: robot.transport, time: this.time, motion, trPlan: this.config[`${robot.team}TrPlan`], brPlan: this.config[`${robot.team}BrPlan`] });
    }
    changed() { this.version++; this.graphs.clear(); }
    validate(robot, action) {
      if (this.ended || this.time >= 180) return fail('競技は終了しています', '4.6.1');
      if (action.type === 'move') {
        if (!action.target || !Number.isFinite(action.target.x) || !Number.isFinite(action.target.y)) return fail('移動先を選んでください', '入力', 'physical');
        return this.footprintAllowed(robot, action.target) ? success : fail('その位置には車体を置けません。活動域・壁・段差を確認してください', 'MOVE-01～09', 'physical');
      }
      if (action.type === 'scan') return robot.role === 'BR' && distance(robot, F.points[robot.team].home) > .12 ? fail('見渡し場所で停止する必要があります', 'ユーザー指定', 'perception') : success;
      if (action.type === 'pickup') {
        if (robot.role !== 'TR') return fail('供給元から採集できるのはTRです', '3.4.1 / 4.5.2');
        const o = this.object(action.objectId);
        if (!o || !this.availableSource(robot, o.type).includes(o)) return fail('取得できる物体がありません', 'OBJ-11', 'physical');
        if (o.type === 'mustika' && this.sanctuary[robot.team] === null) return fail('サンクチュアリ条件が未達成です', '4.5.1');
        if ((o.type === 'mustika' && robot.cargo.length) || robot.cargo.some(id => this.object(id).type === 'mustika')) return fail('Mustikaとの混載は未確定です', 'OPEN-02', 'unsupported');
        if (robot.cargo.length >= 3) return fail('TRは最大3個までです', '4.4.2');
        return this.touchCheck(robot, o);
      }
      if (action.type === 'unload') {
        if (robot.role !== 'TR') return fail('納品はTRの動作です', '3.4');
        if (!robot.cargo.length) return fail('手持ちがありません', 'OBJ-11', 'physical');
        if (distance(robot, F.points[robot.team].transferTR) > .14 || F.surface(robot).type !== 'transfer') return fail('TRは受け渡し区画へ登って納品します', '3.4.5');
        if (this.freeSlot(robot.team, this.object(robot.cargo[0])) === null) return fail('受け渡し区画に空きがありません', 'OBJ-11', 'physical');
        return success;
      }
      if (action.type === 'receive') {
        if (robot.role !== 'BR') return fail('受け取りはBRの動作です', '3.4');
        const o = this.object(action.objectId);
        if (!o || o.location !== 'transfer' || o.transferTeam !== robot.team || o.touchedBy) return fail('受け渡し区画に対象物がありません', '4.4.3', 'physical');
        if (!F.inside({ x: o.x - o.size / 2, y: o.y - o.size / 2 }, F.zones[robot.team].transfer) || !F.inside({ x: o.x + o.size / 2, y: o.y + o.size / 2 }, F.zones[robot.team].transfer)) return fail('物体が受け渡し区画からはみ出しています', '6.3');
        if (this.stock(robot.team).some(t => t.slot === o.slot && t.layer > o.layer)) return fail('上の物体から受け取ってください', '支持関係', 'physical');
        if (robot.cargo.length >= 2) return fail('BRは最大2個までです', '4.4.2');
        if ((o.type === 'mustika' && robot.cargo.length) || robot.cargo.some(id => this.object(id).type === 'mustika')) return fail('Mustikaとの混載は未確定です', 'OPEN-02', 'unsupported');
        return this.touchCheck(robot, o);
      }
      if (['place', 'flip', 'recover'].includes(action.type)) {
        if (robot.role !== 'BR') return fail('建設・反転はBRの動作です', '3.5.1');
        const spot = F.spotById[action.spotId];
        if (!spot) return fail('建設スポットを選んでください', '3.5.1');
        if (spot.team && spot.team !== robot.team) return fail('相手専有スポットでは作業できません', '6.2.2');
        const reach = this.touchCheck(robot, spot); if (!reach.ok) return reach;
        if (spot.level === 2 && F.surface(robot).type !== 'l2') return fail('L2へ上がってから操作してください', action.type === 'place' ? '3.5.4' : 'OPEN-03', action.type === 'place' ? 'rule' : 'unsupported');
        const tower = this.tower(spot.id), top = tower.at(-1);
        if (tower.some(o => o.touchedBy && o.touchedBy !== robot.id)) return fail('他のロボットが操作中です', '6.6', 'physical');
        if (action.type === 'recover') {
          if (!top || top.type !== 'earth' || top.placedBy !== robot.team) return fail('相手Earthや上にブロックのあるEarthは回収できません', '3.5.5 / 7.2');
          if (robot.cargo.length >= 2) return fail('BRは最大2個までです', '4.4.2');
          return success;
        }
        if (!robot.observation || !robot.scanLoaded || robot.batchRemaining <= 0) return fail('見渡し場所へ戻って配置計画を更新してください', 'ユーザー指定', 'perception');
        if (action.type === 'flip') {
          if (robot.cargo.length >= 2) return fail('Skyを持ち上げて反転するための空きがありません', '4.4.2');
          return top?.type === 'sky' ? success : fail('反転できるSkyがありません', '3.5.8', 'physical');
        }
        const o = this.object(action.objectId);
        if (!o || !robot.cargo.includes(o.id)) return fail('指定した物体を保持していません', 'OBJ-11', 'physical');
        if (!['earth', 'sky'].includes(o.type)) return fail('Mustikaは中央柱へ奉納します', '4.5.2');
        if ((o.type === 'earth' && tower.length >= 2) || (o.type === 'sky' && (tower.length !== 2 || tower.some(t => t.type !== 'earth')))) return fail('正規の配置順はEarth → Earth → Skyです。この配置は得点対象外です', '8.6.2', 'unscored');
        return success;
      }
      if (action.type === 'enshrine') {
        if (robot.role !== 'BR') return fail('奉納はBRの動作です', '4.5.2');
        if (this.sanctuary[robot.team] === null) return fail('サンクチュアリ条件が未達成です', '4.5.1');
        if (!robot.cargo.includes('M')) return fail('Mustikaを保持していません', 'OBJ-11', 'physical');
        if (F.surface(robot).type !== 'l2') return fail('L2に上がってください', '4.5.2');
        if (!robot.scanLoaded) return fail('受け取り後に見渡し場所で認識してください', 'ユーザー指定', 'perception');
        return this.touchCheck(robot, { x: 5.5, y: 5.5 });
      }
      if (action.type === 'retry') {
        if (robot.cargo.some(id => this.object(id).type !== 'mustika')) return fail('保持ブロックの扱いは条文が不整合のため未対応です', 'OPEN-01', 'unsupported');
        if (action.level === 1 && (robot.role !== 'BR' || !robot.enteredL1)) return fail('L1リトライの条件を満たしていません', '5.3.1');
        return success;
      }
      if (action.type === 'push') return fail('押す・引きずる運搬は禁止です', '6.1');
      return fail('この動作は未対応です', '未対応', 'unsupported');
    }
    freeSlot(team, object) {
      for (const slot of F.slots(team)) {
        const stack = this.stock(team).filter(o => o.slot === slot.id);
        if (stack.length < slot.maxLayers && !stack.some(o => o.type === 'mustika') && !(object.type === 'mustika' && stack.length) && (!stack.length || stack.at(-1).size >= object.size)) return { ...slot, layer: stack.length, z: .6 + stack.reduce((sum, o) => sum + o.height, 0) };
      }
      return null;
    }
    enqueue(id, actions, manual = false) {
      const r = this.robot(id); if (!r || this.ended) return false;
      if (manual && r.job) return false;
      if (manual) { r.auto = false; r.queue = []; r.failure = null; }
      r.queue.push(...clone(Array.isArray(actions) ? actions : [actions])); return true;
    }
    reject(r, a, result) { r.failure = result; r.status = result.reason; r.queue = []; r.job = null; r.velocity = 0; this.log(r, a.type, result.reason, result.kind, result.rule); }
    startJob(r, a) {
      const result = this.validate(r, a);
      if (!result.ok) { this.reject(r, a, result); return; }
      if (a.type === 'move') {
        const route = this.findPath(r, a.target);
        if (!route) { this.reject(r, a, fail('現在の車体・配置で通れる経路がありません', 'MOVE-08', 'physical')); return; }
        r.job = { ...a, route, destination: a.target }; r.status = a.label || '移動'; r.blocked = 0; return;
      }
      r.job = { ...a, remaining: a.type === 'scan' ? this.config.scanSeconds : a.type === 'retry' ? 3 : ['place', 'flip', 'enshrine', 'recover'].includes(a.type) ? this.config.placeSeconds : this.config.pickupSeconds };
      if (a.type === 'flip' || a.type === 'recover') { const top = this.tower(a.spotId).at(-1); top.touchedBy = r.id; r.job.lockedObject = top.id; }
      if (['pickup', 'receive'].includes(a.type)) { this.object(a.objectId).touchedBy = r.id; r.job.lockedObject = a.objectId; }
      r.status = labels[a.type]; r.velocity = 0;
    }
    complete(r, job) {
      if (job.lockedObject) this.object(job.lockedObject).touchedBy = null;
      const result = this.validate(r, job);
      if (!result.ok) { this.reject(r, job, result); return; }
      if (job.type === 'scan') {
        this.observe(r); r.scanLoaded = true; r.batchRemaining = Math.max(1, r.cargo.length);
      } else if (['pickup', 'receive', 'recover'].includes(job.type)) {
        const o = job.type === 'recover' ? this.tower(job.spotId).at(-1) : this.object(job.objectId);
        o.location = 'cargo'; o.holder = r.id; o.touchedBy = r.id; r.cargo.push(o.id); r.scanLoaded = false; r.batchRemaining = 0; this.changed();
      } else if (job.type === 'unload') {
        const o = this.object(r.cargo[0]), slot = this.freeSlot(r.team, o);
        job = { ...job, objectId: o.id };
        r.cargo.shift(); Object.assign(o, { location: 'transfer', holder: null, touchedBy: null, transferTeam: r.team, slot: slot.id, x: slot.x, y: slot.y, z: slot.z, layer: slot.layer });
        if (o.type !== 'mustika' && !o.deliveries.includes(r.team)) { this.transferPoints[r.team] += 5; o.deliveries.push(r.team); }
        // Delivery progress is the TR's own history, independent of controller resets.
        r.transport.pending.push({ id: o.id, type: o.type });
        if (!r.cargo.length) {
          const delivery = { number: r.transport.completed.length + 1, time: this.time, items: r.transport.pending };
          r.transport.completed.push(delivery); r.transport.pending = [];
          const manifest = ['earth', 'sky', 'mustika'].map(type => ({ type, count: delivery.items.filter(item => item.type === type).length })).filter(item => item.count).map(item => `${({ earth: 'E', sky: 'S', mustika: 'M' })[item.type]}${item.count}`).join('+');
          this.log(r, 'delivery-complete', `${delivery.number}便目の納品完了 · ${manifest}`, 'action', '', { delivery: clone(delivery) });
        }
        this.changed();
      } else if (job.type === 'place') {
        const o = this.object(job.objectId), s = F.spotById[job.spotId], tower = this.tower(s.id);
        r.cargo.splice(r.cargo.indexOf(o.id), 1);
        Object.assign(o, { location: 'spot', holder: null, touchedBy: null, spotId: s.id, x: s.x, y: s.y, z: (s.level === 1 ? .6 : .9) + tower.reduce((sum, t) => sum + t.height, 0), layer: tower.length, placedBy: o.placedBy || r.team, color: o.type === 'sky' ? r.team : null });
        r.batchRemaining--; this.changed();
      } else if (job.type === 'flip') { this.tower(job.spotId).at(-1).color = r.team; r.batchRemaining--; }
      else if (job.type === 'enshrine') {
        const o = this.object('M'); Object.assign(o, { location: 'pillar', holder: null, touchedBy: null, x: 5.5, y: 5.5, z: 1.7, placedBy: r.team }); r.cargo = r.cargo.filter(id => id !== 'M'); r.batchRemaining--; this.changed();
      } else if (job.type === 'retry') {
        if (r.cargo.includes('M')) this.resetMustika();
        const target = job.level === 1 ? F.points[r.team].retry : F.points[r.team][`start${r.role}`];
        if (this.robots.some(other => other !== r && overlap(box(other, this.config.bodySize), box(target, this.config.bodySize)))) { this.reject(r, job, fail('リトライ枠が使用中です', '5.3.4', 'physical')); return; }
        Object.assign(r, target, { z: F.surface(target).z, enteredL1: job.level === 1, observation: null, scanLoaded: false, brain: { stage: 'start' }, queue: [] });
      }
      r.job = null; r.status = '待機'; r.failure = null;
      this.updateSanctuary(); this.log(r, job.type, `${labels[job.type]}${job.spotId ? ' · ' + F.spotById[job.spotId].label : ''}${job.objectId ? ' · ' + job.objectId : ''}`, 'action', '', { cargo: [...r.cargo], observationAt: r.observation?.at ?? null, objectId: job.objectId, objectType: this.object(job.objectId)?.type, spotId: job.spotId });
    }
    resetMustika() { const m = this.object('M'); Object.assign(m, { location: 'source', holder: null, touchedBy: null, x: 5.5, y: 1.25, z: .5, placedBy: null }); for (const r of this.robots) r.cargo = r.cargo.filter(id => id !== 'M'); this.changed(); }
    updateSanctuary() {
      for (const team of ['red', 'blue']) {
        const towers = F.spots.filter(s => { const t = this.tower(s.id); return t.length === 3 && t[0].type === 'earth' && t[1].type === 'earth' && t[2].type === 'sky' && t[2].color === team && t.every(o => !o.touchedBy); });
        if (this.sanctuary[team] === null && towers.length >= 2 && towers.some(s => !s.team)) { this.sanctuary[team] = this.time; this.log(null, 'sanctuary', `${team === 'red' ? '赤' : '青'} サンクチュアリ達成`, 'milestone'); }
      }
    }
    scores() {
      const out = Object.fromEntries(['red', 'blue'].map(team => [team, { transfer: this.transferPoints[team], tower: 0, mustika: 0, total: 0, sky: 0 }]));
      for (const s of F.spots) {
        const t = this.tower(s.id), factor = s.level === 1 ? 1 : 2;
        for (let i = 0; i < t.length; i++) {
          const o = t[i]; if (o.touchedBy || !['red', 'blue'].includes(o.placedBy)) continue;
          if (i < 2 && o.layer === i && o.type === 'earth' && t.slice(0, i).every((b, layer) => b.type === 'earth' && b.layer === layer)) out[o.placedBy].tower += [10, 20][i] * factor;
          if (i === 2 && o.layer === 2 && o.type === 'sky' && t[0].type === 'earth' && t[0].layer === 0 && t[1].type === 'earth' && t[1].layer === 1 && out[o.color]) { out[o.color].tower += 40 * factor; out[o.color].sky++; }
        }
      }
      const m = this.object('M');
      if (m.location === 'pillar' && !m.touchedBy && out[m.placedBy] && this.sanctuary[m.placedBy] !== null) out[m.placedBy].mustika = 250;
      for (const score of Object.values(out)) score.total = score.transfer + score.tower + score.mustika;
      return out;
    }
    step(dt = .05, controllers) {
      if (this.ended) return;
      dt = Math.min(.05, dt, 180 - this.time);
      for (const r of this.robots) {
        if (r.wait > 0) { r.wait = Math.max(0, r.wait - dt); continue; }
        if (!r.job && !r.queue.length && r.auto && controllers) {
          if (r.role === 'TR') this.observe(r);
          const response = controllers.next(this.view(r)); r.brain = response.brain;
          if (response.decision) {
            r.decision = clone(response.decision);
            this.log(r, 'plan', `${r.decision.summary} · 2往復内の予測加点 +${r.decision.horizonGain}`, 'plan', '', { decision: clone(r.decision) });
          }
          r.failure = null; r.wait = response.wait || 0;
          r.queue.push(...(response.actions || []));
        }
      }
      // Lock conflicting manipulations before starting any job, independent of array order.
      const pending = this.robots.filter(r => !r.job && r.queue.length && r.wait <= 0);
      const claims = new Map();
      for (const r of pending) { const key = claimKey(r.queue[0]); if (key) claims.set(key, (claims.get(key) || 0) + 1); }
      for (const r of pending) {
        const key = claimKey(r.queue[0]);
        if (key && claims.get(key) > 1) { r.status = '同時操作の競合'; r.wait = .5; continue; }
        this.startJob(r, r.queue.shift());
      }
      const proposed = new Map();
      for (const r of this.robots) {
        const job = r.job; if (!job || job.type !== 'move' || r.wait > 0) continue;
        if (!job.route.length) { r.job = null; r.velocity = 0; r.status = '到着'; continue; }
        const target = job.route[0], d = distance(r, target), surface = F.surface(r), speed = this.config[`${r.team}Speed`];
        const stairs = ['stairs', 'upperStairs'].includes(surface.type);
        const cap = stairs ? this.config.stairSpeed * speed : this.config.maxSpeed * speed * (surface.type === 'ramp' ? this.config.rampFactor : 1);
        const acceleration = this.config.acceleration * speed;
        r.velocity = Math.min(cap, r.velocity + acceleration * dt, Math.sqrt(2 * acceleration * Math.max(d, .005)));
        const move = Math.min(d, r.velocity * dt);
        proposed.set(r.id, { x: r.x + (target.x - r.x) * (d ? move / d : 0), y: r.y + (target.y - r.y) * (d ? move / d : 0), arrived: move >= d - 1e-6 });
      }
      const blocked = new Set();
      for (const r of this.robots) {
        const p = proposed.get(r.id); if (!p) continue;
        if (!this.segmentAllowed(r, r, p)) blocked.add(r.id);
      }
      const conflicts = (a, pa, b, pb) => {
        if (Math.abs(F.surface(pa).z - F.surface(pb).z) > .65) return false;
        for (let t = 0; t <= 1; t += .2) {
          const qa = { x: a.x + (pa.x - a.x) * t, y: a.y + (pa.y - a.y) * t }, qb = { x: b.x + (pb.x - b.x) * t, y: b.y + (pb.y - b.y) * t };
          if (overlap(box(qa, this.config.bodySize + .015), box(qb, this.config.bodySize + .015))) return true;
        }
        return false;
      };
      // Yield only one mover when the other can safely clear the shared passage.
      // Recheck all pairs because a newly stopped robot changes their swept paths.
      let previousBlocked;
      do {
        previousBlocked = blocked.size;
        for (let i = 0; i < this.robots.length; i++) for (let j = i + 1; j < this.robots.length; j++) {
          const a = this.robots[i], b = this.robots[j];
          const pa = blocked.has(a.id) ? a : proposed.get(a.id) || a, pb = blocked.has(b.id) ? b : proposed.get(b.id) || b;
          if (!conflicts(a, pa, b, pb)) continue;
          const aCanClear = pa !== a && !conflicts(a, pa, b, b);
          const bCanClear = pb !== b && !conflicts(a, a, b, pb);
          if (aCanClear && (!bCanClear || distance(pa, b) > distance(a, pb))) blocked.add(b.id);
          else if (bCanClear) blocked.add(a.id);
          else { if (proposed.has(a.id)) blocked.add(a.id); if (proposed.has(b.id)) blocked.add(b.id); }
        }
      } while (blocked.size !== previousBlocked);
      for (const r of this.robots) {
        const p = proposed.get(r.id); if (!p) continue;
        if (blocked.has(r.id)) {
          r.velocity = 0; r.blocked += dt; r.status = '障害物待ち';
          if (r.blocked >= 1) {
            const route = this.findPath(r, r.job.destination, true);
            if (route) {
              r.job.route = route;
              // Stagger opposing detours; rotating priority avoids permanent color preference.
              const yieldTeam = Math.floor(this.time / 10) % 2 ? 'red' : 'blue';
              if (r.team === yieldTeam) r.wait = 2;
            }
            r.blocked = 0;
          }
          continue;
        }
        const old = F.surface(r); Object.assign(r, { x: p.x, y: p.y, z: F.surface(p).z }); r.blocked = 0;
        const now = F.surface(r);
        if (['stairs', 'upperStairs', 'transfer', 'l2'].includes(now.type) && Math.abs(now.z - old.z) > .1) { r.wait = this.config.stairPause; r.velocity = 0; r.status = '段差で姿勢合わせ'; }
        if (r.role === 'BR' && !r.enteredL1 && now.type === 'l1' && r.x - this.config.bodySize / 2 > 2.5 && r.x + this.config.bodySize / 2 < 8.5) { r.enteredL1 = true; this.graphs.clear(); }
        if (p.arrived) { r.job.route.shift(); r.velocity = 0; }
      }
      this.time = Math.min(180, Math.round((this.time + dt) * 1e9) / 1e9);
      if (this.time >= 180 - 1e-8) {
        this.time = 180; this.ended = true;
        for (const r of this.robots) { r.velocity = 0; r.status = '競技終了'; }
        this.log(null, 'end', '180秒 · 最終状態で採点', 'milestone'); this.capture(true); return;
      }
      for (const r of this.robots) if (r.job && r.job.type !== 'move') { r.job.remaining -= dt; if (r.job.remaining <= 1e-8) this.complete(r, r.job); }
      this.capture();
    }
    snapshot() { return clone({ time: this.time, ended: this.ended, robots: this.robots.map(({ queue, brain, ...r }) => ({ ...r, queueLength: queue.length })), objects: this.objects, scores: this.scores(), sanctuary: this.sanctuary }); }
    capture(force = false) { if (force || Math.floor(this.time * 2) !== this.lastFrame) { this.lastFrame = Math.floor(this.time * 2); this.history.push(this.snapshot()); } }
    export() { return { format: 'robocon-field-sim-v1', config: this.config, assumptions: ['axis-aligned square body', 'ideal snapshot at BR home', 'two transfer columns, two layers', 'retry carrying Earth/Sky unsupported', 'no rigid-body tipping physics'], events: this.events, history: this.history, final: this.snapshot() }; }
  }
  return { Simulation, DEFAULTS, labels, distance, box, overlap };
});
