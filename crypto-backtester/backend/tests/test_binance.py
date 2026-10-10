import time

from fastapi.testclient import TestClient

from app.binance_feed import (
    _binance_span,
    _kline_url,
    is_binance_symbol,
    list_usdt_markets,
    load_binance_series,
    load_funding,
    load_premium,
)
from app.data import DataUnavailable, get_interval, span_days
from app.engine import Candle
from app.main import app


def test_usdt_symbols_are_recognized():
    assert is_binance_symbol("BTCUSDT")
    assert is_binance_symbol("1000SATSUSDT")
    assert not is_binance_symbol("BTC-USD")
    assert not is_binance_symbol("BTCUSD")


def test_market_list_pins_the_majors_and_reads_tick_size(monkeypatch):
    payload = {
        "symbols": [
            _symbol("SOLUSDT", "SOL", "0.01000000", "0.00100000"),
            _symbol("DOGEUSDT", "DOGE", "0.00001000", "1.00000000"),
            _symbol("ETHUSDT", "ETH", "0.01000000", "0.00010000"),
            _symbol("BTCUSDT", "BTC", "0.01000000", "0.00001000"),
            _symbol("XRPUSDT", "XRP", "0.00010000", "0.10000000"),
            _symbol("BTCUSD", "BTC", "0.01000000", "0.00001000", quote="USD"),
            _symbol("OLDUSDT", "OLD", "0.01000000", "1", status="BREAK"),
        ]
    }
    monkeypatch.setattr("app.binance_feed._exchange_info", lambda venue="spot": payload)
    markets = list_usdt_markets()
    assert [item["base"] for item in markets] == ["BTC", "ETH", "SOL", "XRP", "DOGE"]
    bitcoin = markets[0]
    assert bitcoin["id"] == "BTCUSDT"
    assert bitcoin["tickSize"] == "0.01000000"
    assert bitcoin["stepSize"] == "0.00001000"


def test_klines_become_second_candles(monkeypatch):
    def fetch(symbol, interval, start, end, seconds, venue="spot"):
        assert symbol == "ETHUSDT"
        assert venue == "spot"
        assert interval == "1h"
        assert seconds == 3600
        now = int(time.time())
        return [
            Candle(time=now - 3_600, open=100, high=110, low=90, close=105, volume=3),
            Candle(time=now - 60, open=105, high=112, low=104, close=108, volume=2),
        ]

    monkeypatch.setattr("app.binance_feed._read_cache", lambda key: None)
    monkeypatch.setattr("app.binance_feed._write_cache", lambda key, candles, source: None)
    monkeypatch.setattr("app.binance_feed._fetch_klines", fetch)
    candles, source = load_binance_series("ETHUSDT", "1h", 1)
    assert source == "binance"
    assert [candle.close for candle in candles] == [105, 108]


def test_hourly_and_coarser_ranges_cover_the_requested_years():
    hour = get_interval("1h")
    four = get_interval("4h")
    day = get_interval("1d")
    minute = get_interval("1m")
    half = get_interval("30m")
    for spec, days in ((hour, 732), (hour, 1464), (four, 2196), (day, 2196)):
        assert _binance_span(spec, days) == days
    assert _binance_span(hour, 2196) == 2196
    assert span_days(hour, 2196) < 2196
    assert _binance_span(minute, 2196) == span_days(minute, 2196) < 2196
    assert _binance_span(half, 2196) == span_days(half, 2196) < 2196
    assert _binance_span(hour, 0) == span_days(hour, 0)
    assert _binance_span(hour, None) == span_days(hour, None)


def test_load_uses_the_wider_hourly_span(monkeypatch):
    captured: dict[str, int] = {}

    def fetch(symbol, interval, start, end, seconds, venue="spot"):
        assert symbol == "BTCUSDT"
        assert venue == "spot"
        captured["span"] = (end - start) // 86_400
        captured["seconds"] = seconds
        now = int(time.time())
        return [Candle(time=now - seconds, open=1, high=1, low=1, close=1, volume=1)]

    monkeypatch.setattr("app.binance_feed._read_cache", lambda key: None)
    monkeypatch.setattr("app.binance_feed._write_cache", lambda key, candles, source: None)
    monkeypatch.setattr("app.binance_feed._fetch_klines", fetch)
    load_binance_series("BTCUSDT", "1h", 2196)
    assert captured["span"] == 2196
    assert captured["seconds"] == 3600
    load_binance_series("BTCUSDT", "1m", 2196)
    assert captured["span"] == span_days(get_interval("1m"), 2196)
    assert captured["span"] < 60


def test_perp_list_keeps_usdt_perpetuals(monkeypatch):
    payload = {
        "symbols": [
            _symbol("BTCUSDT", "BTC", "0.10", "0.001", contract="PERPETUAL"),
            _symbol("ETHUSDT_241227", "ETH", "0.01", "0.001", contract="CURRENT_QUARTER"),
            _symbol("SOLUSDT", "SOL", "0.010", "0.01", contract="PERPETUAL"),
            _symbol("BTCUSD_PERP", "BTC", "0.1", "1", contract="PERPETUAL", quote="USD"),
            _symbol("OLDUSDT", "OLD", "0.01", "1", contract="PERPETUAL", status="BREAK"),
        ]
    }
    monkeypatch.setattr("app.binance_feed._exchange_info", lambda venue="spot": payload)
    markets = list_usdt_markets("perp")
    assert [item["id"] for item in markets] == ["BTCUSDT", "SOLUSDT"]
    assert markets[0]["tickSize"] == "0.10"


def test_exchange_refusal_is_not_rewritten(monkeypatch):
    monkeypatch.setattr("app.binance_feed._read_cache", lambda key: None)
    monkeypatch.setattr(
        "app.binance_feed._fetch_klines",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            DataUnavailable("Service unavailable from a restricted location.")
        ),
    )
    try:
        load_binance_series("ETHFIUSDT", "1d", 5, venue="perp")
    except DataUnavailable as exc:
        assert "restricted location" in str(exc)
        assert "Try again" not in str(exc)
    else:
        raise AssertionError("a refused candle request should surface the exchange message")


def test_kline_url_follows_the_venue():
    assert _kline_url("spot").endswith("/api/v3/klines")
    assert _kline_url("perp").endswith("/fapi/v1/klines")
    assert "fapi.binance.com" in _kline_url("perp")


def test_funding_history_is_kept_and_a_failure_does_not_invent_zero(monkeypatch):
    def page(symbol, start_ms, end_ms):
        assert symbol == "BTCUSDT"
        return [
            {"symbol": symbol, "fundingRate": "0.00010000", "fundingTime": start_ms + 1_000, "markPrice": "100.5"}
        ]

    monkeypatch.setattr("app.binance_feed._read_funding_cache", lambda key: None)
    monkeypatch.setattr("app.binance_feed._write_funding_cache", lambda key, rates: None)
    monkeypatch.setattr("app.binance_feed._funding_page", page)
    rates, stale = load_funding("BTCUSDT", 1_700_000_000, 1_700_086_400)
    assert stale is False
    assert rates == [{"t": 1_700_000_001, "rate": 0.0001, "mark": 100.5}]

    def down(symbol, start_ms, end_ms):
        raise DataUnavailable("down")

    monkeypatch.setattr("app.binance_feed._funding_page", down)
    try:
        load_funding("ETHUSDT", 1_700_000_000, 1_700_086_400)
    except DataUnavailable as exc:
        assert str(exc) == "down"
    else:
        raise AssertionError("missing funding should not come back as an empty rate")

    monkeypatch.setattr(
        "app.binance_feed._read_funding_cache",
        lambda key: ([{"t": 1_700_000_000, "rate": -0.0002}], time.time() - 40 * 60),
    )
    cached, stale_cache = load_funding("ETHUSDT", 1_700_000_000, 1_700_086_400)
    assert stale_cache is True
    assert cached == [{"t": 1_700_000_000, "rate": -0.0002}]


def test_premium_keeps_the_rate_and_a_failure_does_not_invent_zero(monkeypatch):
    def fetch(symbol):
        assert symbol == "BTCUSDT"
        return {"symbol": symbol, "rate": 0.0001, "nextFundingTime": 1_700_000_000_000}

    monkeypatch.setattr("app.binance_feed._read_premium_cache", lambda key: None)
    monkeypatch.setattr("app.binance_feed._write_premium_cache", lambda key, quote: None)
    monkeypatch.setattr("app.binance_feed._fetch_premium", fetch)
    quote, stale = load_premium("BTCUSDT")
    assert stale is False
    assert quote == {"symbol": "BTCUSDT", "rate": 0.0001, "nextFundingTime": 1_700_000_000_000}

    def down(symbol):
        raise DataUnavailable("Service unavailable from a restricted location.")

    monkeypatch.setattr("app.binance_feed._fetch_premium", down)
    try:
        load_premium("ETHUSDT")
    except DataUnavailable as exc:
        assert "restricted location" in str(exc)
    else:
        raise AssertionError("a missing premium must not come back as a zero rate")

    monkeypatch.setattr(
        "app.binance_feed._read_premium_cache",
        lambda key: ({"symbol": "ETHUSDT", "rate": -0.0003, "nextFundingTime": 1_700_008_000_000}, time.time() - 120),
    )
    cached, stale_cache = load_premium("ETHUSDT")
    assert stale_cache is True
    assert cached["rate"] == -0.0003

    response = TestClient(app).get("/api/premium", params={"symbol": "ETHUSDT"})
    assert response.status_code == 200
    assert response.json()["stale"] is True
    assert response.json()["rate"] == -0.0003


def test_candles_route_loads_perp_funding_without_inventing_it(monkeypatch):
    now = int(time.time())

    def spot_kline(*args, **kwargs):
        raise AssertionError("a perp slot must not plot a spot kline")

    monkeypatch.setattr("app.main.load_binance_series", spot_kline)
    monkeypatch.setattr("app.main.load_binance_tail", spot_kline)
    monkeypatch.setattr(
        "app.main.load_kraken_perp_series",
        lambda symbol, interval, days=None: (
            [Candle(time=now - 3_600, open=1, high=2, low=1, close=1.5, volume=4)],
            "kraken-perp",
        ),
    )
    monkeypatch.setattr(
        "app.main.load_kraken_funding",
        lambda symbol, start, end: (_ for _ in ()).throw(DataUnavailable("kraken down")),
    )
    response = TestClient(app).get("/api/candles", params={"symbol": "BTCUSDT", "interval": "1h", "days": 1, "venue": "perp"})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "kraken-perp"
    assert body["candles"][0]["close"] == 1.5
    assert body["funding"] is None
    assert body["funding_stale"] is True


def test_candles_route_loads_binance_usdt_pairs(monkeypatch):
    now = int(time.time())

    def load(symbol, interval, days=None, venue="spot"):
        assert symbol == "SOLUSDT"
        assert interval == "5m"
        assert days == 1
        assert venue == "spot"
        return ([Candle(time=now - 60, open=1, high=2, low=1, close=1.5, volume=4)], "binance")

    monkeypatch.setattr("app.main.load_binance_series", load)
    response = TestClient(app).get("/api/candles", params={"symbol": "SOLUSDT", "interval": "5m", "days": 1})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "binance"
    assert body["interval"] == "5m"
    assert body["seconds"] == 300
    assert body["candles"][0]["close"] == 1.5


def _symbol(
    symbol: str,
    base: str,
    tick: str,
    step: str,
    quote: str = "USDT",
    status: str = "TRADING",
    contract: str | None = None,
) -> dict:
    row = {
        "symbol": symbol,
        "status": status,
        "baseAsset": base,
        "quoteAsset": quote,
        "isSpotTradingAllowed": True,
        "filters": [
            {"filterType": "PRICE_FILTER", "tickSize": tick},
            {"filterType": "LOT_SIZE", "stepSize": step},
        ],
    }
    if contract:
        row["contractType"] = contract
        row["marginAsset"] = "USDT"
    return row
