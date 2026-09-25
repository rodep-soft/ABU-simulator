/* global RoboField, RoboSim, RoboControllers, RoboReview, lucide */
'use strict';
const F = RoboField, S = RoboSim;
const $ = id => document.getElementById(id);
const canvas = $('field'), ctx = canvas.getContext('2d');
const colors = { red: '#ba3548', blue: '#2464b0', neutral: '#637166' };
let sim = new S.Simulation(), selected = 'redTR', running = false, computing = false, replayTime = null, playback = false, selectedSpot = 'r2', clickedPoint = null, previous = 0, accumulator = 0;
let lastLog = -1, objectKey = '', snapshot = sim.snapshot(), cssSize = 700;
let zoom = 1, generation = 0, lastPlayIcon = '', paintAt = 0;
let review = null, reviewActive = false, reviewObject = null;
const strategyFields = ['red', 'blue'].flatMap(team => ['TR', 'BR'].map(role => ({ team, role, key: `${team}${role === 'TR' ? 'Tr' : 'Br'}Plan`, id: `${team}-${role.toLowerCase()}-plan` })));
const strategyTurns = { red: [], blue: [] };
const transportTrips = { red: [], blue: [] };
function displayedBrPlan(team) {
  const completed = snapshot.robots.find(r => r.id === `${team}BR`)?.brTurn?.completed || 0;
  return sim.config[`${team}BrTurns`][completed] || sim.config[`${team}BrPlan`];
}
const currentRobot = () => sim.robot(selected);
function icons() { lucide.createIcons(); }
function initStrategyMenus() {
  for (const team of ['red', 'blue']) {
    const group = document.createElement('fieldset'), legend = document.createElement('legend');
    group.className = 'strategy-team'; legend.className = `team-${team}`;
    legend.textContent = `${team === 'red' ? '赤' : '青'}チーム`; group.append(legend);
    const presetLabel = document.createElement('label'), preset = document.createElement('select');
    presetLabel.textContent = '戦略モード'; preset.id = `${team}-mode`;
    preset.replaceChildren(new Option('個別設定', ''), ...RoboControllers.listPresets().map(p => new Option(p.name, p.id)));
    preset.onchange = () => {
      const chosen = RoboControllers.listPresets().find(p => p.id === preset.value);
      if (chosen) { $(`${team}-tr-plan`).value = chosen.tr; $(`${team}-br-plan`).value = chosen.br; strategyTurns[team] = []; transportTrips[team] = []; renderTurnEditor(team); renderTripEditor(team); }
      renderStrategyPreviews(); renderStrategyState();
    };
    presetLabel.append(preset); group.append(presetLabel);
    for (const field of strategyFields.filter(f => f.team === team)) {
      const label = document.createElement('label'), select = document.createElement('select'), details = document.createElement('dl');
      label.textContent = `${field.role} · ${field.role === 'TR' ? '搬送戦略' : '通常の配置戦略'}`;
      select.id = field.id;
      select.replaceChildren(...RoboControllers.listStrategies(field.role).map(entry => new Option(entry.name, entry.id)));
      select.onchange = () => { renderStrategyPreviews(); renderStrategyState(); };
      details.id = `${field.id}-details`; details.className = 'strategy-details';
      label.append(select); group.append(label, details);
      if (field.role === 'TR') {
        const trips = document.createElement('div'), heading = document.createElement('div'), title = document.createElement('strong'), add = document.createElement('button'), rows = document.createElement('div');
        trips.className = 'tr-trips'; heading.className = 'turn-heading'; title.textContent = 'TRの便別内訳';
        add.id = `${team}-add-trip`; add.className = 'icon'; add.title = '搬送便を追加'; add.setAttribute('aria-label', `${team === 'red' ? '赤' : '青'}TRの搬送便を追加`); add.innerHTML = '<i data-lucide="plus"></i>';
        add.onclick = () => { transportTrips[team].push(['earth', 'earth', 'earth']); renderTripEditor(team); renderStrategyPreviews(); renderStrategyState(); };
        rows.id = `${team}-tr-trips`; heading.append(title, add); trips.append(heading, rows); group.append(trips);
      }
    }
    const turns = document.createElement('div'), heading = document.createElement('div'), title = document.createElement('strong'), add = document.createElement('button'), rows = document.createElement('div');
    turns.className = 'br-turns'; heading.className = 'turn-heading'; title.textContent = 'BRの順番';
    add.id = `${team}-add-turn`; add.className = 'icon'; add.title = '作業回を追加'; add.setAttribute('aria-label', `${team === 'red' ? '赤' : '青'}BRの作業回を追加`); add.innerHTML = '<i data-lucide="plus"></i>';
    add.onclick = () => { strategyTurns[team].push($(`${team}-br-plan`).value); renderTurnEditor(team); renderStrategyPreviews(); renderStrategyState(); };
    rows.id = `${team}-br-turns`; heading.append(title, add); turns.append(heading, rows); group.append(turns);
    $('strategy-selectors').append(group);
  }
  syncStrategyMenus();
}
function renderTripEditor(team) {
  const rows = $(`${team}-tr-trips`);
  rows.replaceChildren(...transportTrips[team].map((slots, index) => {
    const row = document.createElement('div'), heading = document.createElement('div'), name = document.createElement('strong'), controls = document.createElement('div'), cargo = document.createElement('div');
    row.className = 'tr-trip-row'; heading.className = 'turn-heading'; name.textContent = `${index + 1}便目`; controls.className = 'turn-controls'; cargo.className = 'trip-cargo';
    for (const [action, icon, title] of [['up', 'arrow-up', '前へ'], ['down', 'arrow-down', '後へ'], ['remove', 'trash-2', '削除']]) {
      const button = document.createElement('button'); button.className = 'icon'; button.dataset.tripAction = action; button.title = title;
      button.setAttribute('aria-label', `${team === 'red' ? '赤' : '青'}TR ${index + 1}便目を${title}`); button.innerHTML = `<i data-lucide="${icon}"></i>`;
      button.onclick = () => {
        const trips = transportTrips[team], next = index + (action === 'up' ? -1 : 1);
        if (action === 'remove') trips.splice(index, 1);
        else if (next >= 0 && next < trips.length) [trips[index], trips[next]] = [trips[next], trips[index]];
        renderTripEditor(team); renderStrategyPreviews(); renderStrategyState();
      };
      controls.append(button);
    }
    slots.forEach((type, slot) => {
      const label = document.createElement('label'), select = document.createElement('select'); label.textContent = `${slot + 1}枠目`;
      select.id = `${team}-tr-trip-${index}-${slot}`; select.setAttribute('aria-label', `${team === 'red' ? '赤' : '青'}TR ${index + 1}便目 ${slot + 1}枠目`);
      select.replaceChildren(new Option('Earth', 'earth'), new Option('Sky', 'sky'), new Option('なし', 'none')); select.value = type; select.dataset.cargo = type;
      select.onchange = () => { slots[slot] = select.value; select.dataset.cargo = select.value; renderStrategyPreviews(); renderStrategyState(); };
      label.append(select); cargo.append(label);
    });
    heading.append(name, controls); row.append(heading, cargo); return row;
  }));
  const after = document.createElement('div'); after.className = 'turn-fallback';
  after.textContent = transportTrips[team].length ? `${transportTrips[team].length + 1}便目以降: 通常補給 / 採集はEarth優先 / Mustika便は別枠` : '全便: 選択した搬送戦略';
  rows.append(after); icons();
}
function renderTurnEditor(team) {
  const entries = RoboControllers.listStrategies('BR');
  $(`${team}-br-turns`).replaceChildren(...strategyTurns[team].map((id, index) => {
    const row = document.createElement('div'), label = document.createElement('label'), select = document.createElement('select'), controls = document.createElement('div');
    row.className = 'br-turn-row'; label.textContent = `${index + 1}回目`; select.id = `${team}-br-turn-${index}`; select.title = `${index + 1}回目のBR戦略`;
    select.replaceChildren(...entries.map(entry => new Option(entry.shortName, entry.id))); select.value = id;
    select.onchange = () => { strategyTurns[team][index] = select.value; renderStrategyPreviews(); renderStrategyState(); };
    label.append(select); controls.className = 'turn-controls';
    for (const [action, icon, title] of [['up', 'arrow-up', '前へ'], ['down', 'arrow-down', '後へ'], ['remove', 'trash-2', '削除']]) {
      const button = document.createElement('button'); button.className = 'icon'; button.dataset.turnAction = action;
      button.title = title; button.setAttribute('aria-label', `${index + 1}回目を${title}`); button.innerHTML = `<i data-lucide="${icon}"></i>`;
      button.onclick = () => {
        const turns = strategyTurns[team], next = index + (action === 'up' ? -1 : 1);
        if (action === 'remove') turns.splice(index, 1);
        else if (next >= 0 && next < turns.length) [turns[index], turns[next]] = [turns[next], turns[index]];
        renderTurnEditor(team); renderStrategyPreviews(); renderStrategyState();
      };
      controls.append(button);
    }
    row.append(label, controls); return row;
  }));
  const after = document.createElement('div'); after.className = 'turn-fallback'; after.textContent = strategyTurns[team].length ? `${strategyTurns[team].length + 1}回目以降: 通常の配置戦略` : '全作業: 通常の配置戦略';
  $(`${team}-br-turns`).append(after); icons();
}
function syncStrategyMenus() {
  for (const field of strategyFields) {
    const entries = RoboControllers.listStrategies(field.role);
    $(field.id).value = entries.some(entry => entry.id === sim.config[field.key]) ? sim.config[field.key] : entries[0].id;
  }
  $('supply-mode').value = sim.config.supplyMode;
  for (const team of ['red', 'blue']) { strategyTurns[team] = [...sim.config[`${team}BrTurns`]]; transportTrips[team] = sim.config[`${team}TrTrips`].map(slots => [...slots]); renderTurnEditor(team); renderTripEditor(team); }
  renderStrategyPreviews();
}
function renderStrategyPreviews() {
  $('supply-details').hidden = $('supply-mode').value !== 'ideal';
  for (const team of ['red', 'blue']) $(`${team}-mode`).value = strategyTurns[team].length || transportTrips[team].length ? '' : RoboControllers.listPresets().find(p => p.tr === $(`${team}-tr-plan`).value && p.br === $(`${team}-br-plan`).value)?.id || '';
  for (const field of strategyFields) {
    const details = field.role === 'TR' && $('supply-mode').value === 'ideal'
      ? [['現在の担当', 'Mustika先回り・取得・直接手渡し'], ['便別指定', '適用対象外 (通常補給のみ)']]
      : field.role === 'TR' && transportTrips[field.team].length
        ? [['指定終了後', '選択戦略の通常補給'], ['Mustika', '条件達成後、箱便の合間に取得']]
        : RoboControllers.strategyDetails(field.role, $(field.id).value, field.team);
    $(`${field.id}-details`).replaceChildren(...details.map(([name, value]) => {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = name; dd.textContent = value; row.append(dt, dd); return row;
    }));
  }
}
function renderStrategyState() {
  const ideal = $('supply-mode').value === 'ideal';
  const invalid = ['red', 'blue'].flatMap(team => transportTrips[team].map((slots, index) => slots.every(type => type === 'none') ? `${team === 'red' ? '赤' : '青'}TR ${index + 1}便目: 最低1個を選択` : '')).filter(Boolean);
  const dirty = $('supply-mode').value !== sim.config.supplyMode || strategyFields.some(field => $(field.id).value !== sim.config[field.key]) || ['red', 'blue'].some(team => JSON.stringify(strategyTurns[team]) !== JSON.stringify(sim.config[`${team}BrTurns`]) || JSON.stringify(transportTrips[team]) !== JSON.stringify(sim.config[`${team}TrTrips`]));
  $('strategy-status').textContent = invalid.length ? invalid.join(' / ') : dirty ? '変更あり · 未適用' : '適用済み';
  $('strategy-status').classList.toggle('pending', dirty);
  $('apply-strategies').disabled = computing || !!invalid.length; $('revert-strategies').disabled = computing || !dirty;
  $('supply-mode').disabled = computing;
  $('supply-summary').textContent = sim.config.supplyMode === 'ideal' ? '箱の補給待ちなし' : '通常補給';
  for (const field of strategyFields) $(field.id).disabled = computing || ideal && field.role === 'TR';
  for (const team of ['red', 'blue']) {
    $(`${team}-mode`).disabled = computing;
    $(`${team}-add-turn`).disabled = computing;
    $(`${team}-add-trip`).disabled = computing || ideal;
    $(`${team}-tr-trips`).querySelectorAll('select').forEach(select => { select.disabled = computing || ideal; });
    $(`${team}-tr-trips`).querySelectorAll('.tr-trip-row').forEach((row, index) => {
      row.classList.toggle('invalid', transportTrips[team][index].every(type => type === 'none'));
      for (const button of row.querySelectorAll('button')) button.disabled = computing || ideal || button.dataset.tripAction === 'up' && index === 0 || button.dataset.tripAction === 'down' && index === transportTrips[team].length - 1;
    });
    $(`${team}-br-turns`).querySelectorAll('select').forEach(select => { select.disabled = computing; });
    $(`${team}-br-turns`).querySelectorAll('.br-turn-row').forEach((row, index) => {
      for (const button of row.querySelectorAll('button')) button.disabled = computing || button.dataset.turnAction === 'up' && index === 0 || button.dataset.turnAction === 'down' && index === strategyTurns[team].length - 1;
    });
    $(`${team}-strategy-summary`).textContent = strategyFields.filter(f => f.team === team).map(field => {
      if (field.role === 'TR' && sim.config.supplyMode === 'ideal') return 'TR Mustika担当';
      if (field.role === 'TR' && sim.config[`${team}TrTrips`].length) {
        const index = S.transportTripIndex(snapshot.robots.find(r => r.id === `${team}TR`)?.transport), plan = RoboControllers.transportPlan(sim.config[field.key], index, sim.config[`${team}TrTrips`]);
        if (plan.custom) return `TR 指定${index + 1}便目 ${plan.label}`;
      }
      const entries = RoboControllers.listStrategies(field.role), entry = entries.find(e => e.id === (field.role === 'BR' ? displayedBrPlan(team) : sim.config[field.key])) || entries[0];
      const number = field.role === 'BR' && sim.config[`${team}BrTurns`].length ? `${(snapshot.robots.find(r => r.id === `${team}BR`)?.brTurn?.completed || 0) + 1}回目 ` : '';
      return `${field.role} ${number}${entry.shortName}`;
    }).join(' / ');
  }
}
function selectTab(tab) {
  if (tab === 'review' && !reviewActive) { startReview(); return; }
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(section => section.hidden = section.id !== `tab-${tab}`);
  render();
}
function startReview() {
  if (!sim.ended || computing) return;
  review ||= new RoboReview.Review(sim.snapshot());
  reviewObject ||= review.state.objects.find(RoboReview.editable)?.id || null;
  running = false; playback = false; replayTime = null; reviewActive = true; clickedPoint = null;
  selectTab('review');
}
function exitReview() { reviewActive = false; selectTab('state'); }
function renderReview() {
  $('review-toggle').disabled = $('review-tab').disabled = !sim.ended || computing;
  $('review-toggle').setAttribute('aria-pressed', String(reviewActive));
  if (!review) return;
  const base = review.original.scores, after = review.state.scores;
  const signed = n => `${n > 0 ? '+' : ''}${n}`;
  $('review-scores').replaceChildren(...['red', 'blue', 'gap'].map(team => {
    const original = team === 'gap' ? base.red.total - base.blue.total : base[team].total;
    const current = team === 'gap' ? after.red.total - after.blue.total : after[team].total;
    const row = document.createElement('tr'), label = document.createElement('th');
    label.textContent = team === 'gap' ? '赤−青' : team === 'red' ? '赤' : '青'; label.scope = 'row'; row.append(label);
    for (const value of [original, current, signed(current - original)]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
    return row;
  }));
  const changes = review.changes();
  $('review-count').textContent = `変更${changes.length}個`;
  $('review-undo').disabled = !review.undoStack.length; $('review-redo').disabled = !review.redoStack.length;
  $('review-reset').disabled = !review.undoStack.length && !review.redoStack.length;
  const object = review.state.objects.find(o => o.id === reviewObject && RoboReview.editable(o));
  $('review-selection').textContent = object ? `${F.spotById[object.spotId].label} · ${object.layer + 1}段目 ${object.type === 'earth' ? 'Earth' : 'Sky'}` : 'ブロック未選択';
  for (const team of ['red', 'blue']) {
    $(`review-${team}`).disabled = !object;
    $(`review-${team}`).setAttribute('aria-pressed', String(!!object && RoboReview.owner(object) === team));
  }
  $('review-flip').disabled = !object;
  const flipLabel = object ? `${object.type === 'earth' ? 'Earth' : 'Sky'}反転` : '色反転';
  $('review-flip-label').textContent = flipLabel;
  $('review-flip').title = object ? `検討用: ${object.type === 'earth' ? 'Earth' : 'Sky'}の赤・青を反転` : 'ブロックを選択';
  $('review-status').textContent = object?.touchedBy ? '終了時に接触中 · このブロックは得点対象外' : object ? `${RoboReview.owner(object) === 'red' ? '赤' : '青'}のブロック · ${object.id}` : '配置済みブロックなし';
  const focused = document.activeElement?.id;
  $('review-towers').replaceChildren(...F.spots.map(spot => {
    const row = document.createElement('div'), name = document.createElement('span'); row.className = 'review-tower'; name.textContent = spot.label; row.append(name);
    for (let layer = 0; layer < 3; layer++) {
      const item = review.state.objects.find(o => RoboReview.editable(o) && o.spotId === spot.id && o.layer === layer);
      const cell = document.createElement(item ? 'button' : 'span');
      if (item) {
        const team = RoboReview.owner(item); cell.id = `review-block-${item.id}`; cell.dataset.objectId = item.id;
        cell.className = `block-chip ${team}`; cell.textContent = `${team === 'red' ? '赤' : '青'} ${item.type === 'earth' ? 'E' : 'S'}${layer + 1}`;
        cell.title = `${spot.label} ${layer + 1}段目 ${item.type === 'earth' ? 'Earth' : 'Sky'}を選択`;
        cell.setAttribute('aria-pressed', String(item.id === reviewObject));
        cell.onclick = () => { reviewObject = item.id; render(); };
      } else { cell.className = 'empty'; cell.textContent = '―'; }
      row.append(cell);
    }
    return row;
  }));
  if (focused?.startsWith('review-block-')) $(focused)?.focus({ preventScroll: true });
}
function cargoText(cargo, objects) {
  const counts = { earth: 0, sky: 0, mustika: 0 };
  for (const id of cargo) { const o = objects.find(o => o.id === id); if (o) counts[o.type]++; }
  return `E ${counts.earth} · S ${counts.sky}${counts.mustika ? ' · M 1' : ''}`;
}
function handoffReady(state, team) {
  const tr = state.robots.find(r => r.id === `${team}TR`), m = state.objects.find(o => o.id === 'M');
  return m.location === 'cargo' && m.holder === tr.id && tr.cargo.includes('M') && !tr.job && S.distance(tr, F.points[team].transferTR) <= .14;
}
function feedback(text, kind = '') { $('feedback').textContent = text; $('feedback').className = `feedback ${kind}`; }
function destinations() {
  const team = currentRobot().team, role = currentRobot().role;
  const list = [
    ['home', 'BR見渡し場所 L1', F.points[team].home], ['homeL2', 'BR見渡し場所 L2', F.points[team].homeL2], ['transfer', '受け渡し区画', F.points[team][role === 'TR' ? 'transferTR' : 'transferBR']],
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
  }
  rect(F.regions.l2, '#e5e9e1', '#75846f', .025);
  for (const team of ['red', 'blue']) for (const key of ['home', 'homeL2']) {
    const home = F.points[team][key], c = colors[team];
    circle(home, .23, '#ffffffcc', c); line({ x: home.x - .12, y: home.y }, { x: home.x + .12, y: home.y }, c); line({ x: home.x, y: home.y - .12 }, { x: home.x, y: home.y + .12 }, c);
    text(key === 'homeL2' ? 'L2見渡し' : 'L1見渡し', home.x, home.y + .46, small ? .17 : .14, c);
  }
  for (const s of F.spots) rect(S.box(s, .5), '#bdd5b9', '#477148');
  for (const wall of F.walls) rect(wall, '#6c7868');
  text('L1', 3.2, 7.6, .28, '#977f7c', 'center', true); text('L1', 7.8, 7.6, .28, '#788d9e', 'center', true); text('L2 / 共有', 5.5, 4.65, .23, '#60725c', 'center', true);
  text(small ? 'Earth' : 'Earth保管場所', 1, 1.12, .17, colors.red, 'center', true); text(small ? 'Earth' : 'Earth保管場所', 10, 1.12, .17, colors.blue, 'center', true);
  text('Sky / 共有', 5.5, 10.58, .18, '#5e665d'); text('Mustika', 5.5, .53, .18, '#756119');
  circle({ x: 5.5, y: 1.25 }, .135, '#aaa994', '#585d4d'); circle({ x: 5.5, y: 5.5 }, .135, '#999e8c', '#585d4d');
  for (const slot of [...F.slots('red'), ...F.slots('blue')]) { ctx.setLineDash([.04, .04]); rect(S.box(slot, .35), slot.type === 'earth' ? '#eee9dc' : '#d6e8f4', '#77876e', .01); ctx.setLineDash([]); text(slot.type === 'earth' ? 'E' : 'S', slot.x, slot.y, .15, '#647367'); }
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
  if (reviewActive) {
    const o = state.objects.find(o => o.id === reviewObject);
    if (o) { ctx.setLineDash([.06, .04]); rect(S.box(o, .65), '#00000000', '#9c7313', .04); ctx.setLineDash([]); }
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
  snapshot = reviewActive ? review.snapshot() : replayTime === null ? sim.snapshot() : sim.history.reduce((prev, frame) => frame.time <= replayTime ? frame : prev, sim.history[0]);
  const remaining = Math.max(0, 180 - snapshot.time);
  $('clock').textContent = `${Math.floor(remaining / 60)}:${(remaining % 60).toFixed(1).padStart(4, '0')}`;
  $('match-state').textContent = reviewActive ? '仮想盤面 · 検討中' : computing ? '計算中' : replayTime !== null ? 'リプレイ' : sim.ended ? '競技終了' : running ? '競技中' : sim.time ? '一時停止' : '開始前';
  $('progress').value = snapshot.time; $('elapsed').textContent = `${snapshot.time.toFixed(1)} s`; $('timeline').value = snapshot.time;
  for (const team of ['red', 'blue']) {
    const score = snapshot.scores[team]; $(`${team}-score`).textContent = score.total;
    $(`${team}-detail`).textContent = `搬送 ${score.transfer} / 配置 ${score.tower} / M ${score.mustika}`;
    const mandate = $(`${team}-mandate`), done = snapshot.sanctuary[team] !== null;
    mandate.textContent = done ? `達成済 ${snapshot.sanctuary[team].toFixed(1)} s` : '条件未達'; mandate.className = `mandate${done ? ' done' : ''}`;
    mandate.title = snapshot.sanctuaryEvidence?.[team]?.towers.map(t => t.label).join(' / ') || '完成2塔以上・うち共有1塔以上';
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
  const assessment = r.decision?.assessment, signed = n => `${n >= 0 ? '+' : ''}${n}点`;
  $('decision-assessment').hidden = !assessment;
  $('decision-reason').textContent = assessment ? `${assessment.rationale}${assessment.single ? ' / 1個運搬' : ''}${assessment.lead !== null ? ` / 観測点差 ${signed(assessment.lead)}` : ''}${assessment.skyReplyMargin !== null ? ` / Sky応答後の参考点差 ${signed(assessment.skyReplyMargin)}` : ''}` : '';
  $('robot-ground').textContent = `${({ ground: '地上', l1: 'L1', l2: 'L2', ramp: '坂', stairs: '地上階段', upperStairs: 'L2階段', transfer: '受け渡し' })[ground.type]} / ${(r.z * 1000).toFixed(0)} mm`;
  $('robot-scan').textContent = r.observation ? `${r.observation.local ? '現地 ' : r.observation.origin ? (F.surface(r.observation.origin).type === 'l2' ? 'L2 ' : 'L1 ') : ''}${r.observation.at.toFixed(1)} s (${(snapshot.time - r.observation.at).toFixed(1)}秒前)` : '未認識';
  $('br-work').hidden = r.role !== 'BR';
  const brPlan = displayedBrPlan(r.team);
  $('robot-phase').textContent = ['efficient', 'mustika-fast', 'earth-late', 'second-layer', 'score-adaptive', 'endgame', 'l2-earth'].includes(brPlan) ? RoboControllers.phase(brPlan, snapshot.time, snapshot.sanctuary[r.team] !== null, r.observation, r.team) : '個別戦略';
  $('pending-work').replaceChildren(...(r.pendingWork?.length ? r.pendingWork : [null]).map(a => {
    const li = document.createElement('li'); li.textContent = a ? `${a.spotId ? F.spotById[a.spotId].label + ' · ' : ''}${S.labels[a.type]}${a.objectId ? ' · ' + a.objectId : ''}` : 'なし'; return li;
  }));
  $('transport-data').hidden = r.role !== 'TR';
  const trips = sim.config[`${r.team}TrTrips`], tripIndex = trips.length ? S.transportTripIndex(r.transport) : r.transport.completed.length;
  const plan = RoboControllers.transportPlan(sim.config[`${r.team}TrPlan`], tripIndex, trips);
  $('robot-plan').textContent = sim.config.supplyMode === 'ideal' ? '箱は自動補給 · Mustika担当' : `${plan.custom ? '指定' : ''}${tripIndex + 1}便目 · ${r.cargo.includes('M') ? 'M1 (別枠)' : plan.label}`;
  $('robot-deliveries').textContent = r.transport.completed.map(d => `${d.number}便目 ${cargoText(d.items.map(o => o.id), snapshot.objects)}`).join(' / ') || 'なし';
  if (r.failure) feedback(`${r.failure.reason} [${r.failure.rule}]`, r.failure.kind === 'rule' ? 'error' : 'warn');
  const direct = r.role === 'BR' && handoffReady(snapshot, r.team);
  const relevant = snapshot.objects.filter(o => r.role === 'TR' ? (o.location === 'source' && (!o.team || o.team === r.team)) || r.cargo.includes(o.id) : (o.location === 'transfer' && o.transferTeam === r.team) || r.cargo.includes(o.id) || direct && o.id === 'M');
  const key = relevant.map(o => `${o.id}:${o.location}:${o.holder}:${o.layer}`).join() + direct;
  if (key !== objectKey) {
    const old = $('object-select').value; $('object-select').replaceChildren(...relevant.map(o => new Option(`${o.id} · ${o.type === 'earth' ? 'Earth' : o.type === 'sky' ? 'Sky' : 'Mustika'} · ${direct && o.id === 'M' ? 'TR保持・直接受渡' : o.location === 'cargo' ? '手持ち' : o.location === 'transfer' ? '受渡' : '供給元'}${o.layer != null && o.location !== 'cargo' ? ` ${o.layer + 1}段` : ''}`, o.id)));
    if (!relevant.length) $('object-select').add(new Option('対象物なし', ''));
    if (relevant.some(o => o.id === old)) $('object-select').value = old; objectKey = key;
  }
  $('transfer-state').innerHTML = ['red', 'blue'].map(team => {
    const stock = snapshot.objects.filter(o => o.location === 'transfer' && o.transferTeam === team);
    return `<div class="stock-row"><strong style="color:${colors[team]}">${team === 'red' ? '赤' : '青'} ${stock.length} / ${F.stockLimits.earth + F.stockLimits.sky}個</strong><div>Earth専用 ${stock.filter(o => o.type === 'earth').length}/${F.stockLimits.earth} · Sky専用 ${stock.filter(o => o.type === 'sky').length}/${F.stockLimits.sky}</div><small>${stock.map(o => `${o.id} (${o.type === 'earth' ? 'Earth' : 'Sky'}列 ${o.layer + 1}段)`).join('、') || '空き'}</small>${handoffReady(snapshot, team) ? '<small>Mustika: TR保持・直接受渡待ち</small>' : ''}</div>`;
  }).join('');
  $('sanctuary-state').replaceChildren(...['red', 'blue'].map(team => {
    const row = document.createElement('div'); row.className = 'stock-row';
    const evidence = snapshot.sanctuaryEvidence?.[team];
    row.textContent = `${team === 'red' ? '赤' : '青'}: ${evidence ? `${evidence.at.toFixed(2)}秒に ${evidence.towers.map(t => t.label).join('・')} で達成済` : snapshot.sanctuary[team] !== null ? '達成済（旧記録・根拠未保存）' : '未達成'}`;
    return row;
  }));
  $('tower-state').innerHTML = F.spots.map(s => {
    const t = snapshot.objects.filter(o => o.location === 'spot' && o.spotId === s.id).sort((a, b) => a.layer - b.layer);
    return `<div class="tower-row"><span>${s.label}</span>${[0, 1, 2].map(i => { const o = t[i], team = o && (o.type === 'sky' ? o.color : o.placedBy); return `<span class="block-chip ${team || ''}">${o ? `${team === 'red' ? '赤' : '青'}${o.type === 'earth' ? 'E' : 'S'}` : '―'}</span>`; }).join('')}</div>`;
  }).join('');
  const m = snapshot.objects.find(o => o.id === 'M');
  $('source-state').innerHTML = `<div class="stock-row">赤Earth ${snapshot.objects.filter(o => o.location === 'source' && o.type === 'earth' && o.team === 'red').length} / 青Earth ${snapshot.objects.filter(o => o.location === 'source' && o.type === 'earth' && o.team === 'blue').length}<br>共有Sky ${snapshot.objects.filter(o => o.location === 'source' && o.type === 'sky').length}<br>Mustika: ${m.location === 'cargo' ? `${m.holder.replace('red', '赤 ').replace('blue', '青 ')}が保持` : ({ source: '初期柱・未取得', transfer: '受け渡し区画', pillar: '中央柱' })[m.location]}</div>`;
  if (lastLog !== sim.events.length || replayTime !== null) {
    const events = sim.events.filter(e => e.time <= snapshot.time && (!$('errors-only').checked || !['action', 'setup', 'milestone'].includes(e.kind))).slice(-120).reverse();
    $('event-log').replaceChildren(...events.map(e => { const li = document.createElement('li'), time = document.createElement('time'), span = document.createElement('span'); time.textContent = `${e.time.toFixed(1)}s`; span.textContent = `${e.robot ? e.robot.replace('red', '赤 ').replace('blue', '青 ') + ' · ' : ''}${e.text}${e.rule ? ` [${e.rule}]` : ''}`; if (e.rule) span.className = 'rule'; li.append(time, span); return li; })); lastLog = sim.events.length;
  }
  const blocked = computing || replayTime !== null || sim.ended;
  document.querySelectorAll('.command-grid button,.command-row button').forEach(b => b.disabled = blocked);
  $('finish').disabled = computing || sim.ended; $('step').disabled = computing || sim.ended || replayTime !== null; $('reset').disabled = computing; $('apply-settings').disabled = computing;
  $('auto').disabled = $('stop-robot').disabled = $('approach-object').disabled = computing || replayTime !== null || sim.ended;
  const playIcon = running || playback ? 'pause' : 'play';
  if (playIcon !== lastPlayIcon) { $('play').innerHTML = `<i data-lucide="${playIcon}"></i>`; lastPlayIcon = playIcon; icons(); }
  draw(snapshot);
  $('run-summary').textContent = reviewActive ? '仮想盤面 · 元の試合結果は保持' : sim.ended ? `${sim.events.length}件の記録 · 試合終了` : replayTime !== null ? '記録済み軌跡' : '基本動作モード';
  renderStrategyState();
  renderReview();
}
function reset(config = sim.config, { preserveStrategyDraft = false } = {}) { generation++; RoboScorePlanner.clearCache(); sim.graphs.clear(); sim = new S.Simulation(config); review = null; reviewActive = false; reviewObject = null; if (!$('tab-review').hidden) selectTab('operate'); running = false; computing = false; replayTime = null; playback = false; accumulator = 0; lastLog = -1; objectKey = ''; paintAt = 0; if (!preserveStrategyDraft) syncStrategyMenus(); feedback('初期配置に戻しました · 計算キャッシュを更新'); render(); }
$('play').onclick = () => {
  if (computing) return;
  if (reviewActive) exitReview();
  if (sim.ended && replayTime === null) replayTime = 0;
  if (replayTime !== null) { playback = !playback; running = false; } else running = !running;
  render();
};
$('step').onclick = () => { running = false; for (let i = 0; i < 10; i++) sim.step(.05, RoboControllers); render(); };
$('reset').onclick = () => reset();
$('finish').onclick = () => {
  running = false; computing = true; replayTime = null; render();
  const run = generation;
  function chunk() { if (run !== generation) return; const stop = performance.now() + 60; while (!sim.ended && performance.now() < stop) sim.step(.05, RoboControllers); render(); if (!sim.ended) requestAnimationFrame(chunk); else { computing = false; render(); } }
  requestAnimationFrame(chunk);
};
$('timeline').oninput = () => { const value = Number($('timeline').value); if (reviewActive) exitReview(); running = false; playback = false; const t = Math.min(value, sim.time); replayTime = t >= sim.time - .01 ? null : t; lastLog = -1; render(); };
$('review-toggle').onclick = () => reviewActive ? exitReview() : startReview();
$('review-exit').onclick = exitReview;
for (const color of ['red', 'blue']) $(`review-${color}`).onclick = () => { if (reviewActive && reviewObject) { review.setColor(reviewObject, color); render(); } };
$('review-flip').onclick = () => { if (reviewActive && reviewObject) { review.flip(reviewObject); render(); } };
for (const action of ['undo', 'redo', 'reset']) $(`review-${action}`).onclick = () => { if (reviewActive) { review[action](); render(); } };
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
  config.supplyMode = $('supply-mode').value;
  for (const team of ['red', 'blue']) { config[`${team}BrTurns`] = [...strategyTurns[team]]; config[`${team}TrTrips`] = transportTrips[team].map(slots => [...slots]); }
  reset(config);
};
$('supply-mode').onchange = () => { renderStrategyPreviews(); renderStrategyState(); };
$('revert-strategies').onclick = () => { syncStrategyMenus(); renderStrategyState(); };
$('destination').onchange = () => { clickedPoint = null; if (F.spotById[$('destination').value]) selectedSpot = $('destination').value; render(); };
$('move').onclick = () => send({ type: 'move', target: clickedPoint || targetList.find(([id]) => id === $('destination').value)[2], label: '指定位置へ移動' });
$('scan').onclick = () => send({ type: 'scan', ...(currentRobot().localRescanAllowed ? { local: true } : {}) });
$('approach-object').onclick = () => {
  const o = sim.object($('object-select').value), r = currentRobot();
  if (!o || o.location === 'cargo' && !(r.role === 'BR' && o.id === 'M' && sim.mustikaOffer(r.team))) { feedback('供給元・受け渡し在庫・TR保持中のMustikaを選んでください', 'warn'); return; }
  send({ type: 'move', target: o.location === 'source' ? RoboControllers.sourceApproach(o, r.team) : F.points[r.team][r.role === 'BR' ? 'transferBR' : 'transferTR'], label: `${o.id}へ移動` });
};
for (const type of ['pickup', 'receive', 'return', 'place', 'flip', 'unload', 'enshrine', 'recover']) $(type).onclick = () => send({ type, objectId: $('object-select').value, spotId: selectedSpot });
$('retry').onclick = () => send({ type: 'retry', level: currentRobot().role === 'BR' && currentRobot().enteredL1 ? 1 : 0 });
$('show-path').onchange = $('show-body').onchange = () => draw(snapshot);
$('errors-only').onchange = () => { lastLog = -1; render(); };
$('apply-settings').onclick = () => {
  const fields = { redSpeed: 'red-speed', blueSpeed: 'blue-speed', maxSpeed: 'max-speed', acceleration: 'acceleration', scanSeconds: 'scan-seconds', rampFactor: 'ramp-factor', stairSpeed: 'stair-speed', stairPause: 'stair-pause' }, config = { ...sim.config };
  for (const [key, id] of Object.entries(fields)) { const input = $(id); if (!input.checkValidity() || !Number.isFinite(Number(input.value))) { input.reportValidity(); return; } config[key] = Number(input.value); }
  reset(config, { preserveStrategyDraft: true });
};
function downloadJson(value, prefix) { const data = new Blob([JSON.stringify(value)], { type: 'application/json' }), url = URL.createObjectURL(data), a = document.createElement('a'); a.href = url; a.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('download').onclick = () => downloadJson(sim.export(), 'ABU2027-field');
$('review-download').onclick = () => { if (reviewActive) downloadJson(review.export(), 'ABU2027-review'); };
canvas.addEventListener('pointerdown', e => {
  const bounds = canvas.getBoundingClientRect(), p = { x: ((e.clientX - bounds.left) / bounds.width - .035) * 11 / .93, y: ((e.clientY - bounds.top) / bounds.height - .035) * 11 / .93 };
  if (reviewActive) {
    const spot = F.spots.find(s => S.distance(s, p) < .5);
    if (spot) {
      const tower = snapshot.objects.filter(o => RoboReview.editable(o) && o.spotId === spot.id).sort((a, b) => b.layer - a.layer);
      reviewObject = tower[0]?.id || null; selectTab('review');
      $('review-selection').scrollIntoView({ block: 'nearest' });
    }
    return;
  }
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
  if (playback && replayTime !== null) { replayTime += dt * Number($('rate').value); if (replayTime >= sim.time) { replayTime = null; playback = false; } if (now - paintAt >= 50 || !playback) { render(); paintAt = now; } }
  else if (running && !computing && !sim.ended) { accumulator += dt * Number($('rate').value); const stop = performance.now() + 30; while (accumulator >= .05 && performance.now() < stop) { sim.step(.05, RoboControllers); accumulator -= .05; } if (sim.ended) running = false; if (now - paintAt >= 50 || sim.ended) { render(); paintAt = now; } }
  requestAnimationFrame(tick);
}
window.fieldApp = { get sim() { return sim; }, reset, render, selectRobot: chooseRobot };
initStrategyMenus(); zoomBy(0); icons(); render(); requestAnimationFrame(tick);
