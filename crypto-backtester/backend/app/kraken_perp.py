"""Kraken USD perpetuals. Perp slots read this book, not a Binance spot or USDT-M kline."""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal

import httpx

from app.binance_feed import (
    _binance_span,
    _read_funding_cache,
    _write_funding_cache,
    is_binance_symbol,
)
from app.data import (
    DataUnavailable,
    UnknownSymbol,
    _dedupe,
    _lock,
    _make_candle,
    _read_cache,
    _write_cache,
    get_interval,
    resample,
)
from app.engine import Candle

logger = logging.getLogger("wick.kraken_perp")

CHARTS_URL = "https://futures.kraken.com/api/charts/v1/trade"
INSTRUMENTS_URL = "https://futures.kraken.com/derivatives/api/v3/instruments"
TICKERS_URL = "https://futures.kraken.com/derivatives/api/v3/tickers"
FUNDING_URL = "https://futures.kraken.com/derivatives/api/v3/historical-funding-rates"
USER_AGENT = "WickBacktester/1.0"
SOURCE = "kraken-perp"
MAX_PAGES = 40
PINNED = ("BTC", "ETH", "SOL", "XRP", "DOGE")
EXCLUDED_CATEGORIES = {"Equities", "xStocks", "Commodities", "Forex", "Pre-IPO", "Indices"}
NAMES = {
    "BTC": "Bitcoin",
    "ETH": "Ethereum",
    "SOL": "Solana",
    "XRP": "XRP",
    "DOGE": "Dogecoin",
    "BNB": "BNB",
    "ADA": "Cardano",
    "AVAX": "Avalanche",
    "LINK": "Chainlink",
    "LTC": "Litecoin",
}
# Kraken publishes 1m, 5m, 15m, 30m, 1h, 4h, and 1d. Three-minute bars are bundled from 1m.
RESOLUTIONS = {
    "1m": "1m",
    "3m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
}
RESOLUTION_SECONDS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1_800,
    "1h": 3_600,
    "4h": 14_400,
    "1d": 86_400,
}

_cache_guard = threading.Lock()
_instrument_cache: tuple[float, dict[str, dict]] | None = None


def list_kraken_perp_markets() -> list[dict[str, str]]:
    book = _instrument_book()
    prices = _last_prices()
    markets: list[dict[str, str]] = []
    for base, item in book.items():
        row = {
            "id": f"{base}USDT",
            "base": base,
            "quote": "USDT",
            "tickSize": _plain(item.get("tickSize") or "0.00000001"),
            "stepSize": _step(item.get("contractValueTradePrecision")),
        }
        name = NAMES.get(base)
        if name and name != base:
            row["name"] = name
        last = prices.get(str(item.get("symbol")))
        if last:
            row["lastPrice"] = last
        markets.append(row)
    rank = {pinned: index for index, pinned in enumerate(PINNED)}
    markets.sort(key=lambda market: (rank.get(market["base"], len(PINNED)), market["base"]))
    return markets


def load_kraken_perp_series(
    symbol: str,
    interval: str,
    days: int | None = None,
) -> tuple[list[Candle], str]:
    symbol = _require_symbol(symbol)
    spec = get_interval(interval)
    span = _binance_span(spec, days)
    key = f"{SOURCE}_{symbol}_{interval}_{span}"
    with _lock(key):
        cached = _read_cache(key)
        fresh = cached is not None and time.time() - cached["fetched_at"] < 30 * 60
        if fresh:
            return cached["candles"], SOURCE
        end = int(time.time())
        start = end - span * 86_400
        try:
            candles = _load_window(symbol, interval, start, end)
        except DataUnavailable:
            if cached:
                logger.warning("Using stale %s cache after Kraken failed", key)
                return cached["candles"], cached["source"]
            raise
        candles = [candle for candle in _dedupe(candles) if candle.time >= start]
        if not candles:
            if cached:
                return cached["candles"], cached["source"]
            raise DataUnavailable(f"Kraken returned no {symbol} {interval} perpetual bars.")
        _write_cache(key, candles, SOURCE)
        return candles, SOURCE


def load_kraken_perp_tail(
    symbol: str,
    interval: str,
    since: int | None = None,
) -> tuple[list[Candle], str]:
    symbol = _require_symbol(symbol)
    spec = get_interval(interval)
    end = int(time.time())
    start = end - int(spec["seconds"]) * 5
    if since is not None:
        start = min(start, int(since) - int(spec["seconds"]))
    candles = _load_window(symbol, interval, max(0, start), end)
    candles = _dedupe(candles)
    if since is not None:
        candles = [candle for candle in candles if candle.time >= int(since)]
    return candles, SOURCE


def load_kraken_funding(symbol: str, start: int, end: int) -> tuple[list[dict], bool]:
    """Hourly relative funding. A failed request never invents a zero rate."""
    symbol = _require_symbol(symbol)
    start = max(0, int(start))
    end = max(start, int(end))
    key = f"funding_kraken_{symbol}_{start}_{end}"
    cached = _read_funding_cache(key)
    fresh = cached is not None and time.time() - cached[1] < 30 * 60
    if fresh and cached is not None:
        return cached[0], _coverage_stale(cached[0], start)
    try:
        rates = _fetch_funding(symbol, start, end)
    except DataUnavailable:
        if cached is not None:
            logger.warning("Using stale Kraken funding cache for %s", symbol)
            return cached[0], True
        raise
    _write_funding_cache(key, rates)
    return rates, _coverage_stale(rates, start)


def _load_window(symbol: str, interval: str, start: int, end: int) -> list[Candle]:
    resolution = RESOLUTIONS.get(interval)
    if resolution is None:
        raise DataUnavailable(f"Kraken has no {interval} perpetual candles.")
    product = _kraken_symbol(symbol)
    native = RESOLUTION_SECONDS[resolution]
    candles = _fetch_candles(product, resolution, start, end, native)
    if interval == "3m":
        candles = resample(candles, 180, 60)
    return candles


def _fetch_candles(product: str, resolution: str, start: int, end: int, seconds: int) -> list[Candle]:
    cursor = max(0, int(start))
    end = max(cursor, int(end))
    rows: list[Candle] = []
    for _ in range(MAX_PAGES):
        payload = _get_json(f"{CHARTS_URL}/{product}/{resolution}", {"from": cursor, "to": end})
        batch: list[Candle] = []
        for item in payload.get("candles") or []:
            candle = _chart_candle(item)
            if candle is not None and start <= candle.time <= end:
                batch.append(candle)
        if not batch:
            break
        rows.extend(batch)
        if not payload.get("more_candles"):
            break
        nxt = batch[-1].time + seconds
        if nxt <= cursor:
            break
        cursor = nxt
    return _dedupe(rows)


def _fetch_funding(symbol: str, start: int, end: int) -> list[dict]:
    product = _kraken_symbol(symbol)
    payload = _get_json(FUNDING_URL, {"symbol": product})
    raw = payload.get("rates")
    if not isinstance(raw, list) or not raw:
        raise DataUnavailable(f"Kraken returned no funding history for {symbol}.")
    rates: list[dict] = []
    for row in raw:
        relative = row.get("relativeFundingRate")
        if relative in (None, ""):
            continue
        try:
            stamp = _stamp(str(row.get("timestamp")))
            rate = float(relative)
        except (TypeError, ValueError):
            continue
        if stamp < start or stamp > end:
            continue
        rates.append({"t": stamp, "rate": rate})
    rates.sort(key=lambda item: int(item["t"]))
    return rates


def _coverage_stale(rates: list[dict], start: int) -> bool:
    if not rates:
        return True
    return int(rates[0]["t"]) > int(start) + 2 * 3_600


def _instrument_book() -> dict[str, dict]:
    global _instrument_cache
    with _cache_guard:
        if _instrument_cache is not None and time.time() - _instrument_cache[0] < 30 * 60:
            return _instrument_cache[1]
        payload = _get_json(INSTRUMENTS_URL)
        book: dict[str, dict] = {}
        for item in payload.get("instruments") or []:
            if not _keep(item):
                continue
            base = str(item.get("base") or "")
            if not base or base in book:
                continue
            book[base] = item
        if not book:
            raise DataUnavailable("Kraken did not return a perpetual list.")
        _instrument_cache = (time.time(), book)
        return book


def _keep(item: dict) -> bool:
    symbol = str(item.get("symbol") or "")
    if not symbol.startswith("PF_") or item.get("type") != "flexible_futures":
        return False
    if item.get("quote") != "USD" or item.get("tradeable") is False or item.get("isExpired") is True:
        return False
    if item.get("tradfi") is True or item.get("category") in EXCLUDED_CATEGORIES:
        return False
    return bool(item.get("base"))


def _last_prices() -> dict[str, str]:
    try:
        payload = _get_json(TICKERS_URL)
    except DataUnavailable as exc:
        logger.warning("Kraken perp tickers skipped: %s", exc)
        return {}
    prices: dict[str, str] = {}
    for ticker in payload.get("tickers") or []:
        if ticker.get("tag") != "perpetual":
            continue
        symbol = str(ticker.get("symbol") or "")
        last = ticker.get("last")
        if symbol and last not in (None, ""):
            prices[symbol] = _plain(last)
    return prices


def _kraken_symbol(symbol: str) -> str:
    base = symbol.removesuffix("USDT")
    item = _instrument_book().get(base)
    if not item:
        raise DataUnavailable(f"Kraken has no USD perpetual for {symbol}.")
    return str(item["symbol"])


def _require_symbol(symbol: str) -> str:
    if not is_binance_symbol(symbol):
        raise UnknownSymbol("The book and tape use Binance USDT symbols, like BTCUSDT.")
    return symbol


def _chart_candle(item: dict) -> Candle | None:
    try:
        return _make_candle(
            int(item["time"]) // 1000,
            float(item["open"]),
            float(item["high"]),
            float(item["low"]),
            float(item["close"]),
            float(item["volume"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


def _get_json(url: str, params: dict | None = None) -> dict:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    try:
        with httpx.Client(timeout=30.0, headers=headers, follow_redirects=True) as client:
            response = client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise DataUnavailable("Kraken perpetuals didn't answer.") from exc
    if response.status_code >= 400:
        raise DataUnavailable(_error_message(response))
    try:
        payload = response.json()
    except ValueError as exc:
        raise DataUnavailable("Kraken returned an unexpected payload.") from exc
    if isinstance(payload, dict) and payload.get("result") == "error":
        errors = payload.get("errors") or []
        message = "; ".join(str(item.get("message") or item) for item in errors if isinstance(item, dict))
        raise DataUnavailable(message or "Kraken refused the request.")
    if not isinstance(payload, dict):
        raise DataUnavailable("Kraken returned an unexpected payload.")
    return payload


def _error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return "Kraken refused the perpetual request."
    if isinstance(payload, dict):
        if payload.get("reason"):
            return str(payload["reason"])
        errors = payload.get("errors") or []
        if errors and isinstance(errors[0], dict) and errors[0].get("message"):
            return str(errors[0]["message"])
    return "Kraken refused the perpetual request."


def _stamp(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def _step(precision: object) -> str:
    try:
        places = int(precision)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "0.00000001"
    return _plain(Decimal(10) ** -places)


def _plain(value: object) -> str:
    try:
        number = Decimal(str(value))
    except Exception:
        return str(value)
    text = format(number, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"
