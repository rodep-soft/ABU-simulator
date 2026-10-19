// Bounded deterministic comparison using the same engine and conditions as the GUI.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Simulation, blockCount } = require('../sim/engine.js');
const C = require('../sim/controllers.js');
const P = require('../sim/score-planner.js');
const Policy = require('../sim/private-first.js');
const root = path.resolve(__dirname, '..');
function args(argv) {
  const options = { out: 'results/private-first-' + Date.now(), speeds: '1,0.75,0.5',
    strategies: [ ...Policy.modes.map(m => m.id), 'tactical-baseline-v2' ].join(',') };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!Object.hasOwn(options, key) || !argv[i + 1]) throw new Error('Use --out PATH --speeds 1,0.75,0.5 --strategies ID,ID');
    options[key] = argv[i + 1];
  }
  options.speeds = [...new Set(options.speeds.split(',').map(Number))];
  options.strategies = [...new Set(options.strategies.split(','))];
  if (options.speeds.some(s => ![1, .75, .5].includes(s)) || options.strategies.some(id => ![...Policy.modes.map(m => m.id), 'tactical-baseline-v2'].includes(id))) throw new Error('Unsupported speed or strategy');
  return options;
}
const options = args(process.argv.slice(2)), output = path.resolve(root, options.out);
if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Choose a new output directory; previous results are never overwritten.');
fs.mkdirSync(output, { recursive: true });
const rows = [], started = performance.now(), hashes = {};
for (const name of ['field.js', 'engine.js', 'controllers.js', 'private-first.js', 'ideal-baseline.js', 'tactical-baseline.js', 'score-planner.js', 'efficient-strategy.js', 'br-observation.js', 'action-plan.js']) {
  hashes[name] = createHash('sha256').update(fs.readFileSync(path.join(root, 'sim', name))).digest('hex');
}
function first(events, action, robot, predicate = () => true) { return events.find(e => e.kind === 'action' && e.action === action && e.robot === robot && predicate(e))?.time ?? null; }
function waitDuration(events) {
  let since = null, total = 0;
  for (const e of events.filter(e => e.robot === 'redBR' && e.decision?.privateFirst)) {
    if (e.decision.privateFirst.phase === 'watch' && since === null) since = e.time;
    else if (e.decision.privateFirst.phase !== 'watch' && since !== null) { total += e.time - since; since = null; }
  }
  return +(total + (since === null ? 0 : 180 - since)).toFixed(3);
}
for (const redSpeed of options.speeds) for (const redBrPlan of options.strategies) {
  P.clearCache();
  const config = { supplyMode: 'ideal', brObservationMode: 'stopped', scanSeconds: 1, maxSpeed: 7, acceleration: 3.5,
    redSpeed, blueSpeed: 1, redTrPlan: 'adaptive', blueTrPlan: 'adaptive', redBrPlan, blueBrPlan: 'tactical-baseline-v2', recordActions: true };
  const sim = new Simulation(config), start = performance.now();
  while (!sim.ended) {
    sim.step(.05, C);
    for (const r of sim.robots) assert.ok(blockCount(r.cargo, id => sim.object(id)) <= (r.role === 'BR' ? 2 : 3));
  }
  assert.equal(sim.time, 180);
  const scores = sim.scores(), events = sim.events;
  const phases = events.filter(e => e.robot === 'redBR' && e.decision?.privateFirst);
  const row = { strategy: redBrPlan, label: Policy.modes.find(m => m.id === redBrPlan)?.label || '赤もV2（対照）',
    redSpeed, blueSpeed: 1, red: scores.red.total, blue: scores.blue.total, difference: scores.red.total - scores.blue.total,
    outcome: scores.red.total > scores.blue.total ? 'win' : scores.red.total < scores.blue.total ? 'loss' : 'draw',
    privateComplete: { red: first(events, 'place', 'redBR', e => e.spotId === 'r2' && e.objectType === 'sky'),
      blue: first(events, 'place', 'blueBR', e => e.spotId === 'b2' && e.objectType === 'sky') },
    sanctuary: sim.sanctuary, pickup: { red: first(events, 'pickup', 'redTR', e => e.objectId === 'M'), blue: first(events, 'pickup', 'blueTR', e => e.objectId === 'M') },
    enshrine: { red: first(events, 'enshrine', 'redBR'), blue: first(events, 'enshrine', 'blueBR') },
    firstSharedWork: first(events, 'place', 'redBR', e => e.spotId === 's2'),
    armedAt: phases.find(e => e.decision.privateFirst.readyAt !== undefined)?.decision.privateFirst.readyAt ?? null,
    waitSeconds: waitDuration(events),
    firstSelfBuild: phases.find(e => e.decision.privateFirst.phase === 'self-build')?.time ?? null,
    retryCounts: Object.fromEntries(['red', 'blue'].map(team => [team, events.filter(e => e.robot === team + 'BR' && e.kind === 'recovery').length])),
    rejections: events.filter(e => ['rule', 'perception', 'physical', 'unsupported', 'unscored', 'policy'].includes(e.kind)).map(e => ({ time: e.time, robot: e.robot, action: e.action, kind: e.kind, text: e.text })),
    elapsedMs: +(performance.now() - start).toFixed(2) };
  const stem = redBrPlan + '-speed-' + redSpeed;
  fs.writeFileSync(path.join(output, stem + '.json.gz'), zlib.gzipSync(JSON.stringify({ result: row, match: sim.export() })));
  const opening = events.filter(e => e.robot === 'redBR' && (e.time <= (sim.sanctuary.red ?? 110))
    && (e.kind === 'action' && ['receive', 'place', 'flip', 'return', 'enshrine'].includes(e.action) || e.decision?.privateFirst));
  fs.writeFileSync(path.join(output, stem + '-opening.json'), JSON.stringify(opening, null, 2));
  rows.push(row); console.log(JSON.stringify(row));
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ options, timeStep: .05, hashes, elapsedMs: performance.now() - started, rows }, null, 2));
}
const fmt = x => x === null ? '-' : Number(x).toFixed(1);
const lines = ['# 専有完成→E1+S1待機 vs 青ベースラインV2', '',
  '各条件1試合の決定論的比較。反復試行の勝率や全探索ではありません。赤は3案、青はV2固定。赤V2も対照として計測。両色交換・他の相手・待機秒数の最適化は今回の対象外です。', '',
  '## 共通条件', '', '- 180秒・0.05秒刻み。有限の理想供給。TRは通常のMustika担当で、箱の初便E2+S1の輸送性能は評価しません。',
  '- GUIと同じstopped観測・停止1秒・全盤面認識の理想化。Mustika通知OFF。速度7m/s、加速度3.5m/s²。赤倍率を速度と加速度へ同時適用。',
  '- 専有は赤2/青6、共有は1。E2→S1で専有完成後E1+S1を用意。待機なし/上限5秒/観測した相手接近時のみ上限12秒。期限には移動・観測時間を含み、次の観測が収まらなければ早めに自力建設へ移行。',
  '- 相手積載は既存観測に含まれないため参照しない。接近判断は観測位置・前回位置・共有土台だけ。資格/奉納確認または110秒でV2の後続判断へ。Mustika直接受取・保持中奉納は既存共通処理。',
  '- 空の共有ではE1を先置きし、手持ちS1を保持して追加E1を補充。完成済み共有への反転は満載ならSky1個を返却して空きを作る。', '',
  '## 最終得点と時刻', '', '| 赤案 | 赤速度 | 赤対青 | 点差 | 赤資格 | 青資格 | 赤奉納 | 青奉納 | 待機秒 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map(r => `| ${r.label} | ${r.redSpeed} | ${r.red} : ${r.blue} | ${r.difference > 0 ? '+' : ''}${r.difference} | ${fmt(r.sanctuary.red)} | ${fmt(r.sanctuary.blue)} | ${fmt(r.enshrine.red)} | ${fmt(r.enshrine.blue)} | ${fmt(r.waitSeconds)} |`),
  '', '時刻は試合開始からの秒。資格は反転後も残る履歴。待機秒はログ上のwatch区間で、単なる速度0や通常作業時間ではありません。', '',
  '## 再現', '', '`node tools/compare-private-first.cjs --out results/private-first-next`', '',
  '1条件のみ: `node tools/compare-private-first.cjs --out results/private-first-single --speeds 1 --strategies private-first-short`', '',
  'summary.jsonに条件・ソースSHA256・最終得点・資格/取得/奉納・拒否/Retry記録を保存。各.gzは完全な条件/イベント/軌跡/終了状態、opening.jsonは赤BR初動の読めるログです。同じ出力先への上書きは拒否します。', '',
  '## 留意点', '', '赤青の初期位置・処理順等の既存非対称性があり、赤V2と青V2の同方策対戦も引き分けとは限りません。各条件は1試合で、勝ち確定や実機での優越を示すものではありません。'];
fs.writeFileSync(path.join(output, 'REPORT.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ output, matches: rows.length, elapsedMs: performance.now() - started }));
