# BR tactical-baseline-v2: Windows統合記録

2026-09-27。ユーザー指定ZIP `br-baseline-v2-handoff-01.zip` の `README_WINDOWS.md` と `reference/` コードを正本に、Windows GUIへ必要な差分をマージした記録です。WSL上のファイル、探索結果、公開サイトは変更していません。公開は別作業です。

## 選択方法

`field-simulator.html` を開き、戦略タブで赤/青それぞれのBR通常戦略を「戦術ベースライン v2」にして初期化します。v2単独で試すにはBRターン指定を空にします。TRの便指定は通常供給時に適用され、理想供給中は保存されるだけで箱の便には使われません。v1も比較用に選択できます。

観測条件は戦略とは独立しています。既定の「停止した場所」でも利用可能。移植元の観測を使う場合は「作業ごとに観測・同レベル＋異レベル3m」を選択してください。相手TRのMustika取得通知は別に明示ON/OFFを選びます。ONは通信と即時検知を理想化した取得履歴であり、現在の保持・位置・返却を追跡しません。

## 方針とファイル

- `sim/ideal-baseline.js`: v2本体。資格形成中は専有2番(赤)/6番(青)の完成→共有1番を基本に、即資格の共有反転を優先比較。初配置候補は赤1/2/7、青1/6/10。資格成立、観測した奉納、取得通知、110秒経過で資格レース優先を終えます。150秒以降は有用な現地配置・反転を補給より優先。
- `sim/tactical-baseline.js`: v1本体とv2依存の `rankFor`/`firstPlaced`。点差・固定Earth点・資格進捗・観測した相手の再反転リスクを評価。未来の勝利保証ではありません。
- この2ファイルは同梱コードを移植し、Windows旧stoppedでも追加の1箱受取を比較できるようplannerへ `allowRefill:true` を渡す点だけ適応。既存戦略のstopped時の受取制限は残しています。
- `sim/br-observation.js`: 同梱コードを導入。部分観測、未知/古い情報、自己作業の記憶、任意の初動制限・取得通知設定。
- `sim/engine.js`: 上記projectionへの接続、作業後scanの要求、取得完了通知、任意の初動制限。`blockCount` はEarth/Skyだけを数え、既存のBR2箱＋Mustikaを維持。
- `sim/score-planner.js`: `scoreState` は既存の `Simulation.scores()` を使う仮盤面採点を公開。after-workの時間/受取/未知の候補、順序付き反転、現地作業に適応。GUI用に別の採点を作っていません。
- `sim/efficient-strategy.js`, `sim/field.js`: 有用な現地作業の優先、補給待ち抑制、追加の1箱受取、作業1つで区切る実行、現地scan、未知/古い盤面の偵察。既存の返却・受渡・奉納・復旧を維持。
- `sim/controllers.js`: v1/v2をカタログ末尾へ登録し旧T/B番号を維持。共通の `handoffNext` と保持済みMustika優先、明示ターンの優先順位を保持。v2内部の `pursueMustika:false` は空荷待ちを抑制するだけです。
- `field-simulator.html`, `sim/view.js`: 依存順、戦略、追加観測と通知の選択、設定の適用/取消/初期化。従来のTR便・BR箱/配置先・リプレイ・ログ・試合後分析は維持。
- `tools/case-study-core.cjs`: BR箱容量の検証/運搬統計を箱数だけで判定。Mustika込みの長さで違反としない。戦略数追加に伴い組合せ件数のテストを更新。長時間の全組合せ対戦は実施していません。

## 条件の照合

| 項目 | このWindows版 | 移植元との関係 |
| --- | --- | --- |
| GUI/Nodeの既定観測 | stopped / fixed | 変更せず保持 |
| 追加観測 | 作業後全盤面、または同レベル全域＋異レベル3m | 後者がWSL観測。遮蔽/誤認識なし |
| 作業後観測 | 1作業後に設定秒数(既定1秒)、次を計画 | 旧到着scanを二重追加しない |
| 部分観測の得点 | scores=null、最後に見えた情報のestimatedScores | 本当の全体得点をBRへ与えない |
| 初動制限 | brOpeningはコードから任意指定可能、GUIへ強制しない | v2の最初の配置方針とは別 |
| 取得通知 | 既定OFF、明示ONで相手TR取得完了の履歴 | 全体検知・即時通知の理想化を明記 |
| BR容量 | E/S合計2個＋Mustika別枠1個 | Windows直前変更を保全 |
| TR容量 | 箱3個、Mustikaと箱の混載は未対応 | WSLのTR3箱＋Mustikaとは異なる |
| 理想箱供給 | 各チームE20/S6の有限在庫、E3/S4の置場、返却余地確保 | Windows実装を維持 |
| 理想初回補給 | L1進入後かつBRが受取点から0.75m超離れた後 | WSLと異なる |
| 理想供給の搬送点 | 0点、部分観測の参考集計でも0 | WSLは初回搬送点あり |
| 理想TR | 通常開始枠からMustika前へ実移動 | WSLの準備移動省略と異なる |
| Mustika | 実資格、排他取得、実搬送、直接手渡し、奉納 | 共通dispatcher・合法性を保持 |

設定は試合JSONの `config` と `assumptions` に記録します。戦略変更だけで条件は変わりません。省略時の旧挙動を保ち、同じ試合の両チームには同じ観測/供給設定を適用します。実験的な観測・信号・初動制限は公式ルールの追加ではありません。

## 検証手順

Node.js 24、ブラウザはローカルHTMLをPlaywright/Edgeで確認。アプリ自体にはnpm導入もサーバーも不要です。ブラウザテストのみ `playwright` と実行ブラウザが必要です。

```sh
node --test sim/tests/*.test.cjs
node --test sim/tests/ideal-baseline.test.cjs sim/tests/tactical-baseline.test.cjs sim/tests/baseline-port.test.cjs
node sim/tests/baseline-v2-browser.cjs
node sim/tests/br-stops-browser.cjs
node sim/tests/supply-trips-browser.cjs
node sim/tests/browser-smoke.cjs
node sim/tests/baseline-v2-comparison.cjs
```

WindowsのEdgeを使うテスト環境では `$env:ROBO_BROWSER_CHANNEL='msedge'`。Playwrightがプロジェクト外にある場合はそのnode_modulesディレクトリを `NODE_PATH` に設定します。比較スクリプトは通常/理想×両色の4試合だけで、長時間探索を開始しません。

最終の全Node回帰は **241件成功・失敗0、約51.50秒**。同梱テスト20件は参考コピーで成功した後、移植先でも成功。API依存の3ケースはWindowsの `Simulation` と既存のTR便設定へ適応し、判定要件を保持。参考コピー上の成功だけで移植成功としていません。Windows追加7件では観測待ち・Mustika2箱混載・通知・有限供給/搬送点・明示ターンと観測境界・旧観測の通常/理想4条件180秒完走を確認しました。従来214件を含みます。

GUIの成功記録は `results/baseline-v2-qa-1790479355319/verification.json`。通常/理想で180秒完走、赤青独立選択、BRターンへの登録、TR便保存、設定初期化、部分観測のON/OFF、盤面検討での原試合不変、リプレイ、1440/390/320px横はみ出しなし、非空canvas、JavaScriptエラー0。320pxスクリーンショットを目視確認。

既存GUI回帰の成功記録: `results/br-stops-qa-1790479439958/verification.json`、`results/supply-trips-qa-1790479499076/verification.json`。前者はEarth/Sky・配置先の指定順、3分間、分析と再生、後者はTRの便順/適用取消/理想供給/有限箱数を確認。

途中の `baseline-v2-qa-1790479205293` は通常試合後にテストが戦略タブへ戻らず停止した記録で、成功扱いしません。ブラウザ全体smokeは初回に実時間3倍速の測定が2.486倍で閾値に届かず、再試行では旧固定観測の座標期待とGUI stopped既定の相違を検出。固定観測を検証する箇所へ明示fixedを設定しました。最終再実行は成功(canvas553色、390px幅はみ出しなし、3倍速含む全チェック成功)。画像/出力を `results/baseline-v2-full-gui-20260927/` へ保存コピーし、テストで上書きされた過去の追跡済み画像は元のGit内容へ戻しました。テストに合わせてゲームロジックを変更していません。今後 `browser-smoke.cjs` を実行する際は `ROBO_QA_DIR` に新規フォルダーを指定すると過去画像を上書きせず保存できます。

## 短い対戦比較

記録: `results/baseline-v2-comparison-1790479487667/summary.json` と4試合のJSON。共通条件は等速、0.05秒刻み、部分観測・作業後scan、取得通知ON、初動の外部制限OFF、TR stock-e3＋指定E2S1→E2S1(通常供給だけ)。対戦相手は既存Mustika最速案。旧戦略も共通dispatcherで作業1つごとの観測に従いますが、部分情報を想定した戦略最適化は今回行っていません。

| 供給 | v2側 | 赤得点 | 青得点 | v2点差 |
| --- | --- | ---: | ---: | ---: |
| 通常 | 赤 | 375 | 485 | -110 |
| 通常 | 青 | 360 | 540 | +180 |
| 理想 | 赤 | 850 | 240 | +610 |
| 理想 | 青 | 310 | 820 | +510 |

4試合の実行は約28秒。通常1勝1敗、理想2勝ですが、この有限条件の動作比較であって一般的な勝率ではありません。WSL報告の36勝4敗をWindowsで再現したものでもありません。特に通常赤では資格自体は赤が先(84.60秒)、青が後(94.55秒)なのに青TRが96.40秒に取得しました。TR補給・観測・受渡も含む勝敗であり、BR配置だけで説明しないでください。

## 未変更・残る制約

- GUI描画の全面改修、API/進化探索ランナーの移植、長時間探索、commit/push/Pages公開は未実施。
- 先行する未コミットのBR Mustika別枠対応と検証成果を保持。今回の変更だけをコミット済みとは扱わない。
- 観測遮蔽、実機通信の成否、認識誤差、WSLと完全一致する供給・時間・TR混載条件は未検証/未対応。
- 数値結果を実競技の勝利保証や全探索の最適解と解釈しない。
