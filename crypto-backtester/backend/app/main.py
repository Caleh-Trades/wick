"""Wick HTTP API."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi.middleware.cors import CORSMiddleware

from fastapi import FastAPI, HTTPException, Query, Request

from app.bot_access import acknowledge, authorize, check_ops, create_key, enqueue, list_keys, pending, revoke_key
from app.binance_feed import (
    is_binance_symbol,
    list_usdt_markets,
    load_binance_series,
    load_binance_tail,
    load_funding,
    normalize_venue,
)
from app.kraken_perp import (
    list_kraken_perp_markets,
    load_kraken_funding,
    load_kraken_perp_series,
    load_kraken_perp_tail,
)
from app.data import (
    DataUnavailable,
    UnknownInterval,
    UnknownSymbol,
    get_interval,
    list_intervals,
    list_symbols,
    load_series,
    load_tail,
)
from app.engine import BacktestError, BacktestResult, run_backtest
from app.schemas import BacktestRequest
from app.strategies import StrategyError, get_strategy, list_strategies

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("wick")

app = FastAPI(
    title="Wick",
    summary="Replay crypto strategies against spot history.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "wick"}


@app.get("/api/bot/keys")
def bot_keys() -> dict:
    return {"keys": list_keys()}


@app.post("/api/bot/keys")
def bot_key_create(body: dict) -> dict:
    name = body.get("name") if isinstance(body, dict) else None
    try:
        return create_key(name if isinstance(name, str) else "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/bot/keys/{key_id}")
def bot_key_revoke(key_id: str) -> dict:
    if not revoke_key(key_id):
        raise HTTPException(status_code=404, detail="That key is already gone.")
    return {"ok": True}


@app.post("/api/bot/edit")
def bot_edit(body: dict, request: Request) -> dict:
    header = request.headers.get("authorization", "")
    secret = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if not secret:
        raise HTTPException(status_code=401, detail="Send the bot key as Authorization: Bearer wick_…")
    record = authorize(secret)
    if record is None:
        raise HTTPException(status_code=401, detail="That bot key is not valid.")
    try:
        ops = check_ops(body.get("ops") if isinstance(body, dict) else None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    edit = enqueue(str(record["id"]), ops)
    return {"ok": True, **edit}


@app.get("/api/bot/inbox")
def bot_inbox() -> dict:
    return {"edits": pending()}


@app.post("/api/bot/inbox/ack")
def bot_inbox_ack(body: dict) -> dict:
    ids = body.get("ids") if isinstance(body, dict) else None
    if not isinstance(ids, list) or not all(isinstance(item, str) for item in ids):
        raise HTTPException(status_code=400, detail="Send the edit ids to drop.")
    acknowledge(ids)
    return {"ok": True}


@app.get("/api/meta")
def meta() -> dict:
    return {
        "symbols": [symbol.public() for symbol in list_symbols()],
        "intervals": list_intervals(),
        "strategies": [_strategy_payload(spec) for spec in list_strategies()],
        "defaults": {
            "symbol": "BTC-USD",
            "interval": "1d",
            "strategy": "sma_cross",
            "initial_capital": 10_000,
            "fee_bps": 10,
            "slippage_bps": 5,
            "allow_short": False,
        },
    }


@app.get("/api/markets")
def markets(venue: str = Query(default="spot", pattern="^(spot|perp)$")) -> dict:
    venue = normalize_venue(venue)
    try:
        listed = list_usdt_markets(venue)
    except DataUnavailable as exc:
        if venue != "perp":
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        logger.warning("Binance perp list failed (%s). Using Kraken.", exc)
        try:
            listed = list_kraken_perp_markets()
        except DataUnavailable as kraken_exc:
            raise HTTPException(status_code=503, detail=str(kraken_exc)) from kraken_exc
    except UnknownSymbol as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"markets": listed, "venue": venue}


@app.get("/api/funding")
def funding(
    symbol: str,
    start: int = Query(ge=0),
    end: int = Query(ge=0),
) -> dict:
    try:
        try:
            rates, stale = load_funding(symbol, start, end)
        except DataUnavailable as exc:
            logger.warning("Binance funding failed for %s (%s). Using Kraken.", symbol, exc)
            rates, stale = load_kraken_funding(symbol, start, end)
    except UnknownSymbol as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DataUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"symbol": symbol, "rates": rates, "stale": stale}


@app.get("/api/candles")
def candles(
    symbol: str = "BTC-USD",
    interval: str = "1d",
    since: int | None = Query(default=None, ge=0),
    days: int | None = Query(default=None, ge=0, le=20_000),
    venue: str = Query(default="spot", pattern="^(spot|perp)$"),
) -> dict:
    venue = normalize_venue(venue)
    funding_rates: list | None = None
    funding_stale = False
    try:
        spec = get_interval(interval)
        if venue == "perp":
            series, source = _perp_history(symbol, interval, days, since)
        elif is_binance_symbol(symbol):
            if since is None:
                series, source = load_binance_series(symbol, interval, days, venue="spot")
            else:
                series, source = load_binance_tail(symbol, interval, since, venue="spot")
        elif since is None:
            if days is None:
                series, source = load_series(symbol, interval)
            else:
                series, source = load_series(symbol, interval, days)
        else:
            series, source = load_tail(symbol, interval, since)
        if venue == "perp" and series:
            try:
                funding_rates, funding_stale = _perp_funding(symbol, series[0].time, series[-1].time)
            except DataUnavailable:
                funding_rates = None
                funding_stale = True
    except UnknownSymbol as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except UnknownInterval as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DataUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    body = {
        "symbol": symbol,
        "interval": interval,
        "source": source,
        "venue": venue,
        "seconds": int(spec["seconds"]),
        "periods_per_year": int(spec["periods_per_year"]),
        "candles": [_candle_payload(candle) for candle in series],
    }
    if venue == "perp":
        body["funding"] = funding_rates
        body["funding_stale"] = funding_stale
    return body


@app.post("/api/backtest")
def backtest(body: BacktestRequest) -> dict:
    _validate_request(body)
    try:
        spec = get_interval(body.interval)
        candles, source = load_series(body.symbol, body.interval)
        strategy = get_strategy(body.strategy)
        result = run_backtest(
            candles,
            body.strategy,
            body.params,
            initial_capital=body.initial_capital,
            fee_bps=body.fee_bps,
            slippage_bps=body.slippage_bps,
            allow_short=body.allow_short,
            start=_parse_day(body.start, end_of_day=False) if body.start else None,
            end=_parse_day(body.end, end_of_day=True) if body.end else None,
            periods_per_year=float(spec["periods_per_year"]),
        )
    except UnknownSymbol as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except UnknownInterval as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except StrategyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except BacktestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DataUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return _serialize(body, strategy.name, source, result)


def _perp_history(symbol: str, interval: str, days: int | None, since: int | None) -> tuple[list, str]:
    try:
        if since is None:
            return load_binance_series(symbol, interval, days, venue="perp")
        return load_binance_tail(symbol, interval, since, venue="perp")
    except DataUnavailable as exc:
        logger.warning("Binance perp history failed for %s (%s). Using Kraken.", symbol, exc)
        if since is None:
            return load_kraken_perp_series(symbol, interval, days)
        return load_kraken_perp_tail(symbol, interval, since)


def _perp_funding(symbol: str, start: int, end: int) -> tuple[list[dict], bool]:
    try:
        return load_funding(symbol, start, end)
    except DataUnavailable as exc:
        logger.warning("Binance funding failed for %s (%s). Using Kraken.", symbol, exc)
        return load_kraken_funding(symbol, start, end)


def _validate_request(body: BacktestRequest) -> None:
    if body.initial_capital < 100 or body.initial_capital > 1_000_000_000:
        raise HTTPException(
            status_code=400,
            detail="Starting capital has to sit between $100 and $1,000,000,000.",
        )
    if body.fee_bps < 0 or body.fee_bps > 1_000:
        raise HTTPException(status_code=400, detail="Fees have to be between 0 and 1000 basis points.")
    if body.slippage_bps < 0 or body.slippage_bps > 1_000:
        raise HTTPException(
            status_code=400,
            detail="Slippage has to be between 0 and 1000 basis points.",
        )
    if body.start and body.end and body.start > body.end:
        raise HTTPException(status_code=400, detail="The start date is after the end date.")


def _parse_day(value: str, *, end_of_day: bool) -> int:
    try:
        day = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Dates should look like 2024-01-31.") from exc
    stamp = int(day.timestamp())
    if end_of_day:
        return stamp + 86_400 - 1
    return stamp


def _strategy_payload(spec) -> dict:
    return {
        "id": spec.id,
        "name": spec.name,
        "summary": spec.summary,
        "params": [
            {
                "key": param.key,
                "label": param.label,
                "min": param.minimum,
                "max": param.maximum,
                "step": param.step,
                "default": param.default,
                "integer": param.integer,
            }
            for param in spec.params
        ],
    }


def _serialize(body: BacktestRequest, strategy_name: str, source: str, result: BacktestResult) -> dict:
    metrics = result.metrics
    return {
        "symbol": body.symbol,
        "interval": body.interval,
        "strategy": {"id": result.strategy_id, "name": strategy_name},
        "params": result.params,
        "source": source,
        "window": {
            "start": _iso(result.start),
            "end": _iso(result.end),
            "bars": result.bars,
        },
        "assumptions": {
            "fill": "next_open",
            "fee_bps": body.fee_bps,
            "slippage_bps": body.slippage_bps,
            "initial_capital": body.initial_capital,
            "allow_short": body.allow_short,
        },
        "metrics": {
            "total_return_pct": _round(metrics.total_return_pct, 4),
            "benchmark_return_pct": _round(metrics.benchmark_return_pct, 4),
            "excess_return_pct": _round(metrics.excess_return_pct, 4),
            "cagr_pct": _round(metrics.cagr_pct, 4),
            "max_drawdown_pct": _round(metrics.max_drawdown_pct, 4),
            "sharpe": _round(metrics.sharpe, 3),
            "sortino": _round(metrics.sortino, 3),
            "win_rate_pct": _round(metrics.win_rate_pct, 2),
            "profit_factor": _round(metrics.profit_factor, 3),
            "trades": metrics.trades,
            "exposure_pct": _round(metrics.exposure_pct, 2),
            "final_equity": _round(metrics.final_equity, 2),
            "avg_trade_pct": _round(metrics.avg_trade_pct, 4),
            "best_trade_pct": _round(metrics.best_trade_pct, 4),
            "worst_trade_pct": _round(metrics.worst_trade_pct, 4),
        },
        "equity": [
            {
                "time": _iso(point.time),
                "equity": _round(point.equity, 2),
                "benchmark": _round(point.benchmark, 2),
                "drawdown_pct": _round(point.drawdown_pct, 4),
                "price": _round(point.price, 8),
            }
            for point in result.equity
        ],
        "trades": [
            {
                "entry_time": _iso(trade.entry_time),
                "exit_time": _iso(trade.exit_time) if trade.exit_time is not None else None,
                "side": trade.side,
                "entry_price": _round(trade.entry_price, 8),
                "exit_price": _round(trade.exit_price, 8) if trade.exit_price is not None else None,
                "quantity": _round(trade.quantity, 8),
                "pnl": _round(trade.pnl, 2),
                "return_pct": _round(trade.return_pct, 4),
                "bars_held": trade.bars_held,
                "status": trade.status,
            }
            for trade in result.trades
        ],
        "candles": [
            {
                "time": _iso(candle.time),
                "open": _round(candle.open, 8),
                "high": _round(candle.high, 8),
                "low": _round(candle.low, 8),
                "close": _round(candle.close, 8),
            }
            for candle in result.candles
        ],
    }


def _candle_payload(candle) -> dict:
    return {
        "t": candle.time,
        "time": _iso(candle.time),
        "open": candle.open,
        "high": candle.high,
        "low": candle.low,
        "close": candle.close,
        "volume": candle.volume,
    }


def _iso(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _round(value: float | None, places: int) -> float | None:
    if value is None:
        return None
    if value != value or value in (float("inf"), float("-inf")):
        return None
    return round(float(value), places)
