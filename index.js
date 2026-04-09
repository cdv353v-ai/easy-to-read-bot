const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const pdfImg = require('pdf-img-convert');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Medical Bot is Online!'));
app.listen(PORT, '0.0.0.0', () => console.log(`[Server] Listening on port ${PORT}`));

const bot = new Telegraf(process.env.BOT_TOKEN);

// Функция подготовки данных с автоопределением типа медиа
async function prepareImageData(url, isPdf = false) {
    try {
        if (isPdf) {
            const pdfArray = await pdfImg.convert(url, { page_numbers: [1] });
            return {
                data: Buffer.from(pdfArray[0]).toString('base64'),
                mediaType: "image/png" // Конвертер PDF чаще всего отдает PNG
            };
        } else {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const contentType = response.headers['content-type'] || "image/jpeg";
            return {
                data: Buffer.from(response.data, 'binary').toString('base64'),
                mediaType: contentType
            };
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
        const imageInfo = await prepareImageData(link.href, isPdf);

        const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 2048,
            messages: [{
                role: "user",
                content: [
                    { 
                        type: "text", 
                        text: "Ты — профессиональный врач-интерпретатор. Тщательно проанализируй этот документ (португальский, испанский, немецкий, французский или английский). Переведи на РУССКИЙ, объясни показатели и выдели отклонения. В конце добавь дисклеймер." 
                    },
                    { 
                        type: "image", 
                        source: { 
                            type: "base64", 
                            media_type: imageInfo.mediaType, // Теперь тип подставляется автоматически
                            data: imageInfo.data 
                        } 
                    }
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
        console.error('API Error details:', error.response?.data || error.message);
        await ctx.reply('❌ Ошибка при чтении документа. Убедитесь, что файл не поврежден и попробуйте снова.');
    }
};

bot.on('photo', (ctx) => analyze(ctx, ctx.message.photo.pop().file_id, false));
bot.on('document', (ctx) => {
    const mime = ctx.message.document.mime_type;
    if (mime === 'application/pdf') {
        analyze(ctx, ctx.message.document.file_id, true);
    } else if (mime.startsWith('image/')) {
        analyze(ctx, ctx.message.document.file_id, false);
    }
});

bot.start((ctx) => ctx.reply('Пришлите фото или PDF анализов. Я переведу их на русский.'));
bot.launch();