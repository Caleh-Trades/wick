from fastapi.testclient import TestClient

from app.main import app


def test_two_devices_share_one_desk(monkeypatch, tmp_path):
    monkeypatch.setenv("WICK_ACCOUNT_STORE", str(tmp_path / "accounts.json"))
    first = TestClient(app)
    created = first.post(
        "/api/accounts",
        json={
            "name": "Research desk",
            "password": "correct-horse",
            "desk": {
                "workspace": {"v": 2, "slots": [{"id": "slot-1", "symbol": "BTCUSDT"}], "activeId": "slot-1"},
                "journal": [{"id": "row-1", "symbol": "ETHFIUSDT", "kind": "trade"}],
                "kept": [],
                "favourites": ["DOGEUSDT"],
                "panes": {"v": 5, "book": 280, "chart": 0.34},
            },
        },
    )
    assert created.status_code == 200
    body = created.json()
    assert body["account"]["name"] == "Research desk"
    assert body["token"].startswith("acct_")
    assert "password" not in body["account"]
    assert body["revision"] == 1

    taken = first.post("/api/accounts", json={"name": "research desk", "password": "correct-horse"})
    assert taken.status_code == 409

    short = first.post("/api/accounts", json={"name": "Other", "password": "short"})
    assert short.status_code == 400

    wrong = first.post("/api/accounts/login", json={"name": "Research desk", "password": "wrong-password"})
    assert wrong.status_code == 401

    second = TestClient(app)
    signed = second.post("/api/accounts/login", json={"name": "Research desk", "password": "correct-horse"})
    assert signed.status_code == 200
    other = signed.json()
    assert other["token"] != body["token"]
    assert other["account"]["id"] == body["account"]["id"]
    assert other["desk"]["favourites"] == ["DOGEUSDT"]
    assert other["desk"]["journal"][0]["symbol"] == "ETHFIUSDT"
    assert other["desk"]["working"] == []

    saved = second.put(
        "/api/accounts/desk",
        headers={"Authorization": f"Bearer {other['token']}"},
        json={
            "revision": other["revision"],
            "desk": {
                "workspace": other["desk"]["workspace"],
                "journal": other["desk"]["journal"],
                "kept": [{"id": "kept-1", "symbol": "BTCUSDT"}],
                "working": [{"id": "work-1", "name": "ETHFI trend", "rule": "supertrend"}],
                "favourites": ["DOGEUSDT", "SOLUSDT"],
                "panes": other["desk"]["panes"],
            },
        },
    )
    assert saved.status_code == 200
    assert saved.json()["revision"] == 2

    stale = first.put(
        "/api/accounts/desk",
        headers={"Authorization": f"Bearer {body['token']}"},
        json={"revision": 1, "desk": {"journal": [], "kept": [], "favourites": []}},
    )
    assert stale.status_code == 409
    assert stale.json()["revision"] == 2
    assert stale.json()["desk"]["favourites"] == ["DOGEUSDT", "SOLUSDT"]
    assert stale.json()["desk"]["working"][0]["name"] == "ETHFI trend"

    caught_up = first.put(
        "/api/accounts/desk",
        headers={"Authorization": f"Bearer {body['token']}"},
        json={
            "revision": 2,
            "desk": {
                "workspace": stale.json()["desk"]["workspace"],
                "journal": [{"id": "row-2", "note": "from the first device"}],
                "kept": stale.json()["desk"]["kept"],
                "favourites": ["SOLUSDT"],
                "panes": stale.json()["desk"]["panes"],
            },
        },
    )
    assert caught_up.status_code == 200

    seen = second.get("/api/accounts/desk", headers={"Authorization": f"Bearer {other['token']}"})
    assert seen.status_code == 200
    assert seen.json()["revision"] == 3
    assert seen.json()["account"]["id"] == body["account"]["id"]
    assert seen.json()["desk"]["journal"][0]["note"] == "from the first device"
    assert seen.json()["desk"]["favourites"] == ["SOLUSDT"]
    assert seen.json()["desk"]["workspace"]["slots"][0]["symbol"] == "BTCUSDT"

    assert first.delete("/api/accounts/session", headers={"Authorization": f"Bearer {body['token']}"}).status_code == 200
    closed = first.get("/api/accounts/desk", headers={"Authorization": f"Bearer {body['token']}"})
    assert closed.status_code == 401
    still = second.get("/api/accounts/desk", headers={"Authorization": f"Bearer {other['token']}"})
    assert still.status_code == 200


def test_a_run_does_not_keep_its_candles_or_trades(monkeypatch, tmp_path):
    monkeypatch.setenv("WICK_ACCOUNT_STORE", str(tmp_path / "accounts.json"))
    client = TestClient(app)
    created = client.post(
        "/api/accounts",
        json={
            "name": "Tape desk",
            "password": "correct-horse",
            "desk": {
                "strategies": [{"id": "s1", "name": "SMA 20/50", "symbol": "BTCUSDT"}],
                "runs": [
                    {
                        "id": "r1",
                        "strategyId": "s1",
                        "range": "1Y",
                        "metrics": {"total_return_pct": 4.1},
                        "createdAt": "2026-04-01T00:00:00Z",
                        "candles": [{"t": 1, "close": 100}],
                        "trades": [{"pnl": 10}],
                        "equity": [{"equity": 1}],
                    }
                ],
                "trades": [{"id": "t1", "strategyId": "s1", "runId": "r1", "symbol": "BTCUSDT"}],
            },
        },
    )
    assert created.status_code == 200
    run = created.json()["desk"]["runs"][0]
    assert run["strategyId"] == "s1"
    assert "candles" not in run
    assert "trades" not in run
    assert "equity" not in run
    assert created.json()["desk"]["trades"][0]["runId"] == "r1"
    assert created.json()["desk"]["strategies"][0]["name"] == "SMA 20/50"


def test_a_large_trade_book_still_syncs(monkeypatch, tmp_path):
    monkeypatch.setenv("WICK_ACCOUNT_STORE", str(tmp_path / "accounts.json"))
    client = TestClient(app)
    # ~2MB of closed fills used to trip the old 1.5MB desk cap and block every device.
    trades = [
        {
            "id": f"t{index}",
            "strategyId": "s1",
            "runId": "r1",
            "symbol": "BTCUSDT",
            "side": "long",
            "entryTime": f"2026-01-{(index % 28) + 1:02d}T12:00:00Z",
            "entryPrice": 100.0 + index * 0.01,
            "exitTime": f"2026-01-{(index % 28) + 1:02d}T18:00:00Z",
            "exitPrice": 101.0 + index * 0.01,
            "size": 1.25,
            "fee": 0.12,
            "slippage": 0.05,
            "pnl": 1.0,
            "returnPct": 1.0,
            "note": "fee sync " + ("x" * 80),
            "source": "desk",
            "market": "spot",
        }
        for index in range(3500)
    ]
    created = client.post(
        "/api/accounts",
        json={
            "name": "Heavy desk",
            "password": "correct-horse",
            "desk": {
                "strategies": [{"id": "s1", "name": "SMA 20/50", "symbol": "BTCUSDT"}],
                "runs": [{"id": "r1", "strategyId": "s1", "range": "1Y", "createdAt": "2026-04-01T00:00:00Z"}],
                "trades": trades,
            },
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["revision"] == 1
    assert len(body["desk"]["trades"]) == 3500
    assert body["desk"]["trades"][0]["fee"] == 0.12

    second = TestClient(app)
    signed = second.post("/api/accounts/login", json={"name": "Heavy desk", "password": "correct-horse"})
    assert signed.status_code == 200
    assert signed.json()["desk"]["trades"][-1]["fee"] == 0.12


def test_saved_run_and_journal_follow_the_user_id(monkeypatch, tmp_path):
    monkeypatch.setenv("WICK_ACCOUNT_STORE", str(tmp_path / "accounts.json"))
    first = TestClient(app)
    created = first.post(
        "/api/accounts",
        json={
            "name": "Keeper",
            "password": "correct-horse",
            "desk": {
                "strategies": [
                    {
                        "id": "s1",
                        "name": "SMA 20/50",
                        "symbol": "ETHUSDT",
                        "market": "spot",
                        "params": {"fast": 20, "slow": 50},
                    }
                ],
                "runs": [
                    {
                        "id": "r1",
                        "strategyId": "s1",
                        "range": "1Y",
                        "metrics": {"total_return_pct": 4.1, "trades": 2},
                        "note": "kept on the desk",
                        "candles": [{"t": 1, "close": 100}],
                        "equity": [{"equity": 1}],
                        "trades": [{"pnl": 1}],
                    }
                ],
                "trades": [
                    {
                        "id": "fill-1",
                        "strategyId": "s1",
                        "runId": "r1",
                        "symbol": "ETHUSDT",
                        "market": "spot",
                        "pnl": 10,
                    },
                    {
                        "id": "journal-1",
                        "strategyId": "s1",
                        "runId": None,
                        "symbol": "ETHUSDT",
                        "market": "spot",
                        "note": "logged by hand",
                    },
                ],
            },
        },
    )
    assert created.status_code == 200, created.text
    user_id = created.json()["account"]["id"]
    stored = created.json()["desk"]
    run = stored["runs"][0]
    strategy = stored["strategies"][0]
    assert strategy["name"] == "SMA 20/50"
    assert strategy["symbol"] == "ETHUSDT"
    assert strategy["market"] == "spot"
    assert strategy["params"] == {"fast": 20, "slow": 50}
    assert run["metrics"]["total_return_pct"] == 4.1
    assert run["note"] == "kept on the desk"
    assert "candles" not in run
    assert "equity" not in run
    assert "trades" not in run
    assert {row["id"] for row in stored["trades"]} == {"fill-1", "journal-1"}

    second = TestClient(app)
    signed = second.post("/api/accounts/login", json={"name": "Keeper", "password": "correct-horse"})
    assert signed.status_code == 200
    assert signed.json()["account"]["id"] == user_id
    loaded = signed.json()["desk"]
    assert loaded["runs"][0]["note"] == "kept on the desk"
    assert loaded["strategies"][0]["symbol"] == "ETHUSDT"
    assert {row["id"] for row in loaded["trades"]} == {"fill-1", "journal-1"}
    assert "candles" not in loaded["runs"][0]

    saved = second.put(
        "/api/accounts/desk",
        headers={"Authorization": f"Bearer {signed.json()['token']}"},
        json={
            "revision": signed.json()["revision"],
            "desk": {
                "strategies": loaded["strategies"],
                "runs": [
                    *loaded["runs"],
                    {
                        "id": "r2",
                        "strategyId": "s1",
                        "metrics": {"total_return_pct": 1.2},
                        "note": "kept from the other browser",
                        "candles": [{"t": 2, "close": 50}],
                    },
                ],
                "trades": [
                    *loaded["trades"],
                    {
                        "id": "journal-2",
                        "strategyId": "s1",
                        "runId": None,
                        "symbol": "SOLUSDT",
                        "market": "perp",
                        "note": "logged on the other browser",
                    },
                ],
            },
        },
    )
    assert saved.status_code == 200

    refreshed = first.get("/api/accounts/desk", headers={"Authorization": f"Bearer {created.json()['token']}"})
    assert refreshed.status_code == 200
    assert refreshed.json()["account"]["id"] == user_id
    notes = {row["note"] for row in refreshed.json()["desk"]["runs"]}
    assert "kept on the desk" in notes
    assert "kept from the other browser" in notes
    assert "candles" not in refreshed.json()["desk"]["runs"][1]
    journal = {row["id"]: row for row in refreshed.json()["desk"]["trades"]}
    assert journal["journal-2"]["note"] == "logged on the other browser"
    assert journal["journal-2"]["market"] == "perp"
    assert journal["fill-1"]["runId"] == "r1"
