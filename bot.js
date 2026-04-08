const { Telegraf } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const express = require('express'); // Добавили для стабильности
require('dotenv').config();

// Настройка веб-сервера для Render (чтобы не падал Web Service)
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Бот Easy to Read активен!'));
app.listen(port, () => console.log(`Мониторинг порта ${port} запущен`));

// Проверка ключей
const BOT_TOKEN = process.env.BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!BOT_TOKEN || !ANTHROPIC_API_KEY) {
  console.error('❌ Ошибка: Ключи API не найдены!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Ты — медицинский переводчик-интерпретатор. Протокол "Золотой стандарт v5.1".
(Здесь ваш текст промпта...)`;

// Вспомогательная функция для Claude
async function callClaude(content) {
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: content }],
  });
  return response.content[0].text;
}

// Команда /start
bot.start((ctx) => ctx.reply('🧠 Easy to Read запущен! Отправьте текст или фото заключения.'));

// Обработка текста
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const loading = await ctx.reply('🔄 Интерпретирую...');
  try {
    const result = await callClaude([{ type: 'text', text: ctx.message.text }]);
    await ctx.reply(result, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('❌ Ошибка связи с ИИ.');
  }
});

// Обработка фото
bot.on('photo', async (ctx) => {
  const loading = await ctx.reply('📷 Анализирую изображение...');
  try {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    
    // Качаем фото через axios
    const response = await axios.get(link.href, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    
    const result = await callClaude([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: buffer.toString('base64') },
      },
      { type: 'text', text: 'Распознай и интерпретируй по протоколу.' }
    ]);
    await ctx.reply(result, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('❌ Ошибка при обработке фото.');
  }
});

bot.launch().then(() => console.log('✅ Бот запущен!'));

// Остановка
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));