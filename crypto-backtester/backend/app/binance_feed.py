"""Binance USDT spot and USDT-M perpetual markets. History only; the desk book uses the public stream."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.data import (
    CACHE_DIR,
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

SPOT_REST = "https://data-api.binance.vision"
PERP_REST = "https://fapi.binance.com"
USER_AGENT = "WickBacktester/1.0"
KLINE_LIMIT = 1000
FUNDING_LIMIT = 1000
PINNED = ("BTC", "ETH", "SOL", "XRP", "DOGE")
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
_SYMBOL = re.compile(r"^[A-Z0-9]{2,20}$")

_info_guard = threading.Lock()
_info_cache: dict[str, tuple[float, dict]] = {}


def normalize_venue(value: str | None) -> str:
    return "perp" if value == "perp" else "spot"


def is_binance_symbol(symbol: str) -> bool:
    return symbol.endswith("USDT") and _SYMBOL.fullmatch(symbol) is not None


def list_usdt_markets(venue: str = "spot") -> list[dict[str, str]]:
    venue = normalize_venue(venue)
    payload = _exchange_info(venue)
    markets: list[dict[str, str]] = []
    for item in payload.get("symbols") or []:
        if not _listed(item, venue):
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
        base = str(item.get("baseAsset") or symbol.removesuffix("USDT"))
        row = {
            "id": symbol,
            "base": base,
            "quote": "USDT",
            "tickSize": tick,
            "stepSize": step,
        }
        name = NAMES.get(base) or item.get("baseAssetName")
        if name and str(name) != base:
            row["name"] = str(name)
        price = item.get("lastPrice") or item.get("price")
        if price:
            row["lastPrice"] = str(price)
        markets.append(row)
    rank = {base: index for index, base in enumerate(PINNED)}
    markets.sort(key=lambda market: (rank.get(market["base"], len(PINNED)), market["base"]))
    return markets


def _listed(item: dict, venue: str) -> bool:
    if item.get("status") != "TRADING" or item.get("quoteAsset") != "USDT":
        return False
    if venue == "perp":
        return item.get("contractType") == "PERPETUAL" and item.get("marginAsset") in (None, "USDT")
    return item.get("isSpotTradingAllowed") is not False


def _binance_span(spec: dict, days: int | None) -> int:
    """Requested multi-year windows on hourly bars and coarser. Finer bars keep the page cap."""
    span = span_days(spec, days)
    if int(spec["seconds"]) < 3600 or not days or days <= 0:
        return span
    return max(1, min(int(days), 365 * 12))


def load_binance_series(
    symbol: str,
    interval: str,
    days: int | None = None,
    venue: str = "spot",
) -> tuple[list[Candle], str]:
    venue = normalize_venue(venue)
    symbol = _require_symbol(symbol, venue)
    spec = get_interval(interval)
    span = _binance_span(spec, days)
    source = _source(venue)
    key = f"{source}_{symbol}_{interval}_{span}"
    with _lock(key):
        cached = _read_cache(key)
        fresh = cached is not None and time.time() - cached["fetched_at"] < 30 * 60
        if fresh:
            return cached["candles"], cached["source"]
        end = int(time.time())
        start = end - span * 86_400
        try:
            candles = _fetch_klines(symbol, interval, start, end, int(spec["seconds"]), venue)
        except DataUnavailable:
            if cached:
                logger.warning("Using stale %s cache after Binance failed", key)
                return cached["candles"], cached["source"]
            raise
        except httpx.HTTPError as exc:
            if cached:
                logger.warning("Using stale %s cache after Binance failed: %s", key, exc)
                return cached["candles"], cached["source"]
            raise DataUnavailable(f"Couldn't pull {symbol} from Binance. Try again in a minute.") from exc
        candles = [candle for candle in _dedupe(candles) if candle.time >= start]
        if not candles:
            if cached:
                return cached["candles"], cached["source"]
            raise DataUnavailable(f"Not enough {symbol} {interval} bars came back.")
        _write_cache(key, candles, source)
        return candles, source


def load_binance_tail(
    symbol: str,
    interval: str,
    since: int | None = None,
    venue: str = "spot",
) -> tuple[list[Candle], str]:
    venue = normalize_venue(venue)
    symbol = _require_symbol(symbol, venue)
    spec = get_interval(interval)
    end = int(time.time())
    start = end - int(spec["seconds"]) * 5
    if since is not None:
        start = min(start, int(since) - int(spec["seconds"]))
    candles = _fetch_klines(symbol, interval, max(0, start), end, int(spec["seconds"]), venue)
    candles = _dedupe(candles)
    if since is not None:
        candles = [candle for candle in candles if candle.time >= int(since)]
    return candles, _source(venue)


def load_funding(symbol: str, start: int, end: int) -> tuple[list[dict], bool]:
    """Public USDT-M funding history. A failed request never invents a zero rate."""
    symbol = _require_symbol(symbol, "perp")
    start = max(0, int(start))
    end = max(start, int(end))
    key = f"funding_{symbol}_{start}_{end}"
    cached = _read_funding_cache(key)
    fresh = cached is not None and time.time() - cached[1] < 30 * 60
    if fresh and cached is not None:
        return cached[0], False
    try:
        rates = _fetch_funding(symbol, start, end)
    except DataUnavailable:
        if cached is not None:
            logger.warning("Using stale funding cache for %s after Binance failed", symbol)
            return cached[0], True
        raise
    except httpx.HTTPError as exc:
        if cached is not None:
            logger.warning("Using stale funding cache for %s after Binance failed: %s", symbol, exc)
            return cached[0], True
        raise DataUnavailable(f"Couldn't pull {symbol} funding. The run will not invent a rate.") from exc
    _write_funding_cache(key, rates)
    return rates, False


def _source(venue: str) -> str:
    return "binance-perp" if venue == "perp" else "binance"


def _require_symbol(symbol: str, venue: str) -> str:
    if not is_binance_symbol(symbol):
        kind = "perpetual" if venue == "perp" else "spot"
        raise UnknownSymbol(f"The book and tape use Binance USDT {kind} symbols, like BTCUSDT.")
    return symbol


def _kline_url(venue: str) -> str:
    if venue == "perp":
        return f"{PERP_REST}/fapi/v1/klines"
    return f"{SPOT_REST}/api/v3/klines"


def _fetch_klines(symbol: str, interval: str, start: int, end: int, seconds: int, venue: str = "spot") -> list[Candle]:
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
    url = _kline_url(venue)
    kind = "perpetual" if venue == "perp" else "spot"

    def fetch_window(window: tuple[int, int]) -> list[Candle]:
        start_at, end_at = window
        with httpx.Client(timeout=20.0, headers=headers) as client:
            response = client.get(
                url,
                params={
                    "symbol": symbol,
                    "interval": interval,
                    "startTime": start_at,
                    "endTime": end_at,
                    "limit": KLINE_LIMIT,
                },
            )
        if response.status_code == 400:
            raise UnknownSymbol(f"Binance has no {kind} market {symbol}.")
        _raise_unless_ok(response, f"Couldn't pull {symbol} from Binance.")
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


def _fetch_funding(symbol: str, start: int, end: int) -> list[dict]:
    start_ms = start * 1000
    end_ms = end * 1000
    cursor = start_ms
    rates: list[dict] = []
    seen: set[int] = set()
    while cursor <= end_ms:
        page = _funding_page(symbol, cursor, end_ms)
        if not page:
            break
        last = cursor
        for row in page:
            try:
                stamp_ms = int(row["fundingTime"])
                rate = float(row["fundingRate"])
            except (KeyError, TypeError, ValueError):
                continue
            if stamp_ms in seen:
                continue
            seen.add(stamp_ms)
            last = max(last, stamp_ms)
            item = {"t": stamp_ms // 1000, "rate": rate}
            mark = row.get("markPrice")
            if mark not in (None, ""):
                try:
                    item["mark"] = float(mark)
                except (TypeError, ValueError):
                    pass
            rates.append(item)
        if len(page) < FUNDING_LIMIT or last <= cursor:
            break
        cursor = last + 1
    rates.sort(key=lambda item: int(item["t"]))
    return rates


def _funding_page(symbol: str, start_ms: int, end_ms: int) -> list:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    with httpx.Client(timeout=20.0, headers=headers) as client:
        response = client.get(
            f"{PERP_REST}/fapi/v1/fundingRate",
            params={"symbol": symbol, "startTime": start_ms, "endTime": end_ms, "limit": FUNDING_LIMIT},
        )
    if response.status_code == 400:
        raise UnknownSymbol(f"Binance has no perpetual {symbol}.")
    _raise_unless_ok(response, f"Couldn't pull {symbol} funding.")
    payload = response.json()
    if isinstance(payload, dict):
        raise DataUnavailable(str(payload.get("msg") or "Binance refused the funding request."))
    if not isinstance(payload, list):
        raise DataUnavailable("Binance did not return funding history.")
    return payload


def _read_funding_cache(key: str) -> tuple[list[dict], float] | None:
    path = CACHE_DIR / f"{key}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
        rates = payload["rates"]
        if not isinstance(rates, list):
            return None
    except (OSError, json.JSONDecodeError, KeyError, TypeError):
        logger.warning("Ignoring unreadable funding cache %s", path)
        return None
    return rates, float(payload.get("fetched_at", 0))


def _write_funding_cache(key: str, rates: list[dict]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"fetched_at": time.time(), "rates": rates}))
    temporary.replace(path)


def _raise_unless_ok(response: httpx.Response, fallback: str) -> None:
    if response.status_code < 400:
        return
    message = fallback
    try:
        payload = response.json()
        if isinstance(payload, dict) and payload.get("msg"):
            message = str(payload["msg"])
    except (json.JSONDecodeError, ValueError):
        message = fallback
    raise DataUnavailable(message)


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


def _exchange_info(venue: str = "spot") -> dict:
    venue = normalize_venue(venue)
    with _info_guard:
        cached = _info_cache.get(venue)
        if cached is not None and time.time() - cached[0] < 30 * 60:
            return cached[1]
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    url = f"{PERP_REST}/fapi/v1/exchangeInfo" if venue == "perp" else f"{SPOT_REST}/api/v3/exchangeInfo"
    with httpx.Client(timeout=30.0, headers=headers) as client:
        response = client.get(url)
    _raise_unless_ok(response, "Binance did not return the market list.")
    payload = response.json()
    if not isinstance(payload, dict) or "symbols" not in payload:
        kind = "perpetual" if venue == "perp" else "spot"
        raise DataUnavailable(f"Binance did not return the {kind} list.")
    with _info_guard:
        _info_cache[venue] = (time.time(), payload)
    return payload
