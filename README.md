# NOTE BUZZ ENGINE v2.1

note.com記事 + Xスレッドを自動生成するWebアプリ。Anthropic Claude APIを使用。

## 技術スタック

- **Runtime**: Node.js 20+
- **Framework**: Express 4
- **AI**: Anthropic Claude API（`claude-sonnet-4-20250514`）
- **Frontend**: Vanilla HTML/CSS/JS
- **State**: localStorage
- **Deploy**: Render（GitHub自動デプロイ）

## ディレクトリ構成

```
note-buzz-engine/
├── server.js              # Expressサーバー（APIプロキシ）
├── package.json
├── .env                   # ANTHROPIC_API_KEY（gitignore必須）
├── .env.example
├── .gitignore
├── render.yaml            # Renderデプロイ設定
├── public/
│   └── index.html         # フロントエンド（全UI）
└── README.md
```

## セットアップ

### 1. 依存パッケージのインストール

```bash
cd note-buzz-engine
npm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、Anthropic APIキーを記入する:

```bash
cp .env.example .env
```

`.env` の中身:

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
PORT=3000
```

### 3. 起動

```bash
npm start       # 本番起動
npm run dev     # 開発起動（ファイル変更で自動再起動）
```

ブラウザで `http://localhost:3000` を開く。

## GitHub → Render 自動デプロイ

```bash
# 1. GitHubにリポジトリ作成
git init
git add .
git commit -m "feat: Note Buzz Engine v2.1"
git remote add origin https://github.com/[USERNAME]/note-buzz-engine.git
git push -u origin main
```

2. Renderダッシュボード
   - New → Web Service
   - Connect GitHub repository
   - Branch: `main`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Environment Variables: `ANTHROPIC_API_KEY` を設定

3. 以降は `git push origin main` するだけで自動デプロイ

## 主要機能

### コンテンツ重複防止
- フック（5種）× 視点（5種）× 構成（5種）をランダム選択
- 直近5回の組み合わせを除外
- 直近5件のタイトルを「これとかぶるな」指示としてプロンプトに渡す

### FREE / PAID モード

| 項目 | FREE | PAID |
|------|------|------|
| 数字の具体性 | 可能性表現のみ | 具体的数値+可能性表現 |
| 手順の深さ | 概念・方向性 | 設定値・ステップ詳細 |
| 特殊ブロック | なし | 【PRO TIP】挿入 |
| CTAスタイル | 「詳しくはリンク先で」 | 「具体的な設定はここから」 |

### レベル進行（初回起動日からの経過日数）

| LV | 経過日 | テーマ |
|----|--------|--------|
| 1 | 0〜3日 | AIツール基礎・ChatGPT/Claude入門 |
| 2 | 4〜7日 | プロンプト実践・初収益 |
| 3 | 8〜14日 | 自動化・ワークフロー構築 |
| 4 | 15〜21日 | スケール・収益最大化 |
| 5 | 22日〜 | 独自システム・差別化 |

### 著名人引用インジェクション
- 初期値: ランダム3〜6回に1回発動
- 発動時: ヘッダーの引用インジケーターが緑点滅
- 出力: 「要確認」バッジ付きで記事冒頭または末尾に配置

## 注意点

- `ANTHROPIC_API_KEY` は `.env` に記載し、絶対に `git push` しないこと
- フロントエンドのAPIエンドポイントは `/api/generate`（相対パス）
- `server.js` の `max_tokens: 4096` は変更しない（記事全文が切れるため）
- `localStorage` キーは `nbe_v2`（旧バージョンとの競合回避）
- `render.yaml` の `sync: false` は必須（APIキーをGitHubに同期させない）
