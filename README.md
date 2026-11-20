# バカ人狼 サーバー

依存なしの Node.js アプリ（Node 18+）。Feign（おバカ人狼）方式の対人ゲーム。
ルーム管理・フェーズの自律駆動・役職配布・夜の解決・投票/勝敗までを実装。フロントは public/index.html。
仕様の正本は `~/workspace/baka_jinrou/plan.md`。

## ローカル起動

```bash
node server.mjs
# http://localhost:3000 （PORT環境変数で変更可）
```

環境変数は不要（APIキー等なし）。フェーズ時間は NIGHT_MS / MORNING_MS / DISCUSS_MS / VOTE_MS / EXILE_MS で上書き可。

## 遊び方

- ホストがルームを作り、4文字コードを共有。4〜12人で開始。
- ロビーでボットを追加できる（少人数の穴埋め・1人での試しプレイ用）。
- 全員に役職が配られ、うち1人は「バカ」（役職だと思い込んでいる無能力者・イノセント側）。

## デプロイ（Render 無料枠）

1. このフォルダを GitHub リポジトリに入れる（server.mjs / engine.mjs / package.json / public/ / README.md）。
2. Render → New > Web Service → リポジトリを接続。
3. 設定：Build Command は空（依存なし）、Start Command は `node server.mjs`、Instance Type は Free。
4. 無料枠の注意：無操作でスリープし、再起動に30〜60秒かかる。遊ぶ前に一度開いて起こしておくとスムーズ。
5. ルームはメモリ保持のため、サーバー再起動で消える（パーティ用途として許容）。
