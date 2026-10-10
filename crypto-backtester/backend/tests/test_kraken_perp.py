import time

from fastapi.testclient import TestClient

from app.data import DataUnavailable
from app.engine import Candle
from app.kraken_perp import _load_window, list_kraken_perp_markets, load_kraken_funding
from app.main import app


def test_market_list_keeps_usd_perpetuals_and_skips_other_listings(monkeypatch):
    payload = {
        "instruments": [
            _instrument("PF_XBTUSD", "BTC", 1, 4),
            _instrument("PF_ETHFIUSD", "ETHFI", 0.0001, 1),
            _instrument("PF_AAPLXUSD", "AAPLX", 0.01, 2, category="Equities"),
            _instrument("PF_EURUSD", "EUR", 0.0001, 0, tradfi=True, category="Forex"),
            _instrument("PI_XBTUSD", "BTC", 0.5, 0, kind="futures_inverse"),
            _instrument("PF_SOLUSD", "SOL", 0.01, 2),
        ]
    }
    monkeypatch.setattr("app.kraken_perp._instrument_cache", None)
    monkeypatch.setattr("app.kraken_perp._get_json", lambda url, params=None: payload if "instruments" in url else {"tickers": []})
    markets = list_kraken_perp_markets()
    assert [item["id"] for item in markets] == ["BTCUSDT", "SOLUSDT", "ETHFIUSDT"]
    bitcoin = next(item for item in markets if item["id"] == "BTCUSDT")
    assert bitcoin["tickSize"] == "1"
    assert bitcoin["stepSize"] == "0.0001"
    assert bitcoin["name"] == "Bitcoin"


def test_candles_page_forward_and_three_minute_bars_are_bundled(monkeypatch):
    monkeypatch.setattr("app.kraken_perp._read_cache", lambda key: None)
    monkeypatch.setattr("app.kraken_perp._write_cache", lambda key, candles, source: None)
    monkeypatch.setattr("app.kraken_perp._kraken_symbol", lambda symbol: "PF_XBTUSD")
    calls: list[dict] = []

    def page(url, params=None):
        assert "PF_XBTUSD/1m" in url
        calls.append(dict(params or {}))
        if len(calls) == 1:
            return {
                "candles": [
                    _candle(0, "10"),
                    _candle(60_000, "11"),
                    _candle(120_000, "12"),
                ],
                "more_candles": True,
            }
        return {"candles": [_candle(180_000, "13")], "more_candles": False}

    monkeypatch.setattr("app.kraken_perp._get_json", page)
    candles = _load_window("BTCUSDT", "3m", 0, 400)
    assert len(calls) == 2
    assert calls[1]["from"] == 180
    assert [(candle.time, candle.close, candle.volume) for candle in candles] == [(0, 12.0, 3.0), (180, 13.0, 1.0)]


def test_funding_uses_the_relative_rate_and_flags_a_late_history(monkeypatch):
    monkeypatch.setattr("app.kraken_perp._read_funding_cache", lambda key: None)
    monkeypatch.setattr("app.kraken_perp._write_funding_cache", lambda key, rates: None)
    monkeypatch.setattr("app.kraken_perp._kraken_symbol", lambda symbol: "PF_ETHUSD")
    monkeypatch.setattr(
        "app.kraken_perp._get_json",
        lambda url, params=None: {
            "rates": [
                {
                    "timestamp": "2026-01-01T00:00:00Z",
                    "fundingRate": 1.5,
                    "relativeFundingRate": 0.00002,
                },
                {"timestamp": "2026-01-01T01:00:00Z", "fundingRate": -0.4, "relativeFundingRate": -0.00001},
            ]
        },
    )
    start = int(time.mktime(time.gmtime(0)))  # unused; real stamps below
    del start
    rates, stale = load_kraken_funding("ETHUSDT", 1_700_000_000, 1_800_000_000)
    assert stale is True
    assert rates == [
        {"t": 1_767_225_600, "rate": 0.00002},
        {"t": 1_767_229_200, "rate": -0.00001},
    ]
    covered, fresh = load_kraken_funding("ETHUSDT", 1_767_225_600, 1_767_229_200)
    assert fresh is False
    assert covered[0]["rate"] == 0.00002

    def empty(url, params=None):
        return {"rates": []}

    monkeypatch.setattr("app.kraken_perp._get_json", empty)
    try:
        load_kraken_funding("ETHUSDT", 1_700_000_000, 1_800_000_000)
    except DataUnavailable as exc:
        assert "no funding history" in str(exc)
    else:
        raise AssertionError("missing funding should not come back as an empty rate")


def test_perp_routes_use_kraken(monkeypatch):
    now = int(time.time())

    def spot_kline(*args, **kwargs):
        raise AssertionError("a perp slot must not plot a spot or Binance kline")

    monkeypatch.setattr("app.main.load_binance_series", spot_kline)
    monkeypatch.setattr("app.main.load_binance_tail", spot_kline)
    monkeypatch.setattr("app.main.load_funding", spot_kline)
    monkeypatch.setattr("app.main.list_usdt_markets", spot_kline)
    monkeypatch.setattr(
        "app.main.load_kraken_perp_series",
        lambda symbol, interval, days=None: (
            [Candle(time=now - 86_400, open=10, high=12, low=9, close=11, volume=4)],
            "kraken-perp",
        ),
    )
    monkeypatch.setattr(
        "app.main.load_kraken_funding",
        lambda symbol, start, end: ([{"t": now - 3_600, "rate": 0.000012}], False),
    )
    monkeypatch.setattr(
        "app.main.list_kraken_perp_markets",
        lambda: [{"id": "BTCUSDT", "base": "BTC", "quote": "USDT", "tickSize": "1", "stepSize": "0.0001"}],
    )
    client = TestClient(app)
    candles = client.get("/api/candles", params={"symbol": "BTCUSDT", "interval": "1d", "days": 5, "venue": "perp"})
    assert candles.status_code == 200
    body = candles.json()
    assert body["source"] == "kraken-perp"
    assert body["candles"][0]["close"] == 11
    assert body["funding"] == [{"t": now - 3_600, "rate": 0.000012}]
    assert body["funding_stale"] is False
    markets = client.get("/api/markets", params={"venue": "perp"})
    assert markets.status_code == 200
    assert markets.json()["markets"][0]["id"] == "BTCUSDT"


def test_spot_market_list_does_not_fall_back_to_kraken(monkeypatch):
    def blocked(venue="spot"):
        raise DataUnavailable("spot down")

    monkeypatch.setattr("app.main.list_usdt_markets", blocked)
    response = TestClient(app).get("/api/markets", params={"venue": "spot"})
    assert response.status_code == 503
    assert response.json()["detail"] == "spot down"


def _instrument(
    symbol: str,
    base: str,
    tick: float,
    precision: int,
    category: str = "Layer 1",
    kind: str = "flexible_futures",
    tradfi: bool = False,
) -> dict:
    return {
        "symbol": symbol,
        "type": kind,
        "base": base,
        "quote": "USD",
        "tickSize": tick,
        "contractValueTradePrecision": precision,
        "tradeable": True,
        "isExpired": False,
        "tradfi": tradfi,
        "category": category,
    }


def _candle(time_ms: int, close: str) -> dict:
    return {"time": time_ms, "open": close, "high": close, "low": close, "close": close, "volume": "1"}
