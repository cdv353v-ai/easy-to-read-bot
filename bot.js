const fs = require('fs');
const { Telegraf } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

// Читаем токены из Secret Files на Render
const BOT_TOKEN = fs.readFileSync('/etc/secrets/BOT_TOKEN', 'utf8').trim();
const ANTHROPIC_API_KEY = fs.readFileSync('/etc/secrets/ANTHROPIC_API_KEY', 'utf8').trim();

const bot = new Telegraf(BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Ты — медицинский переводчик-интерпретатор. Протокол "Золотой стандарт v5.1".

ТВОЯ ЗАДАЧА:
Перевести медицинское заключение (анализы крови, МРТ, КТ, УЗИ, рентген) с португальского, английского, немецкого, испанского или французского на простой русский язык. Ответ всегда на русском.

СТРУКТУРА ОТВЕТА (строго в этом порядке):

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

4. **ИНФОРМАЦИОННАЯ СПРАВКА:**
   данный текст — перевод и расшифровка терминов. Он не заменяет консультацию врача и не является постановкой диагноза.

ЗАПРЕЩЕНО:
- Метафоры, аналогии, художественные сравнения
- Диагнозы
- Рекомендации по лечению
- Канцеляризмы: вместо "референсные значения" пиши "обычные показатели для здорового человека"
- Перечисление конкретных цифр в разделе "Общая картина"

ФОРМАТИРОВАНИЕ ДЛЯ TELEGRAM:
- Заголовки выделяй **жирным** с двух сторон
- Пример: **ОБЩАЯ КАРТИНА:**
- НЕ используй # или ##

Если в документе нет отклонений — раздел "Перевод и пояснение терминов" пропускается.`;

const UNSUPPORTED_MSG = 'Отправьте медицинский документ — текст, фото или PDF.';

async function downloadFile(fileUrl) {
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

async function getFileUrl(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
}

async function callClaude(imageContent) {
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
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

bot.start(async (ctx) => {
  await ctx.reply(
    `🧠 *Easy to Read*\n*Читай просто. Понимай легко.*\n\n` +
    `Я перевожу медицинские заключения с PT/EN/DE/ES/FR на простой русский язык.\n\n` +
    `Отправьте текст, фото или PDF заключения.`,
    { parse_mode: 'Markdown' }
  );
});

// Обработка текста
bot.on('text', async (ctx) => {
  const userText = ctx.message.text;
  if (userText.startsWith('/')) return;
  
  if (userText.length < 10) {
    await ctx.reply('⚠️ Текст слишком короткий. Отправьте полное заключение.');
    return;
  }
  
  await ctx.reply('🔄 Интерпретирую...');
  
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2000,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }]
    });
    
    await ctx.reply(response.content[0].text, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error:', error);
    await ctx.reply('❌ Ошибка. Попробуйте позже.');
  }
});

// Обработка фото
bot.on('photo', async (ctx) => {
  const processingMsg = await ctx.reply('📷 Обрабатываю фото...');
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
        text: 'Распознай текст на этом медицинском заключении и интерпретируй по протоколу.',
      },
    ]);

    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply(result, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Photo error:', err);
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply('❌ Ошибка при обработке фото. Попробуйте ещё раз.');
  }
});

// Обработка PDF и документов
bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  const mime = doc.mime_type || '';

  const isPdf = mime === 'application/pdf';
  const isImage = mime.startsWith('image/');

  if (!isPdf && !isImage) {
    return ctx.reply('Поддерживаются только фото и PDF файлы.');
  }

  const processingMsg = await ctx.reply('📄 Обрабатываю документ...');
  try {
    const fileUrl = await getFileUrl(ctx, doc.file_id);
    const buffer = await downloadFile(fileUrl);
    const base64 = buffer.toString('base64');

    const result = await callClaude([
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
        text: 'Распознай текст на этом медицинском заключении и интерпретируй по протоколу.',
      },
    ]);

    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply(result, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Document error:', err);
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.reply('❌ Ошибка при обработке документа. Попробуйте ещё раз.');
  }
});

bot.launch();
console.log('✅ Бот Easy to Read запущен!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));