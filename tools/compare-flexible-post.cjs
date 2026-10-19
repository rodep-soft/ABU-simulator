// Bounded nine-match study. No physics, observations or simulation steps are skipped.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const F = require('../sim/field.js'), S = require('../sim/engine.js'), C = require('../sim/controllers.js');
const P = require('../sim/score-planner.js'), Flex = require('../sim/flexible-post.js'), Defense = require('../sim/l2-sky-defense.js');
const root = path.resolve(__dirname, '..');
const options = { out: 'results/flexible-post-' + Date.now(), speeds: '1,0.75,0.5' };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (!Object.hasOwn(options, key) || !process.argv[i + 1]) throw new Error('Use --out PATH --speeds 1,0.75,0.5');
  options[key] = process.argv[i + 1];
}
options.speeds = [...new Set(options.speeds.split(',').map(Number))];
if (options.speeds.some(n => ![1, .75, .5].includes(n))) throw new Error('Unsupported speed');
const output = path.resolve(root, options.out);
if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Use a new output directory; historical results are never overwritten.');
fs.mkdirSync(output, { recursive: true });
const hash = x => createHash('sha256').update(x).digest('hex');
const hashes = Object.fromEntries(fs.readdirSync(path.join(root, 'sim')).filter(n => n.endsWith('.js')).sort()
  .map(n => ['sim/' + n, hash(fs.readFileSync(path.join(root, 'sim', n)))]));
hashes['tools/compare-flexible-post.cjs'] = hash(fs.readFileSync(__filename));
const rows = [], pairs = [], started = performance.now(), ids = [Flex.OPENING, Defense.ID, Flex.ID];
const label = id => id === Flex.ID ? '全エリア・点差対応' : id === Defense.ID ? 'L2防衛' : '後半V2';
const first = (events, action, robot, pred = () => true) => events.find(e => e.kind === 'action' && e.action === action && e.robot === robot && pred(e))?.time ?? null;
const shortEvent = e => ({ time: e.time, robot: e.robot, action: e.action, number: e.spotId ? F.spotNumbers[e.spotId] : null, objectType: e.objectType });
for (const redSpeed of options.speeds) {
  let control;
  for (const redBrPlan of ids) {
    P.clearCache(); const begin = performance.now();
    const config = { supplyMode: 'ideal', brObservationMode: 'stopped', scanSeconds: 1, maxSpeed: 7, acceleration: 3.5,
      redSpeed, blueSpeed: 1, redTrPlan: 'adaptive', blueTrPlan: 'adaptive', redBrPlan, blueBrPlan: 'tactical-baseline-v2', recordActions: true };
    const sim = new S.Simulation(config);
    while (!sim.ended) {
      sim.step(.05, C);
      for (const r of sim.robots) assert.ok(S.blockCount(r.cargo, id => sim.object(id)) <= (r.role === 'BR' ? 2 : 3));
    }
    assert.equal(sim.time, 180);
    const events = sim.events, scores = sim.scores(), enshrine = first(events, 'enshrine', 'redBR');
    // Only descriptive strategy names differ in common Mustika handling.
    const prefix = events.filter(e => e.time <= (enshrine ?? 180)).map(e => e.robot === 'redBR' && ids.includes(e.decision?.strategy)
      ? { ...e, decision: { ...e.decision, strategy: Flex.OPENING } } : e);
    const decisions = events.filter(e => e.robot === 'redBR' && e.decision?.flexiblePost);
    assert.ok(decisions.every(e => enshrine !== null && e.time >= enshrine));
    for (const e of decisions.filter(e => e.decision.assessment?.safeSeconds !== undefined))
      assert.ok(e.decision.assessment.safeSeconds < 180 - e.time - .049, 'Every selected complete scoring plan must fit with its reserve');
    const perSpot = F.spots.map(p => {
      const tower = sim.tower(p.id);
      const score = P.scoreState({ towers: { [p.id]: tower }, mustika: { location: 'source' } }, 'red');
      return { number: F.spotNumbers[p.id], id: p.id, red: score.red.tower, blue: score.blue.tower,
        layers: tower.map(o => ({ id: o.id, type: o.type, team: o.placedBy, color: o.color, touchedBy: o.touchedBy })) };
    }).sort((a, b) => a.number - b.number);
    const final = sim.snapshot(), robot = final.robots.find(r => r.id === 'redBR');
    const row = { strategy: redBrPlan, label: label(redBrPlan), redSpeed, blueSpeed: 1,
      red: scores.red.total, blue: scores.blue.total, difference: scores.red.total - scores.blue.total, scores, perSpot,
      sanctuary: sim.sanctuary, pickup: first(events, 'pickup', 'redTR', e => e.objectId === 'M'), enshrine,
      activatedAt: decisions[0]?.time ?? null, prefixHash: hash(JSON.stringify(prefix)),
      lateActions: events.filter(e => e.time >= 140 && e.kind === 'action' && ['place', 'flip', 'return', 'retry'].includes(e.action)).map(shortEvent),
      phases: decisions.map(e => ({ time: e.time, phase: e.decision.flexiblePost.phase, tasks: e.decision.tasks, assessment: e.decision.assessment })),
      pendingRed: { position: { x: robot.x, y: robot.y, z: robot.z }, cargo: robot.cargo, job: robot.job, pendingWork: robot.pendingWork },
      unfinishedScoringMove: robot.job?.type === 'move' && robot.pendingWork.some(a => ['place', 'flip', 'enshrine'].includes(a.type)),
      rejections: events.filter(e => ['rule', 'perception', 'physical', 'unsupported', 'unscored', 'policy'].includes(e.kind)),
      recoveries: events.filter(e => e.kind === 'recovery'), elapsedMs: +(performance.now() - begin).toFixed(2) };
    if (!control) control = { prefix, row };
    else {
      assert.equal(enshrine, control.row.enshrine); assert.deepEqual(prefix, control.prefix, 'Behavior before enshrinement must match');
      pairs.push({ redSpeed, strategy: redBrPlan, openingIdentical: true, differenceImprovement: row.difference - control.row.difference,
        byNumber: perSpot.map(p => { const before = control.row.perSpot.find(a => a.id === p.id);
          return { number: p.number, delta: (p.red - p.blue) - (before.red - before.blue) }; }) });
    }
    const stem = redBrPlan + '-speed-' + redSpeed;
    fs.writeFileSync(path.join(output, stem + '.json.gz'), zlib.gzipSync(JSON.stringify({ result: row, match: sim.export() })));
    fs.writeFileSync(path.join(output, stem + '-tactics.json'), JSON.stringify({ config, result: row,
      actions: events.filter(e => e.kind === 'action' && ['receive', 'place', 'flip', 'return', 'enshrine'].includes(e.action)),
      decisions }, null, 2));
    rows.push(row);
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ options, timeStep: .05, hashes, elapsedMs: performance.now() - started, rows, pairs }, null, 2));
    console.log(JSON.stringify({ strategy: row.label, redSpeed, red: row.red, blue: row.blue, difference: row.difference, enshrine,
      unfinishedScoringMove: row.unfinishedScoringMove, elapsedMs: row.elapsedMs }));
  }
}
const signed = n => (n > 0 ? '+' : '') + n;
const lines = ['# 奉納後の全エリア・点差対応 vs 後半V2 / L2防衛', '', '## 条件と実装', '',
  '- 赤3方策×速度1/0.75/0.5、青V2等速固定の9試合。各条件1試合の決定論的比較。全探索・統計的勝率ではない。',
  '- 180秒、0.05秒刻み、有限理想供給、stopped全盤面観測1秒、Mustika通知OFF、7m/s・3.5m/s²。赤倍率は速度と加速度に同時適用。既存Retry/衝突救済を維持。',
  '- 初動は全案とも短時間待機。自身のMustika奉納まで全4台のイベントが一致することをassert（赤BRの表示用decision.strategyだけ正規化）。奉納後のみ新方策へ切替。',
  '- 新案は①・③/⑤・L2を含む全合法配置先。受取/追加補給・満載時の1箱返却＋後続得点も比較。受け取る箱は配置予定があるものだけ。1箱だけなら反転枠があるため返却しない。得点はengineの既存処理を使用し、ルール・物理・観測・青V2を変更しない。',
  '- 残り40秒までは予想点差効率、終盤は観測点差と相手1回反転の仮説を加味。リード中は共有Skyの反転リスクを重く、Earth/専有の固定点も評価。相手の意図・未来・内部真値は使わない。点差未観測なら絶対リードを捏造しない。',
  '- 完了時間は既存plannerの地形・加減速・作業/観測/受取を含む。作業以外の所要時間25%＋1秒、観測相手が経路近傍なら反転＋観測時間を追加し、時間内に完了しない候補を除外。受取/返却だけ間に合う無得点便を選ばない。',
  '- 到着時は有料観測の後で予定先を再検証し、合法・時間内なら作業。候補なしならその場で再観測/保持。L2の共通作業位置にいる場合は、間に合い、観測相手と重ならない短距離の脇へ寄る。V2へ戻って無理な補給/長い退避移動を始めない（fixed観測では既定の見渡し点を使う）。',
  '- 余裕は方策上の仮定で、将来の衝突・相手の配置・進行中移動の遅延を保証しない。相手反撃は1回のSky反転ストレス評価で、実際の意図・多手minimax・勝ち確定ではない。', '',
  '## 最終得点', '', '| 赤速度 | 後半V2 赤:青（差） | L2防衛 赤:青（差） | 全エリア 赤:青（差） |', '|---|---:|---:|---:|',
  ...options.speeds.map(speed => '| ' + speed + ' | ' + ids.map(id => { const r = rows.find(r => r.strategy === id && r.redSpeed === speed); return `${r.red}:${r.blue} (${signed(r.difference)})`; }).join(' | ') + ' |'), '',
  '## 終了時の未完了移動', '', '| 速度 | 案 | 得点作業へ向かう移動が未完了 | 未完了の得点作業先 |', '|---|---|---|---|',
  ...rows.map(r => `| ${r.redSpeed} | ${r.label} | ${r.unfinishedScoringMove ? 'あり' : 'なし'} | ${r.pendingRed.pendingWork.filter(a => ['place', 'flip', 'enshrine'].includes(a.type)).map(a => a.spotId ? F.spotNumbers[a.spotId] : a.type).join(', ') || '-'} |`), '',
  '得点作業のない返却移動と、得点作業に向かう移動を区別。未完了の配置/反転を加点しない。', '',
  '## 番号別の点差変化（新案−後半V2）', '', '| 速度 | ' + F.spots.map(p => F.spotNumbers[p.id]).sort((a, b) => a - b).map(n => n + '番').join(' | ') + ' | 合計 |',
  '|---|' + Array(11).fill('---:').join('|') + '|',
  ...options.speeds.map(speed => { const p = pairs.find(p => p.strategy === Flex.ID && p.redSpeed === speed);
    return '| ' + speed + ' | ' + p.byNumber.map(n => signed(n.delta)).join(' | ') + ' | ' + signed(p.differenceImprovement) + ' |'; }), '',
  'Earthの差は別の試合で置いたチーム/段が違うという比較。Earth反転/置換を競技中に行ったわけではない。', '',
  '## 終盤行動', '', ...rows.flatMap(r => [`### ${r.redSpeed}・${r.label}`, '',
    ...r.lateActions.map(e => `- ${e.time.toFixed(2)}秒 ${e.robot} ${e.action} ${e.number ? e.number + '番' : ''} ${e.objectType || ''}`), '',
    `拒否${r.rejections.length}記録、Retry/救済${r.recoveries.length}記録。`, '']),
  '## 再現・保存', '',
  '- `node tools/compare-flexible-post.cjs --out results/flexible-post-next` （9試合、新出力先必須）',
  '- `node tools/compare-flexible-post.cjs --out results/flexible-post-one --speeds 0.5` （1/2の3案、3試合）',
  '- GUIの赤BRで「短時間待機→奉納後全エリア・点差対応」を選んで適用。理想供給・青V2・stopped・観測1秒。明示手順OFF、BRターン指定空。',
  '- summary.jsonは条件/ソースSHA256/得点/番号別盤面/終盤/未完了/判断余裕。*.json.gzは全試合export、*-tactics.jsonは読める行動/判断。',
  '- 色交換、他相手、通常供給、重み/時間余裕の探索は未実施。結果のために旧2方策・青V2を変更していない。'];
fs.writeFileSync(path.join(output, 'REPORT.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ output, matches: rows.length, elapsedMs: performance.now() - started }));
