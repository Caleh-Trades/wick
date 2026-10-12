"""Named accounts. A password opens the same desk on every device."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

MAX_ACCOUNTS = 200
# Kept-run fills and journal rows share one trades list. A busy desk clears 1.5MB fast.
MAX_DESK_BYTES = 8_000_000
MAX_TRADES = 8_000
PBKDF2_ROUNDS = 120_000
SESSION_DAYS = 30
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{1,31}$")

_LOCK = threading.Lock()


class AccountError(ValueError):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


class DeskConflict(AccountError):
    def __init__(self, revision: int, desk: dict) -> None:
        super().__init__("Saved on another device.", 409)
        self.revision = revision
        self.desk = desk


def _path() -> Path:
    override = os.environ.get("WICK_ACCOUNT_STORE")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / "data" / "accounts.json"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp(moment: datetime | None = None) -> str:
    return (moment or _now()).strftime("%Y-%m-%dT%H:%M:%SZ")


def _empty() -> dict:
    return {"accounts": [], "sessions": []}


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
    accounts = parsed.get("accounts")
    sessions = parsed.get("sessions")
    return {
        "accounts": accounts if isinstance(accounts, list) else [],
        "sessions": sessions if isinstance(sessions, list) else [],
    }


def _save(store: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store))


def _hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    raw_salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), raw_salt, PBKDF2_ROUNDS)
    return raw_salt.hex(), digest.hex()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _clean_name(name: object) -> str:
    if not isinstance(name, str):
        raise AccountError("Name the account with 2 to 32 characters.")
    cleaned = " ".join(name.split())
    if not NAME_RE.fullmatch(cleaned):
        raise AccountError("Use 2 to 32 letters, numbers, spaces, dots, or hyphens.")
    return cleaned


def _clean_password(password: object) -> str:
    if not isinstance(password, str) or len(password) < 8 or len(password) > 72:
        raise AccountError("Use a password of 8 to 72 characters.")
    return password


_RUN_DROP = {"trades", "candles", "equity", "walkForward", "walk_forward", "inSample", "holdout", "in_sample"}
_WORKSPACE_DROP = {"candles", "equity", "trades", "tape", "tapes"}


def _blank_desk() -> dict:
    return {
        "workspace": None,
        "journal": [],
        "kept": [],
        "working": [],
        "strategies": [],
        "runs": [],
        "trades": [],
        "tickets": [],
        "favourites": [],
        "panes": None,
    }


def _record_list(raw: dict, key: str, limit: int) -> list:
    value = raw.get(key, [])
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise AccountError("Strategies, runs, and trades have to be lists of records.")
    if key == "runs":
        return [{field: item[field] for field in item if field not in _RUN_DROP} for item in value[:limit]]
    return list(value[:limit])


def _desk_bytes(desk: dict) -> int:
    return len(json.dumps(desk, separators=(",", ":")))


def _slim_workspace(workspace: object) -> object:
    """Drop tape/candle blobs if a client stuffed them into the workspace JSON."""
    if not isinstance(workspace, dict):
        return workspace
    return {key: value for key, value in workspace.items() if key not in _WORKSPACE_DROP}


def _trade_open(trade: dict) -> bool:
    exit_price = trade.get("exitPrice")
    return exit_price is None or exit_price == ""


def _trade_stamp(trade: dict) -> str:
    for key in ("entryTime", "exitTime", "createdAt", "updatedAt"):
        value = trade.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _fit_trades(trades: list[dict], budget: int, base: dict) -> list[dict]:
    """Keep open rows and the newest closed rows until the desk fits the byte budget."""
    if _desk_bytes({**base, "trades": trades}) <= budget:
        return trades
    open_rows = [trade for trade in trades if _trade_open(trade)]
    closed_rows = sorted(
        (trade for trade in trades if not _trade_open(trade)),
        key=_trade_stamp,
        reverse=True,
    )
    lo, hi = 0, len(closed_rows)
    best = list(open_rows)
    while lo <= hi:
        mid = (lo + hi) // 2
        trial = open_rows + closed_rows[:mid]
        if _desk_bytes({**base, "trades": trial}) <= budget:
            best = trial
            lo = mid + 1
        else:
            hi = mid - 1
    if _desk_bytes({**base, "trades": best}) <= budget:
        return best
    # Last resort: drop oldest open rows too so sync never hard-fails on size.
    kept = sorted(best, key=_trade_stamp, reverse=True)
    lo, hi = 0, len(kept)
    fit: list[dict] = []
    while lo <= hi:
        mid = (lo + hi) // 2
        trial = kept[:mid]
        if _desk_bytes({**base, "trades": trial}) <= budget:
            fit = trial
            lo = mid + 1
        else:
            hi = mid - 1
    return fit


def clean_desk(raw: object) -> dict:
    if raw is None:
        return _blank_desk()
    if not isinstance(raw, dict):
        raise AccountError("Desk data has to be an object.")
    workspace = _slim_workspace(raw.get("workspace"))
    journal = raw.get("journal", [])
    kept = raw.get("kept", [])
    working = raw.get("working", [])
    favourites = raw.get("favourites", [])
    panes = raw.get("panes")
    if workspace is not None and not isinstance(workspace, dict):
        raise AccountError("The workspace is not valid.")
    if not isinstance(journal, list) or not isinstance(kept, list) or not isinstance(working, list) or not isinstance(favourites, list):
        raise AccountError("Journal, kept runs, working strategies, and favourites have to be lists.")
    if any(not isinstance(item, dict) for item in journal) or any(not isinstance(item, dict) for item in kept) or any(not isinstance(item, dict) for item in working):
        raise AccountError("A journal row has to be an object.")
    if panes is not None and not isinstance(panes, dict):
        raise AccountError("Pane sizes are not valid.")
    if not all(isinstance(item, str) and len(item) <= 32 for item in favourites):
        raise AccountError("A favourite has to be a symbol.")
    trades = _record_list(raw, "trades", MAX_TRADES)
    desk = {
        "workspace": workspace,
        "journal": journal[:400],
        "kept": [{field: item[field] for field in item if field not in _RUN_DROP} for item in kept[:80]],
        "working": working[:40],
        "strategies": _record_list(raw, "strategies", 400),
        "runs": _record_list(raw, "runs", 400),
        "trades": trades,
        "tickets": _record_list(raw, "tickets", 400),
        "favourites": [item.strip() for item in favourites[:40] if item.strip()],
        "panes": panes,
    }
    if _desk_bytes(desk) > MAX_DESK_BYTES:
        without_trades = {**desk, "trades": []}
        desk["trades"] = _fit_trades(trades, MAX_DESK_BYTES, without_trades)
    if _desk_bytes(desk) > MAX_DESK_BYTES:
        # Drop oldest kept-run metadata before giving up. Journal open state stays in trades.
        runs = list(desk["runs"])
        while runs and _desk_bytes({**desk, "runs": runs}) > MAX_DESK_BYTES:
            runs.pop(0)
        desk["runs"] = runs
        strategies = list(desk["strategies"])
        while strategies and _desk_bytes({**desk, "strategies": strategies}) > MAX_DESK_BYTES:
            strategies.pop(0)
        desk["strategies"] = strategies
    if _desk_bytes(desk) > MAX_DESK_BYTES:
        raise AccountError("That desk is too large to store. Remove kept runs or archive old trades, then try again.")
    return desk


def _public(account: dict) -> dict:
    return {"id": account["id"], "name": account["name"]}


def _find_name(store: dict, name: str) -> dict | None:
    key = name.casefold()
    for account in store["accounts"]:
        if isinstance(account, dict) and str(account.get("name", "")).casefold() == key:
            return account
    return None


def _find_id(store: dict, account_id: str) -> dict | None:
    for account in store["accounts"]:
        if isinstance(account, dict) and account.get("id") == account_id:
            return account
    return None


def _drop_expired(store: dict) -> None:
    now = _stamp()
    store["sessions"] = [
        item
        for item in store["sessions"]
        if isinstance(item, dict) and isinstance(item.get("expires"), str) and item["expires"] > now
    ]


def _open_session(store: dict, account: dict) -> str:
    token = f"acct_{secrets.token_urlsafe(32)}"
    expires = _now() + timedelta(days=SESSION_DAYS)
    store["sessions"].append(
        {"hash": _token_hash(token), "account_id": account["id"], "expires": _stamp(expires)}
    )
    return token


def _password_matches(account: dict, password: str) -> bool:
    try:
        salt = bytes.fromhex(str(account.get("salt", "")))
        expect = str(account.get("password", ""))
    except ValueError:
        return False
    if not salt or not expect:
        return False
    _, digest = _hash_password(password, salt)
    return hmac.compare_digest(digest, expect)


def _issue(account: dict, store: dict) -> dict:
    token = _open_session(store, account)
    desk = account.get("desk") if isinstance(account.get("desk"), dict) else _blank_desk()
    return {
        "token": token,
        "account": _public(account),
        "revision": int(account.get("revision") or 0),
        "desk": desk,
    }


def create_account(name: object, password: object, desk: object) -> dict:
    cleaned = _clean_name(name)
    secret = _clean_password(password)
    stored = clean_desk(desk)
    salt, digest = _hash_password(secret)
    record = {
        "id": secrets.token_hex(8),
        "name": cleaned,
        "salt": salt,
        "password": digest,
        "created": _stamp(),
        "revision": 1,
        "desk": stored,
    }
    with _LOCK:
        store = _load()
        _drop_expired(store)
        if _find_name(store, cleaned):
            raise AccountError("That name is already an account. Sign in instead.", 409)
        if len(store["accounts"]) >= MAX_ACCOUNTS:
            raise AccountError("This server is not taking new accounts.")
        store["accounts"].append(record)
        issued = _issue(record, store)
        _save(store)
    return issued


def login_account(name: object, password: object) -> dict:
    cleaned = _clean_name(name)
    secret = _clean_password(password)
    with _LOCK:
        store = _load()
        _drop_expired(store)
        account = _find_name(store, cleaned)
        if account is None or not _password_matches(account, secret):
            raise AccountError("That name and password do not match.", 401)
        issued = _issue(account, store)
        _save(store)
    return issued


def account_from_token(token: str) -> dict | None:
    if not token:
        return None
    digest = _token_hash(token)
    with _LOCK:
        store = _load()
        _drop_expired(store)
        session = next(
            (
                item
                for item in store["sessions"]
                if isinstance(item, dict) and hmac.compare_digest(str(item.get("hash", "")), digest)
            ),
            None,
        )
        if session is None:
            return None
        account = _find_id(store, str(session.get("account_id")))
        if account is None:
            return None
        desk = account.get("desk") if isinstance(account.get("desk"), dict) else _blank_desk()
        return {"id": account["id"], "name": account["name"], "revision": int(account.get("revision") or 0), "desk": desk}


def read_desk(token: str) -> dict:
    found = account_from_token(token)
    if found is None:
        raise AccountError("Sign in again.", 401)
    return {"revision": found["revision"], "desk": found["desk"]}


def save_desk(token: str, revision: object, desk: object) -> dict:
    try:
        base = int(revision)
    except (TypeError, ValueError) as exc:
        raise AccountError("Send the revision this desk was loaded from.") from exc
    stored = clean_desk(desk)
    with _LOCK:
        store = _load()
        _drop_expired(store)
        digest = _token_hash(token)
        session = next(
            (
                item
                for item in store["sessions"]
                if isinstance(item, dict) and hmac.compare_digest(str(item.get("hash", "")), digest)
            ),
            None,
        )
        account = _find_id(store, str(session.get("account_id"))) if session else None
        if account is None:
            raise AccountError("Sign in again.", 401)
        current = int(account.get("revision") or 0)
        if base != current:
            current_desk = account.get("desk") if isinstance(account.get("desk"), dict) else _blank_desk()
            raise DeskConflict(current, current_desk)
        account["revision"] = current + 1
        account["desk"] = stored
        _save(store)
        return {"revision": account["revision"]}


def end_session(token: str) -> None:
    if not token:
        return
    digest = _token_hash(token)
    with _LOCK:
        store = _load()
        store["sessions"] = [
            item
            for item in store["sessions"]
            if not (isinstance(item, dict) and hmac.compare_digest(str(item.get("hash", "")), digest))
        ]
        _save(store)
