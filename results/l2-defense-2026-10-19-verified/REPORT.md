# 短時間待機固定・奉納後L2 Sky防衛の比較

## 条件

- 赤は短時間待機→後半V2と、短時間待機→自チーム奉納後L2防衛。青はV2・等速固定。各速度各案1試合、計6試合。決定論的事例であり統計的勝率・全探索ではない。
- 180秒・0.05秒刻み、有限理想供給、停止時全盤面観測1秒、Mustika取得通知OFF。最大7m/s・加速度3.5m/s²に赤倍率1・0.75・0.5を同時適用。GUIと同じengine/controllers。
- 初動は赤②（青側で使う場合は⑥）をE2→S1で完成し、E1+S1で共有①を狙う上限5秒待機案。各組で自チーム奉納完了まで全4台のイベントが一致することをassertした（赤BRのdecision.strategyという表示用戦略名のみ正規化。時刻・行動・物体・予測値は変更しない）。
- 新案は自チーム奉納を観測した後だけ切替。L2⑦⑧⑨⑩のSky取得（反転/新規配置）をL2 Earthより優先。V2の点差・所要時間・再反転リスク評価と共通plannerを使用。得点式・合法性・地形・物理は変更していない。
- 防衛は通路封鎖ではなく、自色L2 Skyがあり150秒以降/観測相手がL2接近/全4塔確保ならL2で有料再観測して再奪取。先に有用な手持ちL2作業を行う。2箱が使えなければ1個返却して反転枠を空ける。時間内にL2仕事がなければV2へフォールバック。
- 到着先の作業は新しい観測で合法性を再確認して完了。相手の位置評価が変わるだけで置き先を延々選び直さない。相手が埋めた・容量不足・時間不足なら再計画。
- 既定のBR移動停止5秒Retry、TR相互衝突1秒救済を維持。停止全盤面認識は理想化。相手内部意図・将来到着・観測外更新は参照しない。

## 得点

| 赤速度 | 現行 赤:青 | 現行点差 | L2防衛 赤:青 | 防衛点差 | 点差改善 | 奉納秒 | 初動一致 |
|---|---:|---:|---:|---:|---:|---:|---|
| 1 | 570:340 | +230 | 540:400 | +140 | -90 | 81.75 | 完全一致 |
| 0.75 | 500:510 | -10 | 540:400 | +140 | +150 | 84.75 | 完全一致 |
| 0.5 | 460:340 | +120 | 500:430 | +70 | -50 | 95 | 完全一致 |

## 終盤ログ

### 1倍・後半V2（現行）

終了時L2: 8番 E(red)/E(red) / 9番 E(blue)/E(blue) / 7番 E(red)/E(red) / 10番 E(blue)/E(blue)

- 140.25秒 blueBR flip 1番
- 142.30秒 redBR place 3番 earth
- 144.80秒 redBR place 3番 earth
- 152.50秒 redBR flip 1番
- 154.35秒 blueBR place 4番 earth
- 156.85秒 blueBR place 4番 earth
- 165.50秒 redBR place 3番 sky
- 165.65秒 blueBR flip 1番
- 173.20秒 redBR flip 1番
- 178.25秒 blueBR place 4番 sky
- 178.30秒 redBR return  earth

Retry/救済 0記録、拒否 0記録。未完了の作業は得点に含めない。

### 1倍・奉納後L2防衛

終了時L2: 8番 E(red)/E(red)/S(red) / 9番 E(blue)/E(blue) / 7番 E(red)/E(blue) / 10番 E(blue)/E(red)/S(blue)

- 145.30秒 redBR place 10番 earth
- 151.80秒 blueBR place 4番 earth
- 151.95秒 redBR flip 8番
- 158.60秒 redBR place 10番 sky
- 164.00秒 blueBR flip 8番
- 173.20秒 redBR flip 8番
- 173.95秒 blueBR flip 10番

Retry/救済 0記録、拒否 0記録。未完了の作業は得点に含めない。

### 0.75倍・後半V2（現行）

終了時L2: 8番 E(red)/E(red)/S(blue) / 9番 E(blue)/E(blue) / 7番 E(red)/E(red)/S(blue) / 10番 E(blue)/E(blue)/S(blue)

- 144.90秒 redBR place 7番 sky
- 152.75秒 blueBR place 8番 sky
- 158.40秒 blueBR flip 7番
- 165.10秒 redBR flip 8番
- 171.50秒 blueBR flip 8番
- 178.15秒 blueBR place 10番 sky
- 178.75秒 redBR flip 1番

Retry/救済 0記録、拒否 0記録。未完了の作業は得点に含めない。

### 0.75倍・奉納後L2防衛

終了時L2: 8番 E(red)/E(red)/S(blue) / 9番 E(blue)/E(blue) / 7番 E(red)/E(red) / 10番 E(blue)/E(blue)/S(red)

- 146.65秒 redBR place 7番 earth
- 152.50秒 redBR flip 8番
- 159.45秒 redBR place 10番 sky
- 160.65秒 blueBR place 4番 earth
- 171.50秒 blueBR flip 10番
- 177.55秒 redBR flip 10番
- 178.15秒 blueBR flip 8番

Retry/救済 0記録、拒否 0記録。未完了の作業は得点に含めない。

### 0.5倍・後半V2（現行）

終了時L2: 8番 E(red)/E(red) / 9番 E(blue)/E(blue) / 7番 E(red)/E(red) / 10番 E(blue)/E(blue)

- 140.15秒 blueBR flip 1番
- 154.25秒 blueBR place 4番 earth
- 156.75秒 blueBR place 4番 earth
- 163.95秒 redBR retry

Retry/救済 1記録、拒否 2記録。未完了の作業は得点に含めない。

### 0.5倍・奉納後L2防衛

終了時L2: 8番 E(red)/E(red)/S(blue) / 9番 E(blue)/E(blue)/S(red) / 7番 E(red)/E(blue) / 10番 E(blue)/E(blue)

- 150.20秒 blueBR place 7番 earth
- 155.85秒 blueBR flip 8番
- 171.55秒 redBR place 9番 sky

Retry/救済 0記録、拒否 2記録。未完了の作業は得点に含めない。

## 保存物と再実行

- summary.json: 条件、全sim/*.jsと実行ツールのSHA256、各結果、初動完全一致ハッシュ、終盤行動、最終L2。
- 各*.json.gz: 完全な試合export（設定・イベント・軌跡・最終状態）。各*-tactics.json: 読める条件/行動/新案の判断。
- `node tools/compare-l2-defense.cjs --out results/l2-defense-next` （計6試合、上書き不可）
- `node tools/compare-l2-defense.cjs --out results/l2-defense-one --speeds 0.75` （3/4の両案2試合）
- GUI: field-simulator.htmlを開き、戦略欄の赤BRで「短時間待機→奉納後L2 Sky防衛」を選択して適用。理想供給/青V2/stopped/1秒を維持。

## 制限

両色交換、別の相手、通常TR供給、待機位置・時刻の最適化は未実施。既存V2の相手応答評価は仮説であり意図の予測ではない。L2優先は勝利保証ではなく、L1の機会損失や接触・Retryも結果に影響する。
