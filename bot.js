const { Telegraf } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!BOT_TOKEN || !ANTHROPIC_API_KEY) {
  console.error('❌ Критическая ошибка: Токены не установлены!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Ты — медицинский переводчик-интерпретатор. Протокол "Золотой стандарт v5.1".
(Весь ваш текст промпта без изменений...)`;

// Функция загрузки
async function downloadFile(fileUrl) {
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

// Помощник дляClaude
async function callClaude(content) {
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: content }],
  });
  return response.content[0].text;
}

bot.start((ctx) => ctx.reply('🧠 Easy to Read запущен! Отправьте текст или фото заключения.'));

// Обработка текста
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  await ctx.reply('🔄 Интерпретирую...');
  try {
    const text = ctx.message.text;
    const result = await callClaude([{ type: 'text', text: text }]);
    await ctx.reply(result, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('❌ Ошибка связи с ИИ.');
  }
});

// Обработка фото
bot.on('photo', async (ctx) => {
  await ctx.reply('📷 Анализирую изображение...');
  try {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    const buffer = await downloadFile(link.href);
    
    const result = await callClaude([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: buffer.toString('base64') },
      },
      { type: 'text', text: 'Распознай и интерпретируй.' }
    ]);
    await ctx.reply(result, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('❌ Ошибка при обработке фото.');
  }
});

bot.launch().then(() => console.log('✅ Бof запущен!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));