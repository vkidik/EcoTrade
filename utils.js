const { Telegraf } = require('telegraf');
const config = require('./config');

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

class Utils {
    constructor(botFarm) {
        this.botFarm = botFarm;
        this.ts = Date.now();

        this.startFunctions();
    }

    async startFunctions() {await this.startTelegramListener()};

    async executeWithRetries(fn, maxRetries = config.MAX_RETRIES, retryDelay = config.RETRY_DELAY) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            } catch (error) {
                console.error(`Ошибка попытки ${i + 1}: ${error.message}`);
                if (i < maxRetries - 1) {
                    await this.sendTelegramMessage(`Ошибка попытки ${i + 1}: ${error.message}. Повторная попытка...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    throw error;
                }
            }
        }
    }
    
    async sendTelegramMessage(message) {
        try {
            await bot.telegram.sendMessage(config.TELEGRAM_CHAT_ID, message);
            console.log('Сообщение отправлено в Telegram:', message);
        } catch (error) {
            console.error('Ошибка при отправке сообщения в Telegram:', error);
        }
    }
    
    async getBalancesCommand(ctx) {
        try {
            const usdtBalance = await this.botFarm.getBalance('USDT');
            const kasBalance = await this.botFarm.getBalance('KAS');
            const message = `
            Баланс USDT: ${usdtBalance} USDT\n
            Баланс KAS: ${kasBalance} KAS\n`;

            ctx.reply(message);
        } catch (error) {
            console.error('Ошибка при выполнении команды получения баланса:', error);
            ctx.reply('Ошибка при получении баланса.');
        }
    }
    
    async startTelegramListener() {
        bot.start((ctx) => ctx.reply('Добро пожаловать! Используйте команду /balance для проверки баланса.'));
        
        bot.command('balance', async (ctx) => {
            await this.getBalancesCommand(ctx);
        });

        bot.command('check', async (ctx) => {
            const profit = this.botFarm.profitBalance;

            const currentTime = Date.now();
            const elapsedTime = currentTime - this.ts; 
            const elapsedHours = Math.floor(elapsedTime / (1000 * 60 * 60)); 
            const elapsedMinutes = Math.floor((elapsedTime % (1000 * 60 * 60)) / (1000 * 60)); 

            ctx.reply(`
                Прибыль: ${profit} USDT\n
                -----------------------\n
                Работает уже: ${elapsedHours} часов и ${elapsedMinutes} минут
            `);
        });
    
        bot.on('text', async (ctx) => {
            if (ctx.message.text.toLowerCase() !== '/balance') {
                await this.sendTelegramMessage('Неизвестная команда. Используйте /balance для проверки баланса.');
                ctx.reply('Неизвестная команда. Используйте /balance для проверки баланса.');
            }
        });
    
        bot.launch();
    }
}

module.exports = Utils;
