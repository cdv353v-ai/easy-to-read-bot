const { Telegraf } = require('telegraf');
const express = require('express');
const axios = require('axios');
const pdfImg = require('pdf-img-convert');
const Anthropic = require('@anthropic-ai/sdk');

// --- Сервер для Render ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Medical Bot is Online'));
app.listen(PORT, '0.0.0.0');

// --- Инициализация Anthropic и Telegram ---
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY.trim(),
});
const bot = new Telegraf(process.env.BOT_TOKEN);

// Подготовка медиа
async function prepareMedia(url, isPdf = false) {
    if (isPdf) {
        const pdfArray = await pdfImg.convert(url, { page_numbers: [1] });
        return { data: Buffer.from(pdfArray[0]).toString('base64'), mime: "image/png" };
    }
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return { data: Buffer.from(response.data, 'binary').toString('base64'), mime: "image/jpeg" };
}

const analyze = async (ctx, fileId, isPdf = false) => {
    try {
        await ctx.reply(isPdf ? '📄 Обрабатываю PDF...' : '📸 Обрабатываю фото...');
        
        const link = await ctx.telegram.getFileLink(fileId);
        const media = await prepareMedia(link.href, isPdf);

        const message = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 2048,
            messages: [{
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "Ты — профессиональный врач. Переведи этот медицинский анализ на русский язык. Документ может быть на португальском, английском, французском, немецком или испанском. Объясни показатели и выдели критические отклонения. В конце добавь медицинский дисклеймер."
                    },
                    {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: media.mime,
                            data: media.data,
                        },
                    },
                ],
            }],
        });

        await ctx.reply(message.content[0].text);
    } catch (error) {
        console.error('Anthropic Error:', error);
        await ctx.reply(`❌ Ошибка: ${error.message || 'Что-то пошло не так'}`);
    }
};

bot.on('photo', (ctx) => analyze(ctx, ctx.message.photo.pop().file_id, false));
bot.on('document', (ctx) => {
    if (ctx.message.document.mime_type === 'application/pdf') {
        analyze(ctx, ctx.message.document.file_id, true);
    }
});

bot.start((ctx) => ctx.reply('Пришлите фото или PDF анализов.'));
bot.launch().then(() => console.log('Bot started'));