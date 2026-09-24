# ABU Robocon 2027 action space catalog

現時点で探索器へ入れるべき行動候補の辞書です。これは得点探索そのものではなく、探索前の「何を選択肢として認めるか」の確認用です。

## 含める行動

- TR: Earth/Skyの1から3個搬送
- TR: Sanctuary達成を見越したMustika付近待機、Mustika搬送
- BR: Earth配置、Sky配置、Sky反転
- BR: 相手の1段目Earthに自分のEarthを2段目として置く
- BR: 相手/混色のEarth2段タワーにSkyを置いて奪う
- BR: Earth+Skyを最大2個保持して、相手1段目から即完成させる漁夫シーケンス
- BR: Mustika受け取り待機、中央柱待機、Mustika奉納
- BR: ホームポジションでの画像認識停止

## まだ探索評価に入っていないもの

- ロボット同士の衝突、ブロッキング、進路妨害
- 相手の未来行動の確率分布
- フィールド上で荷物を途中置きする行動
- ルール上の審判判断が必要な危険操作

## 初期状態

- TR候補: 12
- BR単発候補: 11
- BR最大2個シーケンス候補: 110

### TR候補例
- Earthx1を取りに行ってTransferへ搬送
- Earthx2を取りに行ってTransferへ搬送
- Earthx3を取りに行ってTransferへ搬送
- Earthx2+Skyx1を取りに行ってTransferへ搬送
- Earthx1+Skyx1を取りに行ってTransferへ搬送
- Earthx1+Skyx2を取りに行ってTransferへ搬送
- Skyx1を取りに行ってTransferへ搬送
- Skyx2を取りに行ってTransferへ搬送
- ...ほか4件
### BR単発候補例
- L1共有上の1段目にEarth配置
- L1共有下の1段目にEarth配置
- 赤L1上の1段目にEarth配置
- 赤L1下の1段目にEarth配置
- 青L1上の1段目にEarth配置
- 青L1下の1段目にEarth配置
- L2左上の1段目にEarth配置
- L2右上の1段目にEarth配置
- L2左下の1段目にEarth配置
- L2右下の1段目にEarth配置
- ...ほか1件
### BR最大2個シーケンス例
- BR最大2個: L1共有上の1段目にEarth配置
- BR最大2個: L1共有上の1段目にEarth配置 → L1共有上の2段目にEarth配置
- BR最大2個: L1共有上の1段目にEarth配置 → L1共有下の1段目にEarth配置
- BR最大2個: L1共有上の1段目にEarth配置 → 赤L1上の1段目にEarth配置
- BR最大2個: L1共有上の1段目にEarth配置 → 赤L1下の1段目にEarth配置
- BR最大2個: L1共有上の1段目にEarth配置 → 青L1上の1段目にEarth配置
- BR最大2個: L1共有上の1段目にEarth配置 → 青L1下の1段目にEarth配置
- BR最大2個: L1共有上の1段目にEarth配置 → L2左上の1段目にEarth配置
- BR最大2個: L1共有上の1段目にEarth配置 → L2右上の1段目にEarth配置
- BR最大2個: L1共有上の1段目にEarth配置 → L2左下の1段目にEarth配置
- BR最大2個: L1共有上の1段目にEarth配置 → L2右下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L1共有上の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L1共有下の2段目にEarth配置
- ...ほか96件
## 相手が1段だけ置いた状態

- TR候補: 12
- BR単発候補: 11
- BR最大2個シーケンス候補: 110

### TR候補例
- Earthx1を取りに行ってTransferへ搬送
- Earthx2を取りに行ってTransferへ搬送
- Earthx3を取りに行ってTransferへ搬送
- Earthx2+Skyx1を取りに行ってTransferへ搬送
- Earthx1+Skyx1を取りに行ってTransferへ搬送
- Earthx1+Skyx2を取りに行ってTransferへ搬送
- Skyx1を取りに行ってTransferへ搬送
- Skyx2を取りに行ってTransferへ搬送
- ...ほか4件
### BR単発候補例
- L1共有上の2段目にEarth配置（相手1段目に便乗）
- L1共有下の1段目にEarth配置
- 赤L1上の1段目にEarth配置
- 赤L1下の1段目にEarth配置
- 青L1上の1段目にEarth配置
- 青L1下の1段目にEarth配置
- L2左上の2段目にEarth配置（相手1段目に便乗）
- L2右上の1段目にEarth配置
- L2左下の1段目にEarth配置
- L2右下の1段目にEarth配置
- ...ほか1件
### BR最大2個シーケンス例
- BR最大2個: L1共有上の2段目にEarth配置（相手1段目に便乗）
- BR最大2個: L1共有上の2段目にEarth配置（相手1段目に便乗） → L1共有上にSky配置（相手/混色タワーを奪取）
- BR最大2個: L1共有上の2段目にEarth配置（相手1段目に便乗） → L1共有下の1段目にEarth配置
- BR最大2個: L1共有上の2段目にEarth配置（相手1段目に便乗） → 赤L1上の1段目にEarth配置
- BR最大2個: L1共有上の2段目にEarth配置（相手1段目に便乗） → 赤L1下の1段目にEarth配置
- BR最大2個: L1共有上の2段目にEarth配置（相手1段目に便乗） → 青L1上の1段目にEarth配置
- BR最大2個: L1共有上の2段目にEarth配置（相手1段目に便乗） → 青L1下の1段目にEarth配置
- BR最大2個: L1共有上の2段目にEarth配置（相手1段目に便乗） → L2左上の2段目にEarth配置（相手1段目に便乗）
- BR最大2個: L1共有上の2段目にEarth配置（相手1段目に便乗） → L2右上の1段目にEarth配置
- BR最大2個: L1共有上の2段目にEarth配置（相手1段目に便乗） → L2左下の1段目にEarth配置
- BR最大2個: L1共有上の2段目にEarth配置（相手1段目に便乗） → L2右下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L1共有上の2段目にEarth配置（相手1段目に便乗）
- BR最大2個: L1共有下の1段目にEarth配置 → L1共有下の2段目にEarth配置
- ...ほか96件
## 相手が完成タワーを持つ状態

- TR候補: 12
- BR単発候補: 11
- BR最大2個シーケンス候補: 108

### TR候補例
- Earthx1を取りに行ってTransferへ搬送
- Earthx2を取りに行ってTransferへ搬送
- Earthx3を取りに行ってTransferへ搬送
- Earthx2+Skyx1を取りに行ってTransferへ搬送
- Earthx1+Skyx1を取りに行ってTransferへ搬送
- Earthx1+Skyx2を取りに行ってTransferへ搬送
- Skyx1を取りに行ってTransferへ搬送
- Skyx2を取りに行ってTransferへ搬送
- ...ほか4件
### BR単発候補例
- L1共有上の完成済みSkyを反転
- L1共有下の1段目にEarth配置
- 赤L1上にSky配置
- 赤L1下の1段目にEarth配置
- 青L1上の1段目にEarth配置
- 青L1下の1段目にEarth配置
- L2左上の1段目にEarth配置
- L2右上の1段目にEarth配置
- L2左下の1段目にEarth配置
- L2右下の1段目にEarth配置
- ...ほか1件
### BR最大2個シーケンス例
- BR最大2個: L1共有上の完成済みSkyを反転
- BR最大2個: L1共有上の完成済みSkyを反転 → L1共有下の1段目にEarth配置
- BR最大2個: L1共有上の完成済みSkyを反転 → 赤L1上にSky配置
- BR最大2個: L1共有上の完成済みSkyを反転 → 赤L1下の1段目にEarth配置
- BR最大2個: L1共有上の完成済みSkyを反転 → 青L1上の1段目にEarth配置
- BR最大2個: L1共有上の完成済みSkyを反転 → 青L1下の1段目にEarth配置
- BR最大2個: L1共有上の完成済みSkyを反転 → L2左上の1段目にEarth配置
- BR最大2個: L1共有上の完成済みSkyを反転 → L2右上の1段目にEarth配置
- BR最大2個: L1共有上の完成済みSkyを反転 → L2左下の1段目にEarth配置
- BR最大2個: L1共有上の完成済みSkyを反転 → L2右下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L1共有上の完成済みSkyを反転
- BR最大2個: L1共有下の1段目にEarth配置 → L1共有下の2段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → 赤L1上にSky配置
- ...ほか94件
## Sanctuary目前

- TR候補: 14
- BR単発候補: 12
- BR最大2個シーケンス候補: 89

### TR候補例
- Earthx1を取りに行ってTransferへ搬送
- Earthx2を取りに行ってTransferへ搬送
- Earthx3を取りに行ってTransferへ搬送
- Earthx2+Skyx1を取りに行ってTransferへ搬送
- Earthx1+Skyx1を取りに行ってTransferへ搬送
- Earthx1+Skyx2を取りに行ってTransferへ搬送
- Skyx1を取りに行ってTransferへ搬送
- Skyx2を取りに行ってTransferへ搬送
- ...ほか6件
### BR単発候補例
- L1共有下の1段目にEarth配置
- 赤L1上にSky配置
- 赤L1下の1段目にEarth配置
- 青L1上の1段目にEarth配置
- 青L1下の1段目にEarth配置
- L2左上の1段目にEarth配置
- L2右上の1段目にEarth配置
- L2左下の1段目にEarth配置
- L2右下の1段目にEarth配置
- Mustika受け取りを見越してTransfer付近で待機
- ...ほか2件
### BR最大2個シーケンス例
- BR最大2個: L1共有下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L1共有下の2段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → 赤L1上にSky配置
- BR最大2個: L1共有下の1段目にEarth配置 → 赤L1下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → 青L1上の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → 青L1下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L2左上の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L2右上の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L2左下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L2右下の1段目にEarth配置
- BR最大2個: 赤L1上にSky配置
- BR最大2個: 赤L1上にSky配置 → L1共有下の1段目にEarth配置
- BR最大2個: 赤L1上にSky配置 → 赤L1下の1段目にEarth配置
- BR最大2個: 赤L1上にSky配置 → 青L1上の1段目にEarth配置
- ...ほか75件
## Sanctuary達成済み

- TR候補: 14
- BR単発候補: 12
- BR最大2個シーケンス候補: 72

### TR候補例
- Earthx1を取りに行ってTransferへ搬送
- Earthx2を取りに行ってTransferへ搬送
- Earthx3を取りに行ってTransferへ搬送
- Earthx2+Skyx1を取りに行ってTransferへ搬送
- Earthx1+Skyx1を取りに行ってTransferへ搬送
- Earthx1+Skyx2を取りに行ってTransferへ搬送
- Skyx1を取りに行ってTransferへ搬送
- Skyx2を取りに行ってTransferへ搬送
- ...ほか6件
### BR単発候補例
- L1共有下の1段目にEarth配置
- 赤L1下の1段目にEarth配置
- 青L1上の1段目にEarth配置
- 青L1下の1段目にEarth配置
- L2左上の1段目にEarth配置
- L2右上の1段目にEarth配置
- L2左下の1段目にEarth配置
- L2右下の1段目にEarth配置
- Mustikaを受け取って中央柱へ奉納
- Mustika受け取りを見越してTransfer付近で待機
- ...ほか2件
### BR最大2個シーケンス例
- BR最大2個: L1共有下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L1共有下の2段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → 赤L1下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → 青L1上の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → 青L1下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L2左上の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L2右上の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L2左下の1段目にEarth配置
- BR最大2個: L1共有下の1段目にEarth配置 → L2右下の1段目にEarth配置
- BR最大2個: 赤L1下の1段目にEarth配置
- BR最大2個: 赤L1下の1段目にEarth配置 → L1共有下の1段目にEarth配置
- BR最大2個: 赤L1下の1段目にEarth配置 → 赤L1下の2段目にEarth配置
- BR最大2個: 赤L1下の1段目にEarth配置 → 青L1上の1段目にEarth配置
- BR最大2個: 赤L1下の1段目にEarth配置 → 青L1下の1段目にEarth配置
- ...ほか58件