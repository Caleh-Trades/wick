# Wick

Wick is a local crypto strategy desk. It replays classical rules on Bitcoin, Ether, and the other USDT markets, fills each signal on the next bar’s open, and lines each run up against buy and hold.

The desk holds up to four slots. Each slot keeps its own symbol, spot or perpetual market, bar size, and range. The header follows the active slot and reads Binance spot or Binance perp. A spot slot is long or flat. A perpetual slot can short, sets leverage, and applies funding. When Binance USDT-M history is blocked, that slot’s contract list, candles, and funding fall back to Kraken’s USD perpetuals. The live book stays on the Binance stream for the slot’s market, and the socket stays open until the slot is closed.

Costs are part of the test. Fees and slippage are charged on the way in and the way out. The base balance starts at $10,000 and can be changed per run. Risk per trade is the share of that equity lost if the position is wiped out. It starts at 100, so a total loss takes the whole balance. A smaller share leaves the rest in cash. On spot, wiped out means price at zero. On a perpetual, that share is the margin and a liquidation takes it. Every rule except buy and hold can point short, and a perpetual slot will take that short. A spot slot stays long or flat, and its trade log does not list shorts. Buy and hold stays long. On perpetuals a short is a short position, not a borrow. Setup sets leverage from 1× to 20×, default 3×, only on a perpetual slot. Open perpetual positions pay or receive the public funding rate. If price trades through the liquidation price, from leverage and a 0.40% maintenance margin, the trade closes there and is marked liquidated. A failed funding request does not invent a zero rate.

## Run the API

```bash
cd crypto-backtester/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Spot USDT pairs load candles from Binance spot klines. Perpetuals try USDT-M futures klines and funding history first. If that request is refused, the same symbol loads from the matching Kraken USD perpetual (Bitcoin is PF_XBTUSD), including the hourly relative funding rate. A funding history that starts after the candle window is marked stale and is not filled in with zeros. Other dollar symbols still read Coinbase and fall back to Kraken spot. The desk asks for 1-minute, 3-minute, 5-minute, 15-minute, 30-minute, 1-hour, 4-hour, and daily bars. Binance already publishes those sizes. On Coinbase, three-minute bars are bundled from 1-minute candles, thirty-minute bars from 5-minute candles, and four-hour bars from hourly candles. The first request for a market downloads history and caches it under `backend/data/cache`. Live updates ask for the newest bars and skip that cache. A short bar size only returns as far back as the exchange will page, and the status line says so.

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

Each slot keeps up to five runs in the browser. A run is a name, a rule, its parameters, a fee, a base balance, and a risk per trade. The market belongs to the slot, so every run on that slot shares it. Spot is the Binance USDT spot book. Perp is the USDT-M perpetual book, or the Kraken USD perpetual list when Binance will not send it. Bitcoin, Ether, Solana, XRP, and Dogecoin sit first, then the rest of the contracts. Search ranks an exact ticker, then a prefix, then a name, and picking a row opens a slot instead of only replacing the one on screen. At four slots, search replaces the active symbol. The rule list is buy and hold, SMA crossover, EMA crossover, Donchian breakout, time-series momentum, Bollinger mean reversion, Bollinger breakout, RSI reversal, MACD trend with an ATR trail, Keltner breakout, Supertrend, opening-range breakout, previous-day high/low break, gap fade, gap continuation, VWAP reclaim, ATR chandelier, and a dual moving average with a longer filter. Run and Run all belong to the active slot and calculate off the desk thread, so the book keeps repainting once a second. The comparison names the rule beside the run, and the equity legend does the same. It sorts by Sharpe, win rate, profit factor, CAGR, and trade count. A hidden run stays in the list and drops off the equity chart.

The workspace bar switches slots. Pin one slot beside the active one and both books stay on screen. A thin rail lists the open slots and favourites with the last price and the 24h change from the socket. A missing quote stays a dash. Clicking a slot row focuses it. Clicking a favourite opens a spot slot.

On a wide screen the price chart is the upper pane, with the order book and trade tape on its right. Under it, the equity curve, the comparison, and the trade log sit in one row. Equity is slightly wider than the other two. On a narrow screen a menu switches between those three. Drag the splits to resize them. The sizes are remembered in the browser. On a narrow screen the chart and the book go back behind Chart and Book tabs. The top bar sets the active slot’s venue (Spot or Perp), market, bar size (1m, 3m, 5m, 15m, 30m, 1h, 4h, 1D), and range (1 day, 5D, 1M, 3M, 1Y, 2Y, 4Y, 6Y, All). The status line says Binance spot or Binance perp for that slot, even when perpetual history came from Kraken. Candles shows that slot’s last kline fetch. The book clock is separate and turns stale after three quiet seconds. A year is 366 days, so 2Y, 4Y, and 6Y ask for 732, 1464, and 2196 days. Hourly bars and coarser can cover those windows. Finer bars stay on the deepest tape that size can carry, and the status line says so. The price pane is candlesticks. The last candle follows the book’s last trade, and the price beside it is that same print. Enlarge is the control that opens that slot’s chart across the screen, with volume under the candles, drag-to-zoom, and a reset that fits the tape.

Each open slot has its own Binance book. Spot uses the public spot stream. Perps use the public futures stream. Each sends a 20-level depth snapshot, the trade tape, and the 24h ticker. Closing a slot is what unsubscribes it. Asks sit above the spread, bids below it, best prices nearest the middle, and the middle row shows the last trade, the spread, and the mid. Prices follow the contract tick size. Size, cumulative total, and quote notional use K / M / B, and the depth bars scale off notional. The ladder repaints once a second from the latest snapshot. If the socket goes quiet, the last good ladder stays up with a stale flag. Nothing is invented to fill a gap. A changed size flashes for a moment, new prints enter the 40-row tape, and a 60-second buy-minus-sell delta marks a one-row histogram. The forming candle on the chart takes those trades once a second. The book is not an input to Run or Run all.
