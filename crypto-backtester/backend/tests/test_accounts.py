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
    assert seen.json()["desk"]["journal"][0]["note"] == "from the first device"
    assert seen.json()["desk"]["favourites"] == ["SOLUSDT"]
    assert seen.json()["desk"]["workspace"]["slots"][0]["symbol"] == "BTCUSDT"

    assert first.delete("/api/accounts/session", headers={"Authorization": f"Bearer {body['token']}"}).status_code == 200
    closed = first.get("/api/accounts/desk", headers={"Authorization": f"Bearer {body['token']}"})
    assert closed.status_code == 401
    still = second.get("/api/accounts/desk", headers={"Authorization": f"Bearer {other['token']}"})
    assert still.status_code == 200
