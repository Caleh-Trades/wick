# Wick

Wick is a local crypto strategy desk. It replays a handful of classical rules on spot Bitcoin, Ether, and other dollar markets, fills each signal on the next bar’s open, and lines the result up against buy and hold.

Costs are part of the test. Fees and slippage are charged on the way in and the way out, and a long-only run will not quietly open shorts.

## Run the API

```bash
cd crypto-backtester/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API reads candles from Coinbase and falls back to Kraken. The first request for a market downloads history and caches it under `backend/data/cache`.

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

Rules on the desk: buy and hold, SMA crossover, EMA crossover, RSI reversion, Bollinger bounce, MACD cross, and Donchian breakout.
