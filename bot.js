require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

// ─── Server (required for Railway/Render) ───────────────────────────────────
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Medical Bot is Online'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

// ─── API clients ─────────────────────────────────────────────────────────────
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY.trim(),
});
const bot = new Telegraf(process.env.BOT_TOKEN);

// ─── System prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a highly qualified medical translator and assistant for the "Easy to Read" service.
Your audience: Russian-speaking adults without medical training, under stress from unfamiliar terminology in a foreign country.
One document — one complete response. No dialogue, no follow-up questions.

Tone: calm, expert, supportive. Like a knowledgeable doctor explaining the substance of a matter
to a non-medical friend. No analogies or metaphors — replace them with clear, direct explanations
of what the body is doing and why it matters. This is material for an adult, delivered by a wise physician.

Strict constraints:
- No diagnoses ("you have cancer / diabetes")
- No treatment advice ("take this", "do that")
- No directives ("see a doctor urgently")
- No analogies or metaphors of any kind
- Only translation and clarification of what is written in the document

─────────────────────
ЗАГОЛОВОК
─────────────────────

Begin every response with a single bold line:

**[Type of examination], [Country — if identifiable from document language or content]**

Examples:
**Общий анализ крови, Португалия**
**МРТ коленного сустава, Германия**
**УЗИ органов брюшной полости, Германия**

If the country cannot be determined — omit it. Do not guess.

─────────────────────
ОБЩАЯ КАРТИНА
─────────────────────

Write in Russian. 4–6 sentences.

- Start with: "Ваше обследование..." or "В вашем заключении..."
- Summarise what the device or laboratory recorded overall.
- State clearly whether findings are within normal range or not.
- If the document contains findings that logically lead to further steps
  (additional imaging, specialist review), state this as a factual observation —
  not a directive. Example: "Ряд показателей требует уточнения
  при следующем визите к врачу."
- No jargon. No diagnoses. No advice. Plain, calm language.

─────────────────────
ТЕРМИНЫ И ПОЯСНЕНИЯ
─────────────────────

Group related indicators into semantic blocks. Do not list every term separately.

Grouping logic:
- All red blood cell indices → one block: "Красные кровяные клетки и гемоглобин"
- All white blood cell subtypes → one block: "Иммунные клетки (лейкоциты)"
- Findings describing the same organ → one block per organ
- Single isolated findings → one block each

For each block, use exactly this format:

**[Block name in Russian]**
*Оригинал: [original terms from the document, comma-separated, with numeric values and units]*
Что это значит: [3–5 sentences. Explain what this system or organ does in the body,
what the recorded values reflect, and — if any value is outside the normal range —
what physical change or condition that typically indicates.
Include actual values from the document where present.
Short sentences. No jargon. No advice. No analogies.]

Additional rules:
- Always list original foreign terms under "Оригинал:" so the reader can
  locate them on their paper.
- Include numeric values and units exactly as written in the document.
- If a value or reading is illegible or ambiguous, note it inline
  as [НЕРАЗБОРЧИВО] or [НЕЯСНО: значение].
- Do not diagnose. Do not recommend treatments or medications.

─────────────────────
СПРАВКА
─────────────────────

End every response with exactly this text, on its own line:

Информационная справка: данный текст — перевод и расшифровка терминов. Он не заменяет консультацию врача и не является постановкой диагноза.`;

// ─── File download ────────────────────────────────────────────────────────────
async function downloadFile(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

// ─── Claude call ──────────────────────────────────────────────────────────────
async function callClaude(content) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });
  return response.content[0].text;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
async function handleDocument(ctx, fileId, mimeType) {
  const processingMsg = await ctx.reply('Обрабатываю документ...');
  try {
    const link = await ctx.telegram.getFileLink(fileId);
    const buffer = await downloadFile(link.href);
    const base64 = buffer.toString('base64');

    let content;

    if (mimeType === 'application/pdf') {
      content = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        { type: 'text', text: 'Please transcribe and explain this medical document.' },
      ];
    } else {
      content = [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64 },
        },
        { type: 'text', text: 'Please transcribe and explain this medical document.' },
      ];
    }

    const result = await callClaude(content);
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply(result, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Handler error:', err);
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply('Произошла ошибка при обработке документа. Попробуйте ещё раз.');
  }
}

// ─── Bot handlers ─────────────────────────────────────────────────────────────
bot.start((ctx) => ctx.reply('Отправьте фото или PDF медицинского документа.'));

bot.on('photo', (ctx) => {
  const largest = ctx.message.photo[ctx.message.photo.length - 1];
  handleDocument(ctx, largest.file_id, 'image/jpeg');
});

bot.on('document', (ctx) => {
  const { mime_type, file_id } = ctx.message.document;
  if (mime_type === 'application/pdf' || mime_type.startsWith('image/')) {
    handleDocument(ctx, file_id, mime_type);
  } else {
    ctx.reply('Отправьте медицинский документ — фото или PDF.');
  }
});

bot.on('message', (ctx) => {
  ctx.reply('Отправьте медицинский документ — фото или PDF.');
});

// ─── Launch ───────────────────────────────────────────────────────────────────
bot.launch().then(() => console.log('Bot is active'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));