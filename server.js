require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const basicAuth = require('express-basic-auth');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { TwitterApi } = require('twitter-api-v2');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Render 内部ヘルス: 2xx 必須。APP_PASSWORD 時は / が 401 になる。
// 他の require や DB より**先**に生やす（プローブが早期に 200 を受け取れる）
const _health = (req, res) => res.status(200).type('text/plain').send('ok');
const _healthHead = (req, res) => res.status(200).end();
app.get('/healthz', _health);
app.head('/healthz', _healthHead);
app.get('/healthz/', _health);
app.head('/healthz/', _healthHead);
app.get('/health', _health);
app.head('/health', _healthHead);
app.get('/health/', _health);
app.head('/health/', _healthHead);

function isHealthPath(p) {
  const n = (p || '/').replace(/\/+$/, '') || '/';
  return n === '/healthz' || n === '/health';
}

// =======================================================
// CLIENTS (graceful degradation — missing keys = feature off)
// =======================================================
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const HAS_OPENAI = !!process.env.OPENAI_API_KEY;
const openai = HAS_OPENAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

/** 現状: Render に登録した X キーはピザ屋（store / @pita_pizza1）用のみ。他アカは別キー追加まで投稿不可 */
const HAS_X_CREDS = !!(process.env.X_APP_KEY && process.env.X_APP_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET);
let xClientStore = null;
if (HAS_X_CREDS) {
  try {
    xClientStore = new TwitterApi({
      appKey: process.env.X_APP_KEY,
      appSecret: process.env.X_APP_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_TOKEN_SECRET
    });
  } catch (e) {
    console.error('[x] TwitterApi init failed (keys不正など):', e.message);
  }
}
const HAS_X_API = !!xClientStore;

const X_ENABLED_ACCOUNTS = new Set(['store']); // 将来: ai_main 用に X_AI_* を足す

function getXClientForAccount(accountId) {
  if (!HAS_X_API || !accountId) return null;
  if (!X_ENABLED_ACCOUNTS.has(accountId)) return null;
  return xClientStore;
}

// =======================================================
// SQLite PERSISTENCE（Render: 未指定時は /tmp へ。書込不可のマウントで落ちるのを防ぐ）
// =======================================================
const DB_PATH = process.env.DB_PATH
  || (process.env.RENDER === 'true' ? path.join('/tmp', 'nbe-data.sqlite') : path.join(__dirname, 'data.sqlite'));

let db;
try {
  // 例: Render の永続ディスクを /var/data にマウントして DB_PATH=/var/data/data.sqlite にした直後、ディレクトリ未作成で落ちる
  if (DB_PATH && DB_PATH !== ':memory:') {
    const dir = path.dirname(DB_PATH);
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  day INTEGER,
  level INTEGER,
  plan TEXT,
  keyword TEXT,
  title TEXT,
  article TEXT,
  x_posts TEXT,
  hashtags TEXT,
  image_url TEXT,
  embedding TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_account ON articles(account);
CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at DESC);

CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  in_tokens INTEGER DEFAULT 0,
  out_tokens INTEGER DEFAULT 0,
  units REAL DEFAULT 0,
  usd REAL NOT NULL,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_costs_ts ON costs(ts DESC);

CREATE TABLE IF NOT EXISTS x_metrics (
  article_id INTEGER,
  tweet_id TEXT PRIMARY KEY,
  impressions INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  retweets INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  fetched_at INTEGER NOT NULL
);
  `);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[fatal] SQLite init failed / SQLiteの初期化に失敗:', msg, 'DB_PATH=', DB_PATH);
  process.exit(1);
}

// =======================================================
// COST TRACKING — 単価（USD）※2026/04時点の公表値ベース
// =======================================================
const RATES = {
  claude_sonnet_4_in: 3 / 1_000_000,      // $3/M in
  claude_sonnet_4_out: 15 / 1_000_000,    // $15/M out
  anthropic_web_search: 0.01,             // $0.01/search
  dalle3_standard_1024: 0.04,             // $0.04 / 1024 image
  dalle3_standard_wide: 0.08,            // $0.08 / 1024x1792 or 1792x1024
  openai_embed_small: 0.02 / 1_000_000,   // $0.02/M tokens
  usd_jpy: parseFloat(process.env.USD_JPY || '150')
};

function trackCost({ provider, kind, inTokens = 0, outTokens = 0, units = 0, usd, meta = null }) {
  if (typeof usd !== 'number' || !isFinite(usd)) return;
  db.prepare(`INSERT INTO costs(ts, provider, kind, in_tokens, out_tokens, units, usd, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(Date.now(), provider, kind, inTokens, outTokens, units, usd, meta ? JSON.stringify(meta) : null);
}

function claudeCost(usage, webSearchCount = 0) {
  const inT = usage?.input_tokens || 0;
  const outT = usage?.output_tokens || 0;
  const usd = inT * RATES.claude_sonnet_4_in + outT * RATES.claude_sonnet_4_out + webSearchCount * RATES.anthropic_web_search;
  return { usd, inT, outT };
}

// =======================================================
// PASSWORD AUTH (optional)
// =======================================================
const APP_PASSWORD = process.env.APP_PASSWORD;
const APP_USER = process.env.APP_USER || 'kotaro';
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// /healthz はファイル先頭で登録済み（上記）

if (APP_PASSWORD) {
  app.use((req, res, next) => {
    if (req.path === '/favicon.svg' || req.path === '/favicon.ico') return next();
    if (isHealthPath(req.path)) return next();
    return basicAuth({
      users: { [APP_USER]: APP_PASSWORD },
      challenge: true,
      realm: 'NoteBuzzEngine'
    })(req, res, next);
  });
  console.log('[auth] password protection ENABLED');
} else {
  console.log('[auth] APP_PASSWORD not set — running OPEN (set it before deploying to Render)');
}
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  console.error('[fatal] public/ not found:', publicDir, 'cwd=', process.cwd());
  process.exit(1);
}
app.use(express.static(publicDir));

// =======================================================
// IMAGE: Claude ブリーフ + 外付け用3プロンプト + DALL·E3（用途別サイズ）
// =======================================================
const IMAGE_SLOTS = ['hero', 'ogp', 'ig_square', 'ig_story'];

function dalleSizeForSlot (slot) {
  if (slot === 'ogp' || slot === 'note_ogp') return { size: '1792x1024', usd: RATES.dalle3_standard_wide, tag: 'wide' };
  if (slot === 'ig_story' || slot === 'story') return { size: '1024x1792', usd: RATES.dalle3_standard_wide, tag: 'tall' };
  return { size: '1024x1024', usd: RATES.dalle3_standard_1024, tag: 'sq' };
}

function buildInstagramProHint ({ title, xPosts, imageSlot, accountId }) {
  const ar = { ig_square: '1:1（フィード推奨）', ig_story: '9:16（ストーリー）', ogp: '横長（注: インスタ主戦なら1:1 or 4:5も検討）', hero: '1:1 汎用' }[imageSlot] || '1:1';
  const xArr = Array.isArray(xPosts) ? xPosts : [];
  const first = (xArr[0] && String(xArr[0])) || String(title || '');
  return {
    aspectRatioTarget: ar,
    suggestedCaption: first.slice(0, 2_200),
    howTo: 'NBE から **Instagram へ自動投稿（Graph API）**は未接続。作成画面に画像＋文を**手動**で貼る。インスタProのインサイトは Metaビジネススイート / アプリで確認。'
  };
}

/**
 * 返却: { brief, prompts: [3 strings], slotNote, model }
 * Cursor の「visual-generation-brief」スキルと同方針（外付けIdeogram等へコピー可）
 */
async function generateImageBriefBundle ({ title, articleExcerpt, accountId, imageSlot = 'hero' }) {
  const isStore = accountId === 'store';
  const style = isStore
    ? '飲食・商品アピール。食欲・温かい光。価格・店名の捏造は禁止。テキスト入り厳禁。'
    : '学習・AI・テック。モダン・オレンジ+ブルー系。テキスト入り厳禁。';
  const slotLine = {
    hero: '正方形に近いヒーロー/サムネ想定',
    ogp: '横長 ワイド（note・OGP・リンク用）',
    note_ogp: '横長 ワイド（note・OGP）',
    ig_square: 'Instagram 1:1 中央構図',
    ig_story: '縦長 9:16 寄り ストーリー用'
  }[imageSlot] || '汎用';

  const system = `あなたはビジュアルAD。DALL·E3 / Midjourney / Ideogram 等に使える**英語プロンプトを3本**。画像内に**文字・価格・ロゴ**を入れない（AI文字は汚いため）。

有効な**JSON1つだけ**を出力。キー:
- "brief": string（日本語、ブリーフ4〜6行）
- "prompts": string[] 長さ3。各200文字以下の英語
- "slotNote": string（日本語1行。用途: ${slotLine}）

${style}
`;
  const user = `タイトル: ${title}
抜粋: ${(articleExcerpt || '').slice(0, 500)}
imageSlot: ${imageSlot}`;

  const fallback = {
    brief: '外付け画像生成用のブリーフ。テキストなし、スタイル重視。',
    prompts: [
      `Modern photoreal food photography, appetizing, studio lighting, no text, no logo — ${String(title).slice(0, 40)}`,
      `Cinematic still life, shallow depth, warm tone, no text — ${String(title).slice(0, 40)}`,
      `Top-down food styling, clean background, no text — ${String(title).slice(0, 40)}`
    ],
    slotNote: slotLine,
    model: 'claude-sonnet-4-20250514'
  };
  if (!client) {
    return fallback;
  }
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1_200,
      system,
      messages: [{ role: 'user', content: user }]
    });
    const raw = (msg.content || []).map(c => c.text || '').join('').trim();
    let j = null;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonStr = (fence ? fence[1] : raw).trim();
    try {
      j = JSON.parse(jsonStr);
    } catch {
      j = null;
    }
    const cost = claudeCost(msg.usage);
    trackCost({ provider: 'anthropic', kind: 'image-brief', inTokens: cost.inT, outTokens: cost.outT, usd: cost.usd });
    if (j && Array.isArray(j.prompts) && j.prompts.length) {
      return {
        brief: String(j.brief || '').slice(0, 1_200),
        prompts: j.prompts.slice(0, 3).map(p => String(p).slice(0, 500)),
        slotNote: String(j.slotNote || slotLine),
        model: 'claude-sonnet-4-20250514'
      };
    }
  } catch (e) {
    console.warn('[image-brief] claude fail:', e.message);
  }
  return fallback;
}

async function dalleFromPrompt (prompt, sizeSpec) {
  if (!HAS_OPENAI || !openai) return null;
  const { size, usd } = sizeSpec;
  const resp = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size,
    quality: 'standard',
    response_format: 'url'
  });
  const url = resp.data?.[0]?.url;
  const revisedPrompt = resp.data?.[0]?.revised_prompt || prompt;
  trackCost({ provider: 'openai', kind: 'dalle3', units: 1, usd, meta: { prompt: prompt.slice(0, 200), size } });
  return { url, revisedPrompt, prompt, size };
}

/** imageMode: "dalle" | "brief" — brief 時は DALL·E 呼ばず imageBrief のみ */
async function generateHeroImage ({ title, articleExcerpt, accountId, imageSlot = 'hero', imageMode = 'dalle' }) {
  const bundle = await generateImageBriefBundle({ title, articleExcerpt, accountId, imageSlot });
  const primaryPrompt = (bundle.prompts && bundle.prompts[0]) || '';

  if (imageMode === 'brief' || !HAS_OPENAI) {
    return {
      imageBrief: bundle,
      imageUrl: null,
      prompt: primaryPrompt,
      revisedPrompt: null
    };
  }
  const sizeSpec = dalleSizeForSlot(imageSlot);
  try {
    const d = await dalleFromPrompt(primaryPrompt, sizeSpec);
    if (!d?.url) return { imageBrief: bundle, imageUrl: null, prompt: primaryPrompt, revisedPrompt: null };
    return {
      imageBrief: bundle,
      imageUrl: d.url,
      prompt: d.prompt,
      revisedPrompt: d.revisedPrompt,
      dalleSize: sizeSpec.size
    };
  } catch (e) {
    console.warn('[image-gen] failed:', e.message);
    return { imageBrief: bundle, imageUrl: null, prompt: primaryPrompt, revisedPrompt: null, error: e.message };
  }
}

// =======================================================
// SEMANTIC DEDUP (OpenAI embeddings + cosine similarity)
// =======================================================
async function getEmbedding(text) {
  if (!HAS_OPENAI) return null;
  try {
    const resp = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000)
    });
    const embedding = resp.data?.[0]?.embedding;
    const tokens = resp.usage?.total_tokens || 0;
    trackCost({ provider: 'openai', kind: 'embed', inTokens: tokens, usd: tokens * RATES.openai_embed_small });
    return embedding;
  } catch (e) {
    console.warn('[embed] failed:', e.message);
    return null;
  }
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function findSimilarRecent(account, embedding, threshold = 0.85, limit = 30) {
  if (!embedding) return [];
  const rows = db.prepare(`SELECT id, title, embedding, created_at FROM articles WHERE account = ? AND embedding IS NOT NULL ORDER BY created_at DESC LIMIT ?`).all(account, limit);
  const hits = [];
  for (const r of rows) {
    try {
      const emb = JSON.parse(r.embedding);
      const sim = cosineSim(embedding, emb);
      if (sim >= threshold) hits.push({ id: r.id, title: r.title, similarity: sim, created_at: r.created_at });
    } catch {}
  }
  return hits.sort((a, b) => b.similarity - a.similarity);
}

// =======================================================
// TRENDING HASHTAG CACHE — 6hキャッシュでコスト抑制
// =======================================================
const TRENDING_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const trendingTagsCache = {
  ai_main: { tags: [], fetchedAt: 0 },
  affi_seminar: { tags: [], fetchedAt: 0 },
  store: { tags: [], fetchedAt: 0 }
};

async function refreshTrendingTags(accountId, force = false) {
  const cache = trendingTagsCache[accountId];
  const now = Date.now();
  if (!force && cache.tags.length && (now - cache.fetchedAt) < TRENDING_CACHE_TTL_MS) {
    return cache.tags;
  }

  const queryMap = {
    ai_main: '直近7日以内に日本のX（Twitter）でAI副業・ChatGPT・Claude・AIツール関連でインプレッションが伸びている／使用頻度が増えているハッシュタグを15個挙げてください。日本語タグ10個と英語タグ5個を混ぜてください。各タグがなぜ伸びているかの理由も30字以内で簡潔に。',
    affi_seminar: '直近7日以内に日本のX（Twitter）でAI学習・AIセミナー・AIスクール・キャリアチェンジ・AI副業関連で使われているハッシュタグを12個挙げてください。主に投資意欲の高い30-40代が反応するタグに絞ってください。',
    store: '直近7日以内に日本のX（Twitter）でグルメ・お取り寄せ・家飲み・お取り寄せグルメ・ピザ・バーガー関連で伸びているハッシュタグを10個挙げてください。購買意欲が高い層が使っているものに絞ってください。'
  };
  const query = queryMap[accountId];
  if (!query) return [];

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
      system: `あなたはX（Twitter）のトレンド分析専門家です。本文の中にJSON配列として [{"tag":"#〜","reason":"〜"},...] の形式でハッシュタグリストを必ず含めてください。#記号は必ず付けること。`,
      messages: [{ role: 'user', content: query }]
    });

    const text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const jsonMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    let parsed = [];
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch {}
    }
    if (!parsed.length) {
      // fallback: extract hashtags via regex
      const tags = [...new Set((text.match(/#[A-Za-z0-9ぁ-んァ-ヶー一-龠々_]+/g) || []))];
      parsed = tags.slice(0, 15).map(t => ({ tag: t, reason: '抽出' }));
    }

    cache.tags = parsed.filter(p => p.tag && p.tag.startsWith('#')).slice(0, 20);
    cache.fetchedAt = now;

    const cost = claudeCost(msg.usage, 2);
    trackCost({ provider: 'anthropic', kind: 'trending-tags', inTokens: cost.inT, outTokens: cost.outT, usd: cost.usd, meta: { account: accountId } });

    return cache.tags;
  } catch (err) {
    console.warn('[trending-tags] failed:', err.message);
    return cache.tags; // return stale if available
  }
}

// =======================================================
// AFFILIATE URLs — .env から読み込み（未設定は空文字）
// =======================================================
const AFFI = {
  noteProfile: process.env.AFFI_NOTE_PROFILE || '',
  brain: process.env.AFFI_BRAIN_URL || '',
  rakuten: process.env.AFFI_RAKUTEN_URL || '',
  amazon: process.env.AFFI_AMAZON_URL || '',
  seminar: process.env.AFFI_SEMINAR_URL || '',
  storeEC: process.env.STORE_EC_URL || ''
};

function resolveAffiliateLinks(accountId) {
  const list = [];
  if (accountId === 'ai_main') {
    if (AFFI.brain) list.push({ label: 'brain本「Claude Code完全解説」', url: AFFI.brain, placement: '本文末尾と4番目のX投稿に必ず挿入' });
    if (AFFI.noteProfile) list.push({ label: 'noteプロフィール', url: AFFI.noteProfile, placement: '4番目のX投稿に必ず挿入' });
  } else if (accountId === 'store') {
    if (AFFI.rakuten) list.push({ label: '楽天ショップ', url: AFFI.rakuten, placement: '本文中盤と2番目のX投稿に必ず挿入' });
    if (AFFI.amazon) list.push({ label: 'Amazonショップ', url: AFFI.amazon, placement: '本文中盤と2番目のX投稿に必ず挿入' });
    if (AFFI.storeEC) list.push({ label: '公式EC', url: AFFI.storeEC, placement: '本文冒頭と2番目のX投稿に必ず挿入' });
  } else if (accountId === 'affi_seminar') {
    if (AFFI.seminar) list.push({ label: 'AIセミナーLP', url: AFFI.seminar, placement: '本文末尾と4番目のX投稿に必ず挿入' });
    if (AFFI.noteProfile) list.push({ label: 'noteプロフィール', url: AFFI.noteProfile, placement: '4番目のX投稿に必ず挿入' });
  }
  return list;
}

// =======================================================
// ACCOUNT PROFILES — 3アカ完全分離（混在禁止）
// =======================================================
const ACCOUNTS = {
  ai_main: {
    label: 'AI総合（メイン発信）',
    handle: '@shok_ai_kotaro',
    focus: 'AI副業・AI活用ノウハウ総合',
    personaPool: ['副業初心者', '副業中級者', '主婦・育児中', '学生・20代', 'クリエイター', 'サラリーマン副業組'],
    affiliatePool: [
      'brain自作本「Claude Code完全解説」',
      'ChatGPT Plus / Claude Pro 導線',
      '楽天・Amazon（AI関連書籍・周辺機器）',
      'AI系オンラインサロン'
    ],
    hashtagsJp: ['#AI副業', '#ChatGPT', '#Claude', '#AIツール', '#生成AI', '#AI活用'],
    hashtagsEn: ['#AItools', '#AIagents', '#GenAI', '#AIbusiness'],
    tone: '体験談ベース・実益重視・情熱的だが煽らない',
    aiContent: true,
    storeContent: false,
    noteLinkCTA: true,
    allowQuote: true,
    allowTrend: true,
    sideChannel: 'note.com'
  },
  store: {
    label: '店舗 × ネット販売',
    handle: '@pita_pizza1',
    focus: 'ピタピザ／Bread Burger商品・ネット販売拡散',
    personaPool: ['お取り寄せグルメ好き', '家飲み・宅飲み層', 'ファミリー層', 'ギフト探し層', '地元ファン'],
    affiliatePool: [
      '楽天市場（自店商品）',
      'Amazon（自店商品）',
      'BASE／STORES（ECストア）'
    ],
    hashtagsJp: ['#ピタピザ', '#BreadBurger', '#お取り寄せ', '#ネット販売', '#グルメ', '#家飲み'],
    hashtagsEn: [],
    tone: '商品写真前提・美味しそう・店舗のリアル感を出す',
    aiContent: false,
    storeContent: true,
    noteLinkCTA: false,
    allowQuote: false,
    allowTrend: false,
    sideChannel: 'EC（楽天・Amazon・自社EC）'
  },
  affi_seminar: {
    label: 'AIセミナー・アフィリ専用',
    handle: '@ai_pivot_fire',
    focus: '高額AIセミナー受講レビュー・成果報告・アフィリ',
    personaPool: ['AI学習中級者', '投資意欲ある副業層', '30-40代サラリーマン', '経営者・フリーランス'],
    affiliatePool: [
      '高額AIセミナー（ASP経由）',
      'AIスクール・オンラインブートキャンプ',
      'AIコンサルティングサービス'
    ],
    hashtagsJp: ['#AIセミナー', '#AI学習', '#AIスキル', '#AI投資', '#キャリアチェンジ'],
    hashtagsEn: ['#AIeducation', '#AIcareer'],
    tone: '受講レビュー型・煽らず信頼獲得路線・ROI視点',
    aiContent: true,
    storeContent: false,
    noteLinkCTA: true,
    allowQuote: true,
    allowTrend: true,
    sideChannel: 'note有料記事 + セミナーLP'
  }
};

// =======================================================
// LEVEL PROGRESSION — 即金体験スタート型
// =======================================================
const LEVELS = [
  {
    lv: 1, tag: 'LV.1 — 即金体験', fromDay: 1, toDay: 3,
    theme: '今日AIで3,000〜5,000円を作る最短手順',
    concreteness: 90,
    guardrail: '「100円を生む最小単位」を必ず提示する。派手な金額表現・誇大広告禁止',
    examples: 'ChatGPTで書いた占い文をココナラ500円販売／Claudeでnote有料部分を書き足し販売／AIイラストをミンネ出品／音声AIでVoicy台本作成代行',
    hookPreference: '体験談型・数字インパクト型'
  },
  {
    lv: 2, tag: 'LV.2 — 継続収入化', fromDay: 4, toDay: 7,
    theme: '週3万・月10万の再現レシピ',
    concreteness: 80,
    guardrail: '再現手順を具体化。時給換算を1度入れる。断言は禁止',
    examples: 'ココナラ出品テンプレ量産／noteマガジン月額化／X投稿からの受注導線／AIライティング代行の単価設定',
    hookPreference: '数字インパクト型・問題提起型'
  },
  {
    lv: 3, tag: 'LV.3 — 仕組み化', fromDay: 8, toDay: 14,
    theme: '自動化・ワークフロー・複数ツール連携',
    concreteness: 50,
    guardrail: '記事冒頭10%は「初心者が迷子にならない導入」を必ず入れる',
    examples: 'n8n／Make／Zapier連携／Claude API自作ツール／スプレッドシート×AI／Slack Bot化',
    hookPreference: '逆説型・問題提起型'
  },
  {
    lv: 4, tag: 'LV.4 — 収益最大化', fromDay: 15, toDay: 21,
    theme: '月10万→30万スケール戦略',
    concreteness: 40,
    guardrail: '冒頭10%は初心者向け導入。大きな数字は可能性表現のみ',
    examples: '外注化／情報発信収益化／コンサル契約／サブスク商品設計／コミュニティ運営',
    hookPreference: '逆説型・質問型'
  },
  {
    lv: 5, tag: 'LV.5 — 独自化', fromDay: 22, toDay: 99999,
    theme: '独自システム構築・競合に真似されない差別化',
    concreteness: 30,
    guardrail: '冒頭10%は初心者向け導入。深い内容は中盤以降',
    examples: 'Claude Codeで自作ツール化／独自Bot運用／オリジナルSaaS化／情報発信ブランド確立',
    hookPreference: '質問型・逆説型'
  }
];

function getLevel(day) {
  return LEVELS.find(l => day >= l.fromDay && day <= l.toDay) || LEVELS[4];
}

// =======================================================
// HOOKS / ANGLES / STRUCTURES
// =======================================================
const HOOKS = [
  '問題提起型（「〜で悩んでいませんか？」から始める）',
  '体験談型（著者の失敗談・リアルな失敗から入る）',
  '数字インパクト型（冒頭に具体的な数字を出す）',
  '逆説型（「実は〜ではない」から始める）',
  '質問型（読者への問いかけから始める）'
];
const ANGLES = [
  'AI初心者目線で解説する',
  '飲食店オーナー視点で業務活用に絡める',
  '失敗から学んだ視点を主軸にする',
  'ツール比較・コスト視点で進める',
  '時間効率化・スキマ時間活用の視点で進める',
  '海外事例の日本向けアレンジ視点'
];
const STRUCTURES = [
  'PREP法（結論→理由→具体例→結論）',
  'SDS法（要約→詳細→要約）',
  '問題→解決→結果の3段構成',
  'ビフォーアフター構成',
  'ステップバイステップ構成'
];

// =======================================================
// PROMPT BUILDERS
// =======================================================
function buildSystemPrompt({
  acc, lv, yr, persona, affiliate, articleType, plan,
  hook, angle, structure, dayNumber, reviewMode,
  metaInsertion, avoidBlock, quoteBlock, trendContext,
  affiliateLinks, trendingTags
}) {
  const typeMap = {
    lmn: { label: 'LMN最強（リスト型）', note: 'タイトルは「◯選」形式。H2見出しで各アイテムを構成する' },
    comparison: { label: '比較・選び方型', note: '「〜vs〜」「どれが最強？」形式。本文中に比較ポイントを明示する' },
    guide: { label: 'まとめ・ガイド型', note: '「完全ガイド」「全手順」形式。STEP形式で手順を構成する' },
    trending: { label: 'トレンド型', note: '時事性を冒頭に入れ、今起きていることと著者の体験を絡める' },
    case_study: { label: '実例・ケース型', note: '実際の成果・金額・スクショ想定を中心に組み立てる' }
  };
  const typeInfo = typeMap[articleType] || typeMap.guide;

  const planBlock = plan === 'paid'
    ? `【有料記事モード — 必須】
- 具体的なツール設定値・数字を含める（例:「プロンプトは200字以内で〜」「月3〜8万円を目指せる可能性がある」）
- 有料で読む価値がある独自ノウハウ・手順を必ず入れる
- 本文中に「ここからは具体的な設定手順を解説します」等の有料感を出す演出を入れる
- 本文内に【PRO TIP】として上級者向けのワンポイントを1〜2箇所挿入する`
    : `【無料記事モード】
- 概念・価値観の提示を中心にする
- 具体的手順は「詳しくはリンク先で」など続きを読ませる構成
- 「試してみたい」と思わせる温度感にする`;

  const accBlock = acc.aiContent
    ? `【アカウント: ${acc.label}（${acc.handle}）】
- フォーカス: ${acc.focus}
- トーン: ${acc.tone}
- サイドチャネル: ${acc.sideChannel}
- 店舗ネタ（ピタピザ／Bread Burger等）は絶対に混ぜない`
    : `【アカウント: ${acc.label}（${acc.handle}）】
- フォーカス: ${acc.focus}
- トーン: ${acc.tone}
- サイドチャネル: ${acc.sideChannel}
- AI・副業ノウハウは絶対に混ぜない（店舗＝商品・美味しさ・体験のみ）`;

  const reviewBlock = reviewMode
    ? `【復習回モード — 必須】
本記事は前レベル内容の復習回。新しい内容を追加するのではなく、前LV内容を別角度で再提示する。
- 冒頭で「ここで一度振り返ります」と明示
- 難易度は前LV基準に落とす
- 挫折しかけた読者を拾う温度感を最優先`
    : '';

  const metaBlock = metaInsertion
    ? `【メタ進行加筆 — 必須で本文冒頭または末尾に挿入】
以下の文面に近いニュアンスで、著者から読者への「進行報告」を1段落（200字前後）入れてください:
「${metaInsertion}」
- 機械的にコピペせず、今回の記事内容に合わせて自然に書き換えること`
    : '';

  const linksBlock = (affiliateLinks && affiliateLinks.length)
    ? `【掲載必須のURL — 以下を指定の場所に必ず原文のまま挿入】
${affiliateLinks.map(l => `- ${l.label}: ${l.url}\n  → 配置: ${l.placement}`).join('\n')}
- URLは短縮せずそのまま使う
- 紹介文脈は押し売りにならないよう自然に（「興味があれば覗いてみてください」程度）
- JSON出力でも本文・xPostsの該当箇所にURLを含めること`
    : '';

  const trendBlock = trendContext
    ? `【海外トレンド反映 — 必須】
以下は直近の海外X・技術ブログから拾ったAIトレンド情報です。日本向けに翻訳・アレンジして、本記事の切り口に自然に織り込んでください:
---
${trendContext}
---
- 出典アカウント名・技術名はそのまま明記すること
- ただし「海外が言ってるから正しい」調ではなく「日本の読者にとってどう使えるか」で書く`
    : '';

  const dayLabel = `DAY ${dayNumber} / ${lv.tag}`;

  const authorProfile = acc.aiContent
    ? `著者プロフィール: 飲食店（Bread Burger／ピタピザ）を経営する実店舗オーナー（${acc.handle}）が、AI活用・副業について発信。毎日12時間営業の現場で試行錯誤しながらAIを組み込んでいるリアル感が武器。`
    : `著者プロフィール: ${acc.handle} — ピタピザ／Bread Burgerのオーナー。店頭で出している商品と、ネット販売で届けられる商品を発信。毎日の仕込み・原価率・地域での評判などリアルな店舗情報が強み。`;

  return `あなたは${acc.aiContent ? 'note.com' : 'X'}専門コンテンツライターです。
${authorProfile}

${accBlock}

【絶対ルール】
1. 年号は${yr}年のみ使用。過去年号（2025年等）は絶対禁止
2. 収益・実績の断言は禁止。「〜を狙える」「〜の可能性がある」「〜を目指している」等の可能性表現のみ
3. アフィリエイト商品「${affiliate}」を本文中に自然に1〜2箇所言及（押し売り・過剰宣伝禁止）
4. 記事タイプ: ${typeInfo.label} — ${typeInfo.note}
5. ターゲット読者: ${persona}
6. 文字数: 2000〜2600字
7. シリーズ連番として「${dayLabel}」を本文冒頭または末尾に自然に組み込む

${planBlock}

【現在のレベル: ${lv.tag}】
- テーマ: ${lv.theme}
- 具体度: ${lv.concreteness}%
- 守るべき塩梅: ${lv.guardrail}
- 参考事例群: ${lv.examples}

【今回の構成パターン】
- 冒頭フック: ${hook}
- 記事の切り口・視点: ${angle}
- 本文構成: ${structure}

${reviewBlock}

${metaBlock}

${trendBlock}

${linksBlock}

${avoidBlock}

${quoteBlock}

【X投稿スレッド構成（${acc.storeContent ? '3投稿・各140字以内' : '5投稿・各140字以内'}）】
${acc.storeContent ? `1: 商品訴求フック（写真想定・シズル感重視）
2: 店舗／ネット販売の入手方法・送料等の具体情報
3: レビュー誘発（「食べた人の感想は？」系CTA）` : `1: 共感フック（${hook}で始める・数字＋意外性で全振り）
2: 著者の実体験（飲食店経営×AI）で信頼構築
3: 具体的な手順・ポイント（3〜5個、箇条書き風）
4: note記事への誘導（「詳しくはnoteで↓」）※ここに貼る、末尾ではない
5: 引用RT誘発CTA（「あなたはどっち派？」「同意か反論か？」系）`}

【ハッシュタグ戦略】
- ベースタグ（定番）: ${acc.hashtagsJp.join(' ')} ${acc.hashtagsEn.join(' ')}
${(trendingTags && trendingTags.length) ? `- 🔥 直近バズタグ（優先して混ぜる）: ${trendingTags.map(t => t.tag).join(' ')}
  → 各タグの文脈に合うものを選定し、定番タグと混在させる。ただし記事内容と無関係なら使わない（虚偽はNG）` : ''}
- 各投稿の末尾に関連タグを2〜4個だけ添える（詰め込み禁止）
- バズタグと定番タグをミックスする形で選ぶ

【出力形式】
JSONのみ。説明文・コードブロック・マークダウン記法は不要。
{
  "title": "記事タイトル（${yr}年最新〜など自然に年号を含める）",
  "article": "本文（改行は\\n）",
  "xPosts": ${acc.storeContent ? '["投稿1", "投稿2", "投稿3"]' : '["投稿1", "投稿2", "投稿3", "投稿4", "投稿5"]'},
  "hashtags": ["#タグ1", "#タグ2", ...],
  "quote": ${quoteBlock.includes('引用を1つ') ? '{"person":"","role":"","text":"","source":""}' : 'null'},
  "seriesLabel": "${dayLabel}",
  "metaNote": ${metaInsertion ? '"本文に組み込んだ進行報告の要約（30字以内）"' : 'null'}
}`;
}

// =======================================================
// TREND FETCHER — Claude web_search tool
// =======================================================
async function fetchForeignTrend(keyword) {
  try {
    const trendQuery = `直近7日以内に海外のX（Twitter）や技術ブログで話題になっている「${keyword}」関連のAI・AIエージェント・AIツールのトピックを3つ挙げてください。各トピックについて、誰が／どの媒体が言及しているか、要点、なぜバズっているかを日本語で簡潔にまとめてください。出典URLと発信者名を必ず含めてください。`;

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: trendQuery }]
    });

    const textBlocks = (msg.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n\n');

    const cost = claudeCost(msg.usage, 3);
    trackCost({ provider: 'anthropic', kind: 'trend-fetch', inTokens: cost.inT, outTokens: cost.outT, usd: cost.usd });

    return textBlocks || null;
  } catch (err) {
    console.warn('[trend-fetch] skipped:', err.message);
    return null;
  }
}

// =======================================================
// MAIN GENERATION ENDPOINT
// =======================================================
app.post('/api/generate', async (req, res) => {
  const {
    account = 'ai_main',
    keyword,
    articleType = 'guide',
    persona,
    affiliate,
    plan = 'free',
    dayNumber,
    hook, angle, structure,
    recentTitles = [],
    useQuote = false,
    useTrend = false,
    useImage = true,
    /** dalle: Claudeブリーフ→DALL·E3  |  brief: 外付けAI用（プロンプト3本+ブリーフのみ。OPENAI不要） */
    imageMode = 'dalle',
    /** hero | ogp | ig_square | ig_story */
    imageSlot = 'hero',
    forceReview = false,
    metaInsertion = null,
    currentYear
  } = req.body;

  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  const acc = ACCOUNTS[account];
  if (!acc) return res.status(400).json({ error: 'invalid account' });

  const yr = currentYear || new Date().getFullYear();
  const day = Math.max(1, parseInt(dayNumber) || 1);
  const lv = getLevel(day);

  const selPersona = persona || acc.personaPool[0];
  const selAffiliate = affiliate || acc.affiliatePool[0];
  const selHook = hook || HOOKS[Math.floor(Math.random() * HOOKS.length)];
  const selAngle = angle || ANGLES[Math.floor(Math.random() * ANGLES.length)];
  const selStructure = structure || STRUCTURES[Math.floor(Math.random() * STRUCTURES.length)];

  // Review round: LV2→3 or LV4→5 boundary, 30% probability when arriving
  const onReviewBoundary =
    (day === lv.fromDay) && (lv.lv === 3 || lv.lv === 5);
  const reviewMode = forceReview || (onReviewBoundary && Math.random() < 0.3);

  const quoteBlock = (useQuote && acc.allowQuote)
    ? `【著名人発言の引用】
今回の記事の冒頭か末尾に、イーロン・マスクまたはサム・アルトマンのAI関連の実際の発言を引用を1つ含めてください。
- 引用は1〜2文、出典（発言媒体・時期）を添える
- JSON内の "quote" フィールドに {"person":"","role":"","text":"","source":""} として格納
- 実際に公言されている発言のみ使用すること（創作禁止）`
    : '"quote": null を返すこと';

  const avoidBlock = recentTitles?.length
    ? `【重複回避 — 以下のタイトル・構成とは完全に異なる記事を書くこと】\n${recentTitles.map(t => `- ${t}`).join('\n')}`
    : '';

  // fetch trend context if requested and allowed
  let trendContext = null;
  let trendFetched = false;
  if (useTrend && acc.allowTrend) {
    trendContext = await fetchForeignTrend(keyword);
    trendFetched = !!trendContext;
  }

  const affiliateLinks = resolveAffiliateLinks(account);

  // Auto-refresh trending tags (uses cache if fresh)
  const trendingTags = await refreshTrendingTags(account).catch(() => []);

  const systemPrompt = buildSystemPrompt({
    acc, lv, yr,
    persona: selPersona,
    affiliate: selAffiliate,
    articleType, plan,
    hook: selHook, angle: selAngle, structure: selStructure,
    dayNumber: day,
    reviewMode,
    metaInsertion,
    avoidBlock,
    quoteBlock,
    trendContext,
    affiliateLinks,
    trendingTags
  });

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `キーワード: 「${keyword}」\nJSONのみで返してください。`
      }]
    });

    const raw = (message.content || []).map(c => c.text || '').join('');
    const clean = raw
      .replace(/```[\s\S]*?```/g, s => s.replace(/```\w*|```/g, ''))
      .trim();
    const parsed = JSON.parse(clean);

    const genCost = claudeCost(message.usage);
    trackCost({ provider: 'anthropic', kind: 'article-gen', inTokens: genCost.inT, outTokens: genCost.outT, usd: genCost.usd, meta: { account, keyword } });

    // Semantic dedup check
    const embedText = `${parsed.title || ''}\n${(parsed.article || '').slice(0, 1200)}`;
    const embedding = await getEmbedding(embedText);
    const similar = findSimilarRecent(account, embedding, 0.86, 30);
    const dupWarning = similar.length ? similar[0] : null;

    // Hero / OGP / Insta: Claude ブリーフ + 任意で DALL·E3
    const slot = IMAGE_SLOTS.includes(imageSlot) ? imageSlot : 'hero';
    const mode = imageMode === 'brief' ? 'brief' : 'dalle';
    let image = null;
    if (useImage) {
      image = await generateHeroImage({
        title: parsed.title || keyword,
        articleExcerpt: parsed.article || '',
        accountId: account,
        imageSlot: slot,
        imageMode: mode
      });
    }

    // Persist
    const insertStmt = db.prepare(`INSERT INTO articles(account, day, level, plan, keyword, title, article, x_posts, hashtags, image_url, embedding, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const info = insertStmt.run(
      account, day, lv.lv, plan, keyword,
      parsed.title || null,
      parsed.article || null,
      JSON.stringify(parsed.xPosts || []),
      JSON.stringify(parsed.hashtags || []),
      image?.imageUrl || null,
      embedding ? JSON.stringify(embedding) : null,
      JSON.stringify({
        hook: selHook, angle: selAngle, structure: selStructure, reviewMode, metaInsertion: !!metaInsertion, trendFetched,
        imageMode: useImage ? mode : null, imageSlot: useImage ? slot : null, imageBrief: useImage && image?.imageBrief ? image.imageBrief : null
      }),
      Date.now()
    );

    const igHint = useImage
      ? buildInstagramProHint({ title: parsed.title, xPosts: parsed.xPosts, imageSlot: slot, accountId: account })
      : null;

    res.json({
      success: true,
      data: {
        ...parsed,
        articleId: info.lastInsertRowid,
        account,
        accountLabel: acc.label,
        accountHandle: acc.handle,
        dayNumber: day,
        level: lv.lv,
        levelTag: lv.tag,
        plan,
        reviewMode,
        trendFetched,
        trendContext: trendContext ? trendContext.slice(0, 1200) : null,
        hook: selHook,
        angle: selAngle,
        structure: selStructure,
        affiliateLinks: affiliateLinks.map(l => ({ label: l.label, url: l.url })),
        trendingTags: trendingTags.map(t => t.tag),
        trendingTagsFull: trendingTags,
        imageUrl: image?.imageUrl || null,
        imagePrompt: image?.revisedPrompt || image?.prompt || null,
        imageBrief: useImage ? image?.imageBrief : null,
        imageMode: useImage ? mode : null,
        imageSlot: useImage ? slot : null,
        dalleSize: image?.dalleSize || null,
        instagramProHint: igHint,
        duplicateWarning: dupWarning,
        imageAvailable: mode === 'brief' ? true : HAS_OPENAI
      }
    });
  } catch (err) {
    console.error('[generate] error:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

// =======================================================
// META INSERTION HINT ENDPOINT — LV昇格・重要日の進行報告テンプレ
// =======================================================
app.get('/api/meta-hint', (req, res) => {
  const day = Math.max(1, parseInt(req.query.day) || 1);
  const lv = getLevel(day);
  const prev = LEVELS.find(l => l.lv === lv.lv - 1);

  if (day === lv.fromDay && prev) {
    const msg = `ここまで読んでくれた方へ。昨日までは「${prev.theme}」をお伝えしてきました。今日から${lv.tag}に入ります。テーマは「${lv.theme}」です。いきなり難易度を上げず、${prev.tag}で話した内容を地続きに深める形で進めていくので、ついてきてもらえると嬉しいです。`;
    return res.json({ hasMeta: true, message: msg, boundary: true });
  }
  return res.json({ hasMeta: false, message: null, boundary: false });
});

// =======================================================
// TRENDING TAGS ENDPOINT — UI手動取得／強制更新
// =======================================================
app.get('/api/trending-tags', async (req, res) => {
  const account = req.query.account || 'ai_main';
  const force = req.query.force === '1';
  if (!ACCOUNTS[account]) return res.status(400).json({ error: 'invalid account' });

  const tags = await refreshTrendingTags(account, force).catch(() => []);
  const cache = trendingTagsCache[account];
  res.json({
    account,
    tags,
    fetchedAt: cache.fetchedAt,
    ageMinutes: cache.fetchedAt ? Math.floor((Date.now() - cache.fetchedAt) / 60000) : null,
    ttlMinutes: Math.floor(TRENDING_CACHE_TTL_MS / 60000)
  });
});

// =======================================================
// ACCOUNT DIRECTORY ENDPOINT
// =======================================================
app.get('/api/accounts', (req, res) => {
  const out = {};
  for (const key of Object.keys(ACCOUNTS)) {
    const a = ACCOUNTS[key];
    out[key] = {
      label: a.label,
      handle: a.handle,
      focus: a.focus,
      personaPool: a.personaPool,
      affiliatePool: a.affiliatePool,
      hashtagsJp: a.hashtagsJp,
      hashtagsEn: a.hashtagsEn,
      aiContent: a.aiContent,
      storeContent: a.storeContent,
      allowQuote: a.allowQuote,
      allowTrend: a.allowTrend,
      noteLinkCTA: a.noteLinkCTA
    };
  }
  res.json({ accounts: out, levels: LEVELS });
});

// =======================================================
// COST SUMMARY ENDPOINT
// =======================================================
app.get('/api/costs', (req, res) => {
  const nowMs = Date.now();
  const dayAgo = nowMs - 24 * 60 * 60 * 1000;
  const monthAgo = nowMs - 30 * 24 * 60 * 60 * 1000;

  const total = db.prepare(`SELECT COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS n FROM costs`).get();
  const today = db.prepare(`SELECT COALESCE(SUM(usd), 0) AS usd FROM costs WHERE ts >= ?`).get(dayAgo);
  const month = db.prepare(`SELECT COALESCE(SUM(usd), 0) AS usd FROM costs WHERE ts >= ?`).get(monthAgo);
  const byKind = db.prepare(`SELECT kind, COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS n FROM costs GROUP BY kind ORDER BY usd DESC`).all();

  const jpy = (u) => Math.round(u * RATES.usd_jpy);
  res.json({
    usd_jpy: RATES.usd_jpy,
    total: { usd: total.usd, jpy: jpy(total.usd), calls: total.n },
    last24h: { usd: today.usd, jpy: jpy(today.usd) },
    last30d: { usd: month.usd, jpy: jpy(month.usd) },
    byKind: byKind.map(r => ({ ...r, jpy: jpy(r.usd) }))
  });
});

// =======================================================
// ARTICLES HISTORY ENDPOINT
// =======================================================
app.get('/api/articles', (req, res) => {
  const account = req.query.account;
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const params = [];
  let where = '';
  if (account) { where = 'WHERE account = ?'; params.push(account); }
  const rows = db.prepare(`SELECT id, account, day, level, plan, keyword, title, image_url, created_at, meta FROM articles ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit);
  res.json({
    articles: rows.map(r => ({
      id: r.id, account: r.account, day: r.day, level: r.level, plan: r.plan,
      keyword: r.keyword, title: r.title, imageUrl: r.image_url,
      createdAt: r.created_at, meta: r.meta ? JSON.parse(r.meta) : null
    }))
  });
});

app.get('/api/articles/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM articles WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({
    ...row,
    x_posts: row.x_posts ? JSON.parse(row.x_posts) : [],
    hashtags: row.hashtags ? JSON.parse(row.hashtags) : [],
    meta: row.meta ? JSON.parse(row.meta) : null,
    embedding: undefined
  });
});

// =======================================================
// STANDALONE IMAGE BRIEF（外付けAI用。DALL·E 不要）
// =======================================================
app.post('/api/image-brief', async (req, res) => {
  const { title, articleExcerpt = '', account = 'ai_main', imageSlot = 'hero' } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const slot = IMAGE_SLOTS.includes(imageSlot) ? imageSlot : 'hero';
  if (!ACCOUNTS[account]) return res.status(400).json({ error: 'invalid account' });
  try {
    const bundle = await generateImageBriefBundle({ title, articleExcerpt, accountId: account, imageSlot: slot });
    return res.json({
      success: true,
      data: { imageBrief: bundle, imageSlot: slot, instagramProHint: buildInstagramProHint({ title, xPosts: req.body.xPosts, imageSlot: slot, accountId: account }) }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'brief failed' });
  }
});

// =======================================================
// IMAGE REGENERATION ENDPOINT
// =======================================================
app.post('/api/regenerate-image', async (req, res) => {
  const { articleId, customPrompt, imageSlot = 'hero', imageMode = 'dalle' } = req.body;
  const im = imageMode === 'brief' ? 'brief' : 'dalle';
  if (im === 'dalle' && !HAS_OPENAI && !customPrompt) {
    return res.status(400).json({ error: 'OPENAI_API_KEY not configured' });
  }
  const row = db.prepare(`SELECT * FROM articles WHERE id = ?`).get(articleId);
  if (!row) return res.status(404).json({ error: 'article not found' });

  try {
    let out;
    if (customPrompt) {
      if (!HAS_OPENAI) return res.status(400).json({ error: 'OPENAI_API_KEY required for custom prompt' });
      const sizeSpec = dalleSizeForSlot(imageSlot);
      const d = await dalleFromPrompt(customPrompt, sizeSpec);
      if (!d?.url) throw new Error('generation failed');
      out = { imageUrl: d.url, revisedPrompt: d.revisedPrompt, imagePrompt: d.revisedPrompt, imageBrief: null, dalleSize: sizeSpec.size };
    } else {
      out = await generateHeroImage({
        title: row.title, articleExcerpt: row.article, accountId: row.account,
        imageSlot, imageMode: im
      });
    }
    if (im === 'dalle' && !out?.imageUrl) throw new Error('generation failed');
    if (out?.imageUrl) {
      db.prepare(`UPDATE articles SET image_url = ? WHERE id = ?`).run(out.imageUrl, articleId);
    }
    res.json({
      imageUrl: out.imageUrl || null,
      prompt: out.revisedPrompt || out.imagePrompt,
      imageBrief: out.imageBrief,
      dalleSize: out.dalleSize
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =======================================================
// X POST (SCAFFOLD — requires X API keys)
// =======================================================
app.post('/api/post-to-x', async (req, res) => {
  if (!HAS_X_API) return res.status(400).json({ error: 'X API keys not configured', hint: 'Set X_APP_KEY / X_APP_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET in .env' });

  const { articleId, posts, imageUrl, account: bodyAccount } = req.body;
  if (!posts?.length) return res.status(400).json({ error: 'posts required' });

  let accountId = bodyAccount || null;
  if (articleId) {
    const row = db.prepare(`SELECT account FROM articles WHERE id = ?`).get(articleId);
    if (!row) return res.status(404).json({ error: 'article not found' });
    if (accountId && accountId !== row.account) {
      return res.status(400).json({ error: 'account mismatch', detail: '本文のアカウントと指定が一致しません' });
    }
    accountId = row.account;
  }
  if (!accountId) return res.status(400).json({ error: 'account required', hint: 'articleId を送るか、body に account: "store" を含めてください' });

  const xClient = getXClientForAccount(accountId);
  if (!xClient) {
    return res.status(403).json({
      error: 'X API is not configured for this account',
      account: accountId,
      hint: '現在 Render に登録されているキーは店舗（store / @pita_pizza1）用のみです。AI総合・セミナー用は別途キーを発行してから拡張します。'
    });
  }

  try {
    let mediaId = null;
    if (imageUrl) {
      const imgResp = await fetch(imageUrl);
      const buf = Buffer.from(await imgResp.arrayBuffer());
      const ctype = imgResp.headers.get('content-type') || '';
      const mime = ctype.includes('jpeg') || ctype.includes('jpg') ? 'image/jpeg'
        : ctype.includes('webp') ? 'image/webp'
          : ctype.includes('gif') ? 'image/gif' : 'image/png';
      const upload = await xClient.v1.uploadMedia(buf, { mimeType: mime });
      mediaId = upload;
    }

    const results = [];
    let lastId = null;
    for (let i = 0; i < posts.length; i++) {
      const payload = { text: posts[i] };
      if (i === 0 && mediaId) payload.media = { media_ids: [mediaId] };
      if (lastId) payload.reply = { in_reply_to_tweet_id: lastId };
      const tweet = await xClient.v2.tweet(payload);
      lastId = tweet.data.id;
      results.push({ index: i, id: lastId });
      if (articleId) {
        db.prepare(`INSERT OR IGNORE INTO x_metrics(article_id, tweet_id, fetched_at) VALUES (?, ?, ?)`)
          .run(articleId, lastId, Date.now());
      }
    }
    res.json({ success: true, results, threadUrl: `https://x.com/i/status/${results[0].id}` });
  } catch (e) {
    console.error('[post-to-x]', e);
    res.status(500).json({ error: e.message });
  }
});

// =======================================================
// X METRICS FETCH (SCAFFOLD — learning loop)
// =======================================================
app.post('/api/fetch-x-metrics', async (req, res) => {
  if (!HAS_X_API) return res.status(400).json({ error: 'X API keys not configured' });

  try {
    const tweets = db.prepare(`
      SELECT m.tweet_id, m.article_id
      FROM x_metrics m
      JOIN articles a ON a.id = m.article_id AND a.account IN ('store')
      ORDER BY m.fetched_at ASC
      LIMIT 100
    `).all();
    if (!tweets.length) return res.json({ updated: 0, message: 'no tweets tracked yet' });

    const ids = tweets.map(t => t.tweet_id);
    const data = await xClient.v2.tweets(ids, {
      'tweet.fields': ['public_metrics', 'non_public_metrics']
    });

    let updated = 0;
    for (const t of data.data || []) {
      const m = t.public_metrics || {};
      db.prepare(`UPDATE x_metrics SET impressions = ?, likes = ?, retweets = ?, replies = ?, fetched_at = ? WHERE tweet_id = ?`)
        .run(m.impression_count || 0, m.like_count || 0, m.retweet_count || 0, m.reply_count || 0, Date.now(), t.id);
      updated++;
    }
    res.json({ updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =======================================================
// FEATURES ENDPOINT — UI feature availability check
// =======================================================
app.get('/api/features', (req, res) => {
  const xAccounts = {
    ai_main: false,
    store: !!(HAS_X_API && X_ENABLED_ACCOUNTS.has('store')),
    affi_seminar: false
  };
  res.json({
    image: HAS_OPENAI,
    imageBrief: true,
    xAutoPost: HAS_X_API && X_ENABLED_ACCOUNTS.size > 0,
    xAccounts,
    xMetrics: HAS_X_API && xAccounts.store,
    auth: !!APP_PASSWORD,
    dbPath: DB_PATH,
    xNote: '登録中のXキーは店舗（@pita_pizza1）投稿用です'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NOTE BUZZ ENGINE v3.3.2 listening on 0.0.0.0:${PORT}`);
  console.log(`[boot] RENDER=${process.env.RENDER} NODE_ENV=${process.env.NODE_ENV} DB_PATH=${DB_PATH} cwd=${process.cwd()}`);
  console.log(`[features] image=${HAS_OPENAI} xapi=${HAS_X_API} auth=${!!APP_PASSWORD}`);
});
