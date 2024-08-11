const axios = require('axios');
const config = require('./config');

const client = config.MEXC_CLIENT 

async function sendTelegramMessage(message) {
    const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: config.TELEGRAM_CHAT_ID,
            text: message
        });
        console.log('Сообщение отправлено в Telegram:', message);
    } catch (error) {
        console.error('Ошибка при отправке сообщения в Telegram:', error);
    }
}

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

let lastUpdateId = null;

async function getBalancesCommand() {
    try {
        const usdtBalance = await getBalance('USDT');
        const kasBalance = await getBalance('KAS');
        const message = `Баланс USDT: ${usdtBalance} USDT\nБаланс KAS: ${kasBalance} KAS`;

        await sendTelegramMessage(message);
    } catch (error) {
        console.error('Ошибка при выполнении команды получения баланса:', error);
    }
}

async function getBalance(asset) {
    try {
        const balances = await executeWithRetries(() => client.accountInfo());
        const balanceInfo = balances.balances.find(b => b.asset === asset);
        return parseFloat(balanceInfo ? balanceInfo.free : 0);
    } catch (error) {
        console.error('Ошибка при получении баланса:', error);
        throw error;
    }
}

async function handleTelegramUpdates() {
    try {
        const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId || ''}`;
        const response = await axios.get(url);
        const updates = response.data.result;

        for (const update of updates) {
            lastUpdateId = update.update_id + 1;
            const message = update.message;

            if (message && message.text) {
                if (message.text.toLowerCase() === '/balance') {
                    await getBalancesCommand();
                } else {
                    await sendTelegramMessage('Неизвестная команда. Используйте /balance для проверки баланса.');
                }
            }
        }
    } catch (error) {
        console.error('Ошибка при обработке сообщений Telegram:', error);
    }
}

function startTelegramListener(config, interval = 3000) {
    setInterval(() => handleTelegramUpdates(config), interval);
}

module.exports = {
    sendTelegramMessage,
    executeWithRetries,
    startTelegramListener
};
