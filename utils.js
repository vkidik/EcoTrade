const { Telegraf } = require('telegraf');
const config = require('./config');

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

async function executeWithRetries(fn, maxRetries = config.MAX_RETRIES, retryDelay = config.RETRY_DELAY) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            console.error(`Ошибка попытки ${i + 1}: ${error.message}`);
            if (i < maxRetries - 1) {
                await sendTelegramMessage(`Ошибка попытки ${i + 1}: ${error.message}. Повторная попытка...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
                throw error;
            }
        }
    }
}

async function sendTelegramMessage(message) {
    try {
        await bot.telegram.sendMessage(config.TELEGRAM_CHAT_ID, message);
        console.log('Сообщение отправлено в Telegram:', message);
    } catch (error) {
        console.error('Ошибка при отправке сообщения в Telegram:', error);
    }
}

async function getBalancesCommand(ctx) {
    try {
        const usdtBalance = await getBalance('USDT');
        const kasBalance = await getBalance('KAS');
        const message = `Баланс USDT: ${usdtBalance} USDT\nБаланс KAS: ${kasBalance} KAS`;

        await sendTelegramMessage(message);
        ctx.reply(message);
    } catch (error) {
        console.error('Ошибка при выполнении команды получения баланса:', error);
        ctx.reply('Ошибка при получении баланса.');
    }
}

async function startTelegramListener() {
    bot.start((ctx) => ctx.reply('Добро пожаловать! Используйте команду /balance для проверки баланса.'));
    
    bot.command('balance', async (ctx) => {
        await getBalancesCommand(ctx);
    });

    bot.on('text', async (ctx) => {
        if (ctx.message.text.toLowerCase() !== '/balance') {
            await sendTelegramMessage('Неизвестная команда. Используйте /balance для проверки баланса.');
            ctx.reply('Неизвестная команда. Используйте /balance для проверки баланса.');
        }
    });

    bot.launch();
}

module.exports = {
    sendTelegramMessage,
    executeWithRetries,
    startTelegramListener
};
