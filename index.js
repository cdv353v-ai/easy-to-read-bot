const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const pdfImg = require('pdf-img-convert');

// --- Инициализация сервера для Render ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Medical Bot is Running!'));
app.listen(PORT, '0.0.0.0', () => console.log(`[Server] Listening on port ${PORT}`));

// --- Инициализация бота ---
const bot = new Telegraf(process.env.BOT_TOKEN);

// Функция подготовки изображения (фото или PDF -> Base64)
async function prepareImage(url, isPdf = false) {
    try {
        if (isPdf) {
            // Конвертируем первую страницу PDF
            const pdfArray = await pdfImg.convert(url, { page_numbers: [1] });
            return pdfArray[0].toString('base64');
        } else {
            // Загружаем фото
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(response.data, 'binary').toString('base64');
        }
    } catch (e) {
        console.error('Ошибка подготовки файла:', e.message);
        throw new Error('Не удалось обработать файл. Убедитесь, что это корректное изображение или PDF.');
    }
}

// Основная функция анализа
const processMedicalDocument = async (ctx, fileId, isPdf = false) => {
    try {
        await ctx.reply(isPdf ? '📄 Анализирую ваш PDF-документ...' : '📸 Анализирую ваше фото...');

        const fileLink = await ctx.telegram.getFileLink(fileId);
        const base64Data = await prepareImage(fileLink.href, isPdf);

        // Запрос к Claude 3.5 Sonnet
        const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 2048,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Ты — высококвалифицированный врач-интерпретатор. Тщательно проанализируй этот медицинский документ. Он может быть на португальском, испанском, немецком, французском или английском языке. \n\nТвоя задача:\n1. Определить язык оригинала.\n2. Перевести всё на РУССКИЙ язык.\n3. Объяснить значения показателей простыми словами.\n4. Четко выделить показатели, выходящие за рамки нормы.\n5. В конце добавь: '⚠️ ВНИМАНИЕ: Данная информация носит справочный характер. Для постановки диагноза и назначения лечения обратитесь к врачу.'"
                        },
                        {
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: "image/jpeg",
                                data: base64Data
                            }
                        }
                    ]
                }
            ]
        }, {
            headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY.trim(),
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            }
        });

        const resultText = response.data.content[0].text;
        await ctx.reply(resultText);

    } catch (error) {
        console.error('[Full Error]:', error.response ? JSON.stringify(error.response.data) : error.message);
        
        let errorMsg = '❌ Произошла ошибка при обращении к ИИ.';
        if (error.response?.status === 404) {
            errorMsg = '❌ Ошибка 404: Модель не найдена или доступ ограничен. Проверьте баланс в Anthropic Console и убедитесь, что ваш аккаунт переведен в Tier 1.';
        } else if (error.response?.data?.error?.message) {
            errorMsg += `\nДетали: ${error.response.data.error.message}`;
        } else {
            errorMsg += `\nДетали: ${error.message}`;
        }
        
        ctx.reply(errorMsg);
    }
};

// Обработчики сообщений
bot.start((ctx) => {
    ctx.reply('👋 Привет! Я медицинский переводчик.\nПришлите фото или PDF анализа на португальском, испанском, немецком, французском или английском.');
});

bot.on('photo', (ctx) => {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    processMedicalDocument(ctx, fileId, false);
});

bot.on('document', (ctx) => {
    const mime = ctx.message.document.mime_type;
    if (mime === 'application/pdf') {
        processMedicalDocument(ctx, ctx.message.document.file_id, true);
    } else if (mime.startsWith('image/')) {
        processMedicalDocument(ctx, ctx.message.document.file_id, false);
    } else {
        ctx.reply('Пожалуйста, отправьте именно фото или PDF-файл.');
    }
});

// Запуск бота
bot.launch()
    .then(() => console.log('[Bot] Запущен успешно'))
    .catch(err => console.error('[Bot] Ошибка старта:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));