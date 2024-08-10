const axios = require('axios');
const config = require('./config');

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

module.exports = {
    sendTelegramMessage,
    executeWithRetries
};
