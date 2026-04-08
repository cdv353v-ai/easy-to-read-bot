require('dotenv').config();
const { Telegraf } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const SYSTEM_PROMPT = `Ты — медицинский переводчик-интерпретатор. Протокол "Золотой стандарт v5.1".

ТВОЯ ЗАДАЧА:
Перевести медицинское заключение (анализы крови, МРТ, КТ, УЗИ, рентген) с португальского, английского, немецкого, испанского или французского на простой русский язык. Ответ всегда на русском.

================================================================================
СТРУКТУРА ОТВЕТА (строго в этом порядке):
================================================================================

1. **ЗАГОЛОВОК:** [Название исследования] ([Страна])

2. **ОБЩАЯ КАРТИНА:**
   - 4-6 предложений сухих фактов
   - НЕ перечисляй конкретные цифры и диапазоны
   - Только общее описание: какие группы показателей снижены или повышены
   - Финальная фраза: "Остальные показатели — в пределах обычных значений для здорового человека."

3. **ПЕРЕВОД И ПОЯСНЕНИЕ ТЕРМИНОВ:**
   - Только для показателей с отклонениями (ниже/выше нормы)
   - Для каждого отклонения строгий формат:

     **[Оригинал на языке документа]** — [Русский эквивалент]
     Что это значит: 2-3 предложения. Значение X — ниже/выше обычного показателя для здорового человека (Y)

     Где Y — только одна граница нормы (нижняя для сниженных, верхняя для повышенных)
     НЕ пиши диапазон в скобках после сравнения

4. **ИНФОРМАЦИОННАЯ СПРАВКА:**
   данный текст — перевод и расшифровка терминов. Он не заменяет консультацию врача и не является постановкой диагноза.

================================================================================
ЗАПРЕЩЕНО:
================================================================================
- Метафоры, аналогии, художественные сравнения
- Диагнозы
- Рекомендации по лечению, советы, указания к действию
- Канцеляризмы: вместо "референсные значения" пиши "обычные показатели для здорового человека"
- Списки нормальных показателей (отдельный список не нужен)
- Перечисление конкретных цифр в разделе "Общая картина"

================================================================================
ФОРМАТИРОВАНИЕ ДЛЯ TELEGRAM:
================================================================================
- Заголовки разделов выделяй **жирным** с двух сторон
- Пример: **ОБЩАЯ КАРТИНА:**
- НЕ используй # или ## для заголовков
- После заголовка ставь двоеточие и переходи на новую строку

================================================================================
Если в документе нет отклонений — раздел "Перевод и пояснение терминов" пропускается.
Если документ пустой (нет заполненных значений) — написать об этом в "Общей картине".
================================================================================`;

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const UNSUPPORTED_MSG = 'Отправьте медицинский документ — фото или PDF.';

async function downloadFile(fileUrl) {
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

async function getFileUrl(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
}

async function callClaude(imageContent) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: imageContent,
      },
    ],
  });
  return response.content[0].text;
}

bot.on('photo', async (ctx) => {
  const processingMsg = await ctx.reply('Обрабатываю документ...');
  try {
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    const fileUrl = await getFileUrl(ctx, largest.file_id);
    const buffer = await downloadFile(fileUrl);
    const base64 = buffer.toString('base64');

    const result = await callClaude([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: base64,
        },
      },
      {
        type: 'text',
        text: 'Please transcribe and explain this medical document.',
      },
    ]);

    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply(result, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Photo handler error:', err);
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply('Произошла ошибка при обработке изображения. Попробуйте ещё раз.');
  }
});

bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  const mime = doc.mime_type || '';

  const isPdf = mime === 'application/pdf';
  const isImage = mime.startsWith('image/');

  if (!isPdf && !isImage) {
    return ctx.reply(UNSUPPORTED_MSG);
  }

  const processingMsg = await ctx.reply('Обрабатываю документ...');
  try {
    const fileUrl = await getFileUrl(ctx, doc.file_id);
    const buffer = await downloadFile(fileUrl);
    const base64 = buffer.toString('base64');

    let imageContent;

    if (isPdf) {
      imageContent = [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64,
          },
        },
        {
          type: 'text',
          text: 'Please transcribe and explain this medical document.',
        },
      ];
    } else {
      imageContent = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mime,
            data: base64,
          },
        },
        {
          type: 'text',
          text: 'Please transcribe and explain this medical document.',
        },
      ];
    }

    const result = await callClaude(imageContent);

    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply(result, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Document handler error:', err);
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply('Произошла ошибка при обработке документа. Попробуйте ещё раз.');
  }
});

bot.on('message', (ctx) => {
  ctx.reply(UNSUPPORTED_MSG);
});

bot.launch().then(() => {
  console.log('Bot is running...');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));