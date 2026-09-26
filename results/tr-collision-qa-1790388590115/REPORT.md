# TR同士の競合救済 検証記録

2026-09-26、Windows GUI版。既存のBR停止観測・箱指定などの未コミット変更を保全して追加。WSL側には触れていない。commit/pushは未実施。

## 変更

`sim/engine.js` の移動衝突処理から、相手TRが原因の停止を区別して記録。`updateTrCollisionRestarts` が自動TRの連続1秒停止を検出し、自分の元の開始枠へ復帰させる。壁/箱/BR、採集、荷下ろし、手渡し、待機、階段停止、同一物体の同時取得要求は対象外。

開始枠の占有を検査し、塞がっていれば作業を凍結して待つ。荷物 (Mustikaを含む)、便の途中納品・完了数、判断状態、移動先と後続予定を保持し、経路だけ再計算。得点・配置・資格は変更しない。手動化で取消、終了後の復帰なし。公式Retryとは別のシミュレーション仮定。

## 最終確認

```sh
node --test --test-concurrency=2 sim/tests/*.test.cjs
```

**210件成功、失敗0件、約193.77秒**。新規10件は両色・4速度で正確に1秒後の復帰、通常停止の除外、積荷・便・計画保持、Mustika保持、開始枠占有、時計の解除、同時復帰順序、終了境界・無効設定を確認。既存BR Retryテスト17件も成功。

```sh
node sim/tests/tr-collision-browser.cjs
```

Playwright / Edge、成功 (`NODE_PATH` にPlaywright導入先、`ROBO_BROWSER_CHANNEL=msedge`)。

- 衝突を意図的に作った検証盤面で0.95秒までは元の位置、1秒で赤TR開始枠へ復帰。Earth1を保持し、画面の状態欄とイベントに反映。リプレイ0.5秒では競合中、1秒では復帰済み。
- リセット後に通常の初期盤面から180秒完走。この1試合ではTR復帰0回。赤515/青485は動作確認値であり戦略評価ではない。
- JavaScriptエラー0、390pxで横はみ出しなし。PCの復帰画像と狭幅の試合終了画像を目視確認。
- 詳細は `verification.json`、画像は `restart-desktop.png` / `match-mobile.png`。
- `git diff --check` は空白エラーなし (GitのLF→CRLF予告あり)。

未実施: GitHub Pages反映、WSL実行、スマホ実機、長時間探索、公式Retryのモデル化。前回のコードと同じ試合結果を保証する変更ではなく、競合救済が入る対戦では運搬時刻・結果が変わり得る。
