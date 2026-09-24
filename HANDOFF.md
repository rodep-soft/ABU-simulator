# ABU Robocon 2027 シミュレータ引継ぎ

初回確認日: 2026-09-24 (Windows / Asia-Tokyo)。この資料は、会話履歴を持たないWSL側の開発者向けの現状記録です。追記として、ユーザーが追加した `Reference/` の同梱資料と、Earth/Sky反転の対応済み状態を反映しています。

## 最初に読むこと

- 現行アプリの入口は **`field-simulator.html`**。`index.html` と `tactical-replay.html` は旧版です。
- HTML、`sim/`、`vendor/` を一緒に置けば、Windowsではファイルを直接開いて動かせる構成です。本体にビルド・npm install・常駐サーバーは不要です。
- 引継ぎ作業は **この `HANDOFF.md` と `AGENTS.md` の作成・更新のみ**。ソース変更、依存導入、WSLへのコピー、Git初期化・commit・revertは行っていません。`Reference/` はユーザーが追加した資料です。
- 本体テスト158件は初回引継ぎ作成時にWindowsで成功。WSLでの動作は未確認です。ブラウザテストには移植が必要なWindows固定パスがあります。
- **プロジェクト自身に `.git` はありません。** WindowsでGitを実行すると上位の `C:/Users/sasah` のリポジトリを拾います。「差分が空だからコミット済み」と判断しないでください。
- ルールブック原文・日本語訳、注意点PPTX、フィールドモデルは **`Reference/` に同梱済み**。プロジェクトを丸ごとコピーすれば参照資料も移行できます。
- 試合終了後の分析では、配置済みEarthの各段と各配置先のSkyを選択して反転できます。

次の順序は、`AGENTS.md` を読む、`Reference/` を含む現在のフォルダーをWSLへコピーする、本体テストとGUIの移行確認をする、です。API化はその後の別作業です。

## プロジェクト概要

ABU Robocon 2027の3分間の試合と戦略を検討するための、2チーム・各TR/BRのシミュレータです。人間がフィールド、ロボット、運搬物、配置物、得点、判断理由、試合経過を確認するGUIと、画面描画なしの一括対戦用ツールがあります。

TRは資材を供給元から受け渡し場所へ運ぶ側、BRは受け取った資材を配置する自動ロボットです。Earthは以下でE、SkyはS、MustikaはMとも表記します。運搬初手E3、次便E1+S2、共有/専有への分散配置、速度差、終盤の反転などを比較してきました。目的は単なる加点ではなく勝利ですが、現在の探索は限定した候補・戦略の比較であり、全行動の完全探索や実競技での必勝証明ではありません。

将来はBRから利用できるAPIへ発展させる予定です。**現在はHTTP/WebSocketによるロボット用APIも、複数端末同期サービスもありません。** 人間用GUIに見えてよい完全な状態と、実機BRが観測可能な情報を分けることが次段階の重要制約です。

## プロジェクトの場所と構成

現在のWindowsルート:

```text
C:\Users\sasah\.codex\.chatgpt-projects\g-p-69fe0570a8308191bc6819be4d7b5465\robocon-strategy-sim
```

この資料での相対パスとコマンドの基準は、この `robocon-strategy-sim` です。上位のChatGPTプロジェクトルートとは区別してください。

| パス | 現在の役割 |
| --- | --- |
| `field-simulator.html` | 現行GUIの入口、操作部品、スクリプト読み込み |
| `sim/field.js` | `RoboField`。地形、壁、スタート位置、配置先、見渡し場所、受け渡し置場 |
| `sim/engine.js` | `RoboSim.Simulation`。状態、時間、合法性、移動、作業完了、観測、得点、記録 |
| `sim/controllers.js` | `RoboControllers`。TR/BR戦略一覧と `next(view)` による振り分け |
| `sim/score-planner.js` | `RoboScorePlanner`。配置/反転候補と移動時間の評価、有限先読み、キャッシュ |
| `sim/efficient-strategy.js` | `RoboEfficient`。搬送・受取・返却・見渡し・Mustika等の効率化方策 |
| `sim/match-strategies.js` | `RoboMatchStrategies`。Mustika最速、Earth重視/終盤Skyの方策 |
| `sim/competitive-strategies.js` | `RoboCompetitive`。2段目狙い、得点差対応、終盤優先の3系統 |
| `sim/post-match-review.js` | `RoboReview.Review`。試合終了後の仮想盤面編集、再集計、undo/redo |
| `sim/view.js`, `sim/style.css` | Canvas 2D表示、GUIイベント、再生、設定、分析画面 |
| `sim/tests/` | Node本体テスト `*.test.cjs` とPlaywrightブラウザテスト2本 |
| `tools/case-study.cjs` | 並列一括対戦、再開、ソースハッシュ付きログ保存 |
| `tools/case-study-core.cjs` | `run`, `profiles`, `scenarios`, `verdict`, `secureBounds` 等の対戦・分析処理 |
| `tools/case-study-cache.cjs` | 一括対戦用のキャッシュ最適化。等価性をテスト |
| `tools/audit-current-efficiency.cjs` | 効率を調べる監査用ツール。他にも過去検討用スクリプトがある |
| `vendor/` | ローカル同梱のA*とLucide、各ライセンス |
| `assets/` | `ABU2027_field_v1.STL`, `solidworks-field-top.png`。フィールドの参照資料 |
| `Reference/` | ルールブック原文・日本語訳PDF、ユーザー指定PPTX、SLDPRT/STEP/STLのフィールドモデル。末尾にファイル一覧 |
| `results/` | 過去対戦のmanifest/ログ、検証記録、スクリーンショット、過去配布用コピー等 |
| `README.md`, `STRATEGY_GUIDE.md` | 利用方法、戦略実装の案内 |
| `SIMULATION_RULES.md`, `RULE_CHECK_CASES.md` | シミュレーション上のルール・仮定、確認項目 |
| `00_START_HERE.txt` | 以前の配布用案内。一部記述は現行構成より古い |
| `index.html`, `app.js`, `styles.css` | 旧シミュレータ。現行版の修正対象と混同しない |
| `tactical-replay.html/js/css` | 旧戦術リプレイ。現行の試合ログ再生とは別 |

STLを実行時に読み込んで地形を生成しているわけではありません。現在の地形は `sim/field.js` に数値で定義されています。

ブラウザの読み込み順は `astar` → `lucide` → `field` → `engine` → `score-planner` → `efficient-strategy` → `match-strategies` → `competitive-strategies` → `controllers` → `post-match-review` → `view` です。新しい戦略を加える場合も、CommonJS側の接続とHTML側の読み込み順の両方を確認してください。

### データと制御の流れ

```text
field.js (地形・配置先) + vendor/astar.js
                    |
                    v
engine.js / Simulation <--- 検証済みの行動を時間進行に従って実行
  | view(robot)                       ^
  v                                   |
controllers.next(view) ---> 各戦略 ---> actions / brain / decision
  |                                   |
  +------ score-planner の候補評価 -----+

Simulation.snapshot()/scores()/events/history
  |                           |
  v                           v
view.js (人間用GUI)       case-study-core.cjs (画面なし対戦)
  |
  +-- 終了時コピー --> Review.original / Review.state --> 仮想得点比較
```

本体 `Simulation` の主な状態は `objects`, `robots`, `time`, `ended`, `config`, `sanctuary`, `sanctuaryEvidence`, `transferPoints`, `events`, `history`。`graphs` は経路キャッシュです。初期物体はEarth40個、Sky12個、Mustika1個で、IDを持って状態を遷移します。

`validate`, `enqueue`, `startJob`, `complete`, `step` が行動の実行経路、`footprintAllowed`, `obstacleFree`, `segmentAllowed`, `findPath` が移動の制約・経路を担当します。`changed()` は盤面変更時に経路キャッシュを無効化します。

`scores()` が実得点計算の正本です。`snapshot()` はJSONコピーを返し、ロボットの生の `brain` と `queue` は除いて、作業概要等を含めます。これは人間用の完全盤面記録で、BRに渡してよい観測ではありません。通常 `capture()` は約0.5秒間隔と終了時に記録します。`export()` の形式名は `robocon-field-sim-v1` です。

## 実行環境・依存関係

- 本体はJavaScript、HTML、CSS。ブラウザ側は通常のscriptとグローバル名、Node側はCommonJS `require/module.exports` で同じロジックを利用します。
- 現在のルートに `package.json`、lockfile、ビルド設定、`.nvmrc` はありません。本体・Nodeテスト・一括対戦にnpm外部依存の導入は不要です。
- Canvas 2D、DOM、`requestAnimationFrame`、`ResizeObserver`、Blobダウンロード等を使うため、現代的なブラウザが必要です。
- 同梱 `vendor/astar.js` はBrian GrinsteadのA*実装、MIT。正確なリリース番号はこの調査では特定していません。
- 同梱 `vendor/lucide.min.js` はヘッダー上v1.8.0、ISC。`astar-LICENSE`, `lucide-LICENSE` を維持してください。
- 今回テストに使ったNodeは **v24.19.0**。場所は `C:/Users/sasah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。これはWindowsの検証環境であり、アプリ本体の必須インストール先ではありません。
- Nodeテストは `node:test` 等、一括対戦は `worker_threads`, `fs`, `crypto`, `zlib` 等の標準モジュールを使用します。
- Playwrightはブラウザテストだけの外部依存です。2本ともWindowsのCodex同梱Playwrightを絶対パスで読み、`channel: 'msedge'` で起動します。WSLでは現状のまま実行できません。
- Pythonは任意の静的配信に使えるだけで、通常のアプリには不要です。SolidWorks、PowerPoint、PDF処理ライブラリもアプリ実行には不要です。
- 設定の正本は `sim/engine.js` の `DEFAULTS`。GUI設定はメモリー上で保持され、通常の試合書き出しには `config` が含まれます。専用の永続設定ファイルはありません。

### 主な初期設定

| キー | 値 / 意味 |
| --- | --- |
| `maxSpeed`, `acceleration` | 7 m/s、3.5 m/s^2 |
| `redSpeed`, `blueSpeed` | 各1。速度倍率は最高速と加速度をともに縮小 |
| `redTrPlan`, `blueTrPlan` | `adaptive` |
| `redBrPlan`, `blueBrPlan` | `efficient` |
| `bodySize` | 0.5 m。軸に平行な正方形車体モデル |
| `rampFactor` | 0.55 |
| `stairSpeed`, `stairPause` | 0.25、0.6秒。段差動作は簡易モデル |
| `scanSeconds` | 1秒 |
| `pickupSeconds`, `placeSeconds` | 1.5秒、2.5秒 |
| `brAutoRetrySeconds` | 5秒 |

速度倍率を落としても把持・配置・見渡し時間を一律に同倍率で伸縮する仕様ではありません。衝突・通行制約はありますが、転倒や球の転がりを剛体物理で再現するものではありません。

## 起動・実行方法

### Windowsの現行GUI

PowerShell:

```powershell
Set-Location -LiteralPath 'C:\Users\sasah\.codex\.chatgpt-projects\g-p-69fe0570a8308191bc6819be4d7b5465\robocon-strategy-sim'
Start-Process .\field-simulator.html
```

エクスプローラーで `field-simulator.html` を開いても構いません。HTML単体だけを移すと依存スクリプトがなくなります。

GUIでは赤・青それぞれのTR/BR戦略を選んで適用し、再生ボタンで開始します。3倍速再生があります。「3分計算」は描画を間引きながら試合終了まで計算する機能です。終了後は時刻バーで振り返り、「盤面検討」または「検討」タブで仮想得点を操作できます。設定適用・新規初期化では進行中の試合と分析状態が初期化されます。

### Nodeでの実行とテスト

以下はプロジェクトルートで実行します。WSLではLinux版 `node` が使えることを先に確認してください。

```sh
node --version
node --test sim/tests/*.test.cjs
node --test sim/tests/l2-review.test.cjs
```

画面なしでデフォルト設定の180秒を1試合実行し、最終得点だけ表示する例:

```sh
node -e 'const {Simulation}=require("./sim/engine.js"); const C=require("./sim/controllers.js"); const s=new Simulation(); while(!s.ended) s.step(0.05,C); console.log(JSON.stringify(s.scores(),null,2));'
```

Windowsで今回使ったテストコマンド:

```powershell
& 'C:/Users/sasah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --test sim/tests/*.test.cjs
```

Windowsの既存環境でのブラウザテスト入口は次の2本です。**WSLでそのまま動くコマンドではありません。** これらは `results/` に確認画像等を書き出すため、既存の検証成果物に注意してください。

```sh
node sim/tests/browser-smoke.cjs
node sim/tests/l2-review-browser.cjs
```

### 一括対戦

WSL移行確認後の少数試行例。実行すると結果ファイルを作成します:

```sh
node tools/case-study.cjs "results/wsl-check-$(date +%Y%m%d-%H%M%S)" --limit=1 --workers=1
node tools/case-study.cjs "results/wsl-pilot-$(date +%Y%m%d-%H%M%S)" --pilot --workers=2
```

`--workers=2`, `--limit=1` のように `=` を付けます。無指定で大規模実行しないでください。`--pilot` は登録組合せから16件抽出、`--competitive` は新3戦略と旧2戦略の比較60試合です。通常の全組合せはTR5種 x BR9種 = 45方策、赤青の順序付き45 x 45 x 速度組5種 = **10,125試合**。速度組は1:1、3/4:1、1:3/4、1/2:1、1:1/2です。GUI等にある1/4速度はこの既定一括比較には入りません。

これは「登録戦略同士の総当たり」であって、全行動列の全探索ではありません。`sim/score-planner.js` も有限の先読みです。高速計算でも経路探索・候補評価の計算量はなくなりません。

出力は `manifest.json`, `matches.jsonl`, `progress.json`, `logs/*.json.gz`、失敗時の `errors.jsonl`。`--resume` は同じ出力先・ソースハッシュ・試行範囲のときだけ使用します。コード変更後に古い結果へ追記してはいけません。この実行ツール自体は集計CSVを自動生成しません。

## 実装済みの主な機能

### 競技モデルとルール境界

- 180秒の同時進行、4台の独立した状態・行動列。`step` は最大0.05秒刻み。終了時刻以降に未完了作業を完了させません。
- 11m四方の俯瞰フィールド、左右対称の赤青領域。L1に専有各2箇所と共有2箇所、L2に共有4箇所があります。
- TR最大3個、BR最大2個。TRはL1/L2を横断できず、受け渡し区画への出入りはRamp/階段の通行制約を受けます。BRは初期進入後にGroundへ戻って活動できず、供給元から直接採集できません。
- Earth専用3個、Sky専用4個の受け渡し置場。上から受取、不要資材の返却、BRの返却分を考慮したTR納品容量の確保があります。
- MustikaはTR保持のまま受け渡し位置でBRへ直接渡します。床への納品や他資材との混載は実装上禁止です。これは採用したシミュレーション仕様であり、実ルールの未確定部分まで断定するものではありません。
- サンクチュアリは同時に自色完成2塔以上、うち共有1塔以上で達成。`completedTowers`, `updateSanctuary`, `mandateHeld` が関係し、達成時刻と塔の証拠を記録して保持します。後でSkyを反転されても一度成立した資格は失いません。現在1塔しかなくても過去に成立していれば取得可能です。
- Mustika取得・受取には資格を確認します。奉納してもVゴールにはならず、180秒まで続きます。
- BRは停止して観測し、その観測から複数の配置・反転を計画できます。持ち物2個を一連の作業として処理してから再観測する方式です。配置・反転が失敗した場合には、その場で停止して再観測する例外があります。
- BRの移動が5秒詰まった場合の自動Retryがあります。Earth/Sky保持、Mustika供給元戻し、観測/計画消去。初期進入前は開始側、進入後は自チームL1のRetry位置で再開します。手動RetryでのEarth/Sky保持は別扱いで、未対応です。
- `validate` の拒否理由、経路制約、同時操作の競合、物体保持/接触の状態を本体で扱います。未対応の動作をGUIや戦略から強制実行しないでください。

得点正本 `Simulation.scores()` の現在の値は、L1 Earth1段目10点、2段目20点、Sky3段目40点、L2は各2倍、Mustika奉納250点です。搬送得点は別管理の `transferPoints` を加算します。Earthの配置得点所属は供給元の `team` ではなく **`placedBy`**、Skyは **`color`** です。得点には層・種類・配置状態・接触等の条件があります。

これは公式ルールを完全に物理再現したことの保証ではありません。判断根拠は `SIMULATION_RULES.md` の公式根拠・ユーザー指定・仮定・未対応を区別して読んでください。

### 独立した戦略と探索

`sim/controllers.js` の `catalog.TR/BR` に登録し、`listStrategies`, `strategyDetails`, `listPresets`, `transportPlan`, `next(view)` から利用します。ロボットごとの `brain` と行動列を持ち、赤青/TR/BR別に選べます。

- TR: `balanced`, `e3-e1s2`, `adaptive`, `adaptive-e3-e1s2`, `stock-e3`。
- BR: `score-search`, `basic`, `split-seed`, `efficient`, `mustika-fast`, `earth-late`, `second-layer`, `score-adaptive`, `endgame`。
- 5つの戦略セットはTRを `stock-e3` と組み合わせています。デフォルトTR `adaptive` とは区別してください。
- `efficient-strategy.js` の `courier`, `builder`, `demand`, `stockDemand`, `oneActionAway`, `execute`, `returnCargo`, `mustikaDelivery`, `handoffNext` 等が搬送と作業を調整します。Mustika受渡・奉納の共通処理は個別戦略より優先される場合があります。
- 効率化したBR方策では通常資材を有効な2個組で持つことを重視します。Mustika、空手での反転、現地での失敗復旧等は例外です。すべての旧方策に厳密な2個出発が課されているわけではありません。
- `mustika-fast` は共有/専有へEarthを分散し、相手利用または自前完成で資格を狙います。`earth-late` は固定Earth得点を重視し、終盤にSkyへ移行します。
- `competitive-strategies.js` の `selectPlan`, `metrics`, `builder`, `replyDamage`, `endgameRank`, `phase` 等が既存Earthの2段目、観測された得点差、終盤のSky応答を評価します。150秒の切替は次の判断時で、実行中の仕事を突然破棄しません。
- `score-planner.js` の `plan`, `next`, `flipBatch`, `travelSeconds`, `travelTo` が候補・所要時間を評価します。通常2往復内などの有限先読みで、仮想状態の合法性と得点には本体処理を再利用します。終盤の反転順序も評価対象ですが、全競技の厳密な最適解ではありません。
- 戦略追加はJSの実装、CommonJS/ブラウザ双方の接続、controllersの登録が必要です。外部戦略ファイルをGUIへ投入するプラグイン機構はまだありません。

### L2見渡しと表示の改善

**現在のGUIはフィールド全体の2D俯瞰表示です。BR視点のカメラ画像や、L2から見下ろす3D画像を生成する機能ではありません。** 「L2表示改善」はL2上での認識動作と、それを人間が追える表示・経路評価を指します。

| ファイル | 実装内容 |
| --- | --- |
| `sim/field.js` | `points.red.homeL2 = {x:4.35,y:5.5}`、青は鏡像 `{x:6.65,y:5.5}`。`scanPoint(team, from)` は現在L2ならL2、それ以外はL1を選ぶ。`atScanPoint` は自チームのどちらかから0.12m以内を認める |
| `sim/engine.js` | 通常のBR scanをL1/L2両方の見渡し場所で許可。局所再観測は失敗後の例外として分離 |
| `sim/controllers.js` | 基本方策の見渡し帰還先を地形に合わせる処理 |
| `sim/efficient-strategy.js` | L2作業後はL2で再観測。受取・返却・Mustika受渡後はL1側へ。効率化方策の待機はL2通行を塞がないようL1へ移る処理もある |
| `sim/score-planner.js` | 現在位置からの移動・帰還時間を使う。補給時は受け渡し/L1経由。次の先読みとキャッシュキーも帰還点を考慮 |
| `sim/view.js` | `destinations()` に両階の見渡し先。`draw(state)` でL2床を描いた後に見渡し印を描き、床に隠れないようにする。ロボットの観測表示はL1/L2/その場を識別 |
| `field-simulator.html`, `sim/style.css` | 関連GUIと終了後分析の部品・レイアウト。同時期の変更であり、全変更をL2専用とは断定しない |
| `sim/tests/l2-review.test.cjs` | L2認識、帰還、所要時間、終了後分析等の回帰テスト |

人間向け描画にはフィールド全体、段差・壁、4台の役割/チーム、所持E/S/M、種類別置場、経路、車体範囲を表示します。タワーは層を少しずらしてE/Sと色を描き、サイド欄にも段別の物体と在庫を表示します。拡大表示もあります。これらは既存の視認性機能を含み、「すべて直近に新規実装した」という意味ではありません。

L2見渡しの座標は参照PPTXの5枚目の注記位置を目安に設定したものです。精密寸法測定に基づく座標ではありません。L2見渡し場所は通行を物理的に専有する領域ではありません。

### 試合終了後の得点分析GUI

状態の分離は `sim/post-match-review.js` の `Review` が担当します。`ended === true` かつ `time === 180` の最終スナップショットだけを受け付け、`original` と `state` をそれぞれJSONディープコピーします。元の `Simulation` を編集しません。

| 項目 | 現在の実装 |
| --- | --- |
| 編集可能な物体 | `location === 'spot'` の配置済みEarth/Sky。空欄、手持ち、置場内、Mustikaは対象外 |
| Sky表裏変更 | `Review.flip(id)` / `setColor(id, color)` がSkyの `color` を赤青変更 |
| Earth所属変更 | 同じAPIがEarthの **`placedBy`** を変更。供給元 `team`、ID、位置、段は維持 |
| 再計算 | 各 `apply` で `Review.state.scores` を更新 |
| 得点ロジック | `scores(state)` が薄いアダプター経由で **`Simulation.prototype.scores.call(...)`** を呼ぶ。GUI独自の採点式は持たない |
| 元/仮想の区別 | `review.original.scores` と `review.state.scores`。比較表に実終了時、仮想、差分、赤青得点差を表示 |
| メイン表示 | 分析中の上部得点は仮想値で、「仮想盤面」と表示。元試合の記録は変えない |
| 元に戻す | `undo`, `redo`, `reset`。resetは実終了盤面のコピーへ戻す |
| 分析の出入り | `startReview`, `exitReview`, `renderReview` と `reviewActive`。実結果へ戻る/時刻バーで再生に戻るだけなら分析案は保持、新規試合初期化では破棄 |
| 書き出し | 通常ダウンロードは元の `sim.export()`、分析ダウンロードは別の `robocon-post-match-review-v1` (`original`, `hypothetical`, `changes`) |

搬送得点、Mustikaの状態、終了時の接触状態、過去のサンクチュアリ達成履歴は分析で作り直しません。終了時に接触中の物体は色を変えても得点対象外のままです。分析は「この所属色なら何点か」であり、試合中にその盤面へ合法的に到達できたことや、残り時間内にその変更ができたことを保証しません。Earth反転はこの分析上の仮想操作で、試合中のEarth反転を許す変更ではありません。

**反転の操作:**

- 分析欄は全10配置先を列挙し、各1/2/3段目の配置済み物体を選択できます。
- 段のセルを押すと「選択」します。続いて共通の `#review-flip` を押すと反転します。赤/青の色指定ボタンもあります。
- `#review-flip-label` は選択物に応じて「Earth反転」「Sky反転」に変わります。
- フィールドを押した場合はその塔の最上段が選ばれます。下段Earthは分析欄で選択します。

## 維持したい設計判断

1. ゲーム状態・合法性・得点は `Simulation` を正本とし、GUIや戦略の都合で競技ルールを変えない。
2. 得点計算をGUIや分析に複製しない。`Review` と候補評価は本体を再利用し、加点ルールを変えるときは両方のテストも確認する。
3. 元試合と分析コピーを分離する。分析中の色変更で元のログ・リプレイ・終了得点を汚さない。
4. 戦略はロボットごとの状態と観測を入力にする。自分に見えていない相手の計画や未来の到着時間を都合よく取得しない。
5. WebとNodeが同じ本体を使う。画面なし対戦だけでルールを省略した高速版にしない。
6. キャッシュは意味を変えない。GUI `reset()` は世代番号更新、`RoboScorePlanner.clearCache()`、経路キャッシュ破棄、新規Simulationを行う。バッチの最適化も等価性を維持する。
7. 各種モデル仮定、公式ルール、ユーザー指定を区別する。勝ち確判定も採用モデル内の上下界であって実競技の無条件の保証ではない。

## Git状態と最近の変更

### 実際に確認したGit状態

以下は初回引継ぎ作成時、2資料と `Reference/` の追加前の記録です。ファイル件数は当時の値であり、追記後の現在値ではありません。

| 確認項目 | 結果 |
| --- | --- |
| プロジェクトの `.git` | なし。上位のChatGPTプロジェクトにもなし |
| `git rev-parse --show-toplevel` | `C:/Users/sasah` |
| branch | `master` |
| `git rev-parse --verify HEAD` | `fatal: Needed a single revision`。比較可能なHEADなし |
| `git ls-files -- .` | シミュレータ配下の追跡ファイル0件 |
| `git status --porcelain=v1 --untracked-files=all -- .` | 既存490ファイルすべて `??`。うち `results/` 438件、その他52件 |
| `git diff --no-ext-diff --stat -- .` / `--cached` | ともに空。未追跡なので差分に現れないだけで、保存済み・cleanの意味ではない |

Windowsでは初回に所有者不一致の警告があり、読み取り確認に限り `git -c safe.directory=C:/Users/sasah ...` を使いました。グローバルGit設定は変更していません。`GIT_OPTIONAL_LOCKS=0` とプロジェクト範囲の `-- .` で確認しています。

このため、現行コードの変更履歴をGitのコミット差分から復元することはできません。既存の未コミット作業はすべて保全してください。ユーザーフォルダー全体の `.git` をWSLへ持っていかないでください。新しいリポジトリを作るかは次の担当者がユーザーと確認する事項です。

初回引継ぎ作成で追加した新規ファイルは `HANDOFF.md` と `AGENTS.md` の2件です。その際のファイル一覧は490件から492件となり、既存ファイルの変更・削除はありませんでした。既存ソース等52件はSHA-256、`results/` 438件はサイズ・更新時刻が不変であることを確認しました。その後ユーザーが `Reference/` に6ファイルを追加し、この追記開始時点では498件あります。

### 古い配布ZIPとの比較で分かった直近変更

`../ABU2027_Simulator_20260924_140517.zip` 内の `ABU2027_Simulator/` と現在のファイルを読み取り・ハッシュ比較しました。これは **Git差分ではなく配布ZIPとの比較** です。既存49ファイルとの比較では次の差があります。

| 区分 | ファイル |
| --- | --- |
| 新規3件 | `sim/post-match-review.js`, `sim/tests/l2-review.test.cjs`, `sim/tests/l2-review-browser.cjs` |
| 更新12件 | `field-simulator.html`, `README.md`, `RULE_CHECK_CASES.md`, `SIMULATION_RULES.md`, `STRATEGY_GUIDE.md`, `sim/controllers.js`, `sim/efficient-strategy.js`, `sim/engine.js`, `sim/field.js`, `sim/score-planner.js`, `sim/style.css`, `sim/view.js` |

L2認識・帰還と終了後分析に関する変更は上記の現行ファイルで確認しました。古いZIPにはこれらが入っていないので、**移行元には今のフォルダーを使ってください**。今回ZIPの再作成はしていません。

## 動作確認・未確認・既知の注意点

### 初回引継ぎ作成時に実行して確認したこと

- Windows、Node v24.19.0、プロジェクトルートで `node --test sim/tests/*.test.cjs` を実行。
- **158件成功、失敗0、skip 0、終了コード0。所要約54.8秒。** 実180秒シミュレーション、複数速度、ルール拒否、観測、L2、分析コピー、Earth/Sky反転、キャッシュ等のテストを含みます。
- Gitの実ルート・追跡状況・差分、主要ソース・設定・ドキュメント、旧ZIPとの差を読み取り確認しました。
- WSLでのコマンドやブラウザを実行したわけではありません。
- `Reference/` 追加に伴う今回の追記では、ファイル一覧と反転処理の実装を確認しました。資料更新のみのため、テストは再実行していません。

### この資料作成より前のWindows確認

- `sim/tests/browser-smoke.cjs` の成功記録あり。最新のEarth分析反転より前の広範囲GUI確認です。
- `sim/tests/l2-review-browser.cjs` はEarth反転追加後に成功。ファイル直開き、180秒試合、L2認識、Sky/Earth分析変更、差分、undo/redo/reset、元試合書き出しの不変、再生、分析JSON、狭幅画面を確認しました。
- `results/l2-review-qa/` の `l2-start-desktop.png`, `review-real-match.png`, `review-edited-desktop.png`, `review-mobile.png`, `review-export.json` に成果物があります。以前のWindows確認時には画面も目視確認しています。
- 今回の資料作成ではブラウザテストを再実行していません。既存スクリーンショットが現在のWSL動作を証明するわけではありません。

### 過去の戦略比較の位置づけ

`results/competitive-modes-2026-09-24/VERIFICATION.md` に新3戦略 vs 旧2戦略、赤青入替、速度組5種、TR `stock-e3` の計60試合の記録があります。記録上は `second-layer` 11勝9敗、`score-adaptive` 4勝16敗、`endgame` 14勝6敗でした。

ただし同ディレクトリのmanifestのハッシュは、現在の `engine.js`, `field.js`, `controllers.js`, `score-planner.js`, `efficient-strategy.js` と一致しません。**L2等の修正前の履歴** であり、現行版での期待勝率や全探索結果ではありません。現在の全10,125試合の完了を示すものもありません。再評価は新しい出力先で行ってください。

### 未確認・既知の不具合/制限

- WSLディストリビューション、Linux版Node、Linuxブラウザ、WSLからWindowsブラウザへの接続は未確認。
- ブラウザテスト2本のPlaywright絶対パスとEdge指定が移行上の既知の障害です。
- L2見渡し位置は概略座標。俯瞰表示はあり、実機カメラ視野の再現はありません。
- 観測は理想スナップショットで、遮蔽・誤検出・視野・観測遅延は未モデル化。後述のAPI境界も未実装です。
- 物理的な転倒・転がり・破壊、審判判断などは網羅しません。Mustika混載等の未対応操作を「公式に禁止」と読み替えないでください。
- `SIMULATION_RULES.md` は見出しの日付や参照資料「全4枚」の記述が古く、本文に5枚目のL2追記があります。`00_START_HERE.txt` のtools全体を旧用途とする案内も、現行 `case-study*.cjs` には当てはまりません。今回はこれらの既存資料は変更していません。
- フォントはWindows向けYu Gothic UI/Meiryo等を含むため、Linux側では日本語フォントと文字幅・折返しを確認してください。

## 次の開発フェーズ

### 1. WSLへ移行して同等動作を確認する

移行先の例は `~/projects/robocon-strategy-sim` です。まだ作成・コピーした事実はありません。既存の移行先がある場合は上書きせず差分を確認してください。以下のフォルダー全体のコピーには `Reference/` も含まれるため、同梱したルールブック・PPTX・モデルを別途コピーする必要はありません。

WSL側でのコピー例:

```sh
mkdir -p "$HOME/projects"
src='/mnt/c/Users/sasah/.codex/.chatgpt-projects/g-p-69fe0570a8308191bc6819be4d7b5465/robocon-strategy-sim'
dst="$HOME/projects/robocon-strategy-sim"
if [ -e "$dst" ]; then
  printf '%s\n' 'Destination already exists; stop and compare before copying.'
else
  cp -a -- "$src" "$dst"
fi
```

コピーが成功したことを確認後:

```sh
cd "$HOME/projects/robocon-strategy-sim"
node --version
node --test sim/tests/*.test.cjs
```

Linux版Node 24系を今回の検証環境に近い基準として用意してください。ディストリビューションや既存のNode管理方法は未確認なので、導入方法を勝手に決めて上書きしないでください。本体にnpm installは不要です。

WSL側ファイルをWindowsブラウザから確認する際は、任意の静的サーバーを利用できます:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Windowsブラウザで `http://localhost:8765/field-simulator.html` を開きます。終了はサーバー側でCtrl+C。ポートが使用中なら別ポートを選びます。localhost転送はWSLの設定に依存するため、接続できること自体を確認してください。これは静的ファイル配信であり、BR用APIではありません。

ブラウザテスト移植時は `sim/tests/browser-smoke.cjs` と `sim/tests/l2-review-browser.cjs` の次の2点を直す必要があります:

```js
require('C:/Users/sasah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
chromium.launch({ channel: 'msedge', headless: true })
```

ローカル依存としてのPlaywright解決とLinux対応ブラウザに切り替え、必要ならテスト用package manifest/lockを別作業で導入してください。Playwrightをインストールするだけでは固定パス問題は解消しません。Windows側の動作も必要なら保全します。今回これらのソースは変更していません。

移行後の受入確認:

1. 本体依存の構築、Nodeテスト158件相当の成功、画面なし180秒の完走。
2. 現行GUIの起動、両チームTR/BR、戦略選択、3倍速、3分計算、リプレイ、書き出し。
3. L1/L2の見渡し表示、L2作業後のL2再観測、補給時のL1帰還、地形に沿う移動。
4. 元の得点、サンクチュアリの履歴、Mustika後も180秒まで継続すること。
5. 終了後分析で下段を含むEarthと全箇所Skyの選択・色変更・差分・undo/redo/reset・元結果保全。
6. デスクトップ/狭幅の日本語表示、コンソールエラーなし、依存ファイルの欠落なし。
7. 新しい出力先で少数の一括対戦。古いmanifestと混在させない。

### 2. API化: Ground Truth と Observation を明確に分ける

**Simulator Ground Truth** は正確な全物体、全ロボット、内部計画、実行中作業、合法性、真の得点等の内部状態です。人間用GUIや検証には必要ですが、BR向けAPIに無条件で渡してはいけません。

**Robot Observation** は実機BRがその時点で取得できる情報だけです。観測時刻、観測位置、見えない/分からない項目、古さ、取得時間等を表現し、停止して見渡す制約を守る必要があります。実機では取得できない盤面全体を見ながら動くような制御にしないでください。

現在すでにある境界は次のとおりです:

- `Simulation.observe(robot)` が `robot.observation` のコピーを作ります。自チーム置場、自専有/共有タワー、供給元、資格/証拠、柱、相方の位置/荷物、Mustika受渡情報、得点、相手BR情報等を含みます。
- `Simulation.view(robot)` は自機位置、荷物、観測、失敗、brain、運搬履歴、時刻、運動設定、戦略ID等のコピーをcontrollerへ渡します。
- BRの観測はscan完了で更新します。移動中に盤面を自動追従させません。TRは人間操縦のモデルとして判断前に観測更新します。
- 相方の未観測の計画・次の目的地・到着予定時刻は渡さない方針です。

ただし **実機相当の観測境界としては未完成** です。現在の観測は地形上の全共有タワー等の正確な内容、正確な得点、相手BR位置や最高速/配置秒数まで含む理想化されたモデルです。視野・遮蔽・認識誤差はありません。またGUIの `window.fieldApp.sim` から完全状態を触れるため、同一JS空間の戦略に対する安全な隔離ではありません。

API化では、人間/管理用完全状態とBR用観測の入口を分離し、BR側へ `Simulation` そのものや人間用 `snapshot()` を渡さないこと。観測モデルを独立して定義し、情報の出所・取得可否・更新時刻を明示し、行動は必ずengineの検証を通してください。見えない状態の変更が次回観測までBRの判断に漏れないテストも必要です。通信方式、プロセス分離、認証等の設計はこれからで、今回はAPI実装をしていません。

## 参照資料と次の担当者への注意

ユーザーがプロジェクトルートの **`Reference/`** に以下の6ファイルを追加済みです。WSL移行後もこのプロジェクト内の相対パスを参照してください。Linuxでは大文字小文字を区別するため、ディレクトリ名は `Reference` です。

| ファイル | 用途 |
| --- | --- |
| `Reference/Robocon_2027_Rulebook_v1-1.pdf` | ルールブック原文 |
| `Reference/Robocon_2027_Rulebook_v1-1_ja.pdf` | ルールブック日本語訳。解釈が曖昧な場合は原文も確認 |
| `Reference/シミュレーションにおけるルール作り.pptx` | ユーザー指定のシミュレーション注意点・見渡し場所等 |
| `Reference/ABU2027_field_v1.SLDPRT` | SolidWorksのフィールドモデル |
| `Reference/ABU2027_field_v1.STEP` | フィールドモデルのSTEP形式 |
| `Reference/ABU2027_field_v1.STL` | フィールドモデルのSTL形式 |

これらは開発時の参照資料であり、アプリ実行時の必須依存ではありません。モデルを置き換えても `sim/field.js` の地形定義は自動更新されません。`assets/` にも従来のSTLと俯瞰画像がありますが、今回同梱された原資料の確認先は `Reference/` です。元のWindows外部パスがなくても、同梱資料を参照できます。

過去に確認した注意点PPTXは5枚で、L2見渡しの追記は5枚目です。今回の追記は同梱ファイルの存在確認であり、PDFの再翻訳・全ページ確認、PPTXの全スライド描画、CADモデルの再検証は行っていません。

上位プロジェクトの `sources/` は同期される読み取り専用資料です。編集・移動・削除しないでください。`results/` の過去配布コピーを現行ソースと間違えて修正しないでください。

当面は移行確認を優先し、その後、現行L2モデルでの戦略再評価、観測境界を整えたBR API化をそれぞれ独立した作業として進めます。過去会話がなくても、この資料と現行コードを優先して確認し、未確認事項を確認済みに読み替えないでください。
