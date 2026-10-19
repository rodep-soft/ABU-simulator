'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const F = require('../sim/field.js'), P = require('../sim/score-planner.js');
const root = path.resolve(__dirname, '..');
const afterDir = path.resolve(root, process.argv[2] || 'results/tr-useful-supply-2026-10-19-final');
const beforeDir = path.resolve(root, process.argv[3] || 'results/tr-logistics-2026-10-19-final');
const read = p => JSON.parse(fs.readFileSync(p));
const after = read(path.join(afterDir, 'summary.json')), before = read(path.join(beforeDir, 'summary.json'));
const n = v => v == null ? '-' : v.toFixed(2), sign = v => (v > 0 ? '+' : '') + v;
const count = items => ({ earth: items.filter(o => o.type === 'earth').length, sky: items.filter(o => o.type === 'sky').length });
function towerScores(row) {
  return row.perSpot.map(p => {
    const id = F.spots.find(s => F.spotNumbers[s.id] === p.number).id;
    const scores = P.scoreState({ towers: { [id]: p.layers.map((o, layer) => ({ ...o, layer, placedBy: o.team })) }, mustika: { location: 'source' } }, 'red');
    return { number: p.number, red: scores.red.tower, blue: scores.blue.tower, difference: scores.red.tower - scores.blue.tower };
  });
}
function usage(row, events, team) {
  const all = row.byTeam[team].deliveries.map(e => ({ id: e.objectId, type: e.objectType, delivered: e.time,
    placed: events.find(a => a.kind === 'action' && a.robot === team + 'BR' && a.action === 'place' && a.objectId === e.objectId && a.time >= e.time)?.time ?? null }));
  return { total: count(all), late: all.filter(e => e.delivered >= 120), all };
}
const comparisons = after.rows.map(row => {
  const old = before.rows.find(r => r.strategy === row.strategy && r.redSpeed === row.redSpeed); assert.ok(old);
  const stem = row.strategy + '-speed-' + row.redSpeed;
  const match = dir => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, stem + '.json.gz')))).match;
  const current = match(afterDir), previous = match(beforeDir), diagnostics = read(path.join(afterDir, stem + '-diagnostics.json'));
  const teams = {};
  for (const team of ['red', 'blue']) {
    const decisions = diagnostics.decisions.filter(d => d.robot === team + 'TR');
    const accepted = decisions.filter(d => d.selectedBoxTrip);
    assert.ok(accepted.every(d => d.selectedBoxTrip.fits && d.time + d.selectedBoxTrip.seconds < 179.95));
    const evaluated = decisions.filter(d => d.supplyAssessment);
    const selections = evaluated.filter(d => d.supplyAssessment.selected).map(d => ({ time: d.time, ...d.supplyAssessment }));
    for (const d of selections) {
      const chosen = d.candidates.find(c => c.objectId === d.selected); assert.ok(chosen);
      if (chosen.use?.known) {
        assert.ok(chosen.use.used.includes(d.selected));
        assert.ok(chosen.use.tasks.every(t => t.at < 180));
        if (d.direct?.known) assert.ok(chosen.use.gain > d.direct.gain);
      }
    }
    teams[team] = { usage: usage(row, current.events, team), oldUsage: usage(old, previous.events, team),
      sanctuary: row.byTeam[team].sanctuary, pickup: row.byTeam[team].pickup, enshrine: row.byTeam[team].enshrine,
      oldEnshrine: old.byTeam[team].enshrine, selections,
      rejected: evaluated.flatMap(d => d.supplyAssessment.candidates.filter(c => c.reason !== 'usable-or-unknown').map(c => ({ time: d.time, ...c }))),
      contexts: diagnostics.robots[team + 'TR'].contexts, finalRobot: row.finalRobots.find(r => r.id === team + 'TR') };
  }
  const spots = towerScores(row), oldSpots = towerScores(old);
  const scoreChange = Object.fromEntries(['transfer', 'tower', 'mustika'].map(k => [k,
    (row.scores.red[k] - row.scores.blue[k]) - (old.scores.red[k] - old.scores.blue[k])]));
  assert.equal(Object.values(scoreChange).reduce((a, b) => a + b, 0), row.difference - old.difference);
  return { strategy: row.strategy, label: row.label, speed: row.redSpeed, scores: row.scores, oldScores: old.scores,
    difference: row.difference, oldDifference: old.difference, change: row.difference - old.difference, scoreChange, teams,
    spots: spots.map(p => ({ ...p, change: p.difference - oldSpots.find(o => o.number === p.number).difference })),
    rejections: row.rejections, recoveries: row.recoveries };
});
const speeds = [...new Set(comparisons.map(r => r.speed))], ids = [...new Set(comparisons.map(r => r.strategy))];
const totals = comparisons.reduce((sum, r) => {
  const t = r.teams.red;
  sum.delivered += t.usage.late.length; sum.used += t.usage.late.filter(e => e.placed != null).length;
  sum.oldDelivered += t.oldUsage.late.length; sum.oldUsed += t.oldUsage.late.filter(e => e.placed != null).length;
  return sum;
}, { delivered: 0, used: 0, oldDelivered: 0, oldUsed: 0 });
const worst = comparisons.reduce((a, b) => a.change < b.change ? a : b);
const regressionStem = worst.strategy + '-speed-' + worst.speed;
const lateBR = dir => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, regressionStem + '.json.gz')))).match.events
  .filter(e => e.robot === 'redBR' && e.time >= 143 && ['place', 'flip', 'scan', 'plan'].includes(e.action));
const regression = { strategy: worst.strategy, speed: worst.speed, before: lateBR(beforeDir), after: lateBR(afterDir) };
const lateFlip = regression.before.filter(e => e.kind === 'action' && e.action === 'flip').at(-1);
const point = lateFlip && F.spotApproaches(F.spotById[lateFlip.spotId], 'red')[0];
const oldScan = point && regression.before.filter(e => e.kind === 'action' && e.action === 'scan' && Math.hypot(e.origin.x - point.x, e.origin.y - point.y) < .02).at(-1);
const newScan = point && regression.after.filter(e => e.kind === 'action' && e.action === 'scan' && Math.hypot(e.origin.x - point.x, e.origin.y - point.y) < .02).at(-1);
const timeEvidence = oldScan && newScan ? [`- 最大悪化条件での最後の反転付近：前回は${n(oldScan.time)}秒に${F.spotNumbers[lateFlip.spotId]}番で観測完了、${n(lateFlip.time)}秒に反転。今回は同地点の観測完了が${n(newScan.time)}秒で、残り${n(180 - newScan.time)}秒。前回の観測後反転${n(lateFlip.time - oldScan.time)}秒に届かない。新旧の配置ログはanalysis.jsonのregressionに保存。補給変更とその他の行動/経路の連鎖を分離した因果検証ではない。`] : [];
const lines = ['# TR締切余裕・BRが使える補給の比較', '', '## 実装と情報の境界', '',
  '- 通常供給の自動TRの締切を、既存の経路/加減速/坂/階段計算に移動2%＋0.1秒、荷下ろし毎0.05秒、観測したBRが受取付近なら0.5秒の余裕とした。以前の移動25%＋1秒/荷下ろし0.1秒/BR付近2秒を縮小。将来の衝突や先取りの保証ではない。',
  '- 最後の60秒はusableSupplyで補給後のBRの仮想作業を最大3作業回・各回最大2箱まで評価。TRの納品見積り後から、観測済みBRの位置/手持ち・現在確認できる盤面/在庫・事前既知のBR性能/観測モードを使う。移動/受取/観測/配置・固定見渡し場所への帰還と満載制限を既存score-plannerへ委譲。得点はengineの既存計算を再利用。',
  '- すでにある箱と手持ちを使う場合を比較基準にし、追加箱が実際に仮想配置され、配置点差の見込みも増える時を優先。候補はE/Sを比較し、終盤の暗黙の便内訳は3個以下で変更可能。納品後の仮想配置時刻が180秒に収まらない箱を新規採集しない。運搬点5だけを理由に使えない新しい箱を増やさない。',
  '- 既に持っている箱は捨てない。追加採集が無益なら手持ちを先に返し、受渡では使えそうな箱から荷下ろしする。残りを納品する時間があれば実納品点は得る。Mustika優先・資格・容量・有限供給・受渡位置・明示手順/指定開幕/TR便は維持。BRの実際の戦略/観測更新/ゲームルールは変更しない。',
  '- BRのcontroller・内部brain/queue/job・目的地・未来ETA・要求/予約/信号は読まず、TR/BR間の通信も追加しない。partnerMotion/partnerObservationは事前設定された味方の走行/作業性能と観測モードだけで、ライブな行動情報ではない。行単位の未来の時間上書きや実行中作業の残り秒数は与えない。',
  '- 仮想BRは実際のBR戦略を模倣しない、汎用の合法配置・点差効率モデル。納品までBRが何も進めない保守的仮定、最大3回の有限先読み、返却/反転/防衛を仮想仕事に含めず競合/相手先置きも予知しないという限界がある。Mustikaを保持するBR、見えない/古い位置や在庫、性能不明などは評価不明として従来の需要と納品締切へ戻す。観測外の塔を空と捏造しない。',
  '- 既存TRの全盤面理想観測は維持し、実機のFOV/遮蔽や認識精度を実証していない。各台へ渡した観測だけで判断することと、実機相当の観測範囲の実装は別。', '',
  '## 条件', '',
  '- 両TR=adaptive、通常供給、青BR=V2/速度1、赤BR=後半V2/L2防衛/全エリアの3案×速度1/.75/.5。速度倍率はTR/BR双方の速度・加速度へ適用。7m/s・3.5m/s²、stopped/1秒、通知OFF、指定便/ターン/明示手順なし。180秒を0.05秒刻み。共通改善は青にも適用。',
  `- 前回の${path.relative(root, beforeDir).replaceAll('\\', '/')}と比較。各条件1試合、全探索/普遍的勝率ではない。新しい保存先を使い旧結果を保全。最終${comparisons.length}試合の計算時間${n(after.elapsedMs / 1000)}秒。`, '',
  '## 最終点（赤:青、点差・前回比）', '', '| 赤速度 | 後半V2 | L2防衛 | 全エリア |', '|---|---:|---:|---:|',
  ...speeds.map(s => '| ' + s + ' | ' + ids.map(id => { const r = comparisons.find(r => r.speed === s && r.strategy === id); return `${r.scores.red.total}:${r.scores.blue.total} (${sign(r.difference)}、${sign(r.change)})`; }).join(' | ') + ' |'), '',
  `赤勝利${comparisons.filter(r => r.difference > 0).length}/${comparisons.length}、赤奉納${comparisons.filter(r => r.teams.red.enshrine != null).length}/${comparisons.length}。両色共通変更でBRの選択・競り合いも変わる。2変更の個別因果効果は分離していない。`, '',
  '| 速度 | 案 | 搬送点差変化 | 塔点差変化 | Mustika点差変化 | 番号別の塔点差変化 |', '|---|---|---:|---:|---:|---|',
  ...comparisons.map(r => `| ${r.speed} | ${r.label} | ${sign(r.scoreChange.transfer)} | ${sign(r.scoreChange.tower)} | ${sign(r.scoreChange.mustika)} | ${r.spots.filter(p => p.change).map(p => p.number + '番 ' + sign(p.change)).join(' / ') || 'なし'} |`), '',
  '## 主な発見', '',
  `- 点差改善${comparisons.filter(r => r.change > 0).length}条件、悪化${comparisons.filter(r => r.change < 0).length}条件。Mustika奉納時刻が前回と同じ条件は${comparisons.filter(r => r.teams.red.enshrine === r.teams.red.oldEnshrine).length}/${comparisons.length}。納品効率の改善と勝利率の改善は同じではなく、前回${comparisons.filter(r => r.oldDifference > 0).length}勝→今回${comparisons.filter(r => r.difference > 0).length}勝。`,
  `- ${comparisons.length}試合の赤で120秒以降の納品は${totals.oldDelivered}→${totals.delivered}箱、うち試合中に配置した箱は${totals.oldUsed}→${totals.used}箱、配置しなかった箱は${totals.oldDelivered - totals.oldUsed}→${totals.delivered - totals.used}箱。単なる運搬抑制を無条件の改善とはしない。`,
  `- 最大悪化は${worst.speed}・${worst.label}の${sign(worst.oldDifference)}→${sign(worst.difference)}（${sign(worst.change)}）。塔点差の変化は${worst.spots.filter(p => p.change).map(p => p.number + '番 ' + sign(p.change)).join(' / ')}、搬送点差変化${sign(worst.scoreChange.transfer)}。`,
  ...timeEvidence,
  '- 改善余地：納品中にも観測したBRが既存手持ちを処理する可能性の幅、返却/反転/防衛との整合、BRの最終反転の出発余裕。これらを今回の結果に合わせて後付け修正せず、次の独立した比較対象として残す。特定条件で悪化する今回の方策を普遍的な上位互換とはしない。', '',
  '## 補給と実際の利用', '', '| 速度 | 案 | 赤E/S納品 前→後 | 120秒以降の赤納品→試合中に配置 | 同条件の前回 | 赤終了手持ち | 赤資格/取得/奉納 |', '|---|---|---:|---:|---:|---|---|',
  ...comparisons.map(r => { const t = r.teams.red; return `| ${r.speed} | ${r.label} | ${t.oldUsage.total.earth}/${t.oldUsage.total.sky}→${t.usage.total.earth}/${t.usage.total.sky} | ${t.usage.late.length}→${t.usage.late.filter(e => e.placed != null).length} | ${t.oldUsage.late.length}→${t.oldUsage.late.filter(e => e.placed != null).length} | ${t.finalRobot.cargo.join(',') || 'なし'} | ${n(t.sanctuary)}/${n(t.pickup)}/${n(t.enshrine)} |`; }), '',
  '120秒以降の納品利用は同じIDの箱を味方BRが納品後180秒までにplace完了した実績。仮想利用見積りとは別集計で、Skyを後から相手に反転されても「未使用」には戻さない。配置された箱が最終得点として残る保証でもない。', '',
  ...comparisons.flatMap(r => [`### ${r.speed}・${r.label}`, '', ...['red', 'blue'].flatMap(team => {
    const t = r.teams[team];
    return [`- ${team}: 実納品E${t.usage.total.earth}/S${t.usage.total.sky}。終盤納品: ${t.usage.late.map(e => `${e.id} ${n(e.delivered)}秒→${e.placed == null ? '配置なし' : n(e.placed) + '秒配置'}`).join(' / ') || 'なし'}。`,
      `- ${team}: 終盤採集判断${t.selections.length}回: ${t.selections.map(d => n(d.time) + '秒 ' + d.selected).join(' / ') || 'なし'}。見送り候補の内訳: 納品締切${t.rejected.filter(c => c.reason === 'delivery-deadline').length}、追加配置価値なし${t.rejected.filter(c => c.reason === 'no-marginal-work').length}。繰り返し判断を独立した便数に数えない。`];
  }), `- 番号別の最終塔得点: ${r.spots.map(p => p.number + '番 ' + p.red + ':' + p.blue).join(' / ')}。`,
  `- 拒否${r.rejections.length}件、Retry等の回復${r.recoveries.length}件。詳細と仮想配置予測はanalysis.json。`, '']),
  '## 再現・検証', '',
  '- 今回のテスト/GUI検証結果は[検証記録](VALIDATION.md)を参照（その試行で別途実行した場合のみ）。この集計ツールの実行だけでテストやGUIを成功扱いにはしない。',
  '- summary.jsonに設定・ソースSHA256・全結果、*.json.gzに完全試合export、*-diagnostics.jsonに180秒時間内訳と実際のcontrollerが返したsupplyAssessment。診断用の真値はcontrollerへ返さない。選択した箱の締切、仮想使用、既存在庫との増分を本ツールでもassert。',
  '- 取得後に相手へ先取りされること、輸送中の交通、BRが別戦略を選ぶことは未予知。見積り通りに使われたとは断定せず上の実績と区別する。',
  '- `node tools/compare-transport.cjs --out results/tr-useful-next`',
  '- `node tools/report-usable-supply.cjs results/tr-useful-next results/tr-logistics-2026-10-19-final`',
  '- `node --test sim/tests/*.test.cjs`',
  '- `node sim/tests/transport-coordination-browser.cjs results/tr-useful-next` （別途Playwright/Edgeが必要）',
  '- GUIは通常供給に変更、TRは既定のまま、赤BRは3案のいずれか、青BR=V2、stopped/1秒で初期化。理想供給のGUI既定値は変更しない。',
  '- 実機スマホ/WSL、他相手・色交換、多数の乱数条件、長時間探索、個別アブレーションは未実施。'];
fs.writeFileSync(path.join(afterDir, 'REPORT.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(afterDir, 'analysis.json'), JSON.stringify({ before: path.relative(root, beforeDir), after: path.relative(root, afterDir), comparisons, totals, regression }, null, 2));
console.log(JSON.stringify({ output: afterDir, matches: comparisons.length, wins: comparisons.filter(r => r.difference > 0).length }));
