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
  function sweptContact(from, to, obstacle, half) {
    let enter = 0, leave = 1;
    for (const [axis, size] of [['x', 'w'], ['y', 'h']]) {
      const low = obstacle[axis] - half + 1e-7, high = obstacle[axis] + obstacle[size] + half - 1e-7;
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < 1e-12) { if (from[axis] <= low || from[axis] >= high) return null; continue; }
      const a = (low - from[axis]) / delta, b = (high - from[axis]) / delta;
      enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      if (enter >= leave) return null;
    }
    const t = (enter + leave) / 2;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
  const fail = (reason, rule, kind = 'rule') => ({ ok: false, reason, rule, kind });
  const success = { ok: true };
  const claimKey = a => ['place', 'flip', 'recover'].includes(a.type) ? `spot:${a.spotId}` : ['pickup', 'receive', 'return'].includes(a.type) ? `object:${a.objectId}` : null;
  const DEFAULTS = { maxSpeed: 7, acceleration: 3.5, redSpeed: 1, blueSpeed: 1, redTrPlan: 'adaptive', blueTrPlan: 'adaptive', redBrPlan: 'efficient', blueBrPlan: 'efficient', bodySize: .5, rampFactor: .55, stairSpeed: .25, stairPause: .6, scanSeconds: 1, pickupSeconds: 1.5, placeSeconds: 2.5, brAutoRetrySeconds: 5, trAutoRestartSeconds: 1 };
  const labels = { earth: 'Earth', sky: 'Sky', mustika: 'Mustika', scan: '停止・見渡し', unload: '受け渡しへ配置', receive: 'ブロック受取', return: '種類別置場へ返却', place: 'タワーへ配置', flip: 'Sky反転', enshrine: 'Mustika奉納', pickup: '採集', move: '移動', retry: 'リトライ', recover: '自Earth回収' };
  const mandateHeld = (state, team, time = Infinity) => Number.isFinite(state[team]) && state[team] >= 0 && state[team] <= time;
  const transportTripIndex = transport => (transport?.completed || []).filter(d => d.items.some(o => o.type !== 'mustika')).length + (transport?.skippedTrips?.length || 0);
  function normalizeTrTrips(trips = []) {
    if (!Array.isArray(trips)) throw new TypeError('TR便指定は配列で指定してください');
    return trips.map(slots => {
      if (!Array.isArray(slots) || slots.length !== 3 || slots.some(type => !['earth', 'sky', 'none'].includes(type)) || slots.every(type => type === 'none')) throw new TypeError('TR各便はEarth / Sky / なしの3枠で、最低1個を指定してください');
      return [...slots];
    });
  }
  function normalizeBrTurns(turns = [], team) {
    if (!Array.isArray(turns)) throw new TypeError('BR作業回は配列で指定してください');
    return turns.map(turn => {
      if (typeof turn === 'string' && turn.length) return turn;
      if (!turn || !Array.isArray(turn.slots) || turn.slots.length !== 2) throw new TypeError('BR各回は2枠で指定してください');
      const slots = turn.slots.map(slot => {
        if (!slot || !['earth', 'sky', 'none'].includes(slot.type)) throw new TypeError('BRの箱はEarth / Sky / なしから選択してください');
        if (slot.type === 'none') return { type: 'none', spotId: null };
        const spot = F.spotById[slot.spotId];
        if (!spot || spot.team && spot.team !== team) throw new TypeError('自専有または共有の配置先を選択してください');
        return { type: slot.type, spotId: spot.id };
      });
      if (slots.every(slot => slot.type === 'none')) throw new TypeError('BR各回は最低1個を指定してください');
      return { slots };
    });
  }
  const scanBudget = r => Math.max(1, r.cargo.length + Object.values(r.observation?.towers || {}).filter(t => t.at(-1)?.type === 'sky' && t.at(-1).color !== r.team && t.every(o => !o.touchedBy)).length);
  function completedTowers(tower, team) {
    return F.spots.filter(spot => {
      const t = tower(spot.id);
      return (!spot.team || spot.team === team) && t.length === 3 && t.every((o, i) => o.layer === i && !o.touchedBy)
        && t[0].type === 'earth' && t[1].type === 'earth' && t[2].type === 'sky' && t[2].color === team;
    });
  }
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
      this.config.supplyMode = config.supplyMode ?? 'normal';
      if (!['normal', 'ideal'].includes(this.config.supplyMode)) throw new TypeError('不明な補給モードです');
      this.config.brObservationMode = config.brObservationMode ?? 'fixed';
      if (!['fixed', 'stopped'].includes(this.config.brObservationMode)) throw new TypeError('不明なBR観測モードです');
      if (!Number.isFinite(this.config.trAutoRestartSeconds) || this.config.trAutoRestartSeconds < 0) throw new TypeError('TR競合復帰時間は0以上の秒数で指定してください');
      for (const team of ['red', 'blue']) {
        const key = `${team}BrTurns`;
        this.config[key] = normalizeBrTurns(config[key], team);
        this.config[`${team}TrTrips`] = normalizeTrTrips(config[`${team}TrTrips`]);
      }
      this.time = 0; this.ended = false; this.events = []; this.history = []; this.lastFrame = -1; this.version = 0; this.graphs = new Map();
      this.objects = initialObjects(); this.sanctuary = { red: null, blue: null }; this.sanctuaryEvidence = { red: null, blue: null }; this.transferPoints = { red: 0, blue: 0 };
      if (this.config.supplyMode === 'ideal') for (const o of this.objects.filter(o => o.type === 'sky')) o.supplyTeam = o.x < 5.49 || o.id === 'S2' ? 'red' : 'blue';
      this.robots = [];
      for (const team of ['red', 'blue']) for (const role of ['TR', 'BR']) {
        this.robots.push({ id: `${team}${role}`, team, role, ...F.points[team][`start${role}`], z: 0, enteredL1: false, cargo: [], queue: [], job: null, auto: true, velocity: 0, wait: 0, blocked: 0, stall: null, retryPending: null, status: '開始待ち', observation: null, scanLoaded: false, batchRemaining: 0, brain: { stage: 'start' }, transport: { completed: [], pending: [] }, failure: null });
      }
      this.log(null, '開始', this.config.supplyMode === 'ideal' ? '箱の補給待ちなし · 有限在庫 / 自動補給の搬送点なし / TRはMustika担当' : '初期配置を確認しました', 'setup'); this.capture();
    }
    robot(id) { return this.robots.find(r => r.id === id); }
    brTurnPlan(team) { return this.config[`${team}BrTurns`][this.robot(`${team}BR`)?.brTurn?.completed || 0]; }
    brStrategy(team) { const turn = this.brTurnPlan(team); return typeof turn === 'string' ? turn : this.config[`${team}BrPlan`]; }
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
      // Sampled routes can miss a tiny corner overlap that a slower physical step later hits.
      const half = this.config.bodySize / 2;
      if (F.walls.some(w => sweptContact(from, to, w, half))) return false;
      for (const o of this.objects) if (['source', 'transfer', 'spot'].includes(o.location) && o.type !== 'mustika') {
        const contact = sweptContact(from, to, box(o, o.size), half);
        if (contact) { const z = F.surface(contact).z; if (o.z + o.height > z + .03 && o.z < z + 1.2) return false; }
      }
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
      robot.observation = { at: this.time, origin: { x: robot.x, y: robot.y }, stock: clone(this.stock(robot.team)), towers: Object.fromEntries(F.spots.filter(s => !s.team || s.team === robot.team).map(s => [s.id, clone(this.tower(s.id))])), source: clone(this.objects.filter(o => o.location === 'source' && (!o.team || o.team === robot.team))), sanctuary: mandateHeld(this.sanctuary, robot.team, this.time), sanctuaryEvidence: clone(this.sanctuaryEvidence[robot.team]), pillar: this.object('M').location === 'pillar' ? clone(this.object('M')) : null };
      // Visible pose/cargo only: no partner plan, destination, messages or future arrival time.
      const partner = this.robot(`${robot.team}${robot.role === 'BR' ? 'TR' : 'BR'}`);
      robot.observation.partner = clone({ x: partner.x, y: partner.y, cargo: partner.cargo.map(id => this.object(id)) });
      robot.observation.handoff = this.mustikaOffer(robot.team);
      const opponent = this.robot(`${robot.team === 'red' ? 'blue' : 'red'}BR`);
      robot.observation.scores = clone(this.scores());
      robot.observation.opponentBR = opponent ? { x: opponent.x, y: opponent.y, z: opponent.z,
        maxSpeed: this.config.maxSpeed * this.config[`${opponent.team}Speed`], placeSeconds: this.config.placeSeconds } : null;
    }
    view(robot) {
      const motion = Object.fromEntries(['maxSpeed', 'acceleration', 'bodySize', 'rampFactor', 'stairSpeed', 'stairPause', 'scanSeconds', 'pickupSeconds', 'placeSeconds'].map(key => [key, this.config[key]]));
      motion.speedFactor = this.config[`${robot.team}Speed`];
      return clone({ id: robot.id, role: robot.role, team: robot.team, x: robot.x, y: robot.y, enteredL1: robot.enteredL1, cargo: robot.cargo.map(id => this.object(id)), observation: robot.observation, failure: robot.failure, brain: robot.brain, transport: robot.transport, brTurn: robot.brTurn, brTurnPlan: this.brTurnPlan(robot.team), brObservationMode: this.config.brObservationMode, time: this.time, motion, trPlan: this.config[`${robot.team}TrPlan`], trTrips: this.config[`${robot.team}TrTrips`], supplyMode: this.config.supplyMode, brPlan: this.brStrategy(robot.team) });
    }
    changed() { this.version++; this.graphs.clear(); }
    mustikaOffer(team) {
      const tr = this.robot(`${team}TR`), m = this.object('M'), p = F.points[team];
      if (m.location !== 'cargo' || m.holder !== tr.id || !tr.cargo.includes('M') || tr.job || distance(tr, p.transferTR) > .14 || F.surface(tr).type !== 'transfer') return null;
      return { objectId: 'M', holder: tr.id, x: (p.transferTR.x + p.transferBR.x) / 2, y: (p.transferTR.y + p.transferBR.y) / 2, size: m.size };
    }
    validate(robot, action) {
      if (this.ended || this.time >= 180) return fail('競技は終了しています', '4.6.1');
      if (robot.role === 'TR' && robot.cargo.includes('M') && this.object('M').touchedBy === `${robot.team}BR`) return fail('Mustikaを直接受け渡し中です', 'シミュレーション指定', 'physical');
      if (action.type === 'move') {
        if (!action.target || !Number.isFinite(action.target.x) || !Number.isFinite(action.target.y)) return fail('移動先を選んでください', '入力', 'physical');
        return this.footprintAllowed(robot, action.target) ? success : fail('その位置には車体を置けません。活動域・壁・段差を確認してください', 'MOVE-01～09', 'physical');
      }
      if (action.type === 'scan') {
        if (robot.role === 'BR' && this.config.brObservationMode === 'stopped') return robot.enteredL1 && ['l1', 'l2'].includes(F.surface(robot).type) && !robot.velocity
          ? success : fail('L1またはL2の平面で停止して観測してください', '観測モデル', 'perception');
        if (action.local) return robot.role === 'BR' && robot.localRescanAllowed && robot.enteredL1 && ['l1', 'l2'].includes(F.surface(robot).type)
          ? success : fail('その場での再認識は配置・反転失敗後に行います', 'ユーザー指定', 'perception');
        return robot.role === 'BR' && !F.atScanPoint(robot.team, robot) ? fail('L1またはL2の自チーム見渡し場所で停止する必要があります', 'ユーザー指定', 'perception') : success;
      }
      if (action.type === 'pickup') {
        if (robot.role !== 'TR') return fail('供給元から採集できるのはTRです', '3.4.1 / 4.5.2');
        const o = this.object(action.objectId);
        if (!o || !this.availableSource(robot, o.type).includes(o)) return fail('取得できる物体がありません', 'OBJ-11', 'physical');
        if (o.type === 'mustika' && !mandateHeld(this.sanctuary, robot.team, this.time)) return fail('サンクチュアリ条件が未達成です', '4.5.1');
        if ((o.type === 'mustika' && robot.cargo.length) || robot.cargo.some(id => this.object(id).type === 'mustika')) return fail('Mustikaとの混載は未確定です', 'OPEN-02', 'unsupported');
        if (robot.cargo.length >= 3) return fail('TRは最大3個までです', '4.4.2');
        return this.touchCheck(robot, o);
      }
      if (action.type === 'unload') {
        if (robot.role !== 'TR') return fail('納品はTRの動作です', '3.4');
        if (!robot.cargo.length) return fail('手持ちがありません', 'OBJ-11', 'physical');
        if (robot.cargo.includes('M')) return fail('Mustikaは床置きせず、TRが保持したままBRへ直接渡します', 'シミュレーション指定', 'unsupported');
        if (distance(robot, F.points[robot.team].transferTR) > .14 || F.surface(robot).type !== 'transfer') return fail('TRは受け渡し区画へ登って納品します', '3.4.5');
        const id = action.objectId || robot.cargo[0];
        if (!robot.cargo.includes(id)) return fail('指定したブロックを保持していません', 'OBJ-11', 'physical');
        if (this.freeSlot(robot.team, this.object(id)) === null) return fail('受け渡し区画に空きがありません', 'OBJ-11', 'physical');
        return success;
      }
      if (action.type === 'receive') {
        if (robot.role !== 'BR') return fail('受け取りはBRの動作です', '3.4');
        const o = this.object(action.objectId);
        if (o?.type === 'mustika' && o.location === 'cargo') {
          const offer = this.mustikaOffer?.(robot.team);
          if (!offer || o.touchedBy && ![offer.holder, robot.id].includes(o.touchedBy)) return fail('自チームTRが受け渡し位置でMustikaを保持していません', 'OBJ-06', 'physical');
          if (!mandateHeld(this.sanctuary, robot.team, this.time)) return fail('サンクチュアリ条件が未達成です', '4.5.1');
          if (robot.cargo.length) return fail('Mustika受取前にBRの手持ちを空にしてください', 'OPEN-02', 'unsupported');
          if (distance(robot, F.points[robot.team].transferBR) > .14) return fail('BRは受け渡し位置で直接受け取ります', 'OBJ-06', 'physical');
          const zone = F.zones[robot.team].transfer;
          if (!F.inside({ x: offer.x - o.size / 2, y: offer.y - o.size / 2 }, zone) || !F.inside({ x: offer.x + o.size / 2, y: offer.y + o.size / 2 }, zone)) return fail('直接受け渡す物体が区画外です', '6.3');
          const reach = this.touchCheck(this.robot(offer.holder), offer);
          return reach.ok ? this.touchCheck(robot, offer) : reach;
        }
        if (!o || o.location !== 'transfer' || o.transferTeam !== robot.team || o.touchedBy) return fail('受け渡し区画に対象物がありません', '4.4.3', 'physical');
        if (!F.inside({ x: o.x - o.size / 2, y: o.y - o.size / 2 }, F.zones[robot.team].transfer) || !F.inside({ x: o.x + o.size / 2, y: o.y + o.size / 2 }, F.zones[robot.team].transfer)) return fail('物体が受け渡し区画からはみ出しています', '6.3');
        if (this.stock(robot.team).some(t => t.slot === o.slot && t.layer > o.layer)) return fail('上の物体から受け取ってください', '支持関係', 'physical');
        if (robot.cargo.length >= 2) return fail('BRは最大2個までです', '4.4.2');
        if ((o.type === 'mustika' && robot.cargo.length) || robot.cargo.some(id => this.object(id).type === 'mustika')) return fail('Mustikaとの混載は未確定です', 'OPEN-02', 'unsupported');
        return this.touchCheck(robot, o);
      }
      if (action.type === 'return') {
        if (robot.role !== 'BR') return fail('返却はBRの動作です', 'ユーザー指定');
        const o = this.object(action.objectId);
        if (!o || !robot.cargo.includes(o.id) || o.holder !== robot.id) return fail('指定したブロックを保持していません', 'OBJ-11', 'physical');
        if (!['earth', 'sky'].includes(o.type)) return fail('Mustikaは返却置場に置かず手渡しします', 'ユーザー指定', 'unsupported');
        if (distance(robot, F.points[robot.team].transferBR) > .14) return fail('返却は自陣の受け渡し位置で行います', 'OBJ-05', 'physical');
        const slot = this.freeSlot(robot.team, o, true);
        return slot ? this.touchCheck(robot, { ...slot, size: o.size }) : fail('種類別の返却置場に空きがありません', 'OBJ-11', 'physical');
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
        if (!robot.observation || !robot.scanLoaded || robot.batchRemaining <= 0) return fail('停止・見渡しを行い配置計画を更新してください', 'ユーザー指定', 'perception');
        if (action.type === 'flip') {
          if (robot.batchFlips?.includes(spot.id)) return fail('同じ認識で同じSkyを繰り返し反転できません', 'ユーザー指定', 'perception');
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
        if (!mandateHeld(this.sanctuary, robot.team, this.time)) return fail('サンクチュアリ条件が未達成です', '4.5.1');
        if (!robot.cargo.includes('M')) return fail('Mustikaを保持していません', 'OBJ-11', 'physical');
        if (F.surface(robot).type !== 'l2') return fail('L2に上がってください', '4.5.2');
        if (!robot.scanLoaded) return fail('受け取り後に停止して認識してください', 'ユーザー指定', 'perception');
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
    freeSlot(team, object, returning = false) {
      for (const slot of F.slots(team)) {
        if (slot.type !== object.type) continue;
        const stack = this.stock(team).filter(o => o.slot === slot.id);
        const br = this.robot?.(`${team}BR`);
        const reserved = !returning && br ? br.cargo.filter(id => this.object(id).type === object.type).length : 0;
        if (stack.length + reserved < slot.maxLayers && !stack.some(o => o.touchedBy) && (!stack.length || stack.at(-1).size >= object.size)) return { ...slot, layer: stack.length, z: .6 + stack.reduce((sum, o) => sum + o.height, 0) };
      }
      return null;
    }
    replenishIdealSupply() {
      if (this.config.supplyMode !== 'ideal' || this.ended || this.time >= 180) return;
      for (const team of ['red', 'blue']) {
        const br = this.robot(`${team}BR`);
        // The transfer strip is also the BR entry route. Do not fill it under a robot
        // or change the top of a stack already selected for a receive sequence.
        if (!br.enteredL1 || distance(br, F.points[team].transferBR) <= .75 || [br.job, ...br.queue].some(a => a?.type === 'receive')) continue;
        for (const type of ['earth', 'sky']) {
          let slot;
          while (true) {
            const o = this.availableSource(br, type).find(o => type === 'earth' ? o.team === team : o.supplyTeam === team);
            if (!o || !(slot = this.freeSlot(team, o))) break;
            if (this.robots.some(r => o.height + slot.z > r.z + .03 && slot.z < r.z + 1.2 && overlap(box(slot, o.size), box(r, this.config.bodySize + .015)))) break;
            Object.assign(o, { location: 'transfer', transferTeam: team, holder: null, touchedBy: null, slot: slot.id, x: slot.x, y: slot.y, z: slot.z, layer: slot.layer });
            // Record the first supply without inventing a physical TR delivery or points.
            if (!o.deliveries.includes(team)) o.deliveries.push(team);
            this.changed();
            this.log(null, 'ideal-supply', `${team === 'red' ? '赤' : '青'}受渡へ自動補給 · ${o.id}`, 'supply', '', { team, objectId: o.id, objectType: type, transferPoints: 0 });
          }
        }
      }
    }
    skipExhaustedTrip(r) {
      if (this.ended || this.time >= 180 || r.role !== 'TR' || r.cargo.length || r.transport.pending.length || this.config.supplyMode !== 'normal') return;
      const index = transportTripIndex(r.transport), slots = this.config[`${r.team}TrTrips`][index];
      if (!slots || this.objects.some(o => o.location === 'source' && slots.includes(o.type) && (!o.team || o.team === r.team) && (o.type !== 'sky' || (r.team === 'red' ? o.x <= 5.51 : o.x >= 5.49)))) return;
      (r.transport.skippedTrips ||= []).push({ index, time: this.time }); r.brain = { stage: 'start' };
      this.log(r, 'trip-skipped', `指定${index + 1}便目 · 対象の供給元が枯渇`, 'supply', '', { index });
    }
    enqueue(id, actions, manual = false) {
      const r = this.robot(id); if (!r || this.ended) return false;
      if (manual && r.job) return false;
      if (manual) { r.auto = false; r.queue = []; r.failure = null; r.stall = null; r.retryPending = null; r.trCollisionStall = null; r.trRestartPending = null; }
      r.queue.push(...clone(Array.isArray(actions) ? actions : [actions])); return true;
    }
    reject(r, a, result) {
      r.failure = { ...result, action: a.type }; r.status = result.reason; r.queue = []; r.job = null; r.velocity = 0;
      if (r.role === 'BR' && ['place', 'flip'].includes(a.type)) { r.localRescanAllowed = true; r.scanLoaded = false; r.batchRemaining = 0; }
      this.log(r, a.type, result.reason, result.kind, result.rule);
    }
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
        this.observe(r); r.observation.local = !!job.local; r.localRescanAllowed = false; r.scanLoaded = true; r.batchRemaining = scanBudget(r); r.batchFlips = [];
        if (job.arrival && ['place', 'flip', 'enshrine', 'recover'].includes(r.queue[0]?.type)) {
          r.queue = []; r.brain.stage = r.cargo.length ? 'loaded' : 'choose';
        }
      } else if (['pickup', 'receive', 'recover'].includes(job.type)) {
        const o = job.type === 'recover' ? this.tower(job.spotId).at(-1) : this.object(job.objectId);
        if (job.type === 'receive' && o.type === 'mustika' && o.location === 'cargo') {
          const tr = this.robot(o.holder);
          tr.cargo.splice(tr.cargo.indexOf(o.id), 1);
          this.recordDelivery(tr, o);
          this.log(tr, 'handoff', 'Mustikaを保持したままBRへ直接受け渡し', 'action', 'シミュレーション指定', { objectId: o.id, objectType: o.type, receiver: r.id });
        }
        o.location = 'cargo'; o.holder = r.id; o.touchedBy = r.id; r.cargo.push(o.id); r.scanLoaded = false; r.batchRemaining = 0; this.changed();
      } else if (job.type === 'return') {
        const o = this.object(job.objectId), slot = this.freeSlot(r.team, o, true);
        r.cargo.splice(r.cargo.indexOf(o.id), 1);
        Object.assign(o, { location: 'transfer', holder: null, touchedBy: null, transferTeam: r.team, slot: slot.id, x: slot.x, y: slot.y, z: slot.z, layer: slot.layer });
        r.scanLoaded = false; r.batchRemaining = 0; this.changed();
      } else if (job.type === 'unload') {
        const o = this.object(job.objectId || r.cargo[0]), slot = this.freeSlot(r.team, o);
        job = { ...job, objectId: o.id };
        r.cargo.splice(r.cargo.indexOf(o.id), 1); Object.assign(o, { location: 'transfer', holder: null, touchedBy: null, transferTeam: r.team, slot: slot.id, x: slot.x, y: slot.y, z: slot.z, layer: slot.layer });
        if (o.type !== 'mustika' && !o.deliveries.includes(r.team)) { this.transferPoints[r.team] += 5; o.deliveries.push(r.team); }
        // Delivery progress is the TR's own history, independent of controller resets.
        this.recordDelivery(r, o);
        this.changed();
      } else if (job.type === 'place') {
        const o = this.object(job.objectId), s = F.spotById[job.spotId], tower = this.tower(s.id);
        r.cargo.splice(r.cargo.indexOf(o.id), 1);
        Object.assign(o, { location: 'spot', holder: null, touchedBy: null, spotId: s.id, x: s.x, y: s.y, z: (s.level === 1 ? .6 : .9) + tower.reduce((sum, t) => sum + t.height, 0), layer: tower.length, placedBy: o.placedBy || r.team, color: o.type === 'sky' ? r.team : null });
        r.batchRemaining--; this.changed();
      } else if (job.type === 'flip') { this.tower(job.spotId).at(-1).color = r.team; r.batchRemaining--; (r.batchFlips ||= []).push(job.spotId); }
      else if (job.type === 'enshrine') {
        const o = this.object('M'); Object.assign(o, { location: 'pillar', holder: null, touchedBy: null, x: 5.5, y: 5.5, z: 1.7, placedBy: r.team }); r.cargo = r.cargo.filter(id => id !== 'M'); r.batchRemaining--; this.changed();
      } else if (job.type === 'retry') {
        const result = this.relocateForRetry(r, job.level);
        if (!result.ok) { this.reject(r, job, result); return; }
      }
      r.job = null; r.status = '待機'; r.failure = null;
      // Finish work at this destination, then replan locally before travelling elsewhere.
      if (r.role === 'BR' && r.auto && this.config.brObservationMode === 'stopped' && ['place', 'flip', 'enshrine', 'recover'].includes(job.type)) {
        if (r.queue[0]?.type === 'move' && distance(r, r.queue[0].target) > .12) r.queue = [];
        if (!r.queue.length) r.brain.stage = 'return';
      }
      this.recordBrTurn(r, job);
      this.updateSanctuary(); this.log(r, job.type, `${job.type === 'scan' && job.local ? 'その場で停止・再認識' : labels[job.type]}${job.spotId ? ' · ' + F.spotById[job.spotId].label : ''}${job.objectId ? ' · ' + job.objectId : ''}`, 'action', '', { cargo: [...r.cargo], observationAt: r.observation?.at ?? null, objectId: job.objectId, objectType: this.object(job.objectId)?.type, spotId: job.spotId,
        ...(job.type === 'scan' ? { local: !!job.local, arrival: !!job.arrival, observationMode: this.config.brObservationMode, level: F.surface(r).type, origin: { x: r.x, y: r.y } } : {}),
        ...(job.type === 'pickup' && job.objectId === 'M' ? { sanctuaryAt: this.sanctuary[r.team], sanctuaryEvidence: clone(this.sanctuaryEvidence[r.team]) } : {}) });
    }
    recordBrTurn(r, job) {
      if (r.role !== 'BR' || !this.config[`${r.team}BrTurns`].length) return;
      r.brTurn ||= { completed: 0, worked: false };
      const specified = this.brTurnPlan(r.team)?.slots;
      if (specified) {
        const progress = r.brTurn;
        progress.assigned ||= [null, null]; progress.settled ||= [];
        if (job.type === 'receive' && this.object(job.objectId)?.type !== 'mustika') {
          const slot = specified.findIndex((s, i) => !progress.assigned[i] && s.type === this.object(job.objectId).type);
          if (slot >= 0) progress.assigned[slot] = job.objectId;
        }
        if (['place', 'return'].includes(job.type) && progress.assigned.includes(job.objectId)) progress.settled.push(job.objectId);
        const done = progress.fallback || specified.every((s, i) => s.type === 'none' || progress.assigned[i] && progress.settled.includes(progress.assigned[i]));
        if (job.type !== 'scan' || job.arrival || r.cargo.length || !done) return;
      }
      if (['place', 'flip', 'enshrine'].includes(job.type)) r.brTurn.worked = true;
      // Supply scans, failures and local replans stay in the same sortie, even after partial work.
      if (job.type !== 'scan' || job.arrival || job.local || r.cargo.length || !specified && !r.brTurn.worked) return;
      const strategy = this.brStrategy(r.team);
      r.brTurn = { completed: r.brTurn.completed + 1, worked: false }; r.brain = { stage: 'choose' }; r.decision = null;
      this.log(r, 'br-turn-complete', `BR ${r.brTurn.completed}回目の作業完了`, 'action', '', { turn: r.brTurn.completed, strategy, nextStrategy: this.brStrategy(r.team) });
    }
    recordDelivery(r, o) {
      r.transport.pending.push({ id: o.id, type: o.type });
      if (r.cargo.length) return;
      const delivery = { number: r.transport.completed.length + 1, time: this.time, items: r.transport.pending };
      r.transport.completed.push(delivery); r.transport.pending = [];
      const manifest = ['earth', 'sky', 'mustika'].map(type => ({ type, count: delivery.items.filter(item => item.type === type).length })).filter(item => item.count).map(item => `${({ earth: 'E', sky: 'S', mustika: 'M' })[item.type]}${item.count}`).join('+');
      this.log(r, 'delivery-complete', `${delivery.number}便目の納品完了 · ${manifest}`, 'action', '', { delivery: clone(delivery) });
    }
    resetMustika() { const m = this.object('M'); Object.assign(m, { location: 'source', holder: null, touchedBy: null, x: 5.5, y: 1.25, z: .5, placedBy: null }); for (const r of this.robots) r.cargo = r.cargo.filter(id => id !== 'M'); this.changed(); }
    relocateForRetry(r, level) {
      const target = level === 1 ? F.points[r.team].retry : F.points[r.team][`start${r.role}`];
      const placedRobot = { ...r, enteredL1: level === 1 }, z = F.surface(target).z;
      if (!this.footprintAllowed(placedRobot, target) || !this.obstacleFree(placedRobot, target)) return fail('リトライ枠に車体を置けません', 'MOVE-08', 'physical');
      if (this.robots.some(other => other !== r && Math.abs(other.z - z) <= .65 && overlap(box(other, this.config.bodySize + .015), box(target, this.config.bodySize + .015)))) return fail('リトライ枠が使用中です', '5.3.4', 'physical');
      // Commit only after checking the destination; failed retries must not release cargo.
      if (r.cargo.includes('M')) this.resetMustika();
      Object.assign(r, target, { z, enteredL1: level === 1, observation: null, scanLoaded: false, batchRemaining: 0,
        brain: { stage: 'start' }, queue: [], job: null, decision: null, batchFlips: [], localRescanAllowed: false, velocity: 0, wait: 0, blocked: 0, stall: null, retryPending: null, failure: null });
      for (const id of r.cargo) Object.assign(this.object(id), { x: r.x, y: r.y, location: 'cargo', holder: r.id, touchedBy: r.id });
      this.changed(); return success;
    }
    updateAutoRetries(dt, blocked) {
      const delay = this.config.brAutoRetrySeconds; let relocated = false;
      for (const r of this.robots) {
        if (r.role !== 'BR' || !r.auto || !(delay > 0)) { r.stall = null; r.retryPending = null; continue; }
        if (!r.retryPending) {
          if (r.job?.type !== 'move' || !r.job.route.length || r.status === '段差で姿勢合わせ') { r.stall = null; continue; }
          // A separate clock survives the one-second path-retry counter and collision yield pauses.
          // Accumulated displacement, not one-frame speed, distinguishes slow stairs from a jam.
          if (r.stall && distance(r, r.stall.anchor) >= .01) { r.stall = null; r.status = r.job.label || '移動'; }
          if (!r.stall && blocked.has(r.id)) r.stall = { since: this.time - dt, anchor: { x: r.x, y: r.y } };
          if (!r.stall) continue;
          const elapsed = this.time - r.stall.since;
          r.status = `障害物待ち · 自動Retryまで ${Math.max(0, delay - elapsed).toFixed(1)}秒`;
          if (elapsed < delay - 1e-8) continue;
          r.retryPending = { level: r.enteredL1 ? 1 : 0, requestedAt: this.time, blockedSince: r.stall.since };
          r.job = null; r.queue = []; r.velocity = 0; r.wait = 0; r.blocked = 0;
          r.observation = null; r.scanLoaded = false; r.batchRemaining = 0; r.decision = null;
          this.log(r, 'auto-retry-request', `移動停止 ${delay}秒 · 自動Retry`, 'recovery', 'シミュレーション指定', { level: r.retryPending.level, blockedSince: r.stall.since, cargo: [...r.cargo] });
        }
        const pending = r.retryPending, result = this.relocateForRetry(r, pending.level);
        if (!result.ok) {
          r.status = `自動Retry待機 · ${result.reason}`;
          if (pending.reason !== result.reason) this.log(r, 'auto-retry-wait', r.status, 'recovery', result.rule);
          pending.reason = result.reason; continue;
        }
        r.status = `自動Retry完了 · ${pending.level === 1 ? 'L1 Retryエリア' : '地上開始枠'}`;
        this.log(r, 'retry', r.status, 'action', 'シミュレーション指定', { automatic: true, level: pending.level,
          blockedSince: pending.blockedSince, requestedAt: pending.requestedAt, cargoPolicy: 'keep-earth-sky', cargo: [...r.cargo], observationAt: null });
        relocated = true;
      }
      if (relocated) this.capture(true);
    }
    updateTrCollisionRestarts(dt, collisions) {
      const delay = this.config.trAutoRestartSeconds; let relocated = false;
      for (const r of this.robots) {
        if (r.role !== 'TR') continue;
        if (!r.auto || !(delay > 0) || r.job?.type !== 'move') { r.trCollisionStall = null; r.trRestartPending = null; continue; }
        if (!r.trRestartPending) {
          const opponent = collisions.get(r.id);
          if (!opponent) { r.trCollisionStall = null; continue; }
          r.trCollisionStall ||= { since: this.time - dt, opponent };
          const elapsed = this.time - r.trCollisionStall.since;
          r.status = `相手TRと競合 · 開始枠へ復帰まで ${Math.max(0, delay - elapsed).toFixed(1)}秒`;
          if (elapsed < delay - 1e-8) continue;
          r.trRestartPending = { blockedSince: r.trCollisionStall.since, opponent, requestedAt: this.time };
          r.velocity = 0; r.wait = 0;
          this.log(r, 'tr-restart-request', `相手TRによる移動停止 ${delay}秒 · 開始枠へ復帰`, 'recovery', 'シミュレーション指定', { ...r.trRestartPending, cargo: [...r.cargo] });
        }
        const pending = r.trRestartPending, target = F.points[r.team].startTR, z = F.surface(target).z;
        const clear = this.footprintAllowed(r, target) && this.obstacleFree(r, target)
          && !this.robots.some(other => other !== r && Math.abs(other.z - z) <= .65 && overlap(box(other, this.config.bodySize + .015), box(target, this.config.bodySize + .015)));
        if (!clear) {
          r.status = 'TR復帰待機 · 開始枠が使用中';
          if (!pending.waitLogged) this.log(r, 'tr-restart-wait', r.status, 'recovery', 'シミュレーション指定');
          pending.waitLogged = true; continue;
        }
        // Rebuild only the route from the start; cargo, the trip and the remaining plan survive.
        const move = { type: 'move', target: clone(r.job.destination || r.job.target), label: r.job.label };
        r.queue.unshift(move);
        Object.assign(r, target, { z, enteredL1: false, job: null, observation: null, decision: null, velocity: 0, wait: 0, blocked: 0,
          failure: null, trCollisionStall: null, trRestartPending: null, status: 'TR競合復帰 · 開始枠から再開' });
        for (const id of r.cargo) Object.assign(this.object(id), { x: r.x, y: r.y, z, location: 'cargo', holder: r.id, touchedBy: r.id });
        this.changed();
        this.log(r, 'tr-restart', r.status, 'recovery', 'シミュレーション指定', { ...pending, automatic: true, cargoPolicy: 'keep-all', cargo: [...r.cargo], target: clone(target), resumeTarget: move.target });
        relocated = true;
      }
      if (relocated) this.capture(true);
    }
    updateSanctuary() {
      for (const team of ['red', 'blue']) {
        const towers = completedTowers(id => this.tower(id), team);
        if (this.sanctuary[team] === null && towers.length >= 2 && towers.some(s => !s.team)) {
          this.sanctuary[team] = this.time;
          this.sanctuaryEvidence[team] = { at: this.time, towers: towers.map(s => ({ id: s.id, label: s.label, objects: clone(this.tower(s.id)) })) };
          this.log(null, 'sanctuary', `${team === 'red' ? '赤' : '青'} サンクチュアリ達成 · ${towers.map(s => s.label).join(' / ')}`, 'milestone', '', { team, evidence: clone(this.sanctuaryEvidence[team]) });
        }
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
      if (m.location === 'pillar' && !m.touchedBy && out[m.placedBy] && mandateHeld(this.sanctuary, m.placedBy)) out[m.placedBy].mustika = 250;
      for (const score of Object.values(out)) score.total = score.transfer + score.tower + score.mustika;
      return out;
    }
    step(dt = .05, controllers) {
      if (this.ended) return;
      dt = Math.min(.05, dt, 180 - this.time);
      this.replenishIdealSupply();
      for (const r of this.robots) {
        if (!r.auto) { r.stall = null; r.retryPending = null; r.trCollisionStall = null; r.trRestartPending = null; }
        if (r.retryPending || r.trRestartPending) continue;
        if (r.wait > 0) { r.wait = Math.max(0, r.wait - dt); continue; }
        if (!r.job && !r.queue.length && r.auto && controllers) {
          if (r.role === 'TR') this.observe(r);
          const response = controllers.next(this.view(r)); r.brain = response.brain;
          if (response.fallbackTurn && this.brTurnPlan(r.team)?.slots) {
            r.brTurn ||= { completed: 0, worked: false };
            if (!r.brTurn.fallback) this.log(r, 'br-turn-fallback', response.fallbackTurn, 'plan');
            r.brTurn.fallback = true;
          }
          if (response.skipTrip) this.skipExhaustedTrip(r);
          if (response.status) r.status = response.status;
          if (response.decision) {
            r.decision = clone(response.decision);
            this.log(r, 'plan', `${r.decision.summary} · 2往復内の予測加点 +${r.decision.horizonGain}`, 'plan', '', { decision: clone(r.decision) });
          }
          r.failure = null; r.wait = response.wait || 0;
          r.queue.push(...(response.actions || []));
        }
      }
      // Lock conflicting manipulations before starting any job, independent of array order.
      const pending = this.robots.filter(r => !r.retryPending && !r.trRestartPending && !r.job && r.queue.length && r.wait <= 0);
      const claims = new Map();
      for (const r of pending) { const key = claimKey(r.queue[0]); if (key) claims.set(key, (claims.get(key) || 0) + 1); }
      for (const r of pending) {
        const key = claimKey(r.queue[0]);
        if (key && claims.get(key) > 1) { r.status = '同時操作の競合'; r.wait = .5; continue; }
        this.startJob(r, r.queue.shift());
      }
      const proposed = new Map();
      for (const r of this.robots) {
        const job = r.job; if (!job || job.type !== 'move' || r.wait > 0 || r.trRestartPending) continue;
        if (!job.route.length) {
          r.job = null; r.velocity = 0; r.status = '到着';
          if (r.role === 'BR' && r.auto && this.config.brObservationMode === 'stopped' && r.enteredL1 && ['l1', 'l2'].includes(F.surface(r).type)
            && r.queue[0]?.type !== 'scan' && (!r.observation || distance(r, r.observation.origin) > .12)) r.queue.unshift({ type: 'scan', arrival: true });
          continue;
        }
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
      const terrainBlocked = new Set(blocked), trCollisions = new Map();
      const blockByRobot = (r, other) => {
        blocked.add(r.id);
        if (proposed.has(r.id) && !terrainBlocked.has(r.id) && r.role === 'TR' && other.role === 'TR' && r.team !== other.team) trCollisions.set(r.id, other.id);
      };
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
          if (aCanClear && (!bCanClear || distance(pa, b) > distance(a, pb))) blockByRobot(b, a);
          else if (bCanClear) blockByRobot(a, b);
          else { if (proposed.has(a.id)) blockByRobot(a, b); if (proposed.has(b.id)) blockByRobot(b, a); }
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
      this.updateAutoRetries(dt, blocked);
      this.updateTrCollisionRestarts(dt, trCollisions);
      this.capture();
    }
    snapshot() { return clone({ time: this.time, ended: this.ended, robots: this.robots.map(({ queue, brain, ...r }) => ({ ...r, queueLength: queue.length, pendingWork: [r.job, ...queue].filter(a => a && ['place', 'flip', 'enshrine', 'return'].includes(a.type)).map(({ type, spotId, objectId }) => ({ type, spotId, objectId })) })), objects: this.objects, scores: this.scores(), sanctuary: this.sanctuary, sanctuaryEvidence: this.sanctuaryEvidence }); }
    capture(force = false) { if (force || Math.floor(this.time * 2) !== this.lastFrame) { this.lastFrame = Math.floor(this.time * 2); this.history.push(this.snapshot()); } }
    export() {
      return { format: 'robocon-field-sim-v1', config: this.config, assumptions: [
        'axis-aligned square body',
        this.config.brObservationMode === 'stopped'
          ? 'ideal full-board snapshot after timed stationary scan on L1/L2; replan at work arrival and after each destination; no occlusion or recognition error; idle near transfer'
          : 'ideal snapshot at BR home or after failed work while stopped locally; includes visible partner pose/cargo',
        'Earth-only transfer column: 3 layers; Sky-only: 4 layers; BR returns without extra points',
        'TR unloading reserves capacity for BR held blocks; any held Earth/Sky may be selected for unloading',
        'efficient BR defaults to two useful normal blocks; endgame and l2-earth allow single-block fallbacks; Mustika, empty-handed flips and local recovery are exceptions',
        'distinct observed Sky flips may be queued on one scan in fixed mode; stopped mode replans between destinations; neither increases carry capacity',
        'phase policies switch at the next planning decision on or after 150 seconds; l2-earth keeps Earth priority throughout',
        'named BR turns advance after successful work, empty cargo and a non-arrival normal scan; specified turns retain assigned object IDs through scans and Retry until placed/returned, or fall back with an explicit log',
        'specified BR box turns wait for the requested set and take priority over unheld Mustika; invalid targets fall back to the selected normal BR policy',
        'Mustika direct TR-to-BR handoff inside transfer area; no floor unloading; no mixed cargo',
        'sanctuary latches after simultaneous two-tower completion including a shared tower, with timestamp and tower evidence',
        'automatic BR retry after blocked movement: retain Earth/Sky, return Mustika to source',
        'automatic TR restart after continuous opponent-TR movement collision (default 1 second); wait for a clear start; retain all cargo and trip plan; exclude handling, terrain pauses, idle waits and object claims',
        'manual retry carrying Earth/Sky unsupported', 'no rigid-body tipping physics',
      ], events: this.events, history: this.history, final: this.snapshot() };
    }
  }
  return { Simulation, DEFAULTS, labels, distance, box, overlap, completedTowers, mandateHeld, scanBudget, normalizeTrTrips, normalizeBrTurns, transportTripIndex };
});
