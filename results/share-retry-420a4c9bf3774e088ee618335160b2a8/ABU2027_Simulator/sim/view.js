/* global RoboField, RoboSim, RoboControllers, lucide */
'use strict';
const F = RoboField, S = RoboSim;
const $ = id => document.getElementById(id);
const canvas = $('field'), ctx = canvas.getContext('2d');
const colors = { red: '#ba3548', blue: '#2464b0', neutral: '#637166' };
let sim = new S.Simulation(), selected = 'redTR', running = false, computing = false, replayTime = null, playback = false, selectedSpot = 'r2', clickedPoint = null, previous = 0, accumulator = 0;
let lastLog = -1, objectKey = '', snapshot = sim.snapshot(), cssSize = 700;
let zoom = 1;
const strategyFields = ['red', 'blue'].flatMap(team => ['TR', 'BR'].map(role => ({ team, role, key: `${team}${role === 'TR' ? 'Tr' : 'Br'}Plan`, id: `${team}-${role.toLowerCase()}-plan` })));
const currentRobot = () => sim.robot(selected);
function icons() { lucide.createIcons(); }
function initStrategyMenus() {
  for (const team of ['red', 'blue']) {
    const group = document.createElement('fieldset'), legend = document.createElement('legend');
    group.className = 'strategy-team'; legend.className = `team-${team}`;
    legend.textContent = `${team === 'red' ? '赤' : '青'}チーム`; group.append(legend);
    for (const field of strategyFields.filter(f => f.team === team)) {
      const label = document.createElement('label'), select = document.createElement('select'), details = document.createElement('dl');
      label.textContent = `${field.role} · ${field.role === 'TR' ? '搬送戦略' : '配置戦略'}`;
      select.id = field.id;
      select.replaceChildren(...RoboControllers.listStrategies(field.role).map(entry => new Option(entry.name, entry.id)));
      select.onchange = () => { renderStrategyPreviews(); renderStrategyState(); };
      details.id = `${field.id}-details`; details.className = 'strategy-details';
      label.append(select); group.append(label, details);
    }
    $('strategy-selectors').append(group);
  }
  syncStrategyMenus();
}
function syncStrategyMenus() {
  for (const field of strategyFields) {
    const entries = RoboControllers.listStrategies(field.role);
    $(field.id).value = entries.some(entry => entry.id === sim.config[field.key]) ? sim.config[field.key] : entries[0].id;
  }
  renderStrategyPreviews();
}
function renderStrategyPreviews() {
  for (const field of strategyFields) {
    $(`${field.id}-details`).replaceChildren(...RoboControllers.strategyDetails(field.role, $(field.id).value, field.team).map(([name, value]) => {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = name; dd.textContent = value; row.append(dt, dd); return row;
    }));
  }
}
function renderStrategyState() {
  const dirty = strategyFields.some(field => $(field.id).value !== sim.config[field.key]);
  $('strategy-status').textContent = dirty ? '変更あり · 未適用' : '適用済み';
  $('strategy-status').classList.toggle('pending', dirty);
  $('apply-strategies').disabled = computing; $('revert-strategies').disabled = computing || !dirty;
  for (const field of strategyFields) $(field.id).disabled = computing;
  for (const team of ['red', 'blue']) {
    $(`${team}-strategy-summary`).textContent = strategyFields.filter(f => f.team === team).map(field => {
      const entries = RoboControllers.listStrategies(field.role), entry = entries.find(e => e.id === sim.config[field.key]) || entries[0];
      return `${field.role} ${entry.shortName}`;
    }).join(' / ');
  }
}
function selectTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(section => section.hidden = section.id !== `tab-${tab}`);
  render();
}
function cargoText(cargo, objects) {
  const counts = { earth: 0, sky: 0, mustika: 0 };
  for (const id of cargo) { const o = objects.find(o => o.id === id); if (o) counts[o.type]++; }
  return `E ${counts.earth} · S ${counts.sky}${counts.mustika ? ' · M 1' : ''}`;
}
function feedback(text, kind = '') { $('feedback').textContent = text; $('feedback').className = `feedback ${kind}`; }
function destinations() {
  const team = currentRobot().team, role = currentRobot().role;
  const list = [
    ['home', 'BR見渡し場所', F.points[team].home], ['transfer', '受け渡し区画', F.points[team][role === 'TR' ? 'transferTR' : 'transferBR']],
    ['storage', 'Earth保管場所の手前', F.points[team].storage], ['sky', 'Sky共有区画の手前', F.points[team].sky],
    ['mustika', 'Mustika初期柱の手前', F.points[team].mustika], ['pillar', 'L2中央柱の手前', F.points[team].pillar],
    ...F.spots.map(s => [s.id, s.label, F.spotApproaches(s, team)[0]]),
  ];
  const old = $('destination').value;
  $('destination').replaceChildren(...list.map(([id, label]) => new Option(label, id)));
  if (list.some(([id]) => id === old)) $('destination').value = old;
  else $('destination').value = role === 'TR' ? 'storage' : 'home';
  return list;
}
let targetList = destinations();
function chooseRobot(id) { selected = id; clickedPoint = null; targetList = destinations(); objectKey = ''; render(); }
function send(action) {
  if (replayTime !== null) { feedback('過去の再生中です。最新時刻へ戻してから操作してください', 'warn'); return; }
  if (currentRobot().job) { feedback('現在の動作が完了してから操作してください', 'warn'); return; }
  const result = sim.validate(currentRobot(), action);
  if (!result.ok) { feedback(`${result.reason} [${result.rule}]`, ['unsupported', 'unscored', 'perception'].includes(result.kind) ? 'warn' : 'error'); sim.log(currentRobot(), action.type, result.reason, result.kind, result.rule); render(); return; }
  sim.enqueue(selected, action, true); $('auto').checked = false; running = true; feedback('動作を実行中'); render();
}
function rect(r, fill, stroke = null, width = .018) { ctx.fillStyle = fill; ctx.fillRect(r.x, r.y, r.w, r.h); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.strokeRect(r.x, r.y, r.w, r.h); } }
function text(value, x, y, size = .14, color = '#4d5d52', align = 'center', bold = false) { ctx.font = `${bold ? '700 ' : ''}${size}px "Yu Gothic UI",Meiryo,sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(value, x, y); }
function line(a, b, color, width = .025) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
function circle(p, radius, fill, stroke) { ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = .02; ctx.stroke(); } }
function draw(state) {
  const size = canvas.width, pad = size * .035, scale = (size - 2 * pad) / 11;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, size, size); ctx.translate(pad, pad); ctx.scale(scale, scale);
  const small = cssSize < 500;
  rect(F.regions.ground, '#fbfbf8', '#4b574e', .04); rect(F.rect(0, 0, 5.5, 11), '#fbf0ef'); rect(F.rect(5.5, 0, 5.5, 11), '#edf3fb');
  for (let m = 1; m < 11; m++) { line({ x: m, y: 0 }, { x: m, y: 11 }, '#d8dfd9', .005); line({ x: 0, y: m }, { x: 11, y: m }, '#d8dfd9', .005); }
  rect(F.regions.sky, '#f3f0df', '#b8b29b'); rect(F.regions.mustika, '#ecebe3', '#a7ad9c');
  rect(F.regions.l1, '#f5e5e4', '#70796d'); rect(F.rect(5.5, 2.5, 3, 6), '#e1ecf5');
  rect(F.regions.sharedTop, '#edf0e4'); rect(F.regions.sharedBottom, '#edf0e4');
  for (const team of ['red', 'blue']) {
    const z = F.zones[team], c = colors[team];
    rect(z.storage, team === 'red' ? '#e6b1b6' : '#b0c9eb', c);
    rect(z.ramp, team === 'red' ? '#eed8d4' : '#d2e1f0', '#808c80');
    for (let i = 1; i <= 6; i++) line({ x: z.ramp.x + .12, y: z.ramp.y + i * .5 }, { x: z.ramp.x + .88, y: z.ramp.y + i * .5 }, '#adb3a4', .01);
    text('坂', z.ramp.x + .5, 4.55, small ? .22 : .18, c, 'center', true);
    rect(z.transfer, team === 'red' ? '#efce86' : '#9ecce4', '#798d82', .02);
    text(small ? '受渡' : '受け渡し', z.transfer.x + .48, 6.13, small ? .18 : .15, c, 'center', true);
    rect(z.stairs, team === 'red' ? '#e4c6c3' : '#c4d7e9', '#818e82');
    for (let i = 0; i < 3; i++) line({ x: z.stairs.x, y: 7.3 + i * .3 }, { x: z.stairs.x + 1, y: 7.3 + i * .3 }, '#7a877d');
    text('階段', z.stairs.x + .5, 8.43, .17, c);
    rect(z.upperStairs, '#c4d2c6', '#7e8a7d');
    rect(z.retry, team === 'red' ? '#eabcc2' : '#bfd4ef', c);
    if (!small) text('Retry', z.retry.x + .35, z.retry.y + .35, .14, c);
    for (const role of ['TR', 'BR']) { const p = F.points[team][`start${role}`]; rect(S.box(p, .7), team === 'red' ? '#e8c4c8' : '#c2d7ef', c); text(role, p.x, 10.13, .18, c, 'center', true); }
    const home = F.points[team].home;
    circle(home, .25, '#e1eee4', '#3f7b55'); line({ x: home.x - .15, y: home.y }, { x: home.x + .15, y: home.y }, '#3f7b55'); line({ x: home.x, y: home.y - .15 }, { x: home.x, y: home.y + .15 }, '#3f7b55');
    text('見渡し', home.x, home.y + .46, small ? .18 : .15, '#2e6c47');
  }
  rect(F.regions.l2, '#e5e9e1', '#75846f', .025);
  for (const s of F.spots) rect(S.box(s, .5), '#bdd5b9', '#477148');
  for (const wall of F.walls) rect(wall, '#6c7868');
  text('L1', 3.2, 7.6, .28, '#977f7c', 'center', true); text('L1', 7.8, 7.6, .28, '#788d9e', 'center', true); text('L2 / 共有', 5.5, 4.65, .23, '#60725c', 'center', true);
  text(small ? 'Earth' : 'Earth保管場所', 1, 1.12, .17, colors.red, 'center', true); text(small ? 'Earth' : 'Earth保管場所', 10, 1.12, .17, colors.blue, 'center', true);
  text('Sky / 共有', 5.5, 10.58, .18, '#5e665d'); text('Mustika', 5.5, .53, .18, '#756119');
  circle({ x: 5.5, y: 1.25 }, .135, '#aaa994', '#585d4d'); circle({ x: 5.5, y: 5.5 }, .135, '#999e8c', '#585d4d');
  for (const slot of [...F.slots('red'), ...F.slots('blue')]) { ctx.setLineDash([.04, .04]); rect(S.box(slot, .35), '#ffffff44', '#77876e', .01); ctx.setLineDash([]); }
  const piles = new Map();
  for (const o of state.objects) { if (['cargo', 'removed'].includes(o.location)) continue; const key = `${o.x.toFixed(3)}:${o.y.toFixed(3)}`; if (!piles.has(key)) piles.set(key, []); piles.get(key).push(o); }
  for (const pile of piles.values()) {
    pile.sort((a, b) => a.z - b.z);
    for (let i = 0; i < pile.length; i++) {
      const o = pile[i], p = { x: o.x + i * .045, y: o.y - i * .045 }, c = colors[o.type === 'sky' ? o.color : o.placedBy || o.team] || '#6b776c';
      if (o.type === 'mustika') { circle(p, .12, '#edc542', '#917418'); text('M', p.x, p.y, .13, '#513c00', 'center', true); }
      else { rect(S.box(p, o.size), o.type === 'earth' ? '#faf9f4' : c, c, .025); text(o.type === 'earth' ? 'E' : 'S', p.x, p.y, o.size * .55, o.type === 'earth' ? c : '#fff', 'center', true); }
      if (o.touchedBy && o.location !== 'source') { ctx.setLineDash([.04, .03]); rect(S.box(p, o.size + .1), '#00000000', '#ca882d'); ctx.setLineDash([]); }
    }
  }
  for (const s of F.spots) {
    const tower = state.objects.filter(o => o.location === 'spot' && o.spotId === s.id).sort((a, b) => a.layer - b.layer);
    if (!small) text(s.label, s.x, s.y + .47, .13, '#4b6152');
    if (tower.length) text(tower.map(o => o.type === 'earth' ? 'E' : 'S').join('·'), s.x, s.y - .48, small ? .19 : .15, '#293d30', 'center', true);
  }
  if ($('show-path').checked) for (const r of state.robots) {
    if (!r.job?.route) continue;
    ctx.beginPath(); ctx.moveTo(r.x, r.y); for (const p of r.job.route) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = colors[r.team] + '90'; ctx.lineWidth = .035; ctx.setLineDash([.08, .07]); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const r of state.robots) {
    const c = colors[r.team], body = S.box(r, sim.config.bodySize);
    if (r.id === selected) rect(S.box(r, sim.config.bodySize + .14), '#ffffff00', '#243a2b', .035);
    rect(body, c, '#fff', .035); text(r.role, r.x, r.y, .2, '#fff', 'center', true);
    if ($('show-body').checked) { ctx.setLineDash([.04, .03]); rect(body, '#00000000', '#172d22', .014); ctx.setLineDash([]); }
    if (r.cargo.length) {
      const txt = cargoText(r.cargo, state.objects).replaceAll(' ', '');
      const w = Math.max(.8, txt.length * .095); rect(F.rect(r.x - w / 2, r.y - .58, w, .26), '#fffef4', c, .015); text(txt, r.x, r.y - .45, .16, c, 'center', true);
    }
    if (r.job?.type === 'scan') { circle({ x: r.x + .31, y: r.y - .31 }, .1, '#f0ce58', '#a58937'); }
  }
  if (clickedPoint) { ctx.beginPath(); ctx.arc(clickedPoint.x, clickedPoint.y, .18, 0, 2 * Math.PI); ctx.strokeStyle = '#1d6c48'; ctx.lineWidth = .03; ctx.stroke(); }
}
function render() {
  snapshot = replayTime === null ? sim.snapshot() : sim.history.reduce((prev, frame) => frame.time <= replayTime ? frame : prev, sim.history[0]);
  const remaining = Math.max(0, 180 - snapshot.time);
  $('clock').textContent = `${Math.floor(remaining / 60)}:${(remaining % 60).toFixed(1).padStart(4, '0')}`;
  $('match-state').textContent = computing ? '計算中' : replayTime !== null ? 'リプレイ' : sim.ended ? '競技終了' : running ? '競技中' : sim.time ? '一時停止' : '開始前';
  $('progress').value = snapshot.time; $('elapsed').textContent = `${snapshot.time.toFixed(1)} s`; $('timeline').value = snapshot.time;
  for (const team of ['red', 'blue']) {
    const score = snapshot.scores[team]; $(`${team}-score`).textContent = score.total;
    $(`${team}-detail`).textContent = `搬送 ${score.transfer} / 配置 ${score.tower} / M ${score.mustika}`;
    const mandate = $(`${team}-mandate`), done = snapshot.sanctuary[team] !== null;
    mandate.textContent = done ? `条件達成 ${snapshot.sanctuary[team].toFixed(1)} s` : '条件未達'; mandate.className = `mandate${done ? ' done' : ''}`;
  }
  $('robots').replaceChildren(...snapshot.robots.map(r => {
    const div = document.createElement('div'); div.className = `robot-tile${r.id === selected ? ' active' : ''}`; div.tabIndex = 0; div.setAttribute('role', 'button');
    div.innerHTML = `<strong style="color:${colors[r.team]}">${r.team === 'red' ? '赤' : '青'} ${r.role}</strong><div class="cargo">${cargoText(r.cargo, snapshot.objects)}</div><small></small>`;
    div.querySelector('small').textContent = r.status; div.onclick = () => chooseRobot(r.id); div.onkeydown = e => { if (e.key === 'Enter') chooseRobot(r.id); }; return div;
  }));
  document.querySelectorAll('[data-robot]').forEach(b => b.classList.toggle('active', b.dataset.robot === selected));
  const r = snapshot.robots.find(r => r.id === selected), ground = F.surface(r);
  $('auto').checked = currentRobot().auto; $('robot-status').textContent = r.status; $('robot-cargo').textContent = cargoText(r.cargo, snapshot.objects);
  $('br-decision').hidden = r.role !== 'BR' || !r.decision;
  $('decision-summary').textContent = r.decision?.summary || '未計画';
  $('decision-gain').textContent = r.decision ? `${r.decision.gain >= 0 ? '+' : ''}${r.decision.gain}点 / 約${r.decision.seconds}秒` : '';
  $('decision-horizon').textContent = r.decision ? `+${r.decision.horizonGain}点 / 約${r.decision.horizonSeconds}秒` : '';
  $('robot-ground').textContent = `${({ ground: '地上', l1: 'L1', l2: 'L2', ramp: '坂', stairs: '地上階段', upperStairs: 'L2階段', transfer: '受け渡し' })[ground.type]} / ${(r.z * 1000).toFixed(0)} mm`;
  $('robot-scan').textContent = r.observation ? `${r.observation.at.toFixed(1)} s (${(snapshot.time - r.observation.at).toFixed(1)}秒前)` : '未認識';
  $('transport-data').hidden = r.role !== 'TR';
  const plan = RoboControllers.transportPlan(sim.config[`${r.team}TrPlan`], r.transport.completed.length);
  $('robot-plan').textContent = `${r.transport.completed.length + 1}便目 · ${r.cargo.includes('M') ? 'M1' : plan.label}`;
  $('robot-deliveries').textContent = r.transport.completed.map(d => `${d.number}便目 ${cargoText(d.items.map(o => o.id), snapshot.objects)}`).join(' / ') || 'なし';
  if (r.failure) feedback(`${r.failure.reason} [${r.failure.rule}]`, r.failure.kind === 'rule' ? 'error' : 'warn');
  const relevant = snapshot.objects.filter(o => r.role === 'TR' ? (o.location === 'source' && (!o.team || o.team === r.team)) || r.cargo.includes(o.id) : (o.location === 'transfer' && o.transferTeam === r.team) || r.cargo.includes(o.id));
  const key = relevant.map(o => `${o.id}:${o.location}:${o.layer}`).join();
  if (key !== objectKey) {
    const old = $('object-select').value; $('object-select').replaceChildren(...relevant.map(o => new Option(`${o.id} · ${o.type === 'earth' ? 'Earth' : o.type === 'sky' ? 'Sky' : 'Mustika'} · ${o.location === 'cargo' ? '手持ち' : o.location === 'transfer' ? '受渡' : '供給元'}${o.layer != null ? ` ${o.layer + 1}段` : ''}`, o.id)));
    if (!relevant.length) $('object-select').add(new Option('対象物なし', ''));
    if (relevant.some(o => o.id === old)) $('object-select').value = old; objectKey = key;
  }
  $('transfer-state').innerHTML = ['red', 'blue'].map(team => {
    const stock = snapshot.objects.filter(o => o.location === 'transfer' && o.transferTeam === team);
    return `<div class="stock-row"><strong style="color:${colors[team]}">${team === 'red' ? '赤' : '青'} ${stock.length} / 4個</strong>${cargoText(stock.map(o => o.id), snapshot.objects)}<small>${stock.map(o => `${o.id} (${o.slot.split('-')[1] === '0' ? '上側' : '下側'}列 ${o.layer + 1}段)`).join('、') || '空き'}</small></div>`;
  }).join('');
  $('tower-state').innerHTML = F.spots.map(s => {
    const t = snapshot.objects.filter(o => o.location === 'spot' && o.spotId === s.id).sort((a, b) => a.layer - b.layer);
    return `<div class="tower-row"><span>${s.label}</span>${[0, 1, 2].map(i => { const o = t[i], team = o && (o.type === 'sky' ? o.color : o.placedBy); return `<span class="block-chip ${team || ''}">${o ? `${team === 'red' ? '赤' : '青'}${o.type === 'earth' ? 'E' : 'S'}` : '―'}</span>`; }).join('')}</div>`;
  }).join('');
  $('source-state').innerHTML = `<div class="stock-row">赤Earth ${snapshot.objects.filter(o => o.location === 'source' && o.type === 'earth' && o.team === 'red').length} / 青Earth ${snapshot.objects.filter(o => o.location === 'source' && o.type === 'earth' && o.team === 'blue').length}<br>共有Sky ${snapshot.objects.filter(o => o.location === 'source' && o.type === 'sky').length}<br>Mustika: ${{ source: '初期柱', cargo: '運搬中', transfer: '受け渡し区画', pillar: '中央柱' }[snapshot.objects.find(o => o.id === 'M').location]}</div>`;
  if (lastLog !== sim.events.length || replayTime !== null) {
    const events = sim.events.filter(e => e.time <= snapshot.time && (!$('errors-only').checked || !['action', 'setup', 'milestone'].includes(e.kind))).slice(-120).reverse();
    $('event-log').replaceChildren(...events.map(e => { const li = document.createElement('li'), time = document.createElement('time'), span = document.createElement('span'); time.textContent = `${e.time.toFixed(1)}s`; span.textContent = `${e.robot ? e.robot.replace('red', '赤 ').replace('blue', '青 ') + ' · ' : ''}${e.text}${e.rule ? ` [${e.rule}]` : ''}`; if (e.rule) span.className = 'rule'; li.append(time, span); return li; })); lastLog = sim.events.length;
  }
  const blocked = computing || replayTime !== null || sim.ended;
  document.querySelectorAll('.command-grid button,.command-row button').forEach(b => b.disabled = blocked);
  $('finish').disabled = computing || sim.ended; $('step').disabled = computing || sim.ended || replayTime !== null; $('reset').disabled = computing; $('apply-settings').disabled = computing;
  $('auto').disabled = $('stop-robot').disabled = $('approach-object').disabled = computing || replayTime !== null || sim.ended;
  $('play').innerHTML = `<i data-lucide="${running || playback ? 'pause' : 'play'}"></i>`; icons(); draw(snapshot);
  $('run-summary').textContent = sim.ended ? `${sim.events.length}件の記録 · 試合終了` : replayTime !== null ? '記録済み軌跡' : '基本動作モード';
  renderStrategyState();
}
function reset(config = sim.config, { preserveStrategyDraft = false } = {}) { sim = new S.Simulation(config); running = false; computing = false; replayTime = null; playback = false; accumulator = 0; lastLog = -1; objectKey = ''; if (!preserveStrategyDraft) syncStrategyMenus(); feedback('初期配置に戻しました'); render(); }
$('play').onclick = () => {
  if (computing) return;
  if (sim.ended && replayTime === null) replayTime = 0;
  if (replayTime !== null) { playback = !playback; running = false; } else running = !running;
  render();
};
$('step').onclick = () => { running = false; for (let i = 0; i < 10; i++) sim.step(.05, RoboControllers); render(); };
$('reset').onclick = () => reset();
$('finish').onclick = () => {
  running = false; computing = true; replayTime = null; render();
  function chunk() { const stop = performance.now() + 60; while (!sim.ended && performance.now() < stop) sim.step(.05, RoboControllers); render(); if (!sim.ended) requestAnimationFrame(chunk); else { computing = false; render(); } }
  requestAnimationFrame(chunk);
};
$('timeline').oninput = () => { running = false; playback = false; const t = Math.min(Number($('timeline').value), sim.time); replayTime = t >= sim.time - .01 ? null : t; lastLog = -1; render(); };
$('auto').onchange = () => { const r = currentRobot(); r.auto = $('auto').checked; if (r.auto) r.brain = { stage: r.role === 'BR' && r.cargo.length ? 'return' : 'start' }; else { r.queue = []; r.stall = null; r.retryPending = null; } render(); };
$('stop-robot').onclick = () => {
  const r = currentRobot(); r.auto = false; r.queue = []; r.stall = null; r.retryPending = null;
  if (r.job && r.job.type !== 'move') { feedback('把持・配置中の動作が完了したら停止します', 'warn'); }
  else { r.job = null; r.velocity = 0; r.wait = 0; r.status = '手動停止'; feedback('移動と自動運転を停止しました'); }
  sim.log(r, 'stop', '移動停止・後続動作解除'); render();
};
function zoomBy(delta) { zoom = Math.max(1, Math.min(2.5, zoom + delta)); canvas.style.width = `${zoom * 100}%`; canvas.parentElement.classList.toggle('zoomed', zoom > 1); $('zoom-out').disabled = zoom === 1; $('zoom-in').disabled = zoom === 2.5; }
$('zoom-in').onclick = () => zoomBy(.5);
$('zoom-out').onclick = () => zoomBy(-.5);
document.querySelectorAll('[data-robot]').forEach(b => b.onclick = () => chooseRobot(b.dataset.robot));
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => selectTab(b.dataset.tab));
$('edit-strategies').onclick = () => { selectTab('strategies'); document.querySelector('.tabs').scrollIntoView({ block: 'nearest' }); $('red-tr-plan').focus({ preventScroll: true }); };
$('apply-strategies').onclick = () => {
  if (computing) return;
  const config = { ...sim.config };
  for (const field of strategyFields) config[field.key] = $(field.id).value;
  reset(config);
};
$('revert-strategies').onclick = () => { syncStrategyMenus(); renderStrategyState(); };
$('destination').onchange = () => { clickedPoint = null; if (F.spotById[$('destination').value]) selectedSpot = $('destination').value; render(); };
$('move').onclick = () => send({ type: 'move', target: clickedPoint || targetList.find(([id]) => id === $('destination').value)[2], label: '指定位置へ移動' });
$('scan').onclick = () => send({ type: 'scan' });
$('approach-object').onclick = () => {
  const o = sim.object($('object-select').value), r = currentRobot();
  if (!o || o.location === 'cargo') { feedback('供給元または受け渡し区画のブロックを選んでください', 'warn'); return; }
  send({ type: 'move', target: o.location === 'source' ? RoboControllers.sourceApproach(o, r.team) : F.points[r.team][r.role === 'BR' ? 'transferBR' : 'transferTR'], label: `${o.id}へ移動` });
};
for (const type of ['pickup', 'receive', 'place', 'flip', 'unload', 'enshrine', 'recover']) $(type).onclick = () => send({ type, objectId: $('object-select').value, spotId: selectedSpot });
$('retry').onclick = () => send({ type: 'retry', level: currentRobot().role === 'BR' && currentRobot().enteredL1 ? 1 : 0 });
$('show-path').onchange = $('show-body').onchange = () => draw(snapshot);
$('errors-only').onchange = () => { lastLog = -1; render(); };
$('apply-settings').onclick = () => {
  const fields = { redSpeed: 'red-speed', blueSpeed: 'blue-speed', maxSpeed: 'max-speed', acceleration: 'acceleration', scanSeconds: 'scan-seconds', rampFactor: 'ramp-factor', stairSpeed: 'stair-speed', stairPause: 'stair-pause' }, config = { ...sim.config };
  for (const [key, id] of Object.entries(fields)) { const input = $(id); if (!input.checkValidity() || !Number.isFinite(Number(input.value))) { input.reportValidity(); return; } config[key] = Number(input.value); }
  reset(config, { preserveStrategyDraft: true });
};
$('download').onclick = () => { const data = new Blob([JSON.stringify(sim.export())], { type: 'application/json' }), url = URL.createObjectURL(data), a = document.createElement('a'); a.href = url; a.download = `ABU2027-field-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
canvas.addEventListener('pointerdown', e => {
  const bounds = canvas.getBoundingClientRect(), p = { x: ((e.clientX - bounds.left) / bounds.width - .035) * 11 / .93, y: ((e.clientY - bounds.top) / bounds.height - .035) * 11 / .93 };
  const robot = snapshot.robots.find(r => S.distance(r, p) < .38); if (robot) { chooseRobot(robot.id); return; }
  const spot = F.spots.find(s => S.distance(s, p) < .42);
  if (spot) { selectedSpot = spot.id; $('destination').value = spot.id; clickedPoint = null; feedback(`配置先: ${spot.label}`); }
  else {
    const object = snapshot.objects.filter(o => ['source', 'transfer'].includes(o.location) && S.distance(o, p) < o.size * .7).sort((a, b) => b.z - a.z)[0];
    if (object && [...$('object-select').options].some(option => option.value === object.id)) { $('object-select').value = object.id; clickedPoint = null; feedback(`選択: ${object.id} · ${object.type}`); }
    else { clickedPoint = p; feedback(`移動先: x ${p.x.toFixed(2)} m / y ${p.y.toFixed(2)} m`); }
  }
  draw(snapshot);
});
const observer = new ResizeObserver(() => { cssSize = canvas.getBoundingClientRect().width; canvas.width = canvas.height = Math.round(cssSize * Math.min(2, devicePixelRatio || 1)); draw(snapshot); }); observer.observe(canvas);
function tick(now) {
  const dt = previous ? Math.min(.15, (now - previous) / 1000) : 0; previous = now;
  if (playback && replayTime !== null) { replayTime += dt * Number($('rate').value); if (replayTime >= sim.time) { replayTime = null; playback = false; } render(); }
  else if (running && !computing && !sim.ended) { accumulator += dt * Number($('rate').value); const stop = performance.now() + 30; while (accumulator >= .05 && performance.now() < stop) { sim.step(.05, RoboControllers); accumulator -= .05; } if (sim.ended) running = false; render(); }
  requestAnimationFrame(tick);
}
window.fieldApp = { get sim() { return sim; }, reset, render, selectRobot: chooseRobot };
initStrategyMenus(); zoomBy(0); icons(); render(); requestAnimationFrame(tick);
