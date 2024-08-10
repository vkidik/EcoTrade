require('dotenv').config();

module.exports = {
    API_KEY: process.env.API_KEY,
    API_SECRET: process.env.API_SECRET,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    HISTORY_LENGTH: 20,
    RETRY_DELAY: 2000,
    MAX_RETRIES: 3,
    SYMBOL: "KAS",
    SYMBOL_PAIR: "USDT"
};
