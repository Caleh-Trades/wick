# Wick

Wick is a local crypto strategy desk. It replays classical rules on spot Bitcoin, Ether, and the other dollar markets, fills each signal on the next bar’s open, and lines each run up against buy and hold.

Costs are part of the test. Fees and slippage are charged on the way in and the way out. The base balance starts at $10,000 and can be changed per run. Every rule except buy and hold can short when its signal points down. Buy and hold stays long.

## Run the API

```bash
cd crypto-backtester/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

USDT pairs load candles from Binance spot klines. Other dollar symbols still read Coinbase and fall back to Kraken. The desk asks for 1-minute, 3-minute, 5-minute, 15-minute, 30-minute, 1-hour, 4-hour, and daily bars. Binance already publishes those sizes. On Coinbase, three-minute bars are bundled from 1-minute candles, thirty-minute bars from 5-minute candles, and four-hour bars from hourly candles. The first request for a market downloads history and caches it under `backend/data/cache`. Live updates ask for the newest bars and skip that cache. A short bar size only returns as far back as the exchange will page, and the status line says so.

## Run the desk

```bash
cd crypto-backtester/frontend
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). The page proxies `/api` to the backtester on port 8000.

## Tests

```bash
cd crypto-backtester/backend
source .venv/bin/activate
pytest
```

## What a run reports

- Equity against a buy-and-hold benchmark that pays the same fee and slippage
- Drawdown, CAGR, Sharpe, and Sortino (365-day crypto year)
- Win rate and profit factor on closed round trips
- The trades themselves, including a position that is still open at the end of the window

The desk keeps up to five runs in the browser. Each run is a name, a market, a rule, its parameters, and a fee. The symbol list is the Binance USDT spot book: Bitcoin, Ether, Solana, XRP, and Dogecoin sit first, then the rest of the trading pairs. The rule list is buy and hold, SMA crossover, EMA crossover, Donchian breakout, time-series momentum, Bollinger mean reversion, Bollinger breakout, RSI reversal, MACD trend with an ATR trail, Keltner breakout, Supertrend, opening-range breakout, previous-day high/low break, gap fade, gap continuation, VWAP reclaim, ATR chandelier, and a dual moving average with a longer filter. Every rule is long or flat on the loaded candle tape. Run walks the selected one. Run all walks every run on the tape already loaded for that market. The comparison names the rule beside the run, and the equity legend does the same. It sorts by Sharpe, win rate, profit factor, CAGR, and trade count. A hidden run stays in the list and drops off the equity chart.

The top bar sets the market, the bar size (1m, 3m, 5m, 15m, 30m, 1h, 4h, 1D), and the range (1D, 5D, 1M, 3M, 1Y, 2Y, 4Y, 6Y, All). A year is 366 days, so 2Y, 4Y, and 6Y ask for 732, 1464, and 2196 days. Hourly bars and coarser can cover those windows. Finer bars stay on the deepest tape that size can carry, and the status line says so. The status line names that bar size and the count that loaded. Enlarge opens the price chart across the screen, with volume under the candles, drag-to-zoom, and a reset that fits the tape. Drag the rule between the price chart and the equity chart to give either one more room.

Every listed pair shows a live Binance book beside the price chart. The public spot stream sends a 20-level depth snapshot and the trade tape for that USDT symbol. Asks sit above the spread, bids below it, and the middle row shows the last trade, the spread, and the mid. Prices follow the symbol’s tick size and sizes follow its step size. The ladder repaints once a second from the latest snapshot. A changed size flashes for a moment, new prints enter the 40-row tape, and a 60-second buy-minus-sell delta marks a one-row histogram. The forming candle on the chart takes those trades once a second. The book is not an input to Run or Run all.
