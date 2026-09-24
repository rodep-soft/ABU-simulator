# Tactical opening search

行動辞書から、開幕で特に重要そうな3系統をシナリオ分岐として探索しました。

## 入れた分岐

- 自力2本完成: 共有1本+赤専有1本をこちらだけで完成
- 共有餌→相手完成→Sky反転: こちらが共有1段目を置き、相手が2段目+Skyで完成したあと、こちらがSkyを反転
- 相手1段目を漁夫完成: 相手が共有1段目を置いたあと、こちらがEarth2段目+Skyで共有タワーを完成

## 前提

- 青は常に最高速100%として、赤だけを同等、3/4、1/2、1/4に変更
- BRは各出撃前にホームで3秒相当の画像認識停止
- TR最大3個、BR最大2個を反映
- Sanctuaryは一度達成したらロックされ、あとでSkyを反転されても解除されない
- Mustikaは250点、TRがMustika前に先回りする選択も計算
- 衝突、ブロッキング、相手の妨害走行は未モデル化

## 速度別の目立つ結果

### 赤速度 同等

- #22189 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 63.3s, Mustika 87.0s, 390-30点, 初回BR L1共有下:E1 / 赤L1下:E1
- #22237 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 63.3s, Mustika 87.0s, 390-30点, 初回BR L1共有下:E1 / 赤L1下:E1
- #22381 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E3 | 2:S1: Sanctuary 63.5s, Mustika 87.2s, 390-30点, 初回BR L1共有下:E1 / 赤L1下:E1
- #22181 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 64.5s, Mustika 88.2s, 390-30点, 初回BR L1共有上:E1 / 赤L1下:E1
- #22229 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 64.5s, Mustika 88.2s, 390-30点, 初回BR L1共有上:E1 / 赤L1下:E1
- #22373 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E3 | 2:S1: Sanctuary 64.6s, Mustika 88.4s, 390-30点, 初回BR L1共有上:E1 / 赤L1下:E1
- #22185 共有餌→相手完成→Sky反転 / L1共有下+赤L1上 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 64.8s, Mustika 88.5s, 390-30点, 初回BR L1共有下:E1 / 赤L1上:E1
- #22233 共有餌→相手完成→Sky反転 / L1共有下+赤L1上 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 64.8s, Mustika 88.5s, 390-30点, 初回BR L1共有下:E1 / 赤L1上:E1
- #22191 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 64.8s, Mustika 88.5s, 390-30点, 初回BR 赤L1下:E1 / L1共有下:E1
- #22239 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 64.8s, Mustika 88.5s, 390-30点, 初回BR 赤L1下:E1 / L1共有下:E1

### 赤速度 3/4

- #46357 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E3 | 2:S1: Sanctuary 77.5s, Mustika 107.3s, 390-30点, 初回BR L1共有下:E1 / 赤L1下:E1
- #46165 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 78.4s, Mustika 108.2s, 390-30点, 初回BR L1共有下:E1 / 赤L1下:E1
- #46167 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 78.4s, Mustika 108.2s, 390-30点, 初回BR 赤L1下:E1 / L1共有下:E1
- #46213 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 78.4s, Mustika 108.2s, 390-30点, 初回BR L1共有下:E1 / 赤L1下:E1
- #46215 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 78.4s, Mustika 108.2s, 390-30点, 初回BR 赤L1下:E1 / L1共有下:E1
- #46157 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 79.7s, Mustika 109.5s, 390-30点, 初回BR L1共有上:E1 / 赤L1下:E1
- #46159 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 79.7s, Mustika 109.5s, 390-30点, 初回BR 赤L1下:E1 / L1共有上:E1
- #46205 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 79.7s, Mustika 109.5s, 390-30点, 初回BR L1共有上:E1 / 赤L1下:E1
- #46207 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 79.7s, Mustika 109.5s, 390-30点, 初回BR 赤L1下:E1 / L1共有上:E1
- #46349 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E3 | 2:S1: Sanctuary 79.9s, Mustika 109.7s, 390-30点, 初回BR L1共有上:E1 / 赤L1下:E1

### 赤速度 1/2

- #70141 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 107.0s, Mustika 148.5s, 390-30点, 初回BR L1共有下:E1 / 赤L1下:E1
- #70143 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 107.0s, Mustika 148.5s, 390-30点, 初回BR 赤L1下:E1 / L1共有下:E1
- #70189 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 107.0s, Mustika 148.5s, 390-30点, 初回BR L1共有下:E1 / 赤L1下:E1
- #70191 共有餌→相手完成→Sky反転 / L1共有下+赤L1下 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 107.0s, Mustika 148.5s, 390-30点, 初回BR 赤L1下:E1 / L1共有下:E1
- #70133 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 108.6s, Mustika 150.1s, 390-30点, 初回BR L1共有上:E1 / 赤L1下:E1
- #70135 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 108.6s, Mustika 150.1s, 390-30点, 初回BR 赤L1下:E1 / L1共有上:E1
- #70181 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 108.6s, Mustika 150.1s, 390-30点, 初回BR L1共有上:E1 / 赤L1下:E1
- #70183 共有餌→相手完成→Sky反転 / L1共有上+赤L1下 / TR 1:E2 | 2:E1+S1/S>E: Sanctuary 108.6s, Mustika 150.1s, 390-30点, 初回BR 赤L1下:E1 / L1共有上:E1
- #70137 共有餌→相手完成→Sky反転 / L1共有下+赤L1上 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 109.1s, Mustika 150.5s, 390-30点, 初回BR L1共有下:E1 / 赤L1上:E1
- #70139 共有餌→相手完成→Sky反転 / L1共有下+赤L1上 / TR 1:E2 | 2:E1+S1/E>S: Sanctuary 109.1s, Mustika 150.5s, 390-30点, 初回BR 赤L1上:E1 / L1共有下:E1

### 赤速度 1/4

- #86409 自力2本完成 / L2左上+赤L1上 / TR 1:E2 | 2:E1+S2/E>S | 3:E1: Sanctuary -, Mustika -, 170-0点, 初回BR L2左上:E1 / L2左上:E2
- #86429 自力2本完成 / L2左上+赤L1下 / TR 1:E2 | 2:E1+S2/E>S | 3:E1: Sanctuary -, Mustika -, 170-0点, 初回BR L2左上:E1 / L2左上:E2
- #86449 自力2本完成 / L2右上+赤L1上 / TR 1:E2 | 2:E1+S2/E>S | 3:E1: Sanctuary -, Mustika -, 170-0点, 初回BR L2右上:E1 / L2右上:E2
- #86469 自力2本完成 / L2右上+赤L1下 / TR 1:E2 | 2:E1+S2/E>S | 3:E1: Sanctuary -, Mustika -, 170-0点, 初回BR L2右上:E1 / L2右上:E2
- #86489 自力2本完成 / L2左下+赤L1上 / TR 1:E2 | 2:E1+S2/E>S | 3:E1: Sanctuary -, Mustika -, 170-0点, 初回BR L2左下:E1 / L2左下:E2
- #86509 自力2本完成 / L2左下+赤L1下 / TR 1:E2 | 2:E1+S2/E>S | 3:E1: Sanctuary -, Mustika -, 170-0点, 初回BR L2左下:E1 / L2左下:E2
- #86529 自力2本完成 / L2右下+赤L1上 / TR 1:E2 | 2:E1+S2/E>S | 3:E1: Sanctuary -, Mustika -, 170-0点, 初回BR L2右下:E1 / L2右下:E2
- #86549 自力2本完成 / L2右下+赤L1下 / TR 1:E2 | 2:E1+S2/E>S | 3:E1: Sanctuary -, Mustika -, 170-0点, 初回BR L2右下:E1 / L2右下:E2
- #86649 自力2本完成 / L2左上+赤L1上 / TR 1:E2 | 2:E1+S2/S>E | 3:E1: Sanctuary -, Mustika -, 170-0点, 初回BR L2左上:E1 / L2左上:E2
- #86669 自力2本完成 / L2左上+赤L1下 / TR 1:E2 | 2:E1+S2/S>E | 3:E1: Sanctuary -, Mustika -, 170-0点, 初回BR L2左上:E1 / L2左上:E2

## シナリオ別集計

### 赤速度 同等

- 相手1段目を漁夫完成: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 111.5s, 平均Sanctuary 87.8s, 平均点 445.0, best #22544 76.8s / Mustika 100.5s / 405点
- 共有餌→相手完成→Sky反転: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 120.1s, 平均Sanctuary 96.4s, 平均点 423.3, best #22189 63.3s / Mustika 87.0s / 390点
- 自力2本完成: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 126.0s, 平均Sanctuary 102.3s, 平均点 466.7, best #14884 69.6s / Mustika 93.3s / 420点

### 赤速度 3/4

- 相手1段目を漁夫完成: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 137.0s, 平均Sanctuary 107.2s, 平均点 445.0, best #47167 91.9s / Mustika 121.7s / 405点
- 共有餌→相手完成→Sky反転: Mustika率 97.3%, Sanctuary率 100.0%, 平均Mustika 143.5s, 平均Sanctuary 114.8s, 平均点 416.7, best #46357 77.5s / Mustika 107.3s / 390点
- 自力2本完成: Mustika率 94.3%, Sanctuary率 100.0%, 平均Mustika 154.9s, 平均Sanctuary 126.9s, 平均点 452.5, best #38920 85.8s / Mustika 115.6s / 420点

### 赤速度 1/2

- 相手1段目を漁夫完成: Mustika率 37.4%, Sanctuary率 97.9%, 平均Mustika 174.5s, 平均Sanctuary 144.2s, 平均点 287.8, best #71143 121.3s / Mustika 162.7s / 405点
- 共有餌→相手完成→Sky反転: Mustika率 30.2%, Sanctuary率 89.3%, 平均Mustika 168.7s, 平均Sanctuary 147.7s, 平均点 243.0, best #70141 107.0s / Mustika 148.5s / 390点
- 自力2本完成: Mustika率 4.3%, Sanctuary率 62.6%, 平均Mustika 175.3s, 平均Sanctuary 161.8s, 平均点 197.8, best #62896 119.0s / Mustika 160.5s / 420点

### 赤速度 1/4

- 相手1段目を漁夫完成: Mustika率 0.0%, Sanctuary率 0.0%, 平均Mustika -, 平均Sanctuary -, 平均点 119.0, best #94378 - / Mustika - / 155点
- 共有餌→相手完成→Sky反転: Mustika率 0.0%, Sanctuary率 0.0%, 平均Mustika -, 平均Sanctuary -, 平均点 57.7, best #93502 - / Mustika - / 130点
- 自力2本完成: Mustika率 0.0%, Sanctuary率 0.0%, 平均Mustika -, 平均Sanctuary -, 平均点 56.7, best #86409 - / Mustika - / 170点

## E3初手の共有餌作戦だけを見る

ユーザー仮説に近い「TR初手E3、BR初回で共有1段+赤専有1段」のケースです。

### 赤速度 同等

- L1共有下+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 98.5s, 平均Sanctuary 74.8s, 平均点 390.0, best #22381 63.5s / Mustika 87.2s / 390点
- L1共有下+赤L1上: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 100.0s, 平均Sanctuary 76.3s, 平均点 390.0, best #22377 64.9s / Mustika 88.7s / 390点
- L1共有上+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 100.9s, 平均Sanctuary 77.2s, 平均点 390.0, best #22373 64.6s / Mustika 88.4s / 390点
- L1共有上+赤L1上: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 101.6s, 平均Sanctuary 77.9s, 平均点 390.0, best #22369 66.1s / Mustika 89.8s / 390点
- L2左上+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 110.5s, 平均Sanctuary 86.8s, 平均点 440.0, best #22389 72.3s / Mustika 96.1s / 440点
- L2左下+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 110.6s, 平均Sanctuary 86.8s, 平均点 440.0, best #22405 72.4s / Mustika 96.1s / 440点
- L2右上+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 111.5s, 平均Sanctuary 87.8s, 平均点 440.0, best #22397 72.9s / Mustika 96.6s / 440点
- L2右下+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 111.5s, 平均Sanctuary 87.8s, 平均点 440.0, best #22413 72.9s / Mustika 96.6s / 440点

### 赤速度 3/4

- L1共有下+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 118.8s, 平均Sanctuary 89.0s, 平均点 390.0, best #46357 77.5s / Mustika 107.3s / 390点
- L1共有下+赤L1上: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 121.2s, 平均Sanctuary 91.4s, 平均点 390.0, best #46353 81.9s / Mustika 111.7s / 390点
- L1共有上+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 121.9s, 平均Sanctuary 92.1s, 平均点 390.0, best #46349 79.9s / Mustika 109.7s / 390点
- L1共有上+赤L1上: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 122.8s, 平均Sanctuary 93.0s, 平均点 390.0, best #46345 82.2s / Mustika 112.0s / 390点
- L2左上+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 133.1s, 平均Sanctuary 103.3s, 平均点 440.0, best #46365 88.8s / Mustika 118.6s / 440点
- L2左下+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 133.2s, 平均Sanctuary 103.4s, 平均点 440.0, best #46381 88.9s / Mustika 118.7s / 440点
- L2右上+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 134.7s, 平均Sanctuary 104.9s, 平均点 440.0, best #46373 90.8s / Mustika 120.6s / 440点
- L2右下+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 134.7s, 平均Sanctuary 104.9s, 平均点 440.0, best #46389 90.8s / Mustika 120.6s / 440点

### 赤速度 1/2

- L1共有下+赤L1下: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 161.0s, 平均Sanctuary 119.5s, 平均点 390.0, best #70335 109.2s / Mustika 150.7s / 390点
- L1共有下+赤L1上: Mustika率 100.0%, Sanctuary率 100.0%, 平均Mustika 164.0s, 平均Sanctuary 122.5s, 平均点 390.0, best #70331 112.5s / Mustika 154.0s / 390点
- L1共有上+赤L1下: Mustika率 75.0%, Sanctuary率 100.0%, 平均Mustika 159.5s, 平均Sanctuary 123.7s, 平均点 327.5, best #70325 112.2s / Mustika 153.7s / 390点
- L1共有上+赤L1上: Mustika率 75.0%, Sanctuary率 100.0%, 平均Mustika 161.4s, 平均Sanctuary 124.9s, 平均点 327.5, best #70323 114.6s / Mustika 156.0s / 390点
- L2左上+赤L1下: Mustika率 50.0%, Sanctuary率 100.0%, 平均Mustika 166.8s, 平均Sanctuary 138.6s, 平均点 315.0, best #70341 124.5s / Mustika 165.9s / 440点
- L2左下+赤L1下: Mustika率 50.0%, Sanctuary率 100.0%, 平均Mustika 166.9s, 平均Sanctuary 138.7s, 平均点 315.0, best #70357 124.6s / Mustika 166.0s / 440点
- L2右上+赤L1下: Mustika率 50.0%, Sanctuary率 100.0%, 平均Mustika 169.2s, 平均Sanctuary 140.9s, 平均点 315.0, best #70349 126.9s / Mustika 168.3s / 440点
- L2右下+赤L1下: Mustika率 50.0%, Sanctuary率 100.0%, 平均Mustika 169.2s, 平均Sanctuary 140.9s, 平均点 315.0, best #70365 126.9s / Mustika 168.4s / 440点

### 赤速度 1/4

- L1共有上+赤L1上: Mustika率 0.0%, Sanctuary率 0.0%, 平均Mustika -, 平均Sanctuary -, 平均点 90.0, best #94297 - / Mustika - / 100点
- L1共有上+赤L1下: Mustika率 0.0%, Sanctuary率 0.0%, 平均Mustika -, 平均Sanctuary -, 平均点 90.0, best #94301 - / Mustika - / 100点
- L1共有下+赤L1上: Mustika率 0.0%, Sanctuary率 0.0%, 平均Mustika -, 平均Sanctuary -, 平均点 90.0, best #94305 - / Mustika - / 100点
- L1共有下+赤L1下: Mustika率 0.0%, Sanctuary率 0.0%, 平均Mustika -, 平均Sanctuary -, 平均点 90.0, best #94309 - / Mustika - / 100点
- L2左上+赤L1下: Mustika率 0.0%, Sanctuary率 0.0%, 平均Mustika -, 平均Sanctuary -, 平均点 80.0, best #94318 - / Mustika - / 130点
- L2左下+赤L1下: Mustika率 0.0%, Sanctuary率 0.0%, 平均Mustika -, 平均Sanctuary -, 平均点 80.0, best #94334 - / Mustika - / 130点
- L2左上+赤L1上: Mustika率 0.0%, Sanctuary率 0.0%, 平均Mustika -, 平均Sanctuary -, 平均点 75.0, best #94314 - / Mustika - / 130点
- L2右上+赤L1下: Mustika率 0.0%, Sanctuary率 0.0%, 平均Mustika -, 平均Sanctuary -, 平均点 75.0, best #94326 - / Mustika - / 130点

## 読み取り

- 同等と3/4では、共有餌→相手完成→Sky反転がかなり強い。自分で共有タワー用の2段目EarthとSkyを運ばなくてよくなるため、Mustikaまでの最短が縮みやすい。
- ただし、この作戦は相手が共有1段目に乗って完成してくれる前提なので、相手が無視する世界線では自力完成プランへ切り替える必要がある。
- 1/2でも、相手が完成してくれるなら反転作戦はまだ成立するケースがある。自力2本完成よりMustikaが残りやすい。
- 1/4では、こちらのBR移動と認識停止が重く、Mustikaまで届くケースはかなり少ない。部分点狙いか、相手の1段目を漁夫る待ちの価値が上がる。
- Mustika前TR待機は多くの上位ケースで効く。Sanctuary後に取りに行くより、数秒から十数秒縮む。
