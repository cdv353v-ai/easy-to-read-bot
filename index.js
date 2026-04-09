const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const pdfImg = require('pdf-img-convert');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Medical Bot is Online!'));
app.listen(PORT, '0.0.0.0');

const bot = new Telegraf(process.env.BOT_TOKEN);

async function prepareImage(url, isPdf = false) {
    try {
        if (isPdf) {
            // Конвертируем PDF. Получаем массив Uint8Array
            const pdfArray = await pdfImg.convert(url, { page_numbers: [1] });
            // ВАЖНО: Правильное преобразование Uint8Array в Base64 для Node.js
            return Buffer.from(pdfArray[0]).toString('base64');
        } else {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(response.data, 'binary').toString('base64');
        }
    } catch (e) {
        console.error('Ошибка подготовки файла:', e.message);
        throw e;
    }
}

const analyze = async (ctx, fileId, isPdf = false) => {
    try {
        await ctx.reply(isPdf ? '📄 Обрабатываю PDF...' : '📸 Обрабатываю фото...');
        const link = await ctx.telegram.getFileLink(fileId);
        const base64Data = await prepareImage(link.href, isPdf);

        const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 2048,
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: "Ты — врач-интерпретатор. Переведи этот медицинский анализ (португальский/английский/французский/немецкий/испанский) на русский. Разложи по полочкам и выдели отклонения." },
                    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Data } }
                ]
            }]
        }, {
            headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY.trim(),
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            }
        });

        await ctx.reply(response.data.content[0].text);
    } catch (error) {
        console.error('API Error:', error.response?.data || error.message);
        await ctx.reply('❌ Ошибка при чтении документа. Попробуйте еще раз или проверьте четкость файла.');
    }
};

bot.on('photo', (ctx) => analyze(ctx, ctx.message.photo.pop().file_id, false));
bot.on('document', (ctx) => {
    if (ctx.message.document.mime_type === 'application/pdf') {
        analyze(ctx, ctx.message.document.file_id, true);
    }
});
bot.start((ctx) => ctx.reply('Пришлите фото или PDF анализов.'));
bot.launch();