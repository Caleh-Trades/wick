import time

from fastapi.testclient import TestClient

from app.binance_feed import is_binance_symbol, list_usdt_markets, load_binance_series
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
    monkeypatch.setattr("app.binance_feed._exchange_info", lambda: payload)
    markets = list_usdt_markets()
    assert [item["base"] for item in markets] == ["BTC", "ETH", "SOL", "XRP", "DOGE"]
    bitcoin = markets[0]
    assert bitcoin["id"] == "BTCUSDT"
    assert bitcoin["tickSize"] == "0.01000000"
    assert bitcoin["stepSize"] == "0.00001000"


def test_klines_become_second_candles(monkeypatch):
    def fetch(symbol, interval, start, end, seconds):
        assert symbol == "ETHUSDT"
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


def test_candles_route_loads_binance_usdt_pairs(monkeypatch):
    now = int(time.time())

    def load(symbol, interval, days=None):
        assert symbol == "SOLUSDT"
        assert interval == "5m"
        assert days == 1
        return ([Candle(time=now - 60, open=1, high=2, low=1, close=1.5, volume=4)], "binance")

    monkeypatch.setattr("app.main.load_binance_series", load)
    response = TestClient(app).get("/api/candles", params={"symbol": "SOLUSDT", "interval": "5m", "days": 1})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "binance"
    assert body["interval"] == "5m"
    assert body["seconds"] == 300
    assert body["candles"][0]["close"] == 1.5


def _symbol(symbol: str, base: str, tick: str, step: str, quote: str = "USDT", status: str = "TRADING") -> dict:
    return {
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
