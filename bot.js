const MEXC = require('mexc-api-sdk');
const WebSocket = require('ws');
const config = require('./config');
const { sendTelegramMessage, executeWithRetries } = require('./utils');

const client = new MEXC.Spot();
client.config.apiKey = config.API_KEY;
client.config.apiSecret = config.API_SECRET;
console.log(client);


let priceHistory = [];

class TradingBot {
    constructor() {
        this.buyPercentageDrop = 0;
        this.sellPercentageRise = 0;
        this.attempt = 0;
        this.pingInterval = null;
        this.ws = null;
        this.symbol = config.SYMBOL
        this.pair = config.SYMBOL_PAIR
    }

    async getBalance(asset) {
        try {
            const balances = await executeWithRetries(() => client.accountInfo());
            const balanceInfo = balances.balances.find(b => b.asset === asset);
            await sendTelegramMessage(`Баланс: ${balanceInfo ? balanceInfo.free : 0} ${asset}`);
            return parseFloat(balanceInfo ? balanceInfo.free : 0);
        } catch (error) {
            console.error('Ошибка при получении баланса:', error);
            await sendTelegramMessage(`Ошибка при получении баланса: ${error.message}`);
            throw error;
        }
    }

    async getOpenOrders(symbol) {
        try {
            const openOrders = await executeWithRetries(() => client.openOrders(symbol));
            return openOrders;
        } catch (error) {
            console.error('Ошибка при получении открытых ордеров:', error);
            throw error;
        }
    }

    async calculateDynamicQuantity(asset, price) {
        try {
            const balance = await this.getBalance(asset);
            const openOrders = await this.getOpenOrders(`${this.symbol+this.pair}`);

            let reservedBalance = openOrders.reduce((acc, order) => {
                return acc + parseFloat(order.origQty) - parseFloat(order.executedQty);
            }, 0);

            const availableBalance = balance - reservedBalance;

            if (availableBalance > 0) {
                const volatilityFactor = Math.max(this.buyPercentageDrop, this.sellPercentageRise) / 100;
                const riskFactor = 0.05 + (0.1 * volatilityFactor);
                const quantity = (availableBalance * riskFactor) / price;
                return quantity > 0 ? quantity : 0;
            }
            return 0;
        } catch (error) {
            console.error('Ошибка при расчете количества:', error);
            throw error;
        }
    }

    async placeBuyOrder(price) {
        try {
            const quantity = await this.calculateDynamicQuantity(`${this.pair}`, price);
            const orderValue = quantity * price;
    
            if (orderValue >= 1) {  // Ensure the order value is at least 1 USDT
                await executeWithRetries(() => client.newOrder(`${this.symbol+this.pair}`, 'BUY', 'LIMIT', {
                    quantity: quantity.toFixed(2),
                    price: price.toFixed(4),
                    timeInForce: 'GTC'
                }));
                await sendTelegramMessage(`Создан ордер на покупку ${quantity.toFixed(2)} ${this.symbol} по цене ${price.toFixed(4)} ${this.pair}`);
            } else {
                console.log(`Ордер не создан. Минимальный объем сделки должен быть не менее 1 ${this.pair}.`);
                // await sendTelegramMessage('Ордер не создан. Минимальный объем сделки должен быть не менее 1 USDT.');
            }
        } catch (error) {
            console.error('Ошибка при создании ордера на покупку:', error);
            throw error;
        }
    }
    
    async placeSellOrder(price) {
        try {
            const quantity = await this.calculateDynamicQuantity(`${this.symbol}`, price);
            const orderValue = quantity * price;
    
            if (orderValue >= 1) {  // Ensure the order value is at least 1 USDT
                await executeWithRetries(() => client.newOrder(`${this.symbol+this.pair}`, 'SELL', 'LIMIT', {
                    quantity: quantity.toFixed(2),
                    price: price.toFixed(4),
                    timeInForce: 'GTC'
                }));
                await sendTelegramMessage(`Создан ордер на продажу ${quantity.toFixed(2)} ${this.symbol} по цене ${price.toFixed(4)} ${this.pair}`);
            } else {
                console.log(`Ордер не создан. Минимальный объем сделки должен быть не менее 1 ${this.pair}.`);
                // await sendTelegramMessage('Ордер не создан. Минимальный объем сделки должен быть не менее 1 USDT.');
            }
        } catch (error) {
            console.error('Ошибка при создании ордера на продажу:', error);
            throw error;
        }
    }    

    calculateSMA(prices, period) {
        if (prices.length >= period) {
            const sma = prices.slice(-period).reduce((acc, price) => acc + price, 0) / period;
            return sma;
        }
        return null;
    }

    updatePriceHistory(newPrice) {
        priceHistory.push(newPrice);
        if (priceHistory.length > config.HISTORY_LENGTH) {
            priceHistory.shift();
        }

        if (priceHistory.length === config.HISTORY_LENGTH) {
            const maxPrice = Math.max(...priceHistory);
            const minPrice = Math.min(...priceHistory);
            const volatility = ((maxPrice - minPrice) / minPrice) * 100;

            this.buyPercentageDrop = volatility / 2;
            this.sellPercentageRise = volatility / 2;

            console.log(`Анализ волатильности: ${volatility.toFixed(2)}%`);
            // sendTelegramMessage(`Анализ волатильности: ${volatility.toFixed(2)}%`)
            console.log(`Уровень покупки: ${this.buyPercentageDrop.toFixed(2)}%, Уровень продажи: ${this.sellPercentageRise.toFixed(2)}%`);
            // sendTelegramMessage(`Уровень покупки: ${this.buyPercentageDrop.toFixed(2)}%, Уровень продажи: ${this.sellPercentageRise.toFixed(2)}%`)
        }
    }

    async handlePriceUpdate(newPrice) {
        this.updatePriceHistory(newPrice);

        const shortTermSMA = this.calculateSMA(priceHistory, 5);
        const longTermSMA = this.calculateSMA(priceHistory, 18);

        if (shortTermSMA && longTermSMA) {
            console.log(`Краткосрочный SMA: ${shortTermSMA.toFixed(4)}, Долгосрочный SMA: ${longTermSMA.toFixed(4)}`);
            // sendTelegramMessage(`Краткосрочный SMA: ${shortTermSMA.toFixed(4)}, Долгосрочный SMA: ${longTermSMA.toFixed(4)}`);

            const priceChange = ((newPrice - priceHistory[priceHistory.length - 2]) / priceHistory[priceHistory.length - 2]) * 100;
            console.log(`Текущая цена: ${newPrice} ${this.pair}, Изменение: ${priceChange.toFixed(2)}%`);
            sendTelegramMessage(`Текущая цена: ${newPrice} ${this.pair}, Изменение: ${priceChange.toFixed(2)}%`);

            if (shortTermSMA > longTermSMA) {
                if (priceChange <= -this.buyPercentageDrop) {
                    await this.placeBuyOrder(newPrice);
                }
            } else {
                if (priceChange >= this.sellPercentageRise) {
                    await this.placeSellOrder(newPrice);
                }
            }
        }
    }

    startWebSocket() {
        this.ws = new WebSocket(`wss://wbs.mexc.com/ws?listenKey=`);

        this.ws.on('open', () => {
            this.ws.send(JSON.stringify({
                method: "SUBSCRIPTION",
                params: [
                    `spot@public.deals.v3.api@${this.symbol+this.pair}`
                ],
                id: 1
            }));
            console.log('Подключение к WebSocket установлено и подписка на обновления цены активирована');
            sendTelegramMessage('Подключение к WebSocket установлено и подписка на обновления цены активирована');
            this.attempt = 0; // Сброс счетчика попыток

            // Отправляем ping каждые 3 секунд, чтобы поддерживать соединение активным
            this.pingInterval = setInterval(() => {
                this.ws.send(JSON.stringify({
                    method: "PING",
                }));
                this.ws.ping();
            }, 3000);
        });

        this.ws.on('message', (data) => {
            const parsedData = JSON.parse(data);
            // console.log(parsedData)
            if (parsedData && parsedData.d && parsedData.d.deals.length > 0) {
                const newPrice = parseFloat(parsedData.d.deals[0].p);
                // sendTelegramMessage(`Получено новое ценовое предложение: ${newPrice}`);
                console.log(`Новая цена: ${newPrice}`);
                this.handlePriceUpdate(newPrice);
            }
        });

        this.ws.on('error', (err) => {
            console.error('Ошибка WebSocket:', err);
            sendTelegramMessage(`Ошибка WebSocket: ${err.message}`);
            this.handleReconnection();
        });

        this.ws.on('close', (code) => {
            console.log(`Соединение WebSocket закрыто с кодом ${code}`);
            sendTelegramMessage(`Соединение WebSocket закрыто с кодом ${code}`);

            // Обрабатываем различные коды закрытия
            switch (code) {
                case 1000:
                    console.log("Соединение нормально закрыто");
                    break;
                case 1001:
                    console.log("Клиент уходит (страница/приложение закрыто)");
                    break;
                case 1002:
                    console.log("Протокол WebSocket нарушен");
                    break;
                case 1003:
                    console.log("Получен неподдерживаемый тип данных");
                    break;
                case 1006:
                    console.log("Неожиданное закрытие соединения");
                    break;
                default:
                    console.log("Неизвестный код закрытия");
            }

            clearInterval(this.pingInterval); // Останавливаем отправку ping
            this.handleReconnection();
        });
    }

    handleReconnection() {
        this.attempt++;
        const delay = Math.min(10000, Math.pow(2, this.attempt) * 1000);
        console.log(`Попытка переподключения через ${delay / 1000} секунд...`);
        setTimeout(() => this.startWebSocket(), delay);
    }

    startBot() {
        try {
            this.startWebSocket();
            console.log('Бот запущен')
            sendTelegramMessage('Бот запущен');
        } catch (error) {
            console.error('Ошибка запуска бота:', error);
            sendTelegramMessage(`Ошибка запуска бота: ${error.message}`);
            setTimeout(() => this.startBot(), 5000);
        }
    }
}

module.exports = TradingBot;
