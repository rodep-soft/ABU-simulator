/* global RoboActionPlan, RoboSim */
(function (root) {
  'use strict';
  const P = root.RoboActionPlan, $ = id => document.getElementById(id);
  const robotName = id => id.replace('red', '赤 ').replace('blue', '青 ');
  function create(hooks) {
    let programs = {}, timing = {}, robotId = 'redBR', historyKey = '';
    const message = value => { $('program-message').textContent = value; };
    const plan = () => programs[robotId];
    function icon(name, title, callback) {
      const b = document.createElement('button'); b.className = 'icon'; b.title = title; b.setAttribute('aria-label', title); b.innerHTML = `<i data-lucide="${name}"></i>`; b.onclick = callback; return b;
    }
    function select(options, value, change, title) {
      const s = document.createElement('select'); s.setAttribute('aria-label', title);
      s.replaceChildren(...options.map(([id, name]) => new Option(name, id))); s.value = value; s.onchange = () => change(s.value); return s;
    }
    function field(text, input) { const l = document.createElement('label'); l.textContent = text; l.append(input); return l; }
    function input(value, change, title, min, max, step = .05) {
      const i = document.createElement('input'); i.type = 'number'; i.value = value ?? ''; i.min = min; i.max = max; i.step = step;
      i.setAttribute('aria-label', title); i.onchange = () => change(i.value === '' ? undefined : Number(i.value)); return i;
    }
    function rows() {
      $('program-rows').replaceChildren(...plan().steps.map((a, index) => {
        const row = document.createElement('div'); row.className = 'action-row'; row.dataset.index = index;
        const heading = document.createElement('div'); heading.className = 'turn-heading';
        const title = document.createElement('strong'); title.textContent = `${index + 1}手目`; heading.append(title);
        const controls = document.createElement('div'); controls.className = 'action-row-controls';
        for (const [name, label, action] of [['arrow-up', '前へ', 'up'], ['arrow-down', '後へ', 'down'], ['copy', '複製', 'copy'], ['trash-2', '削除', 'remove']]) {
          const b = icon(name, `${index + 1}手目を${label}`, () => {
            const list = plan().steps;
            if (action === 'remove') list.splice(index, 1);
            else if (action === 'copy') list.splice(index + 1, 0, P.copy(a));
            else { const j = index + (action === 'up' ? -1 : 1); [list[index], list[j]] = [list[j], list[index]]; }
            rows(); message('変更あり · 未適用');
          });
          b.disabled = action === 'up' && index === 0 || action === 'down' && index === plan().steps.length - 1;
          controls.append(b);
        }
        heading.append(controls); row.append(heading);
        const type = select(P.roles[robotId.slice(-2)].map(t => [t, P.names[t]]), a.type, value => {
          plan().steps[index] = { type: value, destination: 'standby', objectType: 'earth', spotId: robotId.startsWith('red') ? 'r2' : 'b2', ...(value === 'wait' ? { seconds: 1 } : {}) };
          rows(); message('変更あり · 未適用');
        }, `${index + 1}手目の動作`); type.dataset.field = 'type'; row.append(field('動作', type));
        if (a.type === 'move') {
          const dest = select(P.destinations(robotId).map(([key, text]) => [key, text]), a.destination || 'standby', value => { a.destination = value; a.target ||= { x: 3.7, y: 6.8 }; rows(); }, '手順の移動先'); dest.dataset.field = 'destination'; row.append(field('移動先', dest));
          if (a.destination === 'coordinates') {
            const pair = document.createElement('div'); pair.className = 'action-pair'; a.target ||= { x: 3.7, y: 6.8 };
            for (const axis of ['x', 'y']) pair.append(field(`${axis} (m)`, input(a.target[axis], v => { a.target[axis] = v; }, axis, 0, 11)));
            row.append(pair);
          }
        }
        if (['pickup', 'receive', 'place', 'unload', 'return'].includes(a.type)) {
          const choices = [['earth', 'Earth · 自動選択'], ['sky', 'Sky · 自動選択'], ['mustika', 'Mustika'],
            ...hooks.getSim().objects.map(o => ['id:' + o.id, `${o.id} · ${o.type}`])];
          const object = select(choices, a.objectId ? 'id:' + a.objectId : a.objectType || 'earth', v => {
            if (v.startsWith('id:')) { a.objectId = v.slice(3); a.objectType = hooks.getSim().object(a.objectId).type; }
            else { a.objectType = v; delete a.objectId; }
          }, '手順の対象物'); object.dataset.field = 'object'; row.append(field('対象', object));
        }
        if (['place', 'flip', 'recover'].includes(a.type)) {
          const dest = select(P.destinations(robotId).filter(([key]) => key.startsWith('spot:')).map(([key, name]) => [key.slice(5), name]), a.spotId, v => { a.spotId = v; }, '手順の配置先'); dest.dataset.field = 'spot'; row.append(field('配置先', dest));
        }
        if (a.type === 'wait') row.append(field('待機 (秒)', input(a.seconds ?? 1, v => { a.seconds = v; }, '待機秒数', .05, 180)));
        else if (P.workTypes.includes(a.type)) {
          const seconds = input(a.seconds, v => { if (v === undefined) delete a.seconds; else a.seconds = v; }, 'この手の作業秒数', .05, 60);
          seconds.dataset.field = 'seconds'; seconds.placeholder = 'ロボット設定'; row.append(field('この手の作業 (秒)', seconds));
        }
        return row;
      }));
      hooks.icons();
    }
    function timingFields() {
      const motion = P.effectiveMotion({ ...hooks.getSim().config, robotTiming: {} }, robotId), limits = { maxSpeed: ['最高速 m/s', .05, 15], acceleration: ['加速度 m/s²', .05, 15], rampFactor: ['坂の速度係数', .05, 1], stairSpeed: ['階段 m/s', .05, 15], stairPause: ['段ごと停止 秒', 0, 10] };
      const keys = [...P.motionKeys, ...P.workTypes.filter(k => P.roles[robotId.slice(-2)].includes(k))];
      $('robot-timing-fields').replaceChildren(...keys.map(key => {
        const [title, min, max] = limits[key] || [P.names[key] + ' 秒', .05, 60];
        const i = input(timing[robotId][key], v => { if (v === undefined) delete timing[robotId][key]; else timing[robotId][key] = v; message('変更あり · 未適用'); }, title, min, max);
        i.dataset.timing = key; i.placeholder = String(limits[key] ? motion[key] : P.duration(motion, key));
        return field(title, i);
      }));
    }
    function editor() { $('program-enabled').checked = plan().enabled; $('program-end').value = plan().end; rows(); timingFields(); }
    function sync() {
      const s = hooks.getSim();
      programs = Object.fromEntries(P.ids.map(id => [id, P.copy(s.config.robotPrograms?.[id] || { enabled: false, end: 'wait', steps: [] })]));
      timing = Object.fromEntries(P.ids.map(id => [id, P.copy(s.config.robotTiming?.[id] || {})])); editor(); historyKey = ''; message('適用済み');
    }
    $('program-robot').replaceChildren(...P.ids.map(id => new Option(robotName(id), id))); $('program-robot').value = robotId;
    $('program-robot').onchange = () => { robotId = $('program-robot').value; hooks.chooseRobot(robotId); editor(); historyKey = ''; };
    $('program-enabled').onchange = () => { plan().enabled = $('program-enabled').checked; message('変更あり · 未適用'); };
    $('program-end').onchange = () => { plan().end = $('program-end').value; message('変更あり · 未適用'); };
    $('program-add').onclick = () => { plan().steps.push({ type: 'wait', seconds: 1 }); plan().enabled = true; $('program-enabled').checked = true; rows(); message('変更あり · 未適用'); };
    $('program-template').onclick = () => { plan().steps.push(...P.template(robotId)); plan().enabled = true; editor(); message('変更あり · 未適用'); };
    function validated() { return { programs: P.normalizePrograms(programs), timing: P.normalizeTiming(timing) }; }
    $('program-apply').onclick = () => {
      try { const v = validated(); hooks.reset({ ...hooks.getSim().config, robotPrograms: v.programs, robotTiming: v.timing }); message('初期化して適用しました'); }
      catch (e) { message(e.message); }
    };
    $('program-update').onclick = () => {
      try { const v = validated(); hooks.getSim().setRobotProgram(robotId, v.programs[robotId], v.timing[robotId]); root.RoboScorePlanner.clearCache(); hooks.render(); rows(); message('未実行の手順を更新しました'); }
      catch (e) { message(e.message); }
    };
    $('program-retry').onclick = () => { const r = hooks.getSim().robot(robotId); if (r.program?.error && !r.job) { delete r.program.error; r.failure = null; r.wait = 0; hooks.render(); message('同じ手順から再開します'); } };
    $('program-skip').onclick = () => {
      const s = hooks.getSim(), r = s.robot(robotId);
      if (r.job || r.queue.length || s.ended) return;
      r.program = { index: Math.min(plan().steps.length, (r.program?.index || 0) + 1) }; r.failure = null; r.wait = 0;
      s.log(r, 'program-skip', '手順を明示スキップ', 'setup'); rows(); hooks.render();
    };
    $('program-export').onclick = () => { try { const v = validated(); hooks.download({ format: 'robocon-action-plans-v1', ...v }, 'ABU2027-plans'); } catch (e) { message(e.message); } };
    $('program-import').onclick = () => $('program-file').click();
    $('program-file').onchange = async () => {
      try {
        const file = $('program-file').files[0]; if (!file) return;
        if (file.size > 1024 * 1024) throw new Error('手順ファイルは1MB以下です');
        const value = JSON.parse(await file.text()); if (value.format !== 'robocon-action-plans-v1') throw new Error('手順ファイルの形式が違います');
        const p = P.normalizePrograms(value.programs), t = P.normalizeTiming(value.timing);
        programs = Object.fromEntries(P.ids.map(id => [id, p[id] || { enabled: false, end: 'wait', steps: [] }]));
        timing = Object.fromEntries(P.ids.map(id => [id, t[id] || {}])); editor(); message('読み込み済み · 未適用');
      } catch (e) { message(e.message); } finally { $('program-file').value = ''; }
    };
    function render(snapshot, state) {
      const sim = hooks.getSim(), r = sim.robot(robotId), index = r.program?.index || 0;
      $('program-progress').textContent = r.program?.error ? `${index + 1}手目で停止 · ${r.program.error.reason}` : sim.config.robotPrograms?.[robotId]?.enabled ? `${index} / ${sim.config.robotPrograms[robotId].steps.length}手完了 · ${r.status}` : '通常戦略';
      $('program-apply').disabled = state.computing || state.running;
      $('program-update').disabled = state.computing || state.running || state.replayTime !== null || sim.ended || !!r.job || !!r.queue.length || !!r.retryPending || !!r.trRestartPending;
      $('program-retry').disabled = !r.program?.error || state.running || state.computing;
      $('program-skip').disabled = !sim.config.robotPrograms?.[robotId]?.enabled || state.running || state.computing || !!r.job || !!r.queue.length || sim.ended || index >= (sim.config.robotPrograms[robotId]?.steps.length || 0);
      document.querySelectorAll('.action-row').forEach((row, i) => { row.classList.toggle('done', i < index); row.classList.toggle('current', i === index); row.querySelector('.turn-heading strong').textContent = `${i + 1}手目${i < index ? ' · 完了' : ''}`; });
      const actor = snapshot.robots.find(r => r.id === robotId), job = actor?.job;
      $('action-current').textContent = job ? `${P.names[job.type] || job.type} · 経過 ${Math.max(0, snapshot.time - (job.startedAt ?? snapshot.time)).toFixed(2)}秒${job.remaining !== undefined ? ' / 残り ' + job.remaining.toFixed(2) + '秒' : ''}` : actor?.status || '待機';
      const history = sim.events.filter(e => e.kind === 'timing' && e.time <= snapshot.time).slice(-24).reverse();
      const key = JSON.stringify(history.map(e => [e.time, e.robot, e.action, e.duration]));
      if (key !== historyKey) {
        $('action-history').replaceChildren(...history.map(e => {
          const row = document.createElement('tr');
          for (const value of [e.time.toFixed(2), robotName(e.robot), P.names[e.action] || e.action, e.duration.toFixed(2)]) { const c = document.createElement('td'); c.textContent = value; row.append(c); }
          return row;
        })); historyKey = key;
      }
    }
    sync(); return { sync, render };
  }
  root.RoboSequenceUI = { create };
})(globalThis);
