# Wick

Wick is a local crypto strategy desk. It replays classical rules on Bitcoin, Ether, and the other USDT markets, fills each signal on the next bar’s open, and lines each run up against buy and hold.

The desk holds up to four slots. Each slot keeps its own symbol, spot or perpetual market, bar size, and range. The header follows the active slot and reads Binance spot or Kraken perp. A spot slot is long or flat. A perpetual slot can short, sets leverage, and applies funding. Perp candles, funding, the contract list, and the live book are Kraken USD perpetuals. Spot stays on Binance. A perp slot does not plot a spot kline. The socket stays open until the slot is closed.

Costs are part of the test. Fees and slippage are charged on the way in and the way out. The base balance starts at $10,000 and can be changed per run. Risk per trade is the percent of equity lost if the stop is hit. It starts at 1% and cannot be set above 5%. The position is that amount divided by the stop distance, and the stop is the 14-bar average true range at the signal. Fee and slippage are inputs, charged on the entry and the exit. Every rule except buy and hold can point short, and a perpetual slot will take that short. A spot slot stays long or flat, and its trade log does not list shorts. Buy and hold stays long. On perpetuals a short is a short position, not a borrow. Setup sets leverage from 1× to 20×, default 3×, only on a perpetual slot. Open perpetual positions pay or receive the public funding rate. If price trades through the liquidation price, from leverage and a 0.40% maintenance margin, the trade closes there and is marked liquidated. A failed funding request does not invent a zero rate.

## Run the API

```bash
cd crypto-backtester/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Spot USDT pairs load candles from Binance spot klines. Perpetual candles, funding, and the contract list come from the matching Kraken USD perpetual (Bitcoin is PF_XBTUSD), including the relative funding rate. A failed Kraken request keeps the last good series and marks it stale. It does not invent a funding rate or a candle. Missing bars stay missing: the previous close is not copied into the hole, and the header counts the gaps. Candles are UTC. Other dollar symbols still read Coinbase and fall back to Kraken spot. The desk asks for 1-minute, 3-minute, 5-minute, 15-minute, 30-minute, 1-hour, 4-hour, and daily bars. Binance already publishes those sizes. On Coinbase, three-minute bars are bundled from 1-minute candles, thirty-minute bars from 5-minute candles, and four-hour bars from hourly candles. The first request for a market downloads history and caches it under `backend/data/cache`. Live updates ask for the newest bars and skip that cache. A short bar size only returns as far back as the exchange will page, and the status line says so.

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
- Expectancy, average win times win rate minus average loss times loss rate, and how many bars the worst drawdown takes to reclaim its peak
- The same pass split into the first 70% of bars and the last 30%. Return, max drawdown, Sharpe, and trade count sit side by side. Parameters are not fit again on the holdout. The comparison table can show the full run, the in-sample window, or the holdout.
- Three walk-forward windows on that same pass, plus the in-sample and holdout slices. Windows, beside Desk and Journal, lists In-sample, Holdout, Window 1, Window 2, and Window 3: return, max drawdown, Sharpe, and trades. A missing slice stays a dash. Nothing is optimized again. Comparison stays the run table. Its Full, In-sample, and Holdout buttons only change which slice that table shows. If holdout Sharpe is negative while the full-sample Sharpe is positive, the run says so.
- MC 5% equity on the run summary: the 5th percentile ending equity after 500 redraws of the closed-trade returns, compounded from the starting balance. The closed-trade count sits beside the figure. Fewer than ten closed trades is marked thin sample.

A perpetual slot shows the last Kraken funding rate already on the candle tape, with that rate’s time in UTC. If the series is missing and stale, the line says funding didn't load. Spot slots hide it. The funding a kept perpetual run paid sits next to its fee, and the run summary shows funding paid only on a perp.

A slot can arm a price above, a price below, or a 60-second delta. Setup also holds a 60-second delta for that slot. Arm shows fired or idle. When the last trade crosses the price, or the book’s 60-second delta crosses either value, the journal gains a row with the time, the symbol, and the value. That row does not place an order and does not notify anywhere else.

The cost line under the metric strip reads before fees, fees paid, slippage paid, and after costs. Fee and slippage sit together in Setup, and both are charged on the entry and the exit.

Keep this run stores a one-line note. Export JSON, beside that button, downloads the kept copy of this run: symbol, spot or perp, timeframe, range, rule, parameters, risk percent, fee, slippage, metrics, walk-forward windows, and the trade list. If this run has not been kept, the file is the active run. The journal lists the symbol, the market, the return, and that note. Reopening the row restores the slot.

Account, beside the Wick name, creates a name and password. That account stores the slots, the journal, kept runs, favourites, and pane sizes. Sign in with the same name on another device and the desk is the same one. Changes save to the account after a short pause, and the other device picks them up. Create starts from the desk already on this browser. Sign in replaces this browser with the account. Sign out leaves a copy here and stops sending changes. The password is stored as a hash.

Settings, beside the Wick name, mints a bot key. A Grok bot sends that key to change the open desk: market, bar size, range, rule, combined strategies, and risk. Desk and Journal in that same header switch the whole page. Pin puts a second slot beside the active one, each with its own book and backtest. The journal keeps a run you save — symbol, spot or perp, timeframe, rule, fee, and metrics — and reopening it restores that slot. It also lists round trips: entry, optional exit, size, side, and the strategy used. Closed trades show P&L, and the page totals P&L, win rate, profit factor, average trade, and a split by strategy. A blank exit stays open and is left out of the win rate. The same key can log one with log-trade: symbol, side, price, size, and an optional exit, strategy, and note. The key does not rewrite the app, and Wick stores only a hash. The example request is in that settings sheet.

Each slot keeps up to five runs in the browser. A run is a name, a rule, its parameters, a fee, a base balance, and a risk per trade. The same run can combine every other strategy on the list. A rule already on the run is not offered again. A position opens only when the main rule and every combined strategy want the same side. The market belongs to the slot, so every run on that slot shares it. Spot is the Binance USDT spot book. Perp is the Kraken USD perpetual list. Bitcoin, Ether, Solana, XRP, and Dogecoin sit first, then the rest of the contracts. Search ranks an exact ticker, then a prefix, then a name, and picking a row opens a slot instead of only replacing the one on screen. At four slots, search replaces the active symbol. The rule list is buy and hold, SMA crossover, EMA crossover, Donchian breakout, time-series momentum, Bollinger mean reversion, Bollinger breakout, RSI reversal, MACD trend with an ATR trail, Keltner breakout, Supertrend, opening-range breakout, previous-day high/low break, gap fade, gap continuation, VWAP reclaim, ATR chandelier, and a dual moving average with a longer filter. Run and Run all belong to the active slot and calculate off the desk thread, so the book keeps repainting once a second. The comparison names the rule beside the run, and the equity legend does the same. It sorts by Sharpe, win rate, profit factor, CAGR, and trade count. A hidden run stays in the list and drops off the equity chart.

The workspace bar switches slots. Pin one slot beside the active one and both books stay on screen. From 1024px up the rail is a sidebar that starts at 200px. Drag its right edge to make it thinner, down to 112px, or wider up to 280px. That width is remembered with the book. Below 1024px the rail is a horizontal strip. It lists the open slots and favourites with the last price and the 24h change from the socket. A missing quote stays a dash. Clicking a slot row focuses it. Clicking a favourite opens a spot slot.

The header keeps every bar size on screen, from 1m through 1D. The status line gives up space first, and the bar sizes wrap onto a second row only when the window is too narrow for one. The run summary is one compact row above the price chart. With one slot on screen and a mouse on a tall window, the chart is on the left and the order book runs beside the chart and the results under it, down to the bottom of that panel. On a touch screen, and in a short landscape window, the book stays only as tall as the price chart, so the ladder scrolls inside that height and the results use the full width underneath. Those results are one view at a time, behind Equity, Comparison, and Trades. Equity shows the dollar figure, the curve, and the drawdown. Pin a second slot and each chart keeps its own book at that chart’s height. Below 1024px, and in a short landscape window, the page itself scrolls, so the chart, the book, and the results can move up under the header. A tall window keeps the panes on one screen. On a touch screen, including an iPad turned sideways, Setup is a button along the bottom that opens the runs. A mouse keeps that panel open on the right. The book stays beside the price chart, the same three tabs switch the results, and the candle plot keeps its height. Drag the vertical split to resize the book. Drag the horizontal split under the candles to scale Equity, Comparison, and Trades together; the candle plot takes the rest of that column. Both sizes are remembered in the browser. The book stays on the right of the price chart, including on a narrow screen. The top bar sets the active slot’s venue (Spot or Perp), market, and bar size (1m, 3m, 5m, 15m, 30m, 1h, 4h, 1D). The range (1 day, 5D, 1M, 3M, 1Y, 2Y, 4Y, 6Y, All) sits on the chart. The price axis fits the high and low of the candles on screen. The status line says Binance spot or Kraken perp for that slot. A gap count appears when bars are missing. Candles shows that slot’s last kline fetch. The book clock is separate and turns stale after three quiet seconds. A year is 366 days, so 2Y, 4Y, and 6Y ask for 732, 1464, and 2196 days. Hourly bars and coarser can cover those windows. Finer bars stay on the deepest tape that size can carry, and the status line says so. The price pane is candlesticks. The last candle, the price beside it, and the header price are the book’s last trade. If no trade has arrived, those three show the mid and label it MID. Clicking a trade in the log windows the chart around that entry and shows the rule values that fired. Full tape clears that window. Enlarge is the control that opens that slot’s chart across the screen, with volume under the candles, drag-to-zoom, and a reset that fits the tape. The equity plot is dark, with the strategy in cyan and buy and hold dashed. A drawdown pane sits under it, and a log toggle scales the equity axis only.

Each open slot has its own book. Spot uses the public Binance spot stream: a 20-level depth snapshot, the trade tape, and the 24h ticker. Perps use the Kraken futures stream for that USD perpetual (Bitcoin is PF_XBTUSD): the book, trades, and ticker. The ticker’s change is an absolute price move. Closing a slot is what unsubscribes it. Asks sit above the spread, bids below it, best prices nearest the middle, and the middle row shows the last trade, the spread, and the mid. Until a trade arrives, that last-trade cell shows the mid and is labeled MID. Prices follow the contract tick size. Size, the cumulative total, and each print keep four decimal places, including once the number passes one thousand, so a fractional step still changes the liquidity. Quote notional uses K / M / B, and the depth bars scale off notional. The ladder repaints once a second from the latest snapshot. If the socket goes quiet, the last good ladder stays up with a stale flag. Nothing is invented to fill a gap. A changed size flashes for a moment, new prints enter the 40-row tape, and a 60-second buy-minus-sell delta marks a one-row histogram. The forming candle on the chart takes those trades once a second. The book is not an input to Run or Run all.
