from fastapi.testclient import TestClient

from app.main import app


def test_bot_key_edits_the_desk(monkeypatch, tmp_path):
    monkeypatch.setenv("WICK_BOT_STORE", str(tmp_path / "bot.json"))
    client = TestClient(app)
    created = client.post("/api/bot/keys", json={"name": "Research bot"})
    assert created.status_code == 200
    secret = created.json()["secret"]
    assert secret.startswith("wick_")
    listed = client.get("/api/bot/keys").json()["keys"]
    assert listed[0]["name"] == "Research bot"
    assert listed[0]["prefix"] == secret[:12]
    assert "secret" not in listed[0]
    assert "hash" not in listed[0]

    denied = client.post("/api/bot/edit", json={"ops": [{"op": "patch-run", "riskPct": 25}]})
    assert denied.status_code == 401
    unknown = client.post(
        "/api/bot/edit",
        headers={"Authorization": f"Bearer {secret}"},
        json={"ops": [{"op": "rewrite-app"}]},
    )
    assert unknown.status_code == 400

    accepted = client.post(
        "/api/bot/edit",
        headers={"Authorization": f"Bearer {secret}"},
        json={"ops": [{"op": "patch-run", "riskPct": 25}]},
    )
    assert accepted.status_code == 200
    inbox = client.get("/api/bot/inbox").json()["edits"]
    assert inbox[0]["ops"] == [{"op": "patch-run", "riskPct": 25}]
    assert client.post("/api/bot/inbox/ack", json={"ids": [inbox[0]["id"]]}).status_code == 200
    assert client.get("/api/bot/inbox").json()["edits"] == []

    assert client.delete(f"/api/bot/keys/{created.json()['id']}").status_code == 200
    revoked = client.post(
        "/api/bot/edit",
        headers={"Authorization": f"Bearer {secret}"},
        json={"ops": [{"op": "unpin"}]},
    )
    assert revoked.status_code == 401
