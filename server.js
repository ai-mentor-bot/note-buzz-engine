require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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
  affiliateLinks
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
- 日本語タグ: ${acc.hashtagsJp.join(' ')}
- 英語タグ: ${acc.hashtagsEn.length ? acc.hashtagsEn.join(' ') : '（このアカウントでは使用しない）'}
- 各投稿の末尾に関連タグを2〜4個だけ添える（詰め込み禁止）

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
    affiliateLinks
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

    res.json({
      success: true,
      data: {
        ...parsed,
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
        affiliateLinks: affiliateLinks.map(l => ({ label: l.label, url: l.url }))
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

app.listen(PORT, () => console.log(`NOTE BUZZ ENGINE v3.0 running on port ${PORT}`));
