# 設計思考ラボ（uiux-learning）

UI/UX学習アプリ。静的サイト（`public/`）と、AIチャット用のNetlify Function（`netlify/functions/chat.mjs`）。

## 作業ルール
- 返答は日本語で、簡潔に。
- 変更は `main` に直接pushせず、ブランチ → プルリクエスト → マージの順で行う。
- プルリクエストは `gh api repos/kinjomiyuki/uiux-learning/pulls`（REST）で作る。`gh pr create` はGraphQLが使えず失敗する。
- UIを変えたら、スマホ幅(375px)とPC幅(1200px)でスクリーンショットを撮って確認する。

## 本番デプロイ
- 本番: https://uiux-learning.netlify.app/ （Netlifyサイト ID: `694bbb39-8dc3-4c1c-b627-6d6cd089ffe2`）
- GitHub連携の自動デプロイは未設定。`main` へのマージだけでは反映されない。
- 反映するには、ネットワークが許可された環境（ユーザーのPCなど）で、リポジトリのフォルダ内から:
  ```
  git checkout main && git pull
  npm install
  npm run deploy
  ```
- 初回のみ `npx netlify-cli login` が必要。`fjtmyk` は誤作成された別サイトなので使わない。
- `ANTHROPIC_API_KEY` はNetlifyの環境変数にあり、コードには入れない。
