# NOTE BUZZ ENGINE v3.0

note.com記事 + Xスレッド自動生成システム。**3アカウント完全分離**・**海外トレンド自動取得**・**即金体験スタート型レベル進行**対応。

## 技術スタック

- **Runtime**: Node.js 20+
- **Framework**: Express 4
- **AI**: Anthropic Claude API（`claude-sonnet-4-20250514`）+ web_search tool
- **Frontend**: Vanilla HTML/CSS/JS（明るめテーマ）
- **State**: localStorage（キー: `nbe_v3`）
- **Deploy**: Render（GitHub自動デプロイ）

## アカウント体制（混在禁止）

| ID | ハンドル | 役割 |
|---|---|---|
| `ai_main` | `@shok_ai_kotaro` | AI総合メイン発信／noteで稼ぐ／brain自作本主軸 |
| `store` | `@pita_pizza1` | ピタピザ・Bread Burgerの店舗×EC拡散／楽天・Amazon |
| `affi_seminar` | `@ai_pivot_fire` | 高額AIセミナーレビュー・アフィリ専用 |

UI上で上部タブから切替。選んだアカウントに応じてペルソナ・アフィリ選択肢・ハッシュタグ・X投稿構成が丸ごと差し替わる。店舗アカ選択時は **AI話題が本文から除外** される。

## レベル進行（即金体験スタート）

| LV | DAY | テーマ | 具体度 |
|---|---|---|---|
| LV1 | 1-3 | **即金体験**（今日AIで3,000〜5,000円を作る最短手順） | 90% |
| LV2 | 4-7 | **継続収入化**（週3万・月10万の再現レシピ） | 80% |
| LV3 | 8-14 | **仕組み化**（自動化・ワークフロー・複数ツール連携） | 50% |
| LV4 | 15-21 | **収益最大化**（月10万→30万スケール戦略） | 40% |
| LV5 | 22日〜 | **独自化**（独自システム構築・差別化戦略） | 30% |

### 挫折防止の塩梅ロジック

- **LV2→3／LV4→5の難易度ジャンプ直前**で30%の確率で「復習回」を自動挿入
- **LV3以降**は記事冒頭10%に初心者向け導入を強制（新規流入を逃さない）
- **LV1-2**は「100円を生む最小単位」縛り（派手な金額禁止）
- **LV境目でメタ進行加筆**を強制発動可能（「ここまで来たあなたへ」型）

## 主要機能

### 1. 海外トレンド自動取得
Claude APIの `web_search_20250305` ツールを組込。🌐トレンドボタンON時に海外X（@mreflow等）・技術ブログからAIトレンドを自動取得し、日本向けアレンジで本文に反映。

### 2. X投稿バズ最適化
- 5投稿構成、**1投稿目に数字＋意外性全振り**
- note誘導は**4投稿目に配置**（最後に置くとリーチ落ちる）
- 5投稿目は**引用RT誘発CTA**（「同意か反論か？」型）
- ハッシュタグ自動選定（日本語＋英語混在。海外リーチ拡大）

### 3. メタ進行加筆（シリーズ感）
- 「DAY X / LV.Y」連番自動付与でフォロー率UP
- レベル昇格日に自動で「進行報告」メッセージを本文に挿入可能

### 4. FREE / PAID モード

| 項目 | FREE | PAID |
|---|---|---|
| 数字の具体性 | 可能性表現のみ | 具体的数値+可能性表現 |
| 手順の深さ | 概念・方向性 | 設定値・ステップ詳細 |
| 特殊ブロック | なし | 【PRO TIP】挿入 |

### 5. 著名人引用インジェクション
- AI系アカ（`ai_main`/`affi_seminar`）でのみ発動
- ランダム3〜6回に1回、イーロン・マスク/サム・アルトマンの発言を自動挿入

## セットアップ

```bash
cd note-buzz-engine
npm install

cp .env.example .env
# .env に ANTHROPIC_API_KEY を記入

npm start
```

ブラウザで `http://localhost:3000`

## 月額コスト概算

| 項目 | 金額 |
|---|---|
| Anthropic API（90回/月想定） | 約900円 |
| web_search追加（1記事3検索） | 約550円 |
| Renderホスティング（Free） | 0円 |
| **合計** | **約1,450円/月** |

## GitHub → Render 自動デプロイ

```bash
git init
git add .
git commit -m "feat: Note Buzz Engine v3.0"
git remote add origin https://github.com/[USERNAME]/note-buzz-engine.git
git push -u origin main
```

Renderダッシュボードで New → Web Service → Connect GitHub → Build: `npm install` / Start: `node server.js` / Env: `ANTHROPIC_API_KEY` を設定。

## 注意点

- `ANTHROPIC_API_KEY` は `.env` にのみ。絶対に `git push` しないこと
- `render.yaml` の `sync: false` は必須（APIキーを同期させない）
- `server.js` の `max_tokens: 4096` は変更しない（記事全文が切れるため）
- `localStorage` キーは `nbe_v3`（旧v2と競合回避）
- 店舗アカ（`store`）では引用機能・トレンド取得機能・note誘導は**自動的に無効化**される
