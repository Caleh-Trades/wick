"""Spot candles from Coinbase, with Kraken as a fallback. Results are cached on disk."""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app.engine import Candle

logger = logging.getLogger("wick.data")

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"
CACHE_TTL_SECONDS = 30 * 60
USER_AGENT = "WickBacktester/1.0"
COINBASE_URL = "https://api.exchange.coinbase.com/products/{product}/candles"
KRAKEN_URL = "https://api.kraken.com/0/public/OHLC"
BARS_PER_REQUEST = 280


class UnknownSymbol(ValueError):
    pass


class UnknownInterval(ValueError):
    pass


class DataUnavailable(RuntimeError):
    pass


class Symbol:
    def __init__(self, id: str, base: str, quote: str, name: str, kraken: str) -> None:
        self.id = id
        self.base = base
        self.quote = quote
        self.name = name
        self.kraken = kraken

    def public(self) -> dict[str, str]:
        return {"id": self.id, "base": self.base, "quote": self.quote, "name": self.name}


SYMBOLS: tuple[Symbol, ...] = (
    Symbol("BTC-USD", "BTC", "USD", "Bitcoin", "XBTUSD"),
    Symbol("ETH-USD", "ETH", "USD", "Ethereum", "ETHUSD"),
    Symbol("SOL-USD", "SOL", "USD", "Solana", "SOLUSD"),
    Symbol("XRP-USD", "XRP", "USD", "XRP", "XRPUSD"),
    Symbol("DOGE-USD", "DOGE", "USD", "Dogecoin", "XDGUSD"),
    Symbol("AVAX-USD", "AVAX", "USD", "Avalanche", "AVAXUSD"),
    Symbol("LINK-USD", "LINK", "USD", "Chainlink", "LINKUSD"),
    Symbol("LTC-USD", "LTC", "USD", "Litecoin", "LTCUSD"),
    Symbol("ADA-USD", "ADA", "USD", "Cardano", "ADAUSD"),
)

# 30m is bundled from 5-minute Coinbase candles. 4h is bundled from hourly candles.
# Kraken already speaks those sizes, so the fallback is not resampled.
INTERVALS: dict[str, dict] = {
    "1m": {
        "label": "1 minute",
        "detail": "About one day",
        "seconds": 60,
        "coinbase": 60,
        "kraken": 1,
        "lookback_days": 1,
        "periods_per_year": 365 * 24 * 60,
    },
    "5m": {
        "label": "5 minute",
        "detail": "About five days",
        "seconds": 300,
        "coinbase": 300,
        "kraken": 5,
        "lookback_days": 5,
        "periods_per_year": 365 * 24 * 12,
    },
    "30m": {
        "label": "30 minute",
        "detail": "About ten days",
        "seconds": 1_800,
        "coinbase": 300,
        "kraken": 30,
        "lookback_days": 10,
        "periods_per_year": 365 * 48,
    },
    "1h": {
        "label": "1 hour",
        "detail": "About sixty days",
        "seconds": 3600,
        "coinbase": 3600,
        "kraken": 60,
        "lookback_days": 60,
        "periods_per_year": 365 * 24,
    },
    "4h": {
        "label": "4 hour",
        "detail": "About six months",
        "seconds": 14_400,
        "coinbase": 3600,
        "kraken": 240,
        "lookback_days": 180,
        "periods_per_year": 365 * 6,
    },
    "1d": {
        "label": "Daily",
        "detail": "About four years",
        "seconds": 86_400,
        "coinbase": 86_400,
        "kraken": 1440,
        "lookback_days": 365 * 4,
        "periods_per_year": 365,
    },
}

_SYMBOLS_BY_ID = {symbol.id: symbol for symbol in SYMBOLS}
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def list_symbols() -> list[Symbol]:
    return list(SYMBOLS)


def list_intervals() -> list[dict[str, str]]:
    return [
        {"id": key, "label": value["label"], "detail": value["detail"]}
        for key, value in INTERVALS.items()
    ]


def get_symbol(symbol_id: str) -> Symbol:
    try:
        return _SYMBOLS_BY_ID[symbol_id]
    except KeyError as exc:
        names = ", ".join(symbol.base for symbol in SYMBOLS)
        raise UnknownSymbol(f"Unknown market. Wick covers {names}.") from exc


def get_interval(interval: str) -> dict:
    try:
        return INTERVALS[interval]
    except KeyError as exc:
        known = ", ".join(INTERVALS)
        raise UnknownInterval(f"Interval has to be one of {known}.") from exc


# About 160 Coinbase pages. That is a month of 1-minute bars, or roughly five months of 5-minute bars.
MAX_PAGES = 160


def span_days(spec: dict, days: int | None) -> int:
    """How many days of history to request. Zero means the longest tape this bar size can carry."""
    source = int(spec["coinbase"])
    cap = max(1, (MAX_PAGES * (BARS_PER_REQUEST - 1) * source) // 86_400)
    if int(spec["seconds"]) >= 86_400:
        cap = 365 * 12
    if days is None:
        return min(int(spec["lookback_days"]), cap)
    if days <= 0:
        return cap
    return max(1, min(int(days), cap))


def load_series(symbol_id: str, interval: str, days: int | None = None) -> tuple[list[Candle], str]:
    symbol = get_symbol(symbol_id)
    spec = get_interval(interval)
    span = span_days(spec, days)
    key = f"{symbol.id}_{interval}_{span}"
    with _lock(key):
        cached = _read_cache(key)
        fresh = cached is not None and time.time() - cached["fetched_at"] < CACHE_TTL_SECONDS
        if fresh:
            return cached["candles"], cached["source"]
        try:
            candles, source = _fetch(symbol, interval, spec, days)
        except (httpx.HTTPError, DataUnavailable) as exc:
            if cached:
                logger.warning("Using stale %s cache after fetch failed: %s", key, exc)
                return cached["candles"], cached["source"]
            raise DataUnavailable(
                f"Couldn't pull {symbol.base} prices from Coinbase or Kraken. Try again in a minute."
            ) from exc
        if len(candles) < 3:
            if cached:
                return cached["candles"], cached["source"]
            raise DataUnavailable(f"Not enough {symbol.base} {spec['label'].lower()} bars came back.")
        _write_cache(key, candles, source)
        return candles, source


def load_tail(symbol_id: str, interval: str, since: int | None = None) -> tuple[list[Candle], str]:
    """Latest bars, always fetched. The full-history cache is left alone."""
    symbol = get_symbol(symbol_id)
    spec = get_interval(interval)
    end = int(time.time())
    granularity = int(spec["coinbase"])
    target = int(spec["seconds"])
    span = max(target * 8, granularity * 12)
    start = end - span
    if since is not None:
        start = min(start, int(since) - target)
    start = max(0, start)
    try:
        rows = _coinbase_rows(symbol.id, granularity, start, end)
        candles = _coinbase_candles(rows)
        if granularity != target:
            candles = resample(candles, target, granularity)
        source = "coinbase"
    except (httpx.HTTPError, DataUnavailable) as exc:
        logger.warning("Live tail failed on Coinbase for %s %s (%s). Trying Kraken.", symbol.id, interval, exc)
        candles = _kraken_candles(symbol.kraken, int(spec["kraken"]))
        source = "kraken"
    candles = _dedupe(candles)
    if since is not None:
        candles = [candle for candle in candles if candle.time >= int(since)]
    return candles, source


def resample(candles: list[Candle], target_seconds: int, source_seconds: int) -> list[Candle]:
    """Bundle smaller bars into aligned buckets. Incomplete buckets in the middle are dropped."""
    if not candles or target_seconds < source_seconds:
        return list(candles)
    expected = target_seconds // source_seconds
    grouped: dict[int, list[Candle]] = {}
    order: list[int] = []
    for candle in candles:
        bucket = candle.time - (candle.time % target_seconds)
        if bucket not in grouped:
            grouped[bucket] = []
            order.append(bucket)
        grouped[bucket].append(candle)

    bundled: list[Candle] = []
    last = len(order) - 1
    for index, bucket in enumerate(order):
        group = grouped[bucket]
        if len(group) < expected and index != last:
            continue
        bundled.append(
            Candle(
                time=bucket,
                open=group[0].open,
                high=max(item.high for item in group),
                low=min(item.low for item in group),
                close=group[-1].close,
                volume=sum(item.volume for item in group),
            )
        )
    return bundled


def _fetch(symbol: Symbol, interval: str, spec: dict, days: int | None = None) -> tuple[list[Candle], str]:
    end = int(time.time())
    start = end - span_days(spec, days) * 86_400
    try:
        rows = _coinbase_rows(symbol.id, int(spec["coinbase"]), start, end)
        candles = _coinbase_candles(rows)
        if int(spec["coinbase"]) != int(spec["seconds"]):
            candles = resample(candles, int(spec["seconds"]), int(spec["coinbase"]))
        if len(candles) < 3:
            raise DataUnavailable("Coinbase returned too few bars.")
        source = "coinbase"
    except (httpx.HTTPError, DataUnavailable) as exc:
        logger.warning("Coinbase failed for %s %s (%s). Trying Kraken.", symbol.id, interval, exc)
        candles = _kraken_candles(symbol.kraken, int(spec["kraken"]))
        source = "kraken"

    candles = [candle for candle in _dedupe(candles) if candle.time >= start]
    if len(candles) < 3:
        raise DataUnavailable(f"{symbol.base} didn't return a usable {interval} history.")
    return candles, source


def _coinbase_rows(product: str, granularity: int, start: int, end: int) -> list[list]:
    span = (BARS_PER_REQUEST - 1) * granularity
    windows: list[tuple[int, int]] = []
    cursor = start
    while cursor < end:
        chunk_end = min(end, cursor + span)
        windows.append((cursor, chunk_end))
        next_cursor = chunk_end + granularity
        if next_cursor <= cursor:
            break
        cursor = next_cursor
    if not windows:
        return []
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}

    def fetch_window(window: tuple[int, int]) -> list[list]:
        start_at, end_at = window
        with httpx.Client(timeout=20.0, headers=headers) as client:
            response = _get_with_retry(
                client,
                COINBASE_URL.format(product=product),
                {"granularity": granularity, "start": _iso(start_at), "end": _iso(end_at)},
            )
        payload = response.json()
        if isinstance(payload, dict):
            message = payload.get("message", "Coinbase refused the candle request.")
            raise DataUnavailable(str(message))
        return payload

    if len(windows) == 1:
        return fetch_window(windows[0])

    from concurrent.futures import ThreadPoolExecutor

    rows: list[list] = []
    with ThreadPoolExecutor(max_workers=min(6, len(windows))) as pool:
        for payload in pool.map(fetch_window, windows):
            rows.extend(payload)
    return rows


def _coinbase_candles(rows: list[list]) -> list[Candle]:
    candles: list[Candle] = []
    for row in rows:
        if len(row) < 6:
            continue
        candle = _make_candle(
            int(row[0]),
            float(row[3]),
            float(row[2]),
            float(row[1]),
            float(row[4]),
            float(row[5]),
        )
        if candle is not None:
            candles.append(candle)
    return candles


def _kraken_candles(pair: str, interval_minutes: int) -> list[Candle]:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    with httpx.Client(timeout=20.0, headers=headers) as client:
        response = _get_with_retry(
            client,
            KRAKEN_URL,
            {"pair": pair, "interval": interval_minutes},
        )
    payload = response.json()
    errors = payload.get("error") or []
    if errors:
        raise DataUnavailable("Kraken: " + "; ".join(str(item) for item in errors))
    result = payload.get("result") or {}
    table_key = next((key for key in result if key != "last"), None)
    if table_key is None:
        raise DataUnavailable("Kraken returned no candles.")
    candles: list[Candle] = []
    for row in result[table_key]:
        candle = _make_candle(
            int(row[0]),
            float(row[1]),
            float(row[2]),
            float(row[3]),
            float(row[4]),
            float(row[6]),
        )
        if candle is not None:
            candles.append(candle)
    return candles


def _get_with_retry(client: httpx.Client, url: str, params: dict) -> httpx.Response:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = client.get(url, params=params)
        except httpx.TransportError as exc:
            last_error = exc
            time.sleep(0.4 * (attempt + 1))
            continue
        if response.status_code == 429 or response.status_code >= 500:
            last_error = DataUnavailable(f"HTTP {response.status_code} from {url}")
            time.sleep(0.4 * (attempt + 1))
            continue
        response.raise_for_status()
        return response
    assert last_error is not None
    raise DataUnavailable(str(last_error)) from last_error


def _make_candle(
    timestamp: int, open_: float, high: float, low: float, close: float, volume: float
) -> Candle | None:
    if min(open_, high, low, close) <= 0 or high < low:
        return None
    return Candle(time=timestamp, open=open_, high=high, low=low, close=close, volume=volume)


def _dedupe(candles: list[Candle]) -> list[Candle]:
    by_time: dict[int, Candle] = {}
    for candle in candles:
        by_time[candle.time] = candle
    return [by_time[stamp] for stamp in sorted(by_time)]


def _iso(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _lock(key: str) -> threading.Lock:
    with _locks_guard:
        if key not in _locks:
            _locks[key] = threading.Lock()
        return _locks[key]


def _read_cache(key: str) -> dict | None:
    path = CACHE_DIR / f"{key}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
        candles = [Candle(*row) for row in payload["candles"]]
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
        logger.warning("Ignoring unreadable cache file %s", path)
        return None
    return {
        "fetched_at": float(payload.get("fetched_at", 0)),
        "source": str(payload.get("source", "cache")),
        "candles": candles,
    }


def _write_cache(key: str, candles: list[Candle], source: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.json"
    temporary = path.with_suffix(".tmp")
    payload = {
        "fetched_at": time.time(),
        "source": source,
        "candles": [
            [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume]
            for candle in candles
        ],
    }
    temporary.write_text(json.dumps(payload))
    temporary.replace(path)
