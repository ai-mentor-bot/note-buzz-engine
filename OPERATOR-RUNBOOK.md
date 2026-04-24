# NOTE BUZZ ENGINE — オペ手順（会話の手戻り防止用）

**版数の正:** `package.json` の `version` と、Render ログの `NOTE BUZZ ENGINE v3.x running`

---

## コードや UI を直した直後（毎回やる短い一連）

1. **差分をコミット**（メッセージ例: `fix(nbe): 画面バッジを 3.2 に統一`）
2. **GitHub へ `git push`**（Render が接続先ブランチを見ていること）
3. **Render** → 該当 Web Service → **Deploys** で **Succeeded** まで確認（失敗なら **Logs**）
4. **本番 URL** を **Safari/Chrome** で開き、**表記**と**主要ボタン1つ**（生成フローが動くところまで）
5. 画面が古い場合 → **スーパーリロード** または **シークレット**（キャッシュ疑い）

---

## 新しい環境変数を足した場合

- `render.yaml` または Render ダッシュボード **Environment** に同じキーを追加
- 保存後、**手動再デプロイ**が必要なことがある

---

## SQLite / 履歴

- 無料枠では **再デプロイで DB が消える** ことがある。重要データは **別途 export** や **永続ディスク**の検討

---

## AI（Cursor）に依頼するときの一文テンプレ

> `note-buzz-engine` を直した。手順に従い **僕（オペ）がやる作業**を箇条書きで出して。Runbook `OPERATOR-RUNBOOK.md` 準拠。

---

## 会話の無駄を減らすルール

- 実装の話の最後に **必ず**「**次にあなたがやること**（番号付き3〜5行）」を付ける（`.cursor/rules` の NBE 用ルールと整合）

## デプロイが「ステータス 1」で終了（ビルドコマンド）

- ダッシュボードの **Build Command** が **`npm run build`** のままなのに、`package.json` に **`build` スクリプトがない**と **exit 1** になる（Render よくある）。
- いまのリポジトリは **`build` あり**（`server.js` の文法チェック + SQLite スモーク）。Blueprint なら **`npm install && npm run build`**。
- 手動で直すなら **Build** = `npm install && npm run build` または **Build** = `npm install`（`build` を走らせないなら dashboard から `npm run build` を外す）。

## デプロイが「ステータス 1」で終了（ヘルスチェック）

- **APP_PASSWORD を Render に入れている**と、未設定の `/` は **401**。Render のヘルスチェックは **2xx/3xx** 必須のため失敗しうる。
- 対策: コードは **`/healthz`（と `/health`）**で `200 ok` を返す。Blueprint では **`healthCheckPath: /healthz`**。
- ダッシュボードのみ運用の場合は **Settings → Health Check Path** を `/healthz` に手動合わせ。

## デプロイが失敗して本番が古い版のまま（例: Git は v3.2 なのに画面は 3.0）

- **失敗したコミットは本番に反映されない**。最後の **Succeeded** が表示されている。
- Render → 失敗した **Deploy** を開き、**Build** ログと **Deploy** ログの **先頭の `Error` / `ERR!`** 行を確認（よくあるのは `better-sqlite3` の `node-gyp`、**Node バージョン不足**、`npm` のネットワーク、**起動直後の例外**）。
- 対策（ダッシュボード）: **Environment** に `NODE_VERSION` = `20.18.1`（または 20 系）を入れ、**Save** 後 **Manual deploy**。
- エラー例 `better_sqlite3.node` / `ERR_DLOPEN` / `The module 'better_sqlite3' was compiled against` → **Node 20**（`NODE_VERSION=20.18.1` と `package.json` の `engines`）に揃え、**Clear build cache & deploy**。ビルドで `rebuild` は使わない（prebuild バイナリで十分なことが多い。ビルドが OOM/exit1 になる原因にもなりやすい）。
- まだ分からないときは、ログの **20〜30 行**（個人情報を消して）を貼ると切り分けしやすい。
