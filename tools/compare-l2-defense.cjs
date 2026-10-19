// Six bounded matches: identical opening, different post-enshrinement controllers.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const F = require('../sim/field.js');
const S = require('../sim/engine.js');
const C = require('../sim/controllers.js');
const P = require('../sim/score-planner.js');
const Policy = require('../sim/l2-sky-defense.js');
const root = path.resolve(__dirname, '..');
const options = { out: 'results/l2-defense-' + Date.now(), speeds: '1,0.75,0.5' };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (!Object.hasOwn(options, key) || !process.argv[i + 1]) throw new Error('Use --out PATH --speeds 1,0.75,0.5');
  options[key] = process.argv[i + 1];
}
options.speeds = [...new Set(options.speeds.split(',').map(Number))];
if (options.speeds.some(s => ![1, .75, .5].includes(s))) throw new Error('Unsupported speed');
const output = path.resolve(root, options.out);
if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Choose a fresh output directory; old results are never overwritten.');
fs.mkdirSync(output, { recursive: true });
const hash = text => createHash('sha256').update(text).digest('hex');
const hashes = Object.fromEntries(fs.readdirSync(path.join(root, 'sim')).filter(n => n.endsWith('.js')).sort()
  .map(n => ['sim/' + n, hash(fs.readFileSync(path.join(root, 'sim', n)))]));
hashes['tools/compare-l2-defense.cjs'] = hash(fs.readFileSync(__filename));
const rows = [], pairs = [], started = performance.now();
const first = (events, action, robot, predicate = () => true) => events.find(e => e.kind === 'action' && e.action === action && e.robot === robot && predicate(e))?.time ?? null;
const l2Ids = F.spots.filter(s => s.level === 2).map(s => s.id);
const number = id => F.spotNumbers[id];
const filename = (id, speed) => id + '-speed-' + speed;
for (const redSpeed of options.speeds) {
  let control;
  for (const redBrPlan of [Policy.OPENING, Policy.ID]) {
    P.clearCache(); const begin = performance.now();
    const config = { supplyMode: 'ideal', brObservationMode: 'stopped', scanSeconds: 1, maxSpeed: 7, acceleration: 3.5,
      redSpeed, blueSpeed: 1, redTrPlan: 'adaptive', blueTrPlan: 'adaptive', redBrPlan, blueBrPlan: 'tactical-baseline-v2', recordActions: true };
    const sim = new S.Simulation(config);
    while (!sim.ended) {
      sim.step(.05, C);
      for (const r of sim.robots) assert.ok(S.blockCount(r.cargo, id => sim.object(id)) <= (r.role === 'BR' ? 2 : 3));
    }
    assert.equal(sim.time, 180);
    const scores = sim.scores(), events = sim.events, enshrine = first(events, 'enshrine', 'redBR');
    // Common Mustika handling labels decisions with the selected policy ID.
    // Normalize only that descriptive name, never times, actions, objects or predictions.
    const prefix = events.filter(e => e.time <= (enshrine ?? 180)).map(e =>
      e.robot === 'redBR' && [Policy.ID, Policy.OPENING].includes(e.decision?.strategy)
        ? { ...e, decision: { ...e.decision, strategy: Policy.OPENING } } : e);
    const defense = events.filter(e => e.robot === 'redBR' && e.decision?.l2Defense);
    assert.ok(defense.every(e => enshrine !== null && e.time >= enshrine));
    const row = { strategy: redBrPlan, label: redBrPlan === Policy.ID ? '奉納後L2防衛' : '後半V2（現行）', redSpeed, blueSpeed: 1,
      red: scores.red.total, blue: scores.blue.total, difference: scores.red.total - scores.blue.total, scores,
      sanctuary: sim.sanctuary, pickup: first(events, 'pickup', 'redTR', e => e.objectId === 'M'), enshrine,
      activatedAt: defense[0]?.time ?? null,
      l2Final: l2Ids.map(id => ({ number: number(id), id, layers: sim.tower(id).map(o => ({ type: o.type, team: o.placedBy, color: o.color, touchedBy: o.touchedBy })) })),
      lateActions: events.filter(e => e.time >= 140 && e.kind === 'action' && ['flip', 'place', 'return', 'retry'].includes(e.action))
        .map(e => ({ time: e.time, robot: e.robot, action: e.action, spot: e.spotId ? number(e.spotId) : null, objectType: e.objectType })),
      phases: defense.map(e => ({ time: e.time, ...e.decision.l2Defense, tasks: e.decision.tasks })),
      retries: events.filter(e => e.kind === 'recovery'),
      rejections: events.filter(e => ['rule', 'perception', 'physical', 'unsupported', 'unscored', 'policy'].includes(e.kind)),
      prefixHash: hash(JSON.stringify(prefix)), elapsedMs: +(performance.now() - begin).toFixed(2) };
    if (redBrPlan === Policy.OPENING) control = { row, prefix };
    else {
      assert.equal(enshrine, control.row.enshrine, 'Enshrinement time must match');
      assert.deepEqual(prefix, control.prefix, 'Pre-enshrinement events must match after policy label normalization');
      assert.deepEqual(row.sanctuary.red, control.row.sanctuary.red);
      pairs.push({ redSpeed, openingIdentical: true, prefixHash: row.prefixHash,
        controlDifference: control.row.difference, defenseDifference: row.difference,
        differenceImprovement: row.difference - control.row.difference, enshrine });
    }
    const stem = filename(redBrPlan, redSpeed);
    fs.writeFileSync(path.join(output, stem + '.json.gz'), zlib.gzipSync(JSON.stringify({ result: row, match: sim.export() })));
    fs.writeFileSync(path.join(output, stem + '-tactics.json'), JSON.stringify({ config, result: row,
      actions: events.filter(e => e.kind === 'action' && ['receive', 'place', 'flip', 'return', 'enshrine'].includes(e.action)),
      decisions: events.filter(e => e.decision?.l2Defense) }, null, 2));
    rows.push(row); console.log(JSON.stringify({ strategy: redBrPlan, redSpeed, red: row.red, blue: row.blue, difference: row.difference, enshrine, activatedAt: row.activatedAt, elapsedMs: row.elapsedMs }));
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ options, timeStep: .05, hashes, elapsedMs: performance.now() - started, rows, pairs }, null, 2));
  }
}
const signed = x => (x > 0 ? '+' : '') + x;
const lines = ['# 短時間待機固定・奉納後L2 Sky防衛の比較', '',
  '## 条件', '',
  '- 赤は短時間待機→後半V2と、短時間待機→自チーム奉納後L2防衛。青はV2・等速固定。各速度各案1試合、計6試合。決定論的事例であり統計的勝率・全探索ではない。',
  '- 180秒・0.05秒刻み、有限理想供給、停止時全盤面観測1秒、Mustika取得通知OFF。最大7m/s・加速度3.5m/s²に赤倍率1・0.75・0.5を同時適用。GUIと同じengine/controllers。',
  '- 初動は赤②（青側で使う場合は⑥）をE2→S1で完成し、E1+S1で共有①を狙う上限5秒待機案。各組で自チーム奉納完了まで全4台のイベントが一致することをassertした（赤BRのdecision.strategyという表示用戦略名のみ正規化。時刻・行動・物体・予測値は変更しない）。',
  '- 新案は自チーム奉納を観測した後だけ切替。L2⑦⑧⑨⑩のSky取得（反転/新規配置）をL2 Earthより優先。V2の点差・所要時間・再反転リスク評価と共通plannerを使用。得点式・合法性・地形・物理は変更していない。',
  '- 防衛は通路封鎖ではなく、自色L2 Skyがあり150秒以降/観測相手がL2接近/全4塔確保ならL2で有料再観測して再奪取。先に有用な手持ちL2作業を行う。2箱が使えなければ1個返却して反転枠を空ける。時間内にL2仕事がなければV2へフォールバック。',
  '- 到着先の作業は新しい観測で合法性を再確認して完了。相手の位置評価が変わるだけで置き先を延々選び直さない。相手が埋めた・容量不足・時間不足なら再計画。',
  '- 既定のBR移動停止5秒Retry、TR相互衝突1秒救済を維持。停止全盤面認識は理想化。相手内部意図・将来到着・観測外更新は参照しない。', '',
  '## 得点', '', '| 赤速度 | 現行 赤:青 | 現行点差 | L2防衛 赤:青 | 防衛点差 | 点差改善 | 奉納秒 | 初動一致 |',
  '|---|---:|---:|---:|---:|---:|---:|---|',
  ...pairs.map(p => { const a = rows.find(r => r.redSpeed === p.redSpeed && r.strategy === Policy.OPENING), b = rows.find(r => r.redSpeed === p.redSpeed && r.strategy === Policy.ID);
    return `| ${p.redSpeed} | ${a.red}:${a.blue} | ${signed(a.difference)} | ${b.red}:${b.blue} | ${signed(b.difference)} | ${signed(p.differenceImprovement)} | ${p.enshrine} | 完全一致 |`; }), '',
  '## 終盤ログ', '',
  ...rows.flatMap(r => [`### ${r.redSpeed}倍・${r.label}`, '',
    '終了時L2: ' + r.l2Final.map(t => `${t.number}番 ${t.layers.map(o => o.type === 'sky' ? 'S(' + o.color + (o.touchedBy ? ',接触中' : '') + ')' : 'E(' + o.team + ')').join('/') || '空'}`).join(' / '), '',
    ...r.lateActions.map(e => `- ${e.time.toFixed(2)}秒 ${e.robot} ${e.action} ${e.spot ? e.spot + '番' : ''} ${e.objectType || ''}`), '',
    `Retry/救済 ${r.retries.length}記録、拒否 ${r.rejections.length}記録。未完了の作業は得点に含めない。`, '']),
  '## 保存物と再実行', '',
  '- summary.json: 条件、全sim/*.jsと実行ツールのSHA256、各結果、初動完全一致ハッシュ、終盤行動、最終L2。',
  '- 各*.json.gz: 完全な試合export（設定・イベント・軌跡・最終状態）。各*-tactics.json: 読める条件/行動/新案の判断。',
  '- `node tools/compare-l2-defense.cjs --out results/l2-defense-next` （計6試合、上書き不可）',
  '- `node tools/compare-l2-defense.cjs --out results/l2-defense-one --speeds 0.75` （3/4の両案2試合）',
  '- GUI: field-simulator.htmlを開き、戦略欄の赤BRで「短時間待機→奉納後L2 Sky防衛」を選択して適用。理想供給/青V2/stopped/1秒を維持。', '',
  '## 制限', '',
  '両色交換、別の相手、通常TR供給、待機位置・時刻の最適化は未実施。既存V2の相手応答評価は仮説であり意図の予測ではない。L2優先は勝利保証ではなく、L1の機会損失や接触・Retryも結果に影響する。'];
fs.writeFileSync(path.join(output, 'REPORT.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ output, matches: rows.length, pairs, elapsedMs: performance.now() - started }));
