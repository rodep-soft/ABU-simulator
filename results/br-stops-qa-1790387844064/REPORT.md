# BR停止観測・箱と配置先の指定 検証記録

実施日: 2026-09-26。対象はWindowsの `ABU-simulator-git`。
開始時HEAD: `0cc3841886820cfe3008fbc4a1110363b73476c4`、main、未コミット変更なし。
この追加は未コミット・未push。WSL側のコード・探索・結果は変更していない。

## 実装

- GUI既定を `brObservationMode: stopped` に変更。移動先到着時と同一配置先の作業後、その場で既定1秒観測して再計画。従来の固定見渡しモードも選択可能。Node省略時は従来互換のfixed。
- 開始時・手待ちのBRは受渡そばの待機点へ。受取位置から0.8m離れ、通常TR・ideal補給を止めない。
- 両色独立のBR順番設定で、各回にEarth/Sky/なしの2枠と配置先番号を指定。既存の名前付き戦略を使う回も混在可能。
- 指定した2個が揃うまで待つ。有限資材不足は指定解除をログに記録。相手に配置先を埋められた場合は、次の停止観測後に通常戦略で代替配置、不可なら返却。
- 部分受取・配置1個目の後・Retry時は物体IDと回の進捗を維持。回の消費は処理完了後のみ。
- 物理、採点、Mustika資格・手渡し、180秒終了、試合後分析の状態分離は既存本体を使用。

変更箇所: `field-simulator.html`、`sim/field.js`、`sim/engine.js`、`sim/controllers.js`、`sim/efficient-strategy.js`、`sim/score-planner.js`、`sim/view.js`、`sim/style.css`。設定・設計はREADME、STRATEGY_GUIDE、SIMULATION_RULES、RULE_CHECK_CASES、AGENTS、HANDOFFへ反映。

## 最終コードでの確認

Windows / 同梱Node v24.19.0:

```sh
node --test --test-concurrency=2 sim/tests/*.test.cjs
```

**200件成功、0件失敗、約193.13秒**。新規 `br-stops.test.cjs` の17件を含む。新規テスト単独も17件成功、約34.16秒。

重点確認はE/S/なしの全8非空組合せ、通常補給の初動、2個待ち、有限不足、途中で埋まった配置先、Sky返却、既存10種のBR戦略への荷物引継ぎ、Retry後の部分受取、固定モード互換、L2上の残り1個と現地認識、キャッシュ等価性、両色・通常/idealの180秒動作。

Playwright / Edge (`NODE_PATH` にPlaywright導入先、`ROBO_BROWSER_CHANNEL=msedge`):

```sh
node sim/tests/br-stops-browser.cjs
```

**成功**。詳細は同階層の `verification.json`、画像は `turns-{1440,390,320}.png` と `field-{1440,390,320}.png`。

- 箱/配置先の変更、赤青独立、並替、削除、取消、適用、両枠なしの適用拒否、相手専有の選択除外。
- 1440/390/320pxで横はみ出しなし、JavaScriptエラー0、canvas描画あり。PCフィールド、320pxフィールド・編集欄を目視確認。
- idealで180秒完走。赤は指定どおり最初の4配置が 1→2→1→1。初回観測は赤(3.7,6.8)、青(7.3,6.8)。両BR合計83回のscanを記録。
- このGUI確認試合は赤560/青470、idealの搬送点は両者0。**1試合の動作確認であり、戦略の優劣を示す比較ではない。**
- 終了後分析で色を変更しても元試合のexportは不変。リプレイで当時の指定回を表示。リセット・fixed/stopped往復でも指定設定を保持。

`git diff --check` 成功。改行形式についてGitのLF→CRLF予告はあるが、空白エラーはなし。

## 制約・未確認

- 停止位置から全盤面を正確に認識できる仮定。観測更新の時刻境界は守るが、実機での視野・遮蔽・認識誤差はモデル化していない。
- 箱指定は未受領Mustikaへの割込より優先。既に保持したMustikaは奉納を優先する。
- 長時間探索、GitHub Pagesへの反映、スマホ実機、WSL実行、実機カメラ確認、配布ZIP更新は実施していない。
- 途中のGUI記録 `../br-stops-qa-1790387000850/` は上書きせず保全。
