const WebSocket = require('ws');
const config = require('./config');
const Utils = require('./utils');

let priceHistory = [];

class TradingBot {
    constructor() {
        this.buyPercentageDrop = 0;
        this.sellPercentageRise = 0;
        this.minPrice = 1 // USDT
        this.attempt = 0;
        this.pingInterval = null;
        this.ws = null;
        this.symbol = config.SYMBOL;
        this.pair = config.SYMBOL_PAIR;
        this.activeOrders = [];
        this.client = config.MEXC_CLIENT
        this.profitBalance = 0;

        this.language = ''
        this.utils = null
    }

    async getBalance(asset) {
        try {
            const balances = await this.utils.executeWithRetries(() => this.client.accountInfo());
            const balanceInfo = balances.balances.find(b => b.asset === asset);
            return parseFloat(balanceInfo ? balanceInfo.free : 0);
        } catch (error) {
            console.error(this.utils.getMessage('error', "ERROR_GET_BALANCE", {error}));
            throw error;
        }
    }

    async getOpenOrders(symbol) {
        try {
            const openOrders = await this.utils.executeWithRetries(() => this.client.openOrders(symbol));
            return openOrders;
        } catch (error) {
            console.error(this.utils.getMessage('error', "ERROR_GET_OPEN_ORDERS", {error}));
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
    
            const availableBalance = balance - reservedBalance - this.profitBalance;
    
            if (availableBalance > 0) {
                const volatilityFactor = Math.max(this.buyPercentageDrop, this.sellPercentageRise) / 100;
                const riskFactor = 0.1 + (0.1 * volatilityFactor);
                let quantity = (availableBalance * riskFactor) / price;
    
                const minimumOrderValue = this.minPrice; // 1 USDT
                const minimumQuantity = minimumOrderValue / price;
    
                if (quantity < minimumQuantity) return 0
    
                return quantity > 0 ? quantity : 0;
            }
            return 0;
        } catch (error) {
            console.error(this.utils.getMessage('error', "ERROR_QUANTITY_CALCULATION", {error}));
            throw error;
        }
    }
    
    async placeBuyOrder(price) {
        try {
            const quantity = await this.calculateDynamicQuantity(this.pair, price);
            if (quantity === 0) {
                console.log(`${this.utils.getMessage('error', "ORDER_NOT_CREATED")} ${this.utils.getMessage('error', "ERROR_MINIMUM_PRICE", {
                    count: this.minPrice,
                    symbol: this.pair
                })}`);
                return;
            }
    
            const order = await this.utils.executeWithRetries(() => this.client.newOrder(`${this.symbol + this.pair}`, 'BUY', 'MARKET', {
                quantity: quantity.toFixed(2),
                price: price.toFixed(4),
                recvWindow: 5000,
                timeInForce: 'GTC'
            }));
            const orderValue = quantity * price;
            this.activeOrders.push({ orderId: order.orderId, timestamp: Date.now() });
            await this.utils.sendTelegramMessage(this.utils.getMessage('logs', "PLACE_ORDER_BUY", {
                quantity: quantity.toFixed(2),
                symbol: this.symbol,
                price: price.toFixed(4),
                pair: this.pair,
                orderValue: orderValue.toFixed(6)
            }));
        } catch (error) {
            console.error(this.utils.getMessage('error', "ERROR_CREATING_ORDER", {
                error,
                type: this.language == "en" ? "buy": "покупку",
            }));
            throw error;
        }
    }
    
    async placeSellOrder(price) {
        try {
            const quantity = await this.calculateDynamicQuantity(this.symbol, price);

            const availableBalance = await this.getBalance(this.symbol);
            if (quantity > availableBalance) {
                console.log(`${this.utils.getMessage('error', "ORDER_NOT_CREATED")} ${this.utils.getMessage('logs', "NOT_AT_NEED", {availableBalance, quantity})});`)
                return;
            }
    
            if (quantity === 0) {
                console.log(`${this.utils.getMessage('error', "ORDER_NOT_CREATED")} ${this.utils.getMessage('error', "ORDER_NOT_CREATED")} ${this.utils.getMessage('error', "ERROR_MINIMUM_PRICE", {
                    count: this.minPrice,
                    symbol: this.pair
                })}`);
                return;
            }
    
            const initialBalance = await this.getBalance(this.pair);
            const order = await this.utils.executeWithRetries(() => this.client.newOrder(`${this.symbol + this.pair}`, 'SELL', 'LIMIT', {
                quantity: quantity.toFixed(2),
                price: price.toFixed(4),
                recvWindow: 5000,
                timeInForce: 'GTC'
            }));
            const finalBalance = await this.getBalance(this.pair);
            const profit = finalBalance - initialBalance;

            this.profitBalance += profit;

            const orderValue = quantity * price;
            this.activeOrders.push({ orderId: order.orderId, timestamp: Date.now() });
            await this.utils.sendTelegramMessage(this.utils.getMessage('logs', "PLACE_ORDER_SELL", {
                quantity: quantity.toFixed(2),
                symbol: this.symbol,
                price: price.toFixed(4),
                pair: this.pair,
                orderValue: orderValue.toFixed(6),
                profit: profit.toFixed(6),
                orderId: order.orderId
            }))
        } catch (error) {
            console.error(this.utils.getMessage('error', "ERROR_CREATING_ORDER", {
                error,
                type: this.language == "en" ? "sale": "продажу",
            }));
            throw error;
        }
    }

    async cancelOrder(orderId) {
        try {
            const result = await this.utils.executeWithRetries(() => this.client.cancelOrder(`${this.symbol + this.pair}`, orderId));
            if (result.status === 'CANCELED') {
                await this.utils.sendTelegramMessage(this.utils.getMessage('logs', "ORDER_CANCELLED", {orderId}));
                this.activeOrders = this.activeOrders.filter(o => o.orderId !== orderId);
            }
        } catch (error) {
            console.error(this.utils.getMessage('error', "ERROR_CANCELING_ORDER", {error}));
            throw error;
        }
    }

    calculateSMA(prices, period) {return prices.length >= period ? prices.slice(-period).reduce((acc, price) => acc + price, 0) / period : null}

    updatePriceHistory(newPrice) {
        priceHistory.push(newPrice);
        if (priceHistory.length > config.HISTORY_LENGTH) priceHistory.shift()

        if (priceHistory.length === config.HISTORY_LENGTH) {
            const maxPrice = Math.max(...priceHistory);
            const minPrice = Math.min(...priceHistory);
            const volatility = ((maxPrice - minPrice) / minPrice) * 100;

            this.buyPercentageDrop = volatility / 2;
            this.sellPercentageRise = volatility / 2;

            console.log(this.utils.getMessage('logs', "VOLATILITI_ANALYSIS", {volatility: volatility.toFixed(2)}))
            console.log(this.utils.getMessage('logs', "PURCHASE_LVL", {purchaseLevel: this.buyPercentageDrop.toFixed(2)}))
            console.log(this.utils.getMessage('logs', "SALES_LVL", {salesLevel: this.sellPercentageRise.toFixed(2)}))
        }
    }

    async handlePriceUpdate(newPrice) {
        this.updatePriceHistory(newPrice);

        const shortTermSMA = this.calculateSMA(priceHistory, 5);
        const longTermSMA = this.calculateSMA(priceHistory, 18);

        if (shortTermSMA && longTermSMA && this.utils.state) {
            console.log(`${this.utils.getMessage('logs', "SHORT_SMA", {shortSma: shortTermSMA.toFixed(4)})}, ${this.utils.getMessage('logs', "LONG_SMA", {longSma: longTermSMA.toFixed(4)})}`)

            const priceChange = ((newPrice - priceHistory[priceHistory.length - 2]) / priceHistory[priceHistory.length - 2]) * 100;
            console.log(`${this.utils.getMessage('logs', "CURRENT_PRICE", {
                currentPrice: newPrice,
                pair: this.pair,
            })}, ${this.utils.getMessage('logs', "CHANGED_PRICE", {
                changedPrice: priceChange.toFixed(2),
            })}`)

            if (shortTermSMA > longTermSMA) {
                if (priceChange <= -this.buyPercentageDrop) {
                    await this.placeBuyOrder(newPrice);
                }
            } else {
                if (priceChange >= this.sellPercentageRise) {
                    await this.placeSellOrder(newPrice);
                }
            }

            const openOrders = await this.getOpenOrders(`${this.symbol + this.pair}`);
            const closedOrders = this.activeOrders.filter(order => !openOrders.find(o => o.orderId === order.orderId));

            for (const order of closedOrders) {
                this.activeOrders = this.activeOrders.filter(o => o.orderId !== order.orderId);
                await this.utils.sendTelegramMessage(this.utils.getMessage('logs', "ORDER_FILLED", {orderId: order.orderId}));
            }

            const currentTime = Date.now();
            for (const order of this.activeOrders) {
                const timeElapsed = (currentTime - order.timestamp) / 1000 / 60;

                if (timeElapsed > 20) {
                    console.log(this.utils.getMessage('logs', "CANCEL_ORDER_LONG_TIME", {orderId: order.orderId}));
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
            console.log(this.utils.getMessage('logs', "START_WEBSOCKET"));
            await this.utils.sendTelegramMessage(this.utils.getMessage('logs', "START_WEBSOCKET"))
            this.attempt = 0;

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
                this.handlePriceUpdate(newPrice);
            }
        });

        this.ws.on('error', async (error) => {
            const err = this.utils.getMessage('error', "ERROR_WEBSOCKET", {error})
            console.error(err);

            await this.utils.sendTelegramMessage(err);
            this.handleReconnection();
        });

        this.ws.on('close', async (code) => {

            let message = '' 
            switch (code) {
                case 1000:
                    message = this.utils.getMessage('error', "1000_WS_ERROR");
                    break;
                case 1001:
                    message = this.utils.getMessage('error', "1001_WS_ERROR");
                    break;
                case 1002:
                    message = this.utils.getMessage('error', "1002_WS_ERROR");
                    break;
                case 1003:
                    message = this.utils.getMessage('error', "1003_WS_ERROR");
                    break;
                case 1006:
                    message = this.utils.getMessage('error', "1006_WS_ERROR");
                    break;
                default:
                    message = this.utils.getMessage('error', "DEFAULT_WS_ERROR");
            }

            const err = this.utils.getMessage('error', "WEBSOCKET_CONNECTION_CLOSED", {
                code,
                message
            });
            console.log(err);
            await this.utils.sendTelegramMessage(err);

            clearInterval(this.pingInterval);
            this.handleReconnection();
        });
    }

    handleReconnection() {
        this.attempt++;
        const delay = Math.min(10000, Math.pow(2, this.attempt) * 1000) / 1000;
        console.log(this.utils.getMessage('error', "ATTEMPTING_RECONNECT", {вудфн}));
        setTimeout(() => this.startWebSocket(), delay);
    }

    async startBot() {
        this.utils = new Utils(this);
        this.language = this.utils.language 

        try {
            this.startWebSocket();
            console.log(this.utils.getMessage('logs', "BOT_STARTED"));
            await this.utils.sendTelegramMessage(this.utils.getMessage('logs', "BOT_STARTED"));
        } catch (error) {
            const err = this.utils.getMessage('error', "ERROR_START_BOT", {error})
            console.error(err);
            await this.utils.sendTelegramMessage(err);
            this.utils = null

            setTimeout(() => this.startBot(), 5000);
        }
    }
}

module.exports = TradingBot;
