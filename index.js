const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');

// --- Инициализация ---
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для Express, чтобы Render видел, что сервис жив
app.get('/', (req, res) => res.send('Medical Bot is Running!'));
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Web-server is listening on port ${PORT}`);
});

// --- Логирование входящих ---
bot.use(async (ctx, next) => {
    console.log(`[Telegram] Получено сообщение. Тип: ${ctx.updateType}`);
    return next();
});

// --- Обработка команд ---
bot.start((ctx) => ctx.reply('Привет! Пришли мне фото или PDF с португальскими анализами, и я помогу разобраться.'));

// --- Основная логика интерпретации ---
const interpretMedicalData = async (ctx, fileId, isPhoto = true) => {
    try {
        await ctx.reply('Анализирую данные, подождите немного...');
        
        // 1. Получаем ссылку на файл
        const fileLink = await ctx.telegram.getFileLink(fileId);
        console.log(`[Bot] Файл получен: ${fileLink.href}`);

        // 2. Отправляем в Claude (Anthropic API)
        // Здесь мы используем Claude 3 Haiku через axios
        const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: "claude-3-haiku-20240307",
            max_tokens: 1024,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Переведи эти медицинские анализы с португальского на русский. Объясни значения простыми словами, укажи на отклонения от нормы. Это ознакомительная информация, не диагноз."
                        },
                        {
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: "image/jpeg",
                                data: await getBase64(fileLink.href)
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
        console.error('[Error]', error.message);
        ctx.reply('Произошла ошибка при обработке. Убедитесь, что файл четкий.');
    }
};

// Функция-помощник для перевода в base64
async function getBase64(url) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data, 'binary').toString('base64');
}

// --- Хендлеры файлов ---
bot.on('photo', (ctx) => {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    interpretMedicalData(ctx, fileId, true);
});

bot.on('document', (ctx) => {
    if (ctx.message.document.mime_type === 'application/pdf' || ctx.message.document.mime_type.startsWith('image/')) {
        interpretMedicalData(ctx, ctx.message.document.file_id, false);
    } else {
        ctx.reply('Пожалуйста, отправьте файл в формате PDF или изображение.');
    }
});

// Запуск
bot.launch()
    .then(() => console.log('[Bot] Telegraf запущен успешно'))
    .catch((err) => console.error('[Bot] Ошибка запуска:', err));

// Мягкая остановка
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));