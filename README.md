# Trading Bot

## Overview

This is a cryptocurrency trading bot designed to work with the MEXC exchange. The bot monitors the market, places buy and sell orders based on Simple Moving Average (SMA) indicators, and responds to price changes with a dynamic trading strategy. It also includes Telegram integration for real-time updates, commands, and error notifications.

## Features

- **WebSocket Integration**: Real-time market data feed using WebSocket.
- **Dynamic Trading Strategy**: Calculates the quantity of assets to trade based on current balance, open orders, and market volatility.
- **SMA Calculation**: Uses short-term and long-term SMAs to determine buy and sell signals.
- **Order Management**: Handles the creation, cancellation, and tracking of orders.
- **Error Handling**: Includes retry mechanisms and error logging.
- **Telegram Bot Integration**: Allows users to interact with the bot through a Telegram bot interface, offering commands to start/stop trading, check balances, and more.
- **Language Support**: Supports English and Russian languages.

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/vkidik/kasvibot.git
   cd kasvibot
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure the bot:**

   `config.js` is file in the root directory with the following content:

   ```javascript
   module.exports = {
       SYMBOL: 'KAS',
       SYMBOL_PAIR: 'USDT',
       MEXC_CLIENT: yourMEXCClientInstance, // Add your MEXC client instance here
       TELEGRAM_BOT_TOKEN: 'your-telegram-bot-token',
       TELEGRAM_CHAT_ID: 'your-telegram-chat-id',
       HISTORY_LENGTH: 100,  // Length of price history to maintain
       MAX_RETRIES: 5,       // Maximum retries for API calls
       RETRY_DELAY: 2000,    // Delay between retries (in milliseconds)
   };
   ```

4. **Create language files:**

   Ensure you have the following language files in a `languages` directory:

   - `errors.json`
   - `logs.json`

   These files should contain the respective messages in both English and Russian.

## Usage

1. **Start the bot:**

   ```bash
   node main.js
   ```

2. **Interact with the bot via Telegram:**

   - `/start_trading`: Start trading.
   - `/stop_trading`: Stop trading.
   - `/balance`: Check current balances.
   - `/check`: Get the current state of the bot (profit, status, uptime).
   - `/language`: Change the bot's language (English/Russian).
   - `/cancel <orderId>`: Cancel an order by its ID.

3. **WebSocket Monitoring:**

   The bot connects to the WebSocket server at `wss://wbs.mexc.com/ws` to receive live market data. The bot listens to price updates and triggers buy/sell orders based on the configured strategy.

## Error Handling and Logging

The bot is equipped with extensive logging and error handling capabilities:

- **Error Messages**: When an error occurs, the bot logs it to the console and sends a notification to the configured Telegram chat.
- **Retry Mechanism**: If an API call fails, the bot retries the operation up to a specified number of attempts.

## Contributing

Contributions are welcome! Feel free to submit a pull request or open an issue if you find any bugs or have suggestions for improvements.

## License

This project is licensed under the MIT License. See the [LICENSE](https://github.com/vkidik/kasvibot/LICENSE) file for details.

## Disclaimer

This trading bot is provided as-is, without any guarantees of profitability. Use it at your own risk. Always test with small amounts before deploying with significant funds.