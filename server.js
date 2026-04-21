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

// メイン生成エンドポイント
app.post('/api/generate', async (req, res) => {
  const {
    keyword,
    brand,
    articleType,
    persona,
    affiliate,
    plan,
    level,
    hook,
    angle,
    structure,
    recentTitles,
    useQuote,
    currentYear
  } = req.body;

  if (!keyword) return res.status(400).json({ error: 'keyword required' });

  const brandMap = {
    bread_burger: { name: 'Bread Burger', handle: '@kotaro_shoku_ai' },
    pitapizza: { name: 'ピタピザ', handle: '@kotaro_shoku_ai' },
    custom: { name: 'カスタム', handle: '@kotaro_shoku_ai' }
  };
  const typeMap = {
    lmn: {
      label: 'LMN最強（リスト型）',
      note: 'タイトルは「◯選」形式。H2見出しで各アイテムを構成する'
    },
    comparison: {
      label: '比較・選び方型',
      note: '「〜vs〜」「どれが最強？」形式。本文中に比較ポイントを明示する'
    },
    guide: {
      label: 'まとめ・ガイド型',
      note: '「完全ガイド」「全手順」形式。STEP形式で手順を構成する'
    },
    trending: {
      label: 'トレンド型',
      note: '時事性を冒頭に入れ、今起きていることと著者の体験を絡める'
    }
  };

  const brandInfo = brandMap[brand] || brandMap.bread_burger;
  const typeInfo = typeMap[articleType] || typeMap.guide;
  const yr = currentYear || new Date().getFullYear();

  // プラン別プロンプト
  const planInstruction = plan === 'paid'
    ? `【有料記事モード — 以下を必ず守る】
- 具体的なツール設定値・数字を含める（例:「プロンプトは200字以内で〜」「月3〜8万円を目指せる可能性がある」）
- 有料で読む価値がある独自ノウハウ・手順を入れる
- 無料では得られない具体性・深さを出す
- 本文中に「ここからは具体的な設定手順を解説します」等の有料感を出す演出を入れる
- 本文内に【PRO TIP】として上級者向けのワンポイントを1〜2箇所挿入する`
    : `【無料記事モード】
- 概念・価値観の提示を中心にする
- 具体的手順は「詳しくはリンク先で」など続きを読ませる構成
- 「試してみたい」と思わせる温度感にする`;

  // レベル別プロンプト
  const levelDescMap = {
    1: { tag: 'LV.1 入門', desc: 'AIツールの基礎概念、ChatGPT/Claude入門、初めての一歩。専門用語を避け平易な言葉で書く' },
    2: { tag: 'LV.2 実践', desc: 'プロンプト基礎、実際の活用例、初収益への道。具体的なツール名と使い方を入れる' },
    3: { tag: 'LV.3 応用', desc: '自動化・ワークフロー構築、複数ツール連携。中級者向けの技術的内容を盛り込む' },
    4: { tag: 'LV.4 収益化', desc: 'スケール戦略、収益最大化、外注・仕組み化。ビジネス観点でKPI・ROIに触れる' },
    5: { tag: 'LV.5 上級', desc: '独自システム構築、差別化戦略、競合に真似されない強み。高度な内容と独自視点を入れる' }
  };
  const lvInfo = levelDescMap[level] || levelDescMap[1];

  // 著名人引用プロンプト
  const quoteInstruction = useQuote
    ? `【著名人発言の引用】
今回の記事の冒頭か末尾に、イーロン・マスクまたはサム・アルトマンのAI関連の実際の発言を1つ引用してください。
- 引用は1〜2文、出典（発言媒体・時期）を添える
- JSON内の "quote" フィールドに {"person":"","role":"","text":"","source":""} として格納
- 実際に公言されている発言のみ使用すること（創作禁止）`
    : `"quote": null を返すこと`;

  // 重複回避
  const avoidInstruction = recentTitles?.length
    ? `【重複回避 — 以下のタイトル・構成とは完全に異なる記事を書くこと】\n${recentTitles.map(t => `- ${t}`).join('\n')}`
    : '';

  const systemPrompt = `あなたはnote.com専門コンテンツライターです。
著者プロフィール: ${brandInfo.name}を経営する飲食店オーナー（${brandInfo.handle}）がAI活用・副業について発信しています。

【絶対ルール】
1. 年号は${yr}年のみ使用。「2025年」等の過去年号は絶対禁止
2. 収益・実績の断言は禁止。「〜を狙える」「〜の可能性がある」「〜を目指している」等の可能性表現のみ
3. 体験談は飲食店経営の実体験を織り交ぜる（毎日12時間営業・原価率・SNS集客・スタッフ管理等）
4. アフィリエイト商品「${affiliate}」を本文中に自然に1〜2箇所言及（押し売り・過剰宣伝禁止）
5. 記事タイプ: ${typeInfo.label} — ${typeInfo.note}
6. ターゲット読者: ${persona}
7. 文字数: 2000〜2600字

${planInstruction}

【読者レベル: ${lvInfo.tag}】
${lvInfo.desc}

【今回の構成パターン — 必ず従うこと】
- 冒頭フック: ${hook}
- 記事の切り口・視点: ${angle}
- 本文構成: ${structure}

${avoidInstruction}

${quoteInstruction}

【X投稿スレッド構成（各140字以内）】
1: 共感フック（読者の悩みを突く、${hook}で始める）
2: 著者の飲食店経営×AI実体験
3: 具体的な手順・ポイント（3〜5個）
4: ${persona}へのメッセージ
5: note記事への誘導（「詳しくはnoteで↓」）

【出力形式】
JSONのみ。説明文・コードブロック・マークダウン記法は不要。
{
  "title": "記事タイトル（${yr}年最新〜などを含む）",
  "article": "本文（改行は\\n）",
  "xPosts": ["投稿1", "投稿2", "投稿3", "投稿4", "投稿5"],
  "quote": null
}`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `キーワード: 「${keyword}」\nJSONのみで返してください。`
        }
      ]
    });

    const raw = message.content.map(c => c.text || '').join('');
    const clean = raw.replace(/```[\s\S]*?```/g, s => s.replace(/```\w*|```/g, '')).trim();
    const parsed = JSON.parse(clean);

    res.json({ success: true, data: parsed });
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

app.listen(PORT, () => console.log(`NOTE BUZZ ENGINE running on port ${PORT}`));
