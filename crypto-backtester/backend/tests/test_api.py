from fastapi.testclient import TestClient

from app.engine import Candle
from app.main import app


def _candles() -> list[Candle]:
    prices = [100, 100, 101, 102, 104, 103, 106, 110, 108, 112]
    return [
        Candle(
            time=1_700_000_000 + index * 86_400,
            open=price,
            high=price + 1,
            low=price - 1,
            close=price,
            volume=10,
        )
        for index, price in enumerate(prices)
    ]


def test_health_and_meta():
    client = TestClient(app)
    assert client.get("/api/health").json()["status"] == "ok"
    meta = client.get("/api/meta").json()
    ids = [item["id"] for item in meta["strategies"]]
    assert "sma_cross" in ids
    assert "buy_hold" in ids
    assert any(item["id"] == "BTC-USD" for item in meta["symbols"])


def test_backtest_route_uses_the_loaded_series(monkeypatch):
    monkeypatch.setattr("app.main.load_series", lambda symbol, interval: (_candles(), "fixture"))
    client = TestClient(app)
    response = client.post(
        "/api/backtest",
        json={
            "symbol": "BTC-USD",
            "interval": "1d",
            "strategy": "buy_hold",
            "initial_capital": 10_000,
            "fee_bps": 0,
            "slippage_bps": 0,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "fixture"
    assert body["metrics"]["final_equity"] > 10_000
    assert body["equity"]
    assert body["candles"]


def test_bad_dates_are_rejected(monkeypatch):
    monkeypatch.setattr("app.main.load_series", lambda symbol, interval: (_candles(), "fixture"))
    client = TestClient(app)
    backwards = client.post(
        "/api/backtest",
        json={"start": "2024-05-01", "end": "2024-01-01", "strategy": "buy_hold"},
    )
    assert backwards.status_code == 400
    assert "start date" in backwards.json()["detail"]


def test_candles_route_serves_a_tape_and_a_live_tail(monkeypatch):
    monkeypatch.setattr("app.main.load_series", lambda symbol, interval: (_candles(), "coinbase"))

    def tail(symbol, interval, since):
        assert symbol == "ETH-USD"
        assert interval == "5m"
        assert since == 100
        return (_candles()[-2:], "coinbase")

    monkeypatch.setattr("app.main.load_tail", tail)
    client = TestClient(app)
    full = client.get("/api/candles", params={"symbol": "BTC-USD", "interval": "1m"})
    assert full.status_code == 200
    body = full.json()
    assert body["source"] == "coinbase"
    assert body["seconds"] == 60
    assert body["candles"][0]["t"] > 0
    assert "close" in body["candles"][0]

    live = client.get("/api/candles", params={"symbol": "ETH-USD", "interval": "5m", "since": 100})
    assert live.status_code == 200
    assert len(live.json()["candles"]) == 2

    missing = client.get("/api/candles", params={"symbol": "BTC-USD", "interval": "15m"})
    assert missing.status_code == 400
    assert "Interval" in missing.json()["detail"]


def test_candles_days_query_reaches_the_loader(monkeypatch):
    def load(symbol, interval, days=None):
        assert symbol == "BTC-USD"
        assert interval == "5m"
        assert days == 31
        return (_candles(), "coinbase")

    monkeypatch.setattr("app.main.load_series", load)
    client = TestClient(app)
    response = client.get("/api/candles", params={"symbol": "BTC-USD", "interval": "5m", "days": 31})
    assert response.status_code == 200
    assert response.json()["candles"][0]["volume"] == 10


def test_unknown_markets_are_rejected():
    client = TestClient(app)
    missing = client.post("/api/backtest", json={"symbol": "NOPE-USD", "strategy": "buy_hold"})
    assert missing.status_code == 400
    assert "Unknown market" in missing.json()["detail"]
