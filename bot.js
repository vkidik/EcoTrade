const WebSocket = require('ws');
const config = require('./config');
const Utils = require('./utils');

let priceHistory = [];

class TradingBot {
    constructor() {
        this.buyPercentageDrop = 0;
        this.sellPercentageRise = 0;
        this.attempt = 0;
        this.pingInterval = null;
        this.ws = null;
        this.symbol = config.SYMBOL;
        this.pair = config.SYMBOL_PAIR;
        this.activeOrders = [];
        this.client = config.MEXC_CLIENT
        this.profitBalance = 0;

        this.utils = null
    }

    async getBalance(asset) {
        try {
            const balances = await this.utils.executeWithRetries(() => this.client.accountInfo());
            const balanceInfo = balances.balances.find(b => b.asset === asset);
            return parseFloat(balanceInfo ? balanceInfo.free : 0);
        } catch (error) {
            console.error('Ошибка при получении баланса:', error);
            throw error;
        }
    }

    async getOpenOrders(symbol) {
        try {
            const openOrders = await this.utils.executeWithRetries(() => this.client.openOrders(symbol));
            return openOrders;
        } catch (error) {
            console.error('Ошибка при получении открытых ордеров:', error);
            throw error;
        }
    }

    async calculateDynamicQuantity(asset, price) {
        try {
            const balance = await this.getBalance(asset);
            const openOrders = await this.getOpenOrders(`${this.symbol + this.pair}`);
    
            let reservedBalance = openOrders.reduce((acc, order) => {
                return acc + parseFloat(order.origQty) - parseFloat(order.executedQty);
            }, 0);
    
            // Исключаем резервный баланс из доступного баланса
            const availableBalance = balance - reservedBalance - this.profitBalance;
    
            if (availableBalance > 0) {
                const volatilityFactor = Math.max(this.buyPercentageDrop, this.sellPercentageRise) / 100;
                const riskFactor = 0.1 + (0.1 * volatilityFactor); // Increase the base risk factor to 0.1
                let quantity = (availableBalance * riskFactor) / price;
    
                // Set a minimum quantity based on the minimum order value (1 USDT)
                const minimumOrderValue = 1; // 1 USDT
                const minimumQuantity = minimumOrderValue / price;
    
                // Ensure the quantity is above the minimum required for a 1 USDT order
                if (quantity < minimumQuantity) return 0
    
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
            const quantity = await this.calculateDynamicQuantity(this.pair, price);
            if (quantity === 0) {
                console.log(`Ордер не создан. Минимальный объем сделки должен быть не менее 1 ${this.pair}.`);
                return;
            }
    
            const order = await this.utils.executeWithRetries(() => this.client.newOrder(`${this.symbol + this.pair}`, 'BUY', 'MARKET', {
                quantity: quantity.toFixed(2),
                price: price.toFixed(4),
                recvWindow: 5000,  // 5 секунд
                timeInForce: 'GTC'
            }));
            const orderValue = quantity * price;
            this.activeOrders.push({ orderId: order.orderId, timestamp: Date.now() });
            await this.utils.sendTelegramMessage(`КУПЛЕНО ${quantity.toFixed(2)} ${this.symbol}\nПо цене: ${price.toFixed(4)} ${this.pair}\nСумма сделки: ${(orderValue).toFixed(6)}`);
        } catch (error) {
            console.error('Ошибка при создании ордера на покупку:', error);
            throw error;
        }
    }
    
    async placeSellOrder(price) {
        try {
            const quantity = await this.calculateDynamicQuantity(this.symbol, price);
    
            // Проверка доступного баланса перед созданием ордера
            const availableBalance = await this.getBalance(this.symbol);
            if (quantity > availableBalance) {
                console.log(`Недостаточно средств для создания ордера. Доступно: ${availableBalance}, необходимо: ${quantity}`);
                return;
            }
    
            if (quantity === 0) {
                console.log(`Ордер не создан. Минимальный объем сделки должен быть не менее 1 ${this.pair}.`);
                return;
            }
    
            const initialBalance = await this.getBalance(this.pair);
            const order = await this.utils.executeWithRetries(() => this.client.newOrder(`${this.symbol + this.pair}`, 'SELL', 'LIMIT', {
                quantity: quantity.toFixed(2),
                price: price.toFixed(4),
                recvWindow: 5000,  // 5 секунд
                timeInForce: 'GTC'
            }));
            const finalBalance = await this.getBalance(this.pair);
            const profit = finalBalance - initialBalance;

            this.profitBalance += profit;

            const orderValue = quantity * price;
            this.activeOrders.push({ orderId: order.orderId, timestamp: Date.now() });
            await this.utils.sendTelegramMessage(`ВЫСТАВЛЕНО ${quantity.toFixed(2)} ${this.symbol}\nПо цене: ${price.toFixed(4)} ${this.pair}\nСумма сделки: ${(orderValue).toFixed(6)}\nПрофит в итоге: ${profit.toFixed(6)} ${this.pair}\nID ордера: ${order.orderId}`);
        } catch (error) {
            console.error('Ошибка при создании ордера на продажу:', error);
            throw error;
        }
    }

    async cancelOrder(orderId) {
        try {
            const result = await this.utils.executeWithRetries(() => this.client.cancelOrder(`${this.symbol + this.pair}`, orderId));
            if (result.status === 'CANCELED') {
                await this.utils.sendTelegramMessage(`Ордер ${orderId} был отменен.`);
                this.activeOrders = this.activeOrders.filter(o => o.orderId !== orderId); // Удалить отменённый ордер из списка активных ордеров
            }
        } catch (error) {
            console.error('Ошибка при отмене ордера:', error);
            throw error;
        }
    }

    calculateSMA(prices, period) {
        return prices.length >= period ? prices.slice(-period).reduce((acc, price) => acc + price, 0) / period : null
    }

    updatePriceHistory(newPrice) {
        priceHistory.push(newPrice);
        if (priceHistory.length > config.HISTORY_LENGTH) priceHistory.shift()

        if (priceHistory.length === config.HISTORY_LENGTH) {
            const maxPrice = Math.max(...priceHistory);
            const minPrice = Math.min(...priceHistory);
            const volatility = ((maxPrice - minPrice) / minPrice) * 100;

            this.buyPercentageDrop = volatility / 2;
            this.sellPercentageRise = volatility / 2;

            console.log(`Анализ волатильности: ${volatility.toFixed(2)}%`);
            console.log(`Уровень покупки: ${this.buyPercentageDrop.toFixed(2)}%, Уровень продажи: ${this.sellPercentageRise.toFixed(2)}%`);
        }
    }

    async handlePriceUpdate(newPrice) {
        this.updatePriceHistory(newPrice);

        const shortTermSMA = this.calculateSMA(priceHistory, 5);
        const longTermSMA = this.calculateSMA(priceHistory, 18);

        if (shortTermSMA && longTermSMA) {
            console.log(`Краткосрочный SMA: ${shortTermSMA.toFixed(4)}, Долгосрочный SMA: ${longTermSMA.toFixed(4)}`);

            const priceChange = ((newPrice - priceHistory[priceHistory.length - 2]) / priceHistory[priceHistory.length - 2]) * 100;
            console.log(`Текущая цена: ${newPrice} ${this.pair}, Изменение: ${priceChange.toFixed(2)}%`);

            if (shortTermSMA > longTermSMA) {
                if (priceChange <= -this.buyPercentageDrop) {
                    await this.placeBuyOrder(newPrice);
                }
            } else {
                if (priceChange >= this.sellPercentageRise) {
                    await this.placeSellOrder(newPrice);
                }
            }

            // Проверка на исполнение активных ордеров
            const openOrders = await this.getOpenOrders(`${this.symbol + this.pair}`);
            const closedOrders = this.activeOrders.filter(order => !openOrders.find(o => o.orderId === order.orderId));

            for (const order of closedOrders) {
                this.activeOrders = this.activeOrders.filter(o => o.orderId !== order.orderId);
                await this.utils.sendTelegramMessage(`Ордер ${order.orderId} исполнен!`);
            }

            // Отмена неактуальных и долго стоящих ордеров
            const currentTime = Date.now();
            for (const order of this.activeOrders) {
                const timeElapsed = (currentTime - order.timestamp) / 1000 / 60; // время в минутах

                // Отменяем ордер, если он стоит более 10 минут или если его цена неактуальна
                if (timeElapsed > 20) {
                    console.log(`Отмена ордера ${order.orderId} из-за долгого времени ожидания`);
                    await this.cancelOrder(order.orderId);
                }
            }
        }
    }

    startWebSocket() {
        this.ws = new WebSocket(`wss://wbs.mexc.com/ws`);

        this.ws.on('open', async () => {
            this.ws.send(JSON.stringify({
                method: "SUBSCRIPTION",
                params: [
                    `spot@public.deals.v3.api@${this.symbol + this.pair}`
                ],
                id: 1
            }));
            console.log('Подключение к WebSocket установлено и подписка на обновления цены активирована');
            await this.utils.sendTelegramMessage('Подключение к WebSocket установлено и подписка на обновления цены активирована');
            this.attempt = 0; // Сброс счетчика попыток

            this.pingInterval = setInterval(() => {
                this.ws.send(JSON.stringify({
                    method: "PING",
                }));
                this.ws.ping();
            }, 3000);
        });

        this.ws.on('message', (data) => {
            const parsedData = JSON.parse(data);
            if (parsedData && parsedData.d && parsedData.d.deals.length > 0) {
                const newPrice = parseFloat(parsedData.d.deals[0].p);
                console.log(`Новая цена: ${newPrice}`);
                this.handlePriceUpdate(newPrice);
            }
        });

        this.ws.on('error', async (err) => {
            console.error('Ошибка WebSocket:', err);
            await this.utils.sendTelegramMessage(`Ошибка WebSocket: ${err.message}`);
            this.handleReconnection();
        });

        this.ws.on('close', async (code) => {
            console.log(`Соединение WebSocket закрыто с кодом ${code}`);
            await this.utils.sendTelegramMessage(`Соединение WebSocket закрыто с кодом ${code}`);

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

    async startBot() {
        this.utils = new Utils(this);

        try {
            this.startWebSocket();
            console.log('Бот запущен');
            await this.utils.sendTelegramMessage('Бот запущен');
        } catch (error) {
            console.error('Ошибка запуска бота:', error);
            await this.utils.sendTelegramMessage(`Ошибка запуска бота: ${error.message}`);
            this.utils = null

            setTimeout(() => this.startBot(), 5000);
        }
    }
}

module.exports = TradingBot;
