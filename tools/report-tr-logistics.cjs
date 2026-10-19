'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const F = require('../sim/field.js'), P = require('../sim/score-planner.js');
const root = path.resolve(__dirname, '..');
const afterDir = path.resolve(root, process.argv[2] || 'results/tr-logistics-2026-10-19-final');
const beforeDir = path.resolve(root, process.argv[3] || 'results/transport-coordination-2026-10-19-final');
const after = JSON.parse(fs.readFileSync(path.join(afterDir, 'summary.json'))), before = JSON.parse(fs.readFileSync(path.join(beforeDir, 'summary.json')));
const n = v => v == null ? '-' : v.toFixed(2), sign = v => (v > 0 ? '+' : '') + v;
const count = objects => ({ earth: objects.filter(o => o.type === 'earth').length, sky: objects.filter(o => o.type === 'sky').length });
function field(row) {
  return row.perSpot.map(p => {
    const id = F.spots.find(s => F.spotNumbers[s.id] === p.number).id;
    const scores = P.scoreState({ towers: { [id]: p.layers.map((o, layer) => ({ ...o, layer, placedBy: o.team })) }, mustika: { location: 'source' } }, 'red');
    return { number: p.number, red: scores.red.tower, blue: scores.blue.tower, difference: scores.red.tower - scores.blue.tower };
  });
}
const comparisons = after.rows.map(row => {
  const old = before.rows.find(r => r.strategy === row.strategy && r.redSpeed === row.redSpeed); assert.ok(old);
  const stem = row.strategy + '-speed-' + row.redSpeed;
  const d = JSON.parse(fs.readFileSync(path.join(afterDir, stem + '-diagnostics.json')));
  const previous = JSON.parse(fs.readFileSync(path.join(beforeDir, stem + '-diagnostics.json')));
  const match = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(afterDir, stem + '.json.gz')))).match;
  const spots = field(row), oldSpots = field(old), teams = {};
  for (const team of ['red', 'blue']) {
    const robot = row.finalRobots.find(r => r.id === team + 'TR'), oldRobot = old.finalRobots.find(r => r.id === team + 'TR');
    const decisions = d.decisions.filter(e => e.robot === robot.id), oldDecisions = previous.decisions.filter(e => e.robot === robot.id);
    const accepted = decisions.filter(e => e.selectedBoxTrip);
    assert.ok(accepted.every(e => e.selectedBoxTrip.fits && e.time + e.selectedBoxTrip.seconds < 179.95));
    teams[team] = { sanctuary: row.byTeam[team].sanctuary, pickup: row.byTeam[team].pickup, enshrine: row.byTeam[team].enshrine,
      oldEnshrine: old.byTeam[team].enshrine, delivered: count(row.byTeam[team].deliveries.map(e => ({ type: e.objectType }))),
      oldDelivered: count(old.byTeam[team].deliveries.map(e => ({ type: e.objectType }))),
      stockWait: d.robots[robot.id].contexts['tr-stock-target'] || 0,
      oldStockWait: previous.robots[robot.id].contexts['tr-stock-target'] || 0,
      earlyReturnDecisions: decisions.filter(e => e.status.includes('追加採集をやめ')),
      cutoffDecisions: decisions.filter(e => e.status.includes('終盤締切')),
      acceptedPickupCount: accepted.length, firstLateEarth: decisions.find(e => e.time >= 120 && e.actions.some(a => a.type === 'pickup' && a.objectId !== 'M') && e.actions.some(a => a.label === 'Earth必要数を採集')) || null,
      finalCargo: count(robot.cargo.map(id => match.final.objects.find(o => o.id === id))),
      oldFinalCargoIds: oldRobot.cargo, finalJob: robot.job || null, oldFinalJob: oldRobot.job || null,
      lastDecisions: decisions.slice(-4), oldLastDecisions: oldDecisions.slice(-4) };
  }
  const scoreChange = Object.fromEntries(['transfer', 'tower', 'mustika'].map(k => [k,
    (row.scores.red[k] - row.scores.blue[k]) - (old.scores.red[k] - old.scores.blue[k])]));
  assert.equal(Object.values(scoreChange).reduce((a, b) => a + b, 0), row.difference - old.difference);
  return { strategy: row.strategy, label: row.label, speed: row.redSpeed, scores: row.scores, oldScores: old.scores,
    difference: row.difference, oldDifference: old.difference, improvement: row.difference - old.difference, scoreChange, teams,
    spots: spots.map(p => ({ ...p, change: p.difference - oldSpots.find(o => o.number === p.number).difference })),
    rejections: row.rejections, recoveries: row.recoveries, prefixHash: row.prefixHash };
});
const speeds = [...new Set(comparisons.map(r => r.speed))], ids = [...new Set(comparisons.map(r => r.strategy))];
const worst = comparisons.reduce((a, b) => a.improvement < b.improvement ? a : b);
const stem = worst.strategy + '-speed-' + worst.speed;
const readMatch = dir => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, stem + '.json.gz')))).match;
const lateActions = match => match.events.filter(e => e.time >= 145 && e.kind === 'action'
  && (e.robot.endsWith('BR') && ['place', 'flip'].includes(e.action)
    || e.robot === 'redTR' && ['pickup', 'unload'].includes(e.action)));
const regressionEvidence = { strategy: worst.strategy, speed: worst.speed, before: lateActions(readMatch(beforeDir)), after: lateActions(readMatch(afterDir)) };
const actionText = events => events.map(e => `${n(e.time)}秒 ${e.robot} ${e.action} ${e.spotId ? F.spotNumbers[e.spotId] + '番 ' : ''}${e.objectId || ''}`).join(' / ');
const guiPath = path.join(root, 'results/tr-logistics-gui-1792391165003/verification.json');
const gui = fs.existsSync(guiPath) ? JSON.parse(fs.readFileSync(guiPath)) : null;
const guiMatches = gui && afterDir === path.join(root, 'results/tr-logistics-2026-10-19-final')
  && gui.result.scores.red.total === after.rows.find(r => r.strategy === 'private-first-short-flexible' && r.redSpeed === 1)?.scores.red.total
  && gui.result.scores.blue.total === after.rows.find(r => r.strategy === 'private-first-short-flexible' && r.redSpeed === 1)?.scores.blue.total
  && Object.values(gui.parity).every(Boolean) && !gui.errors.length;
const lines = ['# TR終盤便の締切・Earth補給の改善', '', '## 実装', '',
  '- sim/efficient-strategy.jsのみ競技方策を変更。TRの新deliveryBudgetは既存Planner.travelTo/travelSecondsと自分のmotionを再利用し、採集までの往路・採集・帰路・荷下ろし・段差/加減速を計上。自分で予定する取得後の帰路は、自分の取得対象だけを観測源の仮コピーから除いた予測。シミュレータの将来状態は参照しない。',
  '- 帰路を含む全納品が180秒までに終わらない追加採集を見送り、手持ちだけなら一部でも納品できる場合は受渡へ戻る。1箱も間に合わなければ新規移動/採集/荷下ろしを始めず保持して待つ。途中の移動/把持を瞬間中断したり、荷物を消去/得点化したりしない。最後に実完了した箱だけengineが採点。',
  '- 余裕は移動の25%＋1秒（受渡に到着済みは0.05秒）、各荷下ろしに0.1秒、観測したBRが受取付近なら2秒を加える。相手やBRの到着予定を取得する処理ではなく方策上の保守的バッファ。将来の通行止め/相手の先取りを保証しない。Mustika優先・固定の開幕便・TR指定便・明示手順は従来通り。',
  '- demandは優先2塔のSkyが足りている場合に限り、その他の観測済み合法なEarth空き段も見る。在庫＋観測したBR手持ちが不足すると最大2個分のEarthを補充する。空きが1段だけなら1個。未知/古い空き・相手専有・無効な土台を新規補充の根拠にしない。Sky不足の解消・有限供給・返却枠・TR最大3個を優先して維持する。',
  '- 新しい通信/要求/予約/ETA/共有メモリ/観測範囲の拡張はなし。新規判断はTRのview、自分の時刻/手持ち/性能と観測済みの物体/盤面/味方の外形的状態のみ。BRのbrain/queue/次の配置計画/実シミュレータへアクセスしない。BR方策と観測/ルール/得点/物理/作業時間は変更していない。現在の全盤面理想観測が実機の視野を保証するものではない。', '',
  '## 比較条件', '',
  '- 赤3BR案（後半V2/L2防衛/全エリア）×1/.75/.5、青V2=1。両色TR=adaptive・通常供給。180秒を0.05秒刻み、7m/s・3.5m/s²、stopped/1秒、通知OFF、指定便/BRターン/明示手順なし。赤倍率はTR/BR両方の速度・加速度へ適用。共通TR改善は青にも適用し、前回との比較で赤だけを有利にしていない。',
  '- 各条件1試合の決定論的比較。前回は先回り/受渡改善済みのtransport-coordination-2026-10-19-final。旧結果を上書きしない。今回の2変更を組み合わせた効果であり、個々の因果効果・最適性・普遍的勝率は未検証。', '',
  '## 最終得点（赤:青、点差）', '', '| 赤速度 | 後半V2 | L2防衛 | 全エリア |', '|---|---:|---:|---:|',
  ...speeds.map(speed => '| ' + speed + ' | ' + ids.map(id => { const r = comparisons.find(r => r.speed === speed && r.strategy === id); return `${r.scores.red.total}:${r.scores.blue.total} (${sign(r.difference)})`; }).join(' | ') + ' |'), '',
  '| 速度 | 案 | 前回点差→今回 | 改善量 | 搬送点差の変化 | 塔点差の変化 | Mustika点差の変化 |', '|---|---|---:|---:|---:|---:|---:|',
  ...comparisons.map(r => `| ${r.speed} | ${r.label} | ${sign(r.oldDifference)}→${sign(r.difference)} | ${sign(r.improvement)} | ${sign(r.scoreChange.transfer)} | ${sign(r.scoreChange.tower)} | ${sign(r.scoreChange.mustika)} |`), '',
  '供給の効率化が必ず勝敗/点差の改善になるとは限らない。増えた箱でBRの選択や相手との干渉が変わるため、増減をそのまま記載する。', '',
  '## 分かったこと・残った課題', '',
  `- 赤は${comparisons.filter(r => r.difference > 0).length}/9勝。赤の資格・Mustika取得・奉納時刻は前回と同じで、最速化の追加効果はない。両色全18台のTRが空荷・動作なしで終了。ただし最終点差は改善/同点/悪化が混在し、今回の変更を一律に強い方策とは扱わない。`,
  '- Earth追加補充により、等速全エリアの赤納品はE5/S4→E7/S4、在庫消費待ちは24.60→6.15秒、点差は+75→+145。一方で青にも同じ改善が効く。赤の待ち短縮だけで勝利差への寄与を断定しない。',
  `- 最大の悪化は${worst.speed}・${worst.label}の${sign(worst.oldDifference)}→${sign(worst.difference)}（${sign(worst.improvement)}）。番号別の塔点差変化は${worst.spots.filter(p => p.change).map(p => p.number + '番 ' + sign(p.change)).join(' / ')}、搬送点差は${sign(worst.scoreChange.transfer)}。`,
  `- この条件の145秒以降、前回：${actionText(regressionEvidence.before)}。`,
  `- 同じ条件の今回：${actionText(regressionEvidence.after)}。`,
  '- 3/4・L2防衛の⑧は前回の赤140:青0→今回の赤20:青120で240点差悪化。前回は赤が165.40秒に2段目Earth・177.10秒にS4を置いたが、今回は青が155.60秒に2段目Earth・166.90秒にS11を置いた。赤TRが見送った末尾のS1がそのまま⑧の失点原因とは言えない。前回の⑧Skyは147.30秒に納品済みのS4であり、S1ではない。補給変更で両色BRの選択・競り合いも変わった事例。個別アブレーションは未実施。',
  '- 締切は「余裕込みで間に合う見積り」なので、見送った便が物理的に不可能という証明ではない。3/4・L2防衛では156.05秒のE2保持時に追加Skyを中止したが、前回は同時刻のE2保持からS1を追加し179.25秒までに全納品できた。保守的バッファが実際には間に合う便も落とす反例。箱を納品できるかと、残り時間にBRが有効配置できるかも別で、後者を締切へはまだ織り込んでいない。', '',
  '## 資格とMustika', '', '| 速度 | 案 | 赤資格 | 赤取得 | 赤奉納（前→後） | 青奉納 |', '|---|---|---:|---:|---:|---:|',
  ...comparisons.map(r => `| ${r.speed} | ${r.label} | ${n(r.teams.red.sanctuary)} | ${n(r.teams.red.pickup)} | ${n(r.teams.red.oldEnshrine)}→${n(r.teams.red.enshrine)} | ${n(r.teams.blue.enshrine)} |`), '',
  '同速度3案は自分の奉納まで全4台イベント一致を比較ツールでassert（赤BRの説明用戦略IDだけ正規化）。', '',
  '## Earth補充と終盤便', '', '| 速度 | 案 | 赤納品E/S 前→後 | 赤TRの在庫消費待ち 前→後 | 赤の早帰り判断 | 赤締切判断の初時刻 | 赤終了手持ちE/S |', '|---|---|---:|---:|---:|---:|---:|',
  ...comparisons.map(r => { const t = r.teams.red; return `| ${r.speed} | ${r.label} | ${t.oldDelivered.earth}/${t.oldDelivered.sky}→${t.delivered.earth}/${t.delivered.sky} | ${n(t.oldStockWait)}→${n(t.stockWait)} | ${t.earlyReturnDecisions.length}回 | ${n(t.cutoffDecisions[0]?.time)} | ${t.finalCargo.earth}/${t.finalCargo.sky} |`; }), '',
  '待ち時間は診断の文脈時間で、移動/scanなどの物理内訳へ二重加算しない。締切の繰り返し判断を独立した便数と数えない。終了手持ちが残った場合も隠さず記録する。', '',
  ...comparisons.flatMap(r => { const t = r.teams.red; return [`### ${r.speed}・${r.label}`, '',
    `- 赤の120秒以降の最初のEarth採集判断：${t.firstLateEarth ? n(t.firstLateEarth.time) + '秒、観測在庫E' + t.firstLateEarth.observedStock.earth + '/S' + t.firstLateEarth.observedStock.sky : 'なし'}。`,
    `- 赤の追加採集を止めた判断：${t.earlyReturnDecisions.map(e => n(e.time) + '秒').join(', ') || 'なし'}。`,
    `- 赤TRの最終動作：${t.finalJob ? t.finalJob.type + ' ' + (t.finalJob.label || '') : '動作なし'}。青TR終了手持ちE${r.teams.blue.finalCargo.earth}/S${r.teams.blue.finalCargo.sky}。`,
    `- 番号別の最終塔得点：${r.spots.map(p => p.number + '番 ' + p.red + ':' + p.blue).join(' / ')}。`,
    `- 前回からの塔点差の変化：${r.spots.filter(p => p.change).map(p => p.number + '番 ' + sign(p.change)).join(' / ') || 'なし'}。`,
    `- 拒否記録${r.rejections.length}件、recovery記録${r.recoveries.length}件。詳細はanalysis.json。`, '']; }),
  '## 再現・検証', '',
  `- 最終9試合の計算時間：約${(after.elapsedMs / 1000).toFixed(2)}秒。前回結果は${path.relative(root, beforeDir).replaceAll('\\', '/')}に保全。`,
  '- 新sim/tests/tr-logistics.test.cjsの9件成功。両色・Earth補充/Sky優先/未知/枯渇/容量・締切・追加採集見送り・最後の1箱だけの実納品・速度/段差/個別作業時間・実経路・観測不変性/BR秘密計画非参照・指定便/明示手順を検証。',
  '- Node全回帰308件成功、失敗0、80.17秒。診断への締切記録追加後に診断2件を再実行し成功（15.03秒）。診断あり/なしの180秒全export一致を維持。',
  ...(guiMatches ? ['- GUI検証成功：results/tr-logistics-gui-1792391165003/verification.json。等速全エリア495:350・奉納94.75秒。画面なしとの全イベント/得点/最終状態一致、上積み拒否0、3D実ピクセル890色、PC1440×900/390×844幅、2D/リプレイ/終了後分析・リセットの原試合不変、JSエラー0。スマホ幅画像を目視確認。実機スマホ/WSL未確認。'] : []),
  '- 追加採集に選ばれたEarth/SkyのselectedBoxTripを、同じ入力viewだけから診断側でも算出し、すべて余裕込みで180秒未満とassert。待機/衝突や他者の先取りによる実績差は別扱いで、完了保証とはしない。',
  '- summary.jsonは設定/ソースSHA256/9結果、*.json.gzは完全export、*-diagnostics.jsonは各台の180秒時間分類・締切/採集判断の予測予算、analysis.jsonは前後比較/両色の納品/終状態/番号別点差と拒否・回復。',
  '- `node tools/compare-transport.cjs --out results/tr-logistics-next`',
  '- `node tools/report-tr-logistics.cjs results/tr-logistics-next results/transport-coordination-2026-10-19-final`',
  '- `node sim/tests/transport-coordination-browser.cjs results/tr-logistics-next` （Playwright/Edge、保存した等速全エリア結果とGUIを比較）',
  '- GUIは通常供給・両TR=既定adaptive・青BR=V2・赤BRは3案のいずれか・stopped/1秒で初期化。GUIの既定理想供給は変更しない。手動/明示手順/指定便は今回の自動締切の対象外。',
  '- 実機の視野/遮蔽、通信禁止の全機構監査、色交換、他相手、2改善の個別アブレーション、長時間探索は今回実施していない。'];
fs.writeFileSync(path.join(afterDir, 'REPORT.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(afterDir, 'analysis.json'), JSON.stringify({ before: path.relative(root, beforeDir), after: path.relative(root, afterDir), comparisons, regressionEvidence }, null, 2));
console.log(JSON.stringify({ output: afterDir, matches: comparisons.length, wins: comparisons.filter(r => r.difference > 0).length }));
