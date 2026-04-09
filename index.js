const { Telegraf } = require('telegraf');
const express = require('express');
const axios = require('axios');
const pdfImg = require('pdf-img-convert');
const Anthropic = require('@anthropic-ai/sdk');

// 1. Настройка сервера
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Medical Bot is Online'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

// 2. Настройка API
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY.trim(),
});
const bot = new Telegraf(process.env.BOT_TOKEN);

// 3. Подготовка медиа
async function prepareMedia(url, isPdf = false) {
    try {
        if (isPdf) {
            const pdfArray = await pdfImg.convert(url, { page_numbers: [1] });
            return { data: Buffer.from(pdfArray[0]).toString('base64'), mime: "image/png" };
        }
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const mime = response.headers['content-type'] || "image/jpeg";
        return { data: Buffer.from(response.data, 'binary').toString('base64'), mime: mime };
    } catch (e) {
        console.error('File prep error:', e.message);
        throw e;
    }
}

// 4. Логика анализа
const analyze = async (ctx, fileId, isPdf = false) => {
    try {
        await ctx.reply(isPdf ? '📄 Обрабатываю PDF...' : '📸 Обрабатываю фото...');
        const link = await ctx.telegram.getFileLink(fileId);
        const media = await prepareMedia(link.href, isPdf);

        const response = await anthropic.messages.create({
            model: "claude-3-haiku-20240307",
            max_tokens: 2048,
            messages: [{
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "Ты — врач. Переведи этот анализ на русский. Оригинал может быть на португальском, английском, французском, немецком или испанском. Объясни показатели и выдели критические отклонения. В конце добавь медицинский дисклеймер."
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

        await ctx.reply(response.content[0].text);
    } catch (error) {
        console.error('AI Error:', error);
        await ctx.reply(`❌ Ошибка: ${error.message}`);
    }
};

// 5. Обработчики
bot.on('photo', (ctx) => analyze(ctx, ctx.message.photo.pop().file_id, false));
bot.on('document', (ctx) => {
    if (ctx.message.document.mime_type === 'application/pdf') {
        analyze(ctx, ctx.message.document.file_id, true);
    } else if (ctx.message.document.mime_type.startsWith('image/')) {
        analyze(ctx, ctx.message.document.file_id, false);
    }
});

bot.start((ctx) => ctx.reply('Пришлите фото или PDF анализов.'));
bot.launch().then(() => console.log('Bot is active'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));