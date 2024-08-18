const MEXC = require('mexc-api-sdk');
require('dotenv').config();

const CLIENT = new MEXC.Spot();
CLIENT.config.apiKey = process.env.API_KEY;
CLIENT.config.apiSecret = process.env.API_SECRET;

module.exports = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    HISTORY_LENGTH: 25,
    RETRY_DELAY: 2000,
    MAX_RETRIES: 3,
    SYMBOL: "KAS",
    SYMBOL_PAIR: "USDT",
    MEXC_CLIENT: CLIENT,
};
