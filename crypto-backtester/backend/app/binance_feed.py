"""Binance USDT spot markets and klines. The desk book uses the public stream; this is history only."""

from __future__ import annotations

import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.data import (
    DataUnavailable,
    UnknownSymbol,
    _dedupe,
    _lock,
    _read_cache,
    _write_cache,
    get_interval,
    span_days,
)
from app.engine import Candle

logger = logging.getLogger("wick.binance")

REST = "https://data-api.binance.vision"
USER_AGENT = "WickBacktester/1.0"
KLINE_LIMIT = 1000
PINNED = ("BTC", "ETH", "SOL", "XRP", "DOGE")
_SYMBOL = re.compile(r"^[A-Z0-9]{2,20}$")

_info_guard = threading.Lock()
_info_cache: dict | None = None
_info_at = 0.0


def is_binance_symbol(symbol: str) -> bool:
    return symbol.endswith("USDT") and _SYMBOL.fullmatch(symbol) is not None


def list_usdt_markets() -> list[dict[str, str]]:
    payload = _exchange_info()
    markets: list[dict[str, str]] = []
    for item in payload.get("symbols") or []:
        if item.get("status") != "TRADING" or item.get("quoteAsset") != "USDT":
            continue
        if item.get("isSpotTradingAllowed") is False:
            continue
        symbol = str(item.get("symbol") or "")
        if not is_binance_symbol(symbol):
            continue
        tick = "0.00000001"
        step = "0.00000001"
        for rule in item.get("filters") or []:
            if rule.get("filterType") == "PRICE_FILTER" and rule.get("tickSize"):
                tick = str(rule["tickSize"])
            if rule.get("filterType") == "LOT_SIZE" and rule.get("stepSize"):
                step = str(rule["stepSize"])
        markets.append(
            {
                "id": symbol,
                "base": str(item.get("baseAsset") or symbol.removesuffix("USDT")),
                "quote": "USDT",
                "tickSize": tick,
                "stepSize": step,
            }
        )
    rank = {base: index for index, base in enumerate(PINNED)}
    markets.sort(key=lambda market: (rank.get(market["base"], len(PINNED)), market["base"]))
    return markets


def load_binance_series(symbol: str, interval: str, days: int | None = None) -> tuple[list[Candle], str]:
    symbol = _require_symbol(symbol)
    spec = get_interval(interval)
    span = span_days(spec, days)
    key = f"binance_{symbol}_{interval}_{span}"
    with _lock(key):
        cached = _read_cache(key)
        fresh = cached is not None and time.time() - cached["fetched_at"] < 30 * 60
        if fresh:
            return cached["candles"], cached["source"]
        end = int(time.time())
        start = end - span * 86_400
        try:
            candles = _fetch_klines(symbol, interval, start, end, int(spec["seconds"]))
        except (httpx.HTTPError, DataUnavailable) as exc:
            if cached:
                logger.warning("Using stale %s cache after Binance failed: %s", key, exc)
                return cached["candles"], cached["source"]
            raise DataUnavailable(f"Couldn't pull {symbol} from Binance. Try again in a minute.") from exc
        candles = [candle for candle in _dedupe(candles) if candle.time >= start]
        if not candles:
            if cached:
                return cached["candles"], cached["source"]
            raise DataUnavailable(f"Not enough {symbol} {interval} bars came back.")
        _write_cache(key, candles, "binance")
        return candles, "binance"


def load_binance_tail(symbol: str, interval: str, since: int | None = None) -> tuple[list[Candle], str]:
    symbol = _require_symbol(symbol)
    spec = get_interval(interval)
    end = int(time.time())
    start = end - int(spec["seconds"]) * 5
    if since is not None:
        start = min(start, int(since) - int(spec["seconds"]))
    candles = _fetch_klines(symbol, interval, max(0, start), end, int(spec["seconds"]))
    candles = _dedupe(candles)
    if since is not None:
        candles = [candle for candle in candles if candle.time >= int(since)]
    return candles, "binance"


def _require_symbol(symbol: str) -> str:
    if not is_binance_symbol(symbol):
        raise UnknownSymbol("The book and tape use Binance USDT spot symbols, like BTCUSDT.")
    return symbol


def _fetch_klines(symbol: str, interval: str, start: int, end: int, seconds: int) -> list[Candle]:
    bar_ms = seconds * 1000
    start_ms = start * 1000
    end_ms = end * 1000
    windows: list[tuple[int, int]] = []
    cursor = start_ms
    step = KLINE_LIMIT * bar_ms
    while cursor < end_ms:
        windows.append((cursor, min(end_ms, cursor + step - bar_ms)))
        cursor += step
    if not windows:
        return []
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}

    def fetch_window(window: tuple[int, int]) -> list[Candle]:
        start_at, end_at = window
        with httpx.Client(timeout=20.0, headers=headers) as client:
            response = client.get(
                f"{REST}/api/v3/klines",
                params={
                    "symbol": symbol,
                    "interval": interval,
                    "startTime": start_at,
                    "endTime": end_at,
                    "limit": KLINE_LIMIT,
                },
            )
        if response.status_code == 400:
            raise UnknownSymbol(f"Binance has no spot market {symbol}.")
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict):
            raise DataUnavailable(str(payload.get("msg") or "Binance refused the candle request."))
        candles: list[Candle] = []
        for row in payload:
            candle = _kline_candle(row)
            if candle is not None:
                candles.append(candle)
        return candles

    if len(windows) == 1:
        return fetch_window(windows[0])
    candles: list[Candle] = []
    with ThreadPoolExecutor(max_workers=min(4, len(windows))) as pool:
        for batch in pool.map(fetch_window, windows):
            candles.extend(batch)
    return candles


def _kline_candle(row: list) -> Candle | None:
    if len(row) < 6:
        return None
    try:
        open_ = float(row[1])
        high = float(row[2])
        low = float(row[3])
        close = float(row[4])
        volume = float(row[5])
        stamp = int(row[0]) // 1000
    except (TypeError, ValueError):
        return None
    if min(open_, high, low, close) <= 0 or high < low:
        return None
    return Candle(time=stamp, open=open_, high=high, low=low, close=close, volume=volume)


def _exchange_info() -> dict:
    global _info_cache, _info_at
    with _info_guard:
        if _info_cache is not None and time.time() - _info_at < 30 * 60:
            return _info_cache
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    with httpx.Client(timeout=30.0, headers=headers) as client:
        response = client.get(f"{REST}/api/v3/exchangeInfo")
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or "symbols" not in payload:
        raise DataUnavailable("Binance did not return the spot list.")
    with _info_guard:
        _info_cache = payload
        _info_at = time.time()
    return payload
