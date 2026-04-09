const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const pdfImg = require('pdf-img-convert');

// --- 1. Настройка сервера для Render ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Medical Interpreter Bot is Online!'));
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Listening on port ${PORT}`);
});

// --- 2. Инициализация бота ---
const bot = new Telegraf(process.env.BOT_TOKEN);

// Функция для подготовки изображения (из фото или первой страницы PDF)
async function prepareImage(url, isPdf = false) {
    try {
        if (isPdf) {
            // Конвертируем первую страницу PDF в картинку (Buffer)
            const pdfArray = await pdfImg.convert(url, { page_numbers: [1] });
            return pdfArray[0].toString('base64');
        } else {
            // Получаем фото и переводим в Base64
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(response.data, 'binary').toString('base64');
        }
    } catch (e) {
        console.error('Ошибка подготовки изображения:', e.message);
        throw new Error('Не удалось обработать файл');
    }
}

// --- 3. Основная логика работы с Claude ---
const processMedicalDocument = async (ctx, fileId, isPdf = false) => {
    try {
        await ctx.reply(isPdf ? '📄 Вижу PDF. Начинаю расшифровку...' : '📸 Вижу фото. Анализирую...');

        const fileLink = await ctx.telegram.getFileLink(fileId);
        const base64Data = await prepareImage(fileLink.href, isPdf);

        const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: "claude-3-haiku-20240307",
            max_tokens: 2000,
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
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            }
        });

        await ctx.reply(response.data.content[0].text);

    } catch (error) {
        console.error('[Full Error]:', error.response ? JSON.stringify(error.response.data) : error.message);
        
        let errorMsg = '❌ Произошла ошибка.';
        if (error.response?.data?.error?.type === 'not_found_error') {
            errorMsg += '\nClaude не отвечает. Скорее всего, нужно пополнить баланс в Anthropic Console (раздел Billing).';
        } else {
            errorMsg += `\nДетали: ${error.message}`;
        }
        ctx.reply(errorMsg);
    }
};

// --- 4. Обработчики Telegram ---

bot.start((ctx) => {
    ctx.reply('👋 Привет! Я медицинский ИИ-переводчик.\n\nЯ понимаю анализы на 5 языках:\n🇵🇹 Португальский\n🇪🇸 Испанский\n🇩🇪 Немецкий\n🇫🇷 Французский\n🇬🇧 Английский\n\nПросто пришли мне фото или PDF-файл.');
});

// Обработка фото
bot.on('photo', (ctx) => {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    processMedicalDocument(ctx, fileId, false);
});

// Обработка документов (PDF)
bot.on('document', (ctx) => {
    const mime = ctx.message.document.mime_type;
    if (mime === 'application/pdf') {
        processMedicalDocument(ctx, ctx.message.document.file_id, true);
    } else if (mime.startsWith('image/')) {
        processMedicalDocument(ctx, ctx.message.document.file_id, false);
    } else {
        ctx.reply('Пожалуйста, отправьте фото или PDF-файл.');
    }
});

// --- 5. Запуск ---
bot.launch()
    .then(() => console.log('[Bot] Запущен успешно'))
    .catch(err => console.error('[Bot] Ошибка старта:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));