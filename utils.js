const { Telegraf, Markup } = require('telegraf');
const config = require('./config');

const errors = require('./languages/errors.json')
const logs = require('./languages/logs.json')

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

class Utils {
    constructor(botFarm) {
        this.botFarm = botFarm;
        this.ts = Date.now();
        this.language = ''
        this.state = false

        this.startTelegramListener()
    }

    getMessage(type, name, vars = {}, language = this.language) {
        const messageVar = type == 'error' ? errors : logs

        let message = ''
        if(language == 'ru') {
            message = messageVar[name]["ruMessage"]
        } else if(language == 'en') {
            message = messageVar[name]["enMessage"]
        } else {
            message = `
${messageVar[name]["enMessage"]}
-----------------------------------------
${messageVar[name]["ruMessage"]}` 
        }
        
        return message.replace(/{(\w+)}/g, (match, p1) => vars[p1] || match);
    }

    async executeWithRetries(fn, maxRetries = config.MAX_RETRIES, retryDelay = config.RETRY_DELAY) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            } catch (error) {
                let retry = i + 1;

                const err = this.getMessage('error', "ERROR_OF_№_RETRY", {retry, error})
                console.error(err);
                if (i < maxRetries - 1) {
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
        } catch (error) {
            console.error(this.getMessage('error', "ERROR_OF_SENDING_TELEGRAM_MESSAGE", {error}));
        }
    }
    
    async getBalancesCommand(ctx) {
        try {
            const balance_pair = await this.botFarm.getBalance(this.botFarm.pair);
            const balance_symbol = await this.botFarm.getBalance(this.botFarm.symbol);
            const message = `
            Баланс: 
-- ${balance_pair} ${this.botFarm.pair}
-- ${balance_symbol} ${this.botFarm.symbol}`;

            ctx.reply(message);
        } catch (error) {
            console.error(this.getMessage('error', "ERROR_GET_BALANCE", {error}));
            ctx.reply(this.getMessage('error', "ERROR_GET_BALANCE", {error: error.message}));
        }
    }

    userCheckMiddleware(ctx, next) {
        if (ctx.from.id == config.TELEGRAM_CHAT_ID) {
            return next(); 
        } else {
            ctx.reply(this.getMessage('logs', "NOT_OWNER_BOT", {}, ''));
        }
    }
    
    async startTelegramListener() {
        bot.use(this.userCheckMiddleware.bind(this));

        bot.start((ctx) => ctx.reply(this.getMessage('logs', "START_COMMNAND")));

        bot.command('help', async (ctx) => {ctx.reply(this.getMessage('logs', 'HELP_COMMAND'))})

        bot.command('start_trading', async (ctx) => {
            if(this.language == ''){
                ctx.reply(this.getMessage('logs', "NOT_SELECTED_LANGUAGE"))
            } else{
                this.state = true
                ctx.reply(this.getMessage('logs', 'BOT_STARTED'));
            }
        })
        
        bot.command('stop_trading', async (ctx) => {
            this.state = false
            ctx.reply(this.getMessage('logs', 'BOT_STOPPED'));
        })

        /////////    /////////    /////////    /////////    /////////    /////////    
        bot.command('language', async (ctx) => {
            ctx.reply(this.getMessage('logs', 'SELECT_LANGUAGE'), Markup.inlineKeyboard([
                [Markup.button.callback('Русский(RU)', 'lanRu')],
                [Markup.button.callback('English(EN)', 'lanEn')],
            ]));

        })
        bot.action('lanRu', async (ctx) => {
            this.language = 'ru'
            await ctx.reply(this.getMessage('logs', "CHANGED_LANGUAGE"));
            await ctx.deleteMessage();
        });
        
        bot.action('lanEn', async (ctx) => {
            this.language = 'en'
            await ctx.reply(this.getMessage('logs', "CHANGED_LANGUAGE"));
            await ctx.deleteMessage();
        });
        /////////    /////////    /////////    /////////    /////////    /////////    

        bot.command('balance', async (ctx) => {
            await this.getBalancesCommand(ctx);
        });

        bot.hears(/\/cancel (.+)/, (ctx) => {
            const id = ctx.match[1];
            this.botFarm.cancelOrder(id)
            
            ctx.reply(this.getMessage('logs', "ORDER_CANCELLED", {orderId: id}));
        });

        bot.command('check', async (ctx) => {
            const elapsedTime = Date.now() - this.ts; 
            const elapsedHours = Math.floor(elapsedTime / (1000 * 60 * 60)); 
            const elapsedMinutes = Math.floor((elapsedTime % (1000 * 60 * 60)) / (1000 * 60));

            let stateMes
            if(this.state == true){
                stateMes = this.language == 'ru'? 'Работает' : 'Work'
            } else{ 
                stateMes = this.language == 'ru'? 'Остановлен' : 'Stopped'
            }

            ctx.reply(`
-- ${this.getMessage('logs', 'PROFIT')} ${this.botFarm.profitBalance} ${this.botFarm.pair}
-- ${this.getMessage('logs', "STATE_OF_WORK", {state: stateMes})}
-- ${this.getMessage('logs', "TIME_OF_WORK", {time: `${elapsedHours}:${elapsedMinutes}`})}`);
        });
    
        bot.on('text', async (ctx) => {
            const err = this.getMessage('error', "ERROR_TELEGRAM_COMMAND")
            await this.sendTelegramMessage(err);
            ctx.reply(err);
        });
    
        bot.launch();
    }
}

module.exports = Utils;
