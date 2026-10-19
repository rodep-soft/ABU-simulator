'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const F = require('../sim/field.js'), P = require('../sim/score-planner.js');
const root = path.resolve(__dirname, '..'), dir = path.resolve(root, process.argv[2] || 'results/transport-study-2026-10-19');
const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'))), rows = summary.rows;
const n = x => x == null ? '-' : x.toFixed(2), sign = x => (x > 0 ? '+' : '') + x;
const baseline = rows.filter(r => r.strategy === 'private-first-short');
const merge = (segments, context) => segments.filter(s => s.context === context).reduce((a, s) => {
  const last = a.at(-1);
  if (last && last.end === s.start) { last.end = s.end; last.seconds = +(last.seconds + s.seconds).toFixed(2); }
  else a.push({ start: s.start, end: s.end, seconds: s.seconds });
  return a;
}, []);
const data = baseline.map(r => {
  const stem = r.strategy + '-speed-' + r.redSpeed;
  const d = JSON.parse(fs.readFileSync(path.join(dir, stem + '-diagnostics.json')));
  const match = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, stem + '.json.gz')))).match;
  const events = match.events, timing = id => events.filter(e => e.robot === id && e.kind === 'timing').reduce((a, e) => {
    a[e.action] = +((a[e.action] || 0) + e.duration).toFixed(2); return a;
  }, {});
  const trips = events.filter(e => e.robot === 'redTR' && e.action === 'delivery-complete' && e.kind === 'action').map(e => ({
    time: e.time, number: e.delivery.number, earth: e.delivery.items.filter(o => o.type === 'earth').length,
    sky: e.delivery.items.filter(o => o.type === 'sky').length }));
  const failedPickups = events.filter(e => e.robot === 'redTR' && e.action === 'pickup' && e.kind === 'physical').map(e => {
    const last = d.decisions.filter(x => x.robot === 'redTR' && x.time <= e.time).at(-1);
    return { time: e.time, message: e.text, objectId: last?.actions.find(a => a.type === 'pickup')?.objectId,
      decisionAt: last?.time, elapsedSinceDecision: last ? +(e.time - last.time).toFixed(2) : null };
  });
  const field = r.perSpot.map(p => { const score = P.scoreState({ towers: { [F.spots.find(s => F.spotNumbers[s.id] === p.number).id]:
    p.layers.map((o, i) => ({ ...o, placedBy: o.team, layer: i })) }, mustika: { location: 'source' } }, 'red');
    return { number: p.number, red: score.red.tower, blue: score.blue.tower }; });
  assert.equal(field.reduce((s, p) => s + p.red, 0), r.scores.red.tower);
  assert.equal(field.reduce((s, p) => s + p.blue, 0), r.scores.blue.tower);
  return { speed: r.redSpeed, row: r, boxWait: merge(d.robots.redBR.segments, 'br-box-supply'),
    clearance: merge(d.robots.redTR.segments, 'tr-br-clearance'), stockPause: merge(d.robots.redTR.segments, 'tr-stock-target'),
    trTiming: timing('redTR'), brTiming: timing('redBR'), trips, failedPickups, field,
    blueHandoffReady: d.decisions.find(e => e.robot === 'blueTR' && e.context === 'tr-mustika-handoff')?.time ?? null,
    redMustikaRequest: d.decisions.find(e => e.robot === 'redTR' && e.actions.some(a => a.type === 'pickup' && a.objectId === 'M'))?.time ?? null,
    blueMustikaStart: events.find(e => e.kind === 'timing' && e.action === 'pickup' && e.objectId === 'M')?.startedAt ?? null,
    workReadyRejections: events.filter(e => e.robot === 'redBR' && e.kind === 'physical' && e.action === 'receive').map(e => ({ time: e.time, reason: e.text })) };
});
const noActivation = rows.every(r => !r.enshrine), same = baseline.every(r => rows.filter(x => x.redSpeed === r.redSpeed).every(x => x.prefixHash === r.prefixHash));
assert.ok(noActivation && same, 'This report describes this study only; inspect changed outcomes before adapting it.');
const contextSeconds = (r, role, key) => r.byTeam.red.contexts[role][key] || 0;
const collisionSeconds = r => ['opposing-tr-collision', 'manipulation-conflict', 'movement-obstacle', 'movement-yield', 'recovery-pending']
  .reduce((s, key) => s + (r.byTeam.red.categories.TR[key] || 0), 0);
const lines = ['# 通常TR搬送込み・3案×3速度の診断', '',
  '## 結論', '',
  '- 9試合を完走。TRは両色ともGUI既定のadaptive、青BRはV2。通常供給では赤は全試合でMustikaを逃した。3案の違いは「赤が奉納した後」だけなので、今回その分岐は発動せず、同じ速度の3試合は全4台のイベントまで一致した（表示用の戦略名だけ正規化）。3案の優劣を判定できる試合ではない。',
  '- 赤は全速度で青より早く②＋①の資格を作った。しかし3便目のE2+S1が輸送中で、空荷になるまでMustika取得へ切り替われない。BRの配置だけでなくTRの便の締切・先回りを合わせる必要がある。',
  '- 赤BRの明示的な初動箱待ちフェーズは18.95 / 23.10 / 29.35秒。赤TRのBR退避待ちは0 / 7.80 / 7.80秒。ただし遅い2条件では、その待ちより前に青がMustikaを取得済み。',
  '- 今回は両色とも移動衝突待ち・同時操作競合待ち・自動Retry/ワープの発生なし。相手と同じSkyを狙って取得が失敗するケースは別に発生し、「車体がぶつかり停止し続けた」とは区別した。', '',
  '## 条件', '',
  '- 180秒を0.05秒刻み。7m/s、3.5m/s²、stopped観測1秒、通知OFF、明示手順/BRターン/TR指定便なし。既存の観測・容量・坂/階段・作業時間・衝突救済を維持。赤倍率はTR/BR両方の最高速度と加速度へ適用し、青は1倍。',
  '- supplyMode=normalを両色へ適用。Earth/SkyはTRが採集・荷下ろしする。Mustikaは従来どおり直接手渡し。GUIの既定値やエンジン/戦略は変更していない。各条件1試合の決定論的事例で、勝率や全探索ではない。',
  '- 時間計測は読み取り専用sidecar。完全状態/実在庫は診断保存だけに使い、controllerには既存viewだけを渡す。物理カテゴリーは各台180秒に分割。文脈別時間（箱待ち中の移動/再観測を含む）はその内訳と重なるので二重加算しない。0.05秒サンプリングの境界誤差があり、dispatchは境界の処理時間も含む。完了作業の正確な経過時間はengineのtimingイベントを併記。', '',
  '## 得点', '', '| 赤速度 | 後半V2 赤:青（差） | L2防衛 赤:青（差） | 全エリア 赤:青（差） |', '|---|---:|---:|---:|',
  ...baseline.map(r => `| ${r.redSpeed} | ` + rows.filter(x => x.redSpeed === r.redSpeed).map(x => `${x.scores.red.total}:${x.scores.blue.total} (${sign(x.difference)})`).join(' | ') + ' |'), '',
  '| 赤速度 | 赤 搬送/塔/Mustika | 青 搬送/塔/Mustika | 塔だけの点差 |', '|---|---:|---:|---:|',
  ...baseline.map(r => `| ${r.redSpeed} | ${r.scores.red.transfer}/${r.scores.red.tower}/${r.scores.red.mustika} | ${r.scores.blue.transfer}/${r.scores.blue.tower}/${r.scores.blue.mustika} | ${sign(r.scores.red.tower - r.scores.blue.tower)} |`), '',
  '通常供給には初回搬送点がある。旧理想供給との総得点差を、そのままBRの低下量と解釈しない。Mustikaを赤へ付け替えるだけの仮想計算は実対戦の改善を保証しないため行わない。', '',
  '## 資格から取得まで', '', '| 赤速度 | 赤資格 | 青資格 | 赤3便目の空荷化 | 赤Mustika取得への出発 | 青取得開始 | 青取得完了 | 青奉納 |', '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...data.map(d => `| ${d.speed} | ${n(d.row.byTeam.red.sanctuary)} | ${n(d.row.byTeam.blue.sanctuary)} | ${n(d.trips[2]?.time)} | ${n(d.redMustikaRequest)} | ${n(d.blueMustikaStart)} | ${n(d.row.byTeam.blue.pickup)} | ${n(d.row.byTeam.blue.enshrine)} |`), '',
  '等速：赤73.10秒で①完成・資格成立。その時TRはE2+S1を持ち、階段を上って受渡へ向かっていた。83.45秒に荷下ろし完了、Mustikaへ出発。青は資格が82.95秒と遅いが、82.60秒には空荷で先回りを開始し、88.25秒に取得作業を開始。赤の89.20秒の取得要求は、青が操作中で失敗。資格の9.85秒リードをTRの都合で使えなかった。',
  '3/4・1/2：資格成立時もTRはSky採集へ向かう途中。進行中の移動＋pickupは新資格で途中中断されず、箱を受渡へ搬送して荷下ろしする。空荷化は101.40 / 118.70秒で、青取得89.75 / 101.30秒より後。箱/Mustika混載不可の現仕様もあるため、荷物を持ったまま直行させるだけの修正は不可。', '',
  '## 箱待ち・受け渡し・競合', '', '| 赤速度 | BR初動の明示箱待ち | TRのBR退避待ち | TR置場容量待ち | TR衝突/同時操作等 | 赤BRの受取拒否 |', '|---|---:|---:|---:|---:|---:|',
  ...data.map(d => `| ${d.speed} | ${n(contextSeconds(d.row, 'BR', 'br-box-supply'))} | ${n(contextSeconds(d.row, 'TR', 'tr-br-clearance'))} | ${n(contextSeconds(d.row, 'TR', 'tr-slot-capacity'))} | ${n(collisionSeconds(d.row))} | ${d.workReadyRejections.length}回 |`), '',
  'BR箱待ちはprivateFirst.phase=supplyの期間で、再観測と待機点への短い移動を含む。全試合の無得点時間や純粋な在庫不足時間そのものではない。V2移行後の「配置計画待ち」は候補なしも含むので別集計（diagnosticsのbr-other-supply-plan）。', '',
  ...data.flatMap(d => [`### 赤${d.speed}倍`, '',
    `- 箱待ち区間：${d.boxWait.map(s => `${n(s.start)}〜${n(s.end)}秒 (${n(s.seconds)}秒)`).join('、')}。最初は②用のE2、次は①用のE1+S1を待つ。`,
    `- 箱の納品便：${d.trips.map(t => `${t.number}便 E${t.earth}+S${t.sky} ${n(t.time)}秒`).join(' → ')}。既定TRは初手E3固定ではなく、今回の初動はE2S1→E1S1→E2S1。`,
    `- BR退避待ち区間：${d.clearance.map(s => `${n(s.start)}〜${n(s.end)}秒`).join('、') || 'なし'}。発生した2条件ではTRがSky1個を保持し、受取位置付近のBRが離れるまで積み増ししない。これは車体の移動衝突ではない。`,
    `- TRの需要ゼロ判断による補給抑制：${d.stockPause.map(s => `${n(s.start)}〜${n(s.end)}秒`).join('、') || 'なし'}。在庫/BR手持ちと優先2塔への必要量から需要を決めるため、常にE3/S4を満たす実装ではない。全てが無駄とは断定しない。`,
    `- 完了イベント上のTR所要時間：移動${n(d.trTiming.move)}秒、採集${n(d.trTiming.pickup)}秒、荷下ろし${n(d.trTiming.unload)}秒。移動には坂/階段/姿勢合わせを含む。末尾の未完了移動は含まない。BRの受取作業合計${n(d.brTiming.receive)}秒、観測合計${n(d.brTiming.scan)}秒（全観測が箱待ちではない）。`,
    `- BR受取拒否：${d.workReadyRejections.map(e => `${n(e.time)}秒「${e.reason}」`).join('、') || 'なし'}。TRが観測後〜受取前に同じ種類の山へ上積みした在庫変化が発生（初回はEarth、等速2回目はSky）。受取拒否から再観測・再計画する時間もあり、合計拒否回数と受渡待ち秒数は別。`,
    `- TR取得失敗：${d.failedPickups.map(e => `${n(e.time)}秒 ${e.objectId}（判断${n(e.decisionAt)}秒から${n(e.elapsedSinceDecision)}秒）`).join('、') || 'なし'}。判断から失敗までの時間全量を回避可能ロスとは見なさない。`, '']),
  '等速と3/4の2便目はS11を狙うが、青が37.95秒に取得操作を開始し39.45秒に完了。赤は等速33.00→38.90秒、3/4は36.75→43.60秒で取得に失敗して別Skyへ変更。車体衝突の待ちとは別の対象競合。1/2ではこの失敗はない。',
  '青にもMustika手渡し待ちがある。受渡位置に準備できた時刻は95.30 / 95.30 / 106.85秒、受取完了105.95 / 105.95 / 118.55秒。取得を確保済みの段階なので、今回の取得競争を逆転させる要因ではなかった。', '',
  '## 番号別の最終塔得点', '', '| 番号 | 等速 赤:青 | 3/4 赤:青 | 1/2 赤:青 |', '|---|---:|---:|---:|',
  ...Array.from({ length: 10 }, (_, i) => `| ${i + 1} | ` + data.map(d => { const p = d.field.find(p => p.number === i + 1); return `${p.red}:${p.blue}`; }).join(' | ') + ' |'), '',
  '②の完成は49.30 / 52.80 / 59.30秒、①の完成＝赤資格は73.10 / 74.75 / 86.20秒。等速は⑧⑨のSkyを赤へ戻し塔得点で+220だが、青Mustika250点と搬送差+15を合わせ最終-15。3/4は⑧を青に取られ、⑨は青Earth2段、⑦も青Earth2段目で塔得点-40。1/2は⑧をEarth2段で止め、⑩は青Earth2段、①Skyも最後は青で塔得点-10。', '',
  '## 次に試す改善（今回は未実装）', '',
  '1. 最優先は資格直前のTR便調整。BRの次作業で資格が成立しそうなら、次のE2S1便を始めず空荷でMustikaへ先回りする選択肢を比較する。BRからの信号は仮定を明示し、相手の内部計画/未来や完全状態をcontrollerへ渡さない。進行中の採集を変えるなら安全な中断・荷物の扱いも設計する。',
  '2. TR荷下ろしとBR受取を観測時点から調停する。BRの在庫観測後にTRが同じ種類の山へ積み増しし、受取候補が下段になる競合を抑える。物理/ルールを弱めず、受取順の再検証や受渡予約を検討する。',
  '3. ②用E2→S、①用E1+S1というBR需要と、TR便/荷下ろし順を合わせる。常時満杯や常時2個出発が最善と決めず、資格の締切とBRの手持ちを基準に比較する。',
  '4. Mustikaを逃した場合の分岐を3案にも設ける余地がある。現状L2防衛/全エリア分岐は自分の奉納後限定なので、今回のように相手へ渡ると全てV2のまま。今回は原因調査だけで、作戦や得点/時間を変更していない。', '',
  '## 再現と検証', '',
  `- 9試合の合計実行時間：${(summary.elapsedMs / 1000).toFixed(2)}秒。既存の長時間探索やWSLには触れていない。`,
  '- `node tools/compare-transport.cjs --out results/transport-next` （9試合・新規出力先必須）',
  '- `node tools/report-transport.cjs results/transport-next` （保存結果だけを集計・同フォルダーのREPORT.md/analysis.jsonを生成）',
  '- `node --test sim/tests/transport-diagnostics.test.cjs` （診断あり/なしの180秒全export一致、時間分類を確認）',
  '- GUIで再現：通常供給、赤BRはいずれか3案、青BR=戦術ベースラインv2、両色TR=効率化・必要量補給＋Mustika先回り（adaptive）、赤速度指定、青1、stopped/1秒。明示手順OFF、TR便/BRターン指定を空にして初期化。GUI既定は理想供給なので必ず切り替える。今回の9試合は描画なし、GUI描画の再検証はしていない。',
  '- summary.json：実設定/ソースSHA256/9結果/得点内訳/両色行動/回復/拒否。*.json.gz：試合の完全export。*-diagnostics.json：各台180秒の排他的時間分類、文脈別時間、区間、判断時の観測在庫と診断用実在庫/相方手持ち。analysis.json：3速度の集計。',
  '- 全9試合の積載上限・180秒完走・全4台の共通初動（今回全180秒）一致をassert。終了時のsim全JSと比較/計測ツールのSHA256を開始時と照合し一致。青も含め移動衝突待ち/同時操作競合待ち/自動救済0を確認。一般に競合しないことや最適性を保証する結果ではない。',
  '- 専用診断2件＋既存3戦略36件の計38テスト成功（11.76秒）。診断あり/なしの180秒全export一致を含む。GUI再検証・Node全回帰は今回実施していない。',
  '- 色交換、他相手、TR方策変更の対照実験は未実施。時間区間は因果的に回避可能なロスの証明ではなく、改善後の獲得/勝利は再実験が必要。'];
fs.writeFileSync(path.join(dir, 'REPORT.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify({ noPostEnshrinementActivation: noActivation, sameWholeMatchBySpeed: same, data }, null, 2));
console.log(JSON.stringify({ report: path.join(dir, 'REPORT.md'), matches: rows.length, sameWholeMatchBySpeed: same }));
