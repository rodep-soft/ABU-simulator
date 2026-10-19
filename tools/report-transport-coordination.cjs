'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const F = require('../sim/field.js'), P = require('../sim/score-planner.js');
const root = path.resolve(__dirname, '..');
const afterDir = path.resolve(root, process.argv[2] || 'results/transport-coordination-2026-10-19-final');
const beforeDir = path.resolve(root, process.argv[3] || 'results/transport-study-2026-10-19');
const after = JSON.parse(fs.readFileSync(path.join(afterDir, 'summary.json'))), before = JSON.parse(fs.readFileSync(path.join(beforeDir, 'summary.json')));
const n = value => value == null ? '-' : value.toFixed(2), sign = value => (value > 0 ? '+' : '') + value;
function field(row) {
  return row.perSpot.map(p => {
    const id = F.spots.find(s => F.spotNumbers[s.id] === p.number).id;
    const score = P.scoreState({ towers: { [id]: p.layers.map((o, layer) => ({ ...o, layer, placedBy: o.team })) }, mustika: { location: 'source' } }, 'red');
    return { number: p.number, red: score.red.tower, blue: score.blue.tower, difference: score.red.tower - score.blue.tower };
  });
}
const comparisons = after.rows.map(row => {
  const old = before.rows.find(r => r.strategy === row.strategy && r.redSpeed === row.redSpeed); assert.ok(old);
  const stem = row.strategy + '-speed-' + row.redSpeed;
  const d = JSON.parse(fs.readFileSync(path.join(afterDir, stem + '-diagnostics.json')));
  const match = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(afterDir, stem + '.json.gz')))).match;
  const spots = field(row), oldSpots = field(old);
  assert.equal(spots.reduce((sum, p) => sum + p.red, 0), row.scores.red.tower);
  assert.equal(spots.reduce((sum, p) => sum + p.blue, 0), row.scores.blue.tower);
  const upperRefusals = r => r.rejections.filter(e => e.action === 'receive' && e.text.includes('上の物体'));
  const contexts = id => d.robots[id].contexts;
  const firstMove = team => d.decisions.find(e => e.robot === team + 'TR' && e.actions.some(a => a.label === '条件達成に備えMustika前へ'))?.time ?? null;
  return { strategy: row.strategy, label: row.label, speed: row.redSpeed, old: old.scores, scores: row.scores,
    difference: row.difference, oldDifference: old.difference, improvement: row.difference - old.difference,
    milestones: Object.fromEntries(['red', 'blue'].map(team => [team, {
      sanctuary: row.byTeam[team].sanctuary, departure: firstMove(team), pickup: row.byTeam[team].pickup,
      receive: row.byTeam[team].receive, enshrine: row.byTeam[team].enshrine }])),
    activation: match.events.find(e => e.robot === 'redBR' && (e.decision?.l2Defense || e.decision?.flexiblePost))?.time ?? null,
    timeContexts: { redTR: contexts('redTR'), redBR: contexts('redBR'), blueTR: contexts('blueTR'), blueBR: contexts('blueBR') },
    oldUpperRefusals: upperRefusals(old), upperRefusals: upperRefusals(row), rejections: row.rejections, recoveries: row.recoveries,
    spots: spots.map(p => ({ ...p, change: p.difference - oldSpots.find(o => o.number === p.number).difference })),
    lateActions: row.byTeam.red.placements.filter(e => e.time >= 140), finalRobots: row.finalRobots,
    openingHash: row.prefixHash };
});
for (const speed of [...new Set(comparisons.map(r => r.speed))])
  assert.equal(new Set(comparisons.filter(r => r.speed === speed).map(r => r.openingHash)).size, 1);
const seconds = (r, id, key) => n(r.timeContexts[id][key] || 0);
const lines = ['# TR先回り・受渡再観測の修正後比較', '',
  '## 変更と条件', '',
  '- TRの既定adaptiveを改善。完成済み1塔に加え、E1土台＋E1S1があれば2個の配置で資格成立すると予測して先回り。E2＋Sky/敵Sky反転の直前だけを見る旧条件を広げた。E1S1が準備済みで共有が空の場合も、相手の土台が来るか最大16秒の短い予測待機を許す。相手の未来の配置を事実とは扱わない。',
  '- 強い条件へ進んだ場合だけ延長。共有土台待ち16秒、E1S1配置24秒、最後のSky/反転16秒、同一エピソードの上限40秒。移動時間込み。毎回期限を更新せず、材料不足/取得不可/145秒以降なら補給へ戻る。資格の実成立前にはMustikaを取らず、荷物を消去したり箱とMustikaを混載したりしない。指定開幕/明示手順は維持。',
  '- BRの通常供給＋stopped/after-workでは、離れた場所から決めた受取IDをそのまま実行しない。受渡へ移動して有料scanし、現時点の上段から再選択する。到着済み・その位置で観測済みなら不要なscanを足さない。',
  '- BRの観測へtransferWork.unloadingを追加。現在のTRの荷下ろし作業が見えたかという真偽値のみで、相手/味方の未来計画や残り時間ではない。level-radiusでは在庫とTRの両方が見えたscanだけ更新し、古さ/未知を維持。BRは見えた荷下ろしが終わるまで有料再観測。従来のTR側の受取近接待ちと併用して上積みを調停する。',
  '- fixed観測と明示プログラム/手動操作に新しい現地受取scanを強制しない。fixedの古い観測からの上積み競合や、手動での同時操作を全面禁止する変更ではない。理想供給モードの動作は変更しない。',
  '- 前回と同じ赤3BR案×1/.75/.5、青V2=1、両TR=adaptive、通常供給、180秒/0.05秒、stopped/1秒、7m/s・3.5m/s²。赤倍率はTR/BRの速度と加速度。通知OFF、指定手順/便/ターンなし。ルール・容量・得点・地形/衝突・作業時間は維持。',
  '- 共通の先回り/受取処理は赤青双方へ適用。青のV2評価器や赤BR3案の評価器は変更していないが、青も共通処理の改善を受ける。前後差は2修正を両色に適用した総合効果で、個別の因果効果や普遍的勝率ではない。', '',
  '## 得点（赤:青、括弧は点差）', '', '| 赤速度 | 案 | 修正前 | 修正後 | 点差改善 |', '|---|---|---:|---:|---:|',
  ...comparisons.map(r => `| ${r.speed} | ${r.label} | ${r.old.red.total}:${r.old.blue.total} (${sign(r.oldDifference)}) | ${r.scores.red.total}:${r.scores.blue.total} (${sign(r.difference)}) | ${sign(r.improvement)} |`), '',
  '## 赤の資格・Mustika時刻', '', '| 赤速度 | 先回り出発 | 資格 | 取得 | BR受取 | 奉納 |', '|---|---:|---:|---:|---:|---:|',
  ...comparisons.filter(r => r.strategy === 'private-first-short').map(r => { const m = r.milestones.red;
    return `| ${r.speed} | ${n(m.departure)} | ${n(m.sanctuary)} | ${n(m.pickup)} | ${n(m.receive)} | ${n(m.enshrine)} |`; }), '',
  '同速度3案は自身奉納まで全4台のイベント一致をassert（赤BRの説明用戦略IDだけ正規化）。今回の3案の差は、その後の本来の分岐で生じる。前回は赤奉納なしで分岐自体が発動しなかった。', '',
  '## 待ち時間と受取拒否', '', '| 速度 | 案 | 赤BR初動箱待ち | 赤TR・BR退避待ち | 赤BR受渡再確認※ | 赤BR荷下ろし待ち※ | 上積み受取拒否（両色）前→後 |', '|---|---|---:|---:|---:|---:|---:|',
  ...comparisons.map(r => `| ${r.speed} | ${r.label} | ${seconds(r, 'redBR', 'br-box-supply')} | ${seconds(r, 'redTR', 'tr-br-clearance')} | ${seconds(r, 'redBR', 'br-transfer-refresh')} | ${seconds(r, 'redBR', 'br-unload-wait')} | ${r.oldUpperRefusals.length}→${r.upperRefusals.length} |`), '',
  '※受渡再確認は移動とscanを含む文脈別時間で、荷下ろし待ちも再観測時間を含む。初動箱待ちもphase=supplyであり、純粋な停止時間/除去可能ロスではない。物理カテゴリー（全台180秒）とは重ねて足さない。再確認時間が増えても、無効な受取とやり直しを避ける対策であり、全所要時間が必ず減るとは限らない。', '',
  '## 得点の内訳', '', '| 速度 | 案 | 赤 搬送/塔/Mustika | 青 搬送/塔/Mustika |', '|---|---|---:|---:|',
  ...comparisons.map(r => `| ${r.speed} | ${r.label} | ${r.scores.red.transfer}/${r.scores.red.tower}/${r.scores.red.mustika} | ${r.scores.blue.transfer}/${r.scores.blue.tower}/${r.scores.blue.mustika} |`), '',
  'Mustikaへ先回りすると箱便を遅らせるため、搬送点やL2の材料が減るトレードオフがある。Mustika250点を得たことだけで最終勝利や全戦略の改善を保証しない。', '',
  '## 番号別の最終塔得点・終盤', '',
  ...comparisons.flatMap(r => [`### ${r.speed}・${r.label}`, '',
    '| 番号 | 赤:青 | 修正前からの塔点差変化 |', '|---|---:|---:|',
    ...r.spots.map(p => `| ${p.number} | ${p.red}:${p.blue} | ${sign(p.change)} |`), '',
    `- 奉納後独自方策の初判断：${n(r.activation)}秒（後半V2は独自切替なし）。`,
    `- 140秒以降：${r.lateActions.map(e => `${n(e.time)}秒 ${e.action} ${e.number ? e.number + '番' : ''}`).join(' / ') || '得点作業の完了なし'}。`,
    `- 拒否記録${r.rejections.length}件、recovery記録${r.recoveries.length}件。拒否/救済の詳細はanalysis.jsonと完全ログを参照。`, '']),
  '## 保存と確認', '',
  `- 最終9試合：約${(after.elapsedMs / 1000).toFixed(2)}秒。前回${path.relative(root, beforeDir).replaceAll('\\', '/')}の結果は変更せず、別フォルダーへ保存。途中の等速3試合checkは別保存。`,
  '- `node tools/compare-transport.cjs --out results/transport-coordination-next` （9試合・新規出力先必須）',
  '- `node tools/report-transport-coordination.cjs results/transport-coordination-next results/transport-study-2026-10-19` （前後集計のみ）',
  '- `node --test sim/tests/transport-coordination.test.cjs` （先回り期限/材料不足からの復帰/資格前取得禁止/観測分離/指定手順維持/両色・配列順・遅い荷下ろし）',
  '- 最終コードのNode全回帰299件成功、失敗0、66.08秒。旧診断あり/なしの180秒全export一致も含む。',
  '- 最終GUIはsim/tests/transport-coordination-browser.cjsで等速全エリア485:410・赤奉納94.75秒、画面なしとの全イベント/得点/最終状態一致、上積み拒否0、3D実ピクセル881色、PC1440/スマホ幅390、2D・リプレイ・終了後分析/リセットによる原試合不変、JSエラー0を確認。記録results/transport-coordination-gui-1792389902091/verification.json。スマホ幅画像を目視確認。実機スマホ/WSLでは未確認。',
  '- 最終9試合で上積み受取拒否は両色0、TR移動衝突/自動復帰0。ただし終盤のBR移動停止/Retryは残る（等速L2防衛の赤1回、1/2の後半V2の青1回、1/2の全エリアは両色各1回）。S11の先取りによる赤TR取得失敗も等速/3/4では残る。改善済みと未解決を区別する。',
  '- summary.jsonに設定/ソースSHA256/9結果、*.json.gzに完全export、*-diagnostics.jsonに各台の時間分類と判断時の観測情報。analysis.jsonに前後比較/番号別塔点/終盤行動/拒否と回復の詳細。時間や操作を省略せず、同条件の奉納前一致/積載/180秒/ソース不変をassert。',
  '- GUIで通常供給、両色TR既定adaptive、赤BRいずれか3案、青V2、stopped/1秒、指定手順/便/ターンなしで初期化。赤速度と加速度倍率を変更し青1を維持。理想供給のGUI既定値は変更していない。',
  '- 他相手/色交換/赤のみ改善の対照や、待機時間の探索は今回実施していない。予測待機16/24/40秒は方策上の仮定で最適値ではない。共有土台が来ない/材料が変わる場合は補給復帰するが、全ての盤面で停滞や競合を排除する保証ではない。'];
fs.writeFileSync(path.join(afterDir, 'REPORT.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(afterDir, 'analysis.json'), JSON.stringify({ before: path.relative(root, beforeDir), after: path.relative(root, afterDir), comparisons }, null, 2));
console.log(JSON.stringify({ output: afterDir, matches: comparisons.length, wins: comparisons.filter(r => r.difference > 0).length }));
