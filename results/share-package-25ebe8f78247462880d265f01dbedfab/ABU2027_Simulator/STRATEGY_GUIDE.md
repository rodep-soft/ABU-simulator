# 戦略の追加ガイド

## 編集するファイル

| ファイル | 役割 |
| --- | --- |
| `sim/controllers.js` | 戦略の登録一覧 `catalog`、TRの `courier`、BRの `builder`・`splitBuilder`、戦略の呼び分け `next` |
| `sim/score-planner.js` | BRの得点探索。`plan` が候補評価、`next` が帰還・受取・見渡し・作業の指示 |
| `sim/engine.js` | 競技ルール、採点、移動、積載制約、見渡し、時間進行。戦略の公平な比較では共通にする |
| `sim/field.js` | フィールド形状、スポット、移動先の座標 |
| `sim/view.js` | 表示と操作。通常の戦略追加では編集不要 |

**基本は「判断関数を書く → `controllers.js` の `catalog` に登録」です。**
各人の戦略には別々のIDを付けて登録すれば、赤・青の選択メニューで対戦させられます。
メニューへ追加しただけでは適用されません。ブラウザを再読み込みし、戦略を選んで
「この戦略で初期化」を押してください。TRとBRの選択は独立しています。

## TRの運搬内容だけを変える

`controllers.js` の `catalog.TR` 配列に、次のような項目を追加します。
この例は追加用であり、共有版にはあらかじめ登録していません。

```js
{
  id: 'team-a-opening',
  name: 'Team A opening',
  shortName: 'Team A',
  opening: [
    { earth: 3, sky: 0, label: 'E3' },
    { earth: 1, sky: 2, label: 'E1+S2' },
  ],
  repeat: { earth: 2, sky: 1, label: 'E2+S1' },
  run: courier,
},
```

- `opening`: 開幕から便ごとの運搬内容。空配列なら初便から `repeat` を使います。
- `repeat`: 開幕指定の完了後に繰り返す内容。
- `earth`・`sky`: 非負整数、合計1〜3個。1便の全数を納品してから便数が進みます。
- `run: courier`: 既存の採集・移動・納品処理を再利用します。開幕指定後は条件を満たしたMustikaを優先します。
- 異なる採集順や適応的な運搬まで変えるなら、独自の判断関数を `run` に指定します。
  現在のTRメニュー・搬送目標表示は `opening` と `repeat` を前提にしています。
  独自関数を使う場合も登録に両項目を残し、表示と実際の運搬内容を一致させてください。

## BRの新しい判断を書く

`controllers.js` 内の `catalog` より前に、`myBuilder(v)` のような関数を定義し、
`catalog.BR` 配列に登録します。既存の `builder` や `splitBuilder` を参考にできます。

```js
{
  id: 'team-a-builder',
  name: 'Team A builder',
  shortName: 'Team A',
  run: myBuilder,
  details: team => [
    ['Policy', 'My building policy'],
    ['Team', team],
  ],
},
```

`name` はメニュー、`shortName` は上部の戦略表示、`details` は戦略詳細です。
`id` は同じ役割の他の戦略と重複させないでください。

## 判断関数の入出力

判断関数は、そのロボットの動作と予約された作業が空になった時に呼ばれます。
受け取る `v` はコピーで、実際の盤面を直接書き換えるものではありません。

| 入力 | 内容 |
| --- | --- |
| `v.team` / `v.role` / `v.id` | 赤・青、TR・BR、ロボットID |
| `v.x`, `v.y` | 自分の現在位置（メートル） |
| `v.cargo` | 自分が保持する物体の配列。IDだけでなく種類なども含む |
| `v.observation` | 最後に観測した盤面。未観測時は `null` |
| `v.observation.at` | 観測時刻 |
| `v.observation.stock` | 観測時の自チーム受け渡し在庫 |
| `v.observation.towers` | 観測時の自チーム専有・共有スポットの積み上げ状態 |
| `v.observation.sanctuary` | 観測時点で条件を一度でも達成していたか |
| `v.observation.source` | 供給元。BRが直接採集してよいという意味ではない |
| `v.observation.pillar` | 観測時の奉納済みMustika。なければ `null` |
| `v.time` | 現在の試合時刻。残り時間は `180 - v.time` |
| `v.motion` | 自分の速度倍率・最高速度・加速度・各動作時間など |
| `v.brain` | 前回返した判断用の記憶。開始時は `{ stage: 'start' }` |
| `v.failure` | 直前の失敗理由。なければ `null` |
| `v.transport` | 自分の納品履歴。TRの便数管理に使用 |

戻り値の形は次のとおりです。

```js
return {
  brain: { stage: 'return' },
  actions: [
    { type: 'move', target: F.points[v.team].home },
    { type: 'scan' },
  ],
};
```

これは移動と認識の指示例で、完成した建設戦略ではありません。
`brain` は毎回返します。待機なら `{ brain: v.brain, wait: 1 }` のように秒数を指定します。
JSONに保存できる値を使い、記憶に関数や実際のSimulationオブジェクトを入れないでください。

主要な作業指示:

| 指示 | 指定する値 |
| --- | --- |
| `move` | `target: { x, y }`。建設位置は `F.spotApproaches(F.spotById[id], v.team)[0]` など |
| `scan` | 見渡し場所での停止・認識 |
| `pickup` | TRのみ。`objectId` で供給元の物体を指定 |
| `unload` | TRのみ。受け渡し位置で先頭の手持ち1個を納品 |
| `receive` | BRのみ。`objectId` で受け渡し在庫を指定 |
| `place` | BRのみ。`objectId` と `spotId` を指定 |
| `flip` | BRのみ。`spotId` でSky反転を指定 |
| `recover` | BRのみ。`spotId` で自分が置いた最上段Earthの回収を指定 |
| `enshrine` | BRのみ。中央柱へMustikaを奉納 |

移動と作業は別指示です。先に到達可能な作業位置へ移動させてください。
実際の可否は実行開始時と完了時に `engine.js` が判定します。

## BRで守ること

- 判断に使う盤面は `v.observation`。走行中に `window.fieldApp.sim` などから最新状態を取得しないでください。
- 開始時・作業後・失敗後には `F.points[v.team].home` へ戻って `scan` します。
- ブロックを受け取った後にも見渡しが必要です。最大2個を扱う作業先と順序は出発前に決定します。
- 在庫は上の物体から取り出します。BRは最大2個で、2個保持中のSky反転には空きがありません。
- TR・BRの活動域、供給元からの直接取得禁止、受け渡し位置などは共通エンジンに従います。
- 一連の作業が途中で不可能になった場合、後続指示は取り消されます。`v.failure` を処理して帰還・再認識してください。
- 判断用の記憶はロボット別の `v.brain` に入れます。共有変数で他ロボットの観測情報を渡さないでください。
- Mustika奉納は試合終了ではありません。180秒まで次の行動を選びます。

## 各人のファイルに分ける場合

独自の判断関数を `sim/team-a-strategy.js` などに分けることもできます。
その場合は既存の `score-planner.js` と同様の公開形式にして、
`field-simulator.html` で `controllers.js` より前に読み込み、
`controllers.js` 冒頭でブラウザ用の公開関数とNode.js用の `require` を受け取って登録します。
**ファイルをフォルダーに置くだけでは自動登録されません。**

## 動作確認

通常利用にはNode.jsは不要です。開発用テストはNode.jsの入った環境で、
このフォルダーを作業場所にして実行します。

```text
node --test sim/tests/engine.test.cjs sim/tests/transport-plan.test.cjs sim/tests/split-builder.test.cjs sim/tests/score-planner.test.cjs
```

既存のテストには戦略ID一覧を確認するものがあります。新規登録時はその期待値も更新し、
新しい戦略の初動・見渡し・積載・180秒終了のテストを追加してください。
ブラウザでは「戦略」で自作戦略を選択し「この戦略で初期化」した後、
「3分計算」とリプレイ・保存ログで実際の動きを確認します。

現在の得点探索は最大2往復の先読みです。変更する場合も、探索範囲と評価方法を
明記し、3分全体の最適解や勝率と混同しないようにしてください。
