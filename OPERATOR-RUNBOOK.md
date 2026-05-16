# NOTE BUZZ ENGINE — オペ手順（会話の手戻り防止用）

**版数の正:** `package.json` の `version` と、Render ログの `NOTE BUZZ ENGINE v3.3.4 listening`（等）

---

## 最短版（毎回ここから）

### WHERE（どこで）

- **ターミナル場所:** `c:\Users\pizat\OneDrive\デスクトップ\クロードコードまとめ\note-buzz-engine`
- まずこれを実行:

```powershell
cd "c:\Users\pizat\OneDrive\デスクトップ\クロードコードまとめ\note-buzz-engine"
```

### WHAT（何を）

```powershell
npm run pw:ready
npm run pw:verify:store
npm run pw:note:draft:store
```

### DONE の判定（何が出たらOKか）

- `pw:verify:*` で `=== RESULT: OK ===`
- `playwright/auth-verify-result.json` が `"ok": true`
- 下書き画面 URL が `https://note.com/notes/new`

### 補足（毎朝見る専用フォルダ）

- `c:\Users\pizat\OneDrive\デスクトップ\クロードコードまとめ\note自動化運用`
- ここに 3アカ分の `.cmd` と説明書を置いた。朝はこのフォルダだけ開けばよい。

### 毎回の改善提案（運用ルール）

- この Runbook 運用では、**作業完了のたびに必ず 1 つ**「次回を速くする改善提案」を付ける。
- 提案テンプレ:
  - `改善案:` 何を改善するか
  - `効果:` 何分短縮 / 何の失敗を減らすか
  - `次回実施:` 次回どのタイミングで入れるか

---

## PC で note を自動操作する「最初の 1 回だけ」（ここだけ読めばよい）

普段の Chrome でログインしていても **無関係**。専用ブラウザ用に **もう一度ログイン**するだけ。

**いちばんかんたん（ターミナル不要）**

1. エクスプローラーで次のフォルダを開く: `デスクトップ\クロードコードまとめ\note-buzz-engine`
2. その中の **`DO-AUTH-ONCE.cmd`** を **ダブルクリック**
3. 出てきたブラウザで note にログイン → マイページまで → **黒い窓**に戻り **Enter** 1 回

**ターミナルでやる人（2 行まとめてコピー。パスだけでは動きません。`cd` まで入れる）**

```powershell
cd "c:\Users\pizat\OneDrive\デスクトップ\クロードコードまとめ\note-buzz-engine"
npm run pw:auth:pitapizza
```

終わったら、**Cursor 側でも追える確認**として次を実行（結果が JSON + スクショに残る）。

```powershell
cd "c:\Users\pizat\OneDrive\デスクトップ\クロードコードまとめ\note-buzz-engine"
npm run pw:verify:pitapizza
```

**よくあるミス:** 親フォルダの `クロードコードまとめ` だけにいるまま `npm run ...` すると **`package.json` が無くて ENOENT`** になります。必ず上の `cd` で **`note-buzz-engine`** まで下がる。**親からワンクリック**ならデスクトップの `クロードコードまとめ\NOTE-BUZZ-pw-verify-pitapizza.cmd` をダブルクリック。**変な文字や「内部コマンドではない」:** `.cmd` は **メモ帳で日本語だけのままだと環境により壊れる**ため、`DO-AUTH-ONCE.cmd` は **ASCII 英語のみ**にしてある。**PowerShell で怪しいとき**は、`cmd.exe` で「フルパス」の `DO-AUTH-ONCE.cmd` をダブルクリックするか、上の `cd` を使う。

- 成功（exit 0）: `playwright/auth-verify-result.json` の `"ok": true`  
- 失敗（exit 1）: 同ファイルに理由。再ログインは `DO-AUTH-ONCE.cmd`  
- スクショは `playwright/artifacts/pitapizza/auth-verify-*.png`（一覧用。git には含めない）

下書きだけ試す: `npm run pw:note:draft:dry:pitapizza`

（別名: `scripts\pw-auth-pitapizza.cmd` も同じ用途中身）

---

## 明日から毎日まわす実行チェックリスト（朝〜夜）

### 0) 朝いち 2 分（接続確認）

```powershell
cd "c:\Users\pizat\OneDrive\デスクトップ\クロードコードまとめ\note-buzz-engine"
npm run pw:ready
npm run pw:verify:pitapizza
```

- `pitapizza.json OK` が出ればそのまま進む  
- `pw:verify` で **`auth-verify-result.json` が ok** になれば、このPCの note はログイン済みとして共通確認できる  
- 出ない場合は `DO-AUTH-ONCE.cmd` をダブルクリックして再ログイン

### 1) 記事案を作る（10〜15 分）

- NOTE BUZZ ENGINE でキーワード入力 → `GENERATE`
- タイトル、本文、X 5本の叩き台を確認

### 2) note 下書きを自動で開く（1 分）

```powershell
cd "c:\Users\pizat\OneDrive\デスクトップ\クロードコードまとめ\note-buzz-engine"
npm run pw:note:draft:pitapizza
```

- 開いた note 下書き画面で、本文を最終調整

### 3) 投稿前チェック（5 分）

- タイトル: 年号・誇大表現を最終確認
- 本文: 誤字、体験談、CTA を確認
- 引用: 出典付きか確認（必要時）

### 4) 投稿後チェック（5 分）

- 公開 URL を保存
- X スレッドを投稿
- 反応（いいね、保存、クリック）をメモ

### 5) 夜の終了 1 分（明日用）

- 明日のキーワードを 1 つメモ
- うまくいった型（フック/構成）を 1 行メモ

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
- **永続ディスク**を使うときは `DB_PATH` をマウント先のファイルに（例: `/var/data/data.sqlite`）。コードが **親ディレクトリを自動作成**するが、**ディスクをサービスにマウント済み**であること（未マウントだと `/var/data` を作れず失敗することがある）

---

## AI（Cursor）に依頼するときの一文テンプレ

> `note-buzz-engine` を直した。手順に従い **僕（オペ）がやる作業**を箇条書きで出して。Runbook `OPERATOR-RUNBOOK.md` 準拠。

---

## 会話の無駄を減らすルール

- 実装の話の最後に **必ず**「**次にあなたがやること**（番号付き3〜5行）」を付ける（`.cursor/rules` の NBE 用ルールと整合）

## デプロイが「ステータス 1」で終了（ビルドコマンド）

- ダッシュボードの **Build Command** が **`npm run build`** のままなのに、`package.json` に **`build` スクリプトがない**と **exit 1** になる（Render よくある）。
- いまのリポジトリは **`build` あり**（`server.js` の文法チェック + SQLite スモーク）。**`render.yaml`（Blueprint）** の Build は **`npm install && npm rebuild better-sqlite3 && npm run build`** に揃える（Render の Linux と `better-sqlite3` ネイティブの食い合わせ用）。
- ダッシュボードだけ運用するときも、同じ **`npm install && npm rebuild better-sqlite3 && npm run build`** を推奨。短く **`npm install && npm run build`** だけだと、まれに **`better_sqlite3.node` がロードできず**ビルド or 実行で落ちる。**Environment に `NODE_VERSION=20.18.1`**（または 20 系）も必ず。

## デプロイが「ステータス 1」で終了（ヘルスチェック）

- **APP_PASSWORD を Render に入れている**と、未設定の `/` は **401**。Render のヘルスチェックは **2xx/3xx** 必須のため失敗しうる。
- 対策: コードは **`/healthz`（と `/health`）**で `200 ok` を返す。Blueprint では **`healthCheckPath: /healthz`**。加えて **`RENDER` + パスワード時**は **`GET/HEAD /`** を **Basic 有無 + UA/Accept** で分岐（監視系 UA や `Render` を含む UA は 200；実ブラウザ+HTML のみ Basic）。
- ダッシュボードのみ運用の場合は **Settings → Health Check Path** を `/healthz` に手動合わせ（**末尾の `/` なし**で揃える。`/` や空は不可）。
- **手動で新規 Web サービスを作った**（`note-xxx.onrender.com` など）場合、Blueprint を使っていても **そのサービス**の **Health Check Path** が空や `/` のままだと**タイムアウト**する。必ず **`/healthz`** を設定して Save → Redeploy。
- 本番確認: ブラウザか `curl` で **`https://<ホスト名>/healthz`** が **200** で本文 `ok`（**Basic 認証なし**）であること。401 ならパス違いか古い版。

## デプロイが失敗して本番が古い版のまま（例: Git は v3.2 なのに画面は 3.0）

- **失敗したコミットは本番に反映されない**。最後の **Succeeded** が表示されている。
- Render → 失敗した **Deploy** を開き、**Build** ログと **Deploy** ログの **先頭の `Error` / `ERR!`** 行を確認（よくあるのは `better-sqlite3` の `node-gyp`、**Node バージョン不足**、`npm` のネットワーク、**起動直後の例外**）。
- 対策（ダッシュボード）: **Environment** に `NODE_VERSION` = `20.18.1`（または 20 系）を入れ、**Save** 後 **Manual deploy**。
- エラー例 `better_sqlite3.node` / `ERR_DLOPEN` / `The module 'better_sqlite3' was compiled against` → **Node 20**（`NODE_VERSION=20.18.1` と `package.json` の `engines`）に揃え、Build を **`npm install && npm rebuild better-sqlite3 && npm run build`** にして **Clear build cache & deploy**。全体の `npm rebuild`（全パッケージ）は重いので避け、**`better-sqlite3` だけ**の rebuild で足りることが多い。
- まだ分からないときは、ログの **20〜30 行**（個人情報を消して）を貼ると切り分けしやすい。
