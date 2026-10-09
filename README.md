# Wick

Wick is a local crypto strategy desk. It replays SMA crossover, RSI reversion, and buy and hold on spot Bitcoin and Ether, fills each signal on the next bar’s open, and lines each run up against buy and hold.

Costs are part of the test. Fees and slippage are charged on the way in and the way out, and a long-only run will not quietly open shorts.

## Run the API

```bash
cd crypto-backtester/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API reads candles from Coinbase and falls back to Kraken. The desk asks for 1-minute, 5-minute, 30-minute, and daily bars. Thirty-minute bars are bundled from Coinbase 5-minute candles. The first request for a market downloads history and caches it under `backend/data/cache`. Live updates ask for the newest bars and skip that cache.

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

The desk keeps up to five runs in the browser. Each run is a name, a market, a rule, its periods, and a fee. Run walks the selected one. Run all walks every run on the tape already loaded for that market. Sharpe, win rate, and profit factor sort the comparison. A hidden run stays in the list and drops off the equity chart.

The API still knows the wider rule set — EMA, Bollinger, MACD, and Donchian — for `POST /api/backtest`.
