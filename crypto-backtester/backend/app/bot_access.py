"""API keys that let a bot change the open desk."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path

MAX_KEYS = 8
MAX_OPS = 20
MAX_QUEUE = 40
KNOWN_OPS = {"focus", "pin", "unpin", "set-slot", "patch-run", "select-run", "add-run", "remove-run", "log-trade"}

_LOCK = threading.Lock()


def _path() -> Path:
    override = os.environ.get("WICK_BOT_STORE")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / "data" / "bot_access.json"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _empty() -> dict:
    return {"keys": [], "edits": []}


def _load() -> dict:
    path = _path()
    if not path.exists():
        return _empty()
    try:
        parsed = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return _empty()
    if not isinstance(parsed, dict):
        return _empty()
    keys = parsed.get("keys")
    edits = parsed.get("edits")
    return {
        "keys": keys if isinstance(keys, list) else [],
        "edits": edits if isinstance(edits, list) else [],
    }


def _save(store: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store, indent=2))


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def list_keys() -> list[dict]:
    with _LOCK:
        store = _load()
    return [_public(item) for item in store["keys"] if isinstance(item, dict)]


def create_key(name: str) -> dict:
    cleaned = " ".join(name.split())
    if not cleaned or len(cleaned) > 40:
        raise ValueError("Name the key with 1 to 40 characters.")
    secret = f"wick_{secrets.token_urlsafe(24)}"
    record = {
        "id": secrets.token_hex(8),
        "name": cleaned,
        "prefix": secret[:12],
        "hash": _hash(secret),
        "created": _now(),
        "last_used": None,
    }
    with _LOCK:
        store = _load()
        if len(store["keys"]) >= MAX_KEYS:
            raise ValueError(f"This desk already has {MAX_KEYS} keys. Revoke one first.")
        store["keys"].append(record)
        _save(store)
    return {**_public(record), "secret": secret}


def revoke_key(key_id: str) -> bool:
    with _LOCK:
        store = _load()
        kept = [item for item in store["keys"] if not (isinstance(item, dict) and item.get("id") == key_id)]
        if len(kept) == len(store["keys"]):
            return False
        store["keys"] = kept
        _save(store)
    return True


def authorize(secret: str) -> dict | None:
    digest = _hash(secret)
    with _LOCK:
        store = _load()
        for item in store["keys"]:
            if isinstance(item, dict) and hmac.compare_digest(str(item.get("hash", "")), digest):
                item["last_used"] = _now()
                _save(store)
                return _public(item)
    return None


def check_ops(ops: object) -> list[dict]:
    if not isinstance(ops, list) or not ops:
        raise ValueError("Send at least one edit.")
    if len(ops) > MAX_OPS:
        raise ValueError(f"Send at most {MAX_OPS} edits at once.")
    cleaned: list[dict] = []
    for item in ops:
        if not isinstance(item, dict) or not isinstance(item.get("op"), str):
            raise ValueError("Each edit needs an op.")
        op = item["op"]
        if op not in KNOWN_OPS:
            raise ValueError(f"Unknown edit: {op}.")
        if op == "log-trade":
            _require_log(item)
        cleaned.append({key: value for key, value in item.items() if _allowed_value(value)})
    return cleaned


def enqueue(key_id: str, ops: list[dict]) -> dict:
    edit = {"id": secrets.token_hex(8), "at": _now(), "key_id": key_id, "ops": ops}
    with _LOCK:
        store = _load()
        store["edits"].append(edit)
        store["edits"] = store["edits"][-MAX_QUEUE:]
        _save(store)
    return {"id": edit["id"], "at": edit["at"]}


def pending() -> list[dict]:
    with _LOCK:
        store = _load()
    return [
        {"id": item.get("id"), "at": item.get("at"), "ops": item.get("ops")}
        for item in store["edits"]
        if isinstance(item, dict)
    ]


def acknowledge(ids: list[str]) -> None:
    dropping = set(ids)
    with _LOCK:
        store = _load()
        store["edits"] = [item for item in store["edits"] if not (isinstance(item, dict) and item.get("id") in dropping)]
        _save(store)


def _require_log(item: dict) -> None:
    side = str(item.get("side", "")).lower()
    if side not in {"buy", "sell", "long", "short"}:
        raise ValueError("log-trade side is buy or sell.")
    symbol = item.get("symbol")
    if not isinstance(symbol, str) or not symbol.strip():
        raise ValueError("log-trade needs a symbol.")
    for key in ("price", "size"):
        try:
            number = float(item[key])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"log-trade needs a {key}.") from exc
        if not number > 0:
            raise ValueError(f"log-trade {key} has to be above zero.")
    exit_price = item.get("exitPrice", item.get("exit"))
    if exit_price not in (None, ""):
        try:
            number = float(exit_price)
        except (TypeError, ValueError) as exc:
            raise ValueError("log-trade exit has to be a price.") from exc
        if not number > 0:
            raise ValueError("log-trade exit has to be above zero.")
    strategy = item.get("strategy")
    if strategy is not None and not isinstance(strategy, str):
        raise ValueError("log-trade strategy has to be text.")
    if isinstance(strategy, str) and len(strategy) > 48:
        raise ValueError("log-trade strategy is too long.")
    venue = item.get("venue")
    if venue is not None and venue not in {"spot", "perp"}:
        raise ValueError("log-trade venue is spot or perp.")


def _public(record: dict) -> dict:
    return {
        "id": record.get("id"),
        "name": record.get("name"),
        "prefix": record.get("prefix"),
        "created": record.get("created"),
        "last_used": record.get("last_used"),
    }


def _allowed_value(value: object) -> bool:
    if value is None or isinstance(value, (str, int, float, bool)):
        return isinstance(value, bool) or not isinstance(value, float) or value == value
    if isinstance(value, list):
        return all(isinstance(item, dict) and all(_allowed_value(nested) for nested in item.values()) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and _allowed_value(nested) for key, nested in value.items())
    return False
