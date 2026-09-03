"""SQLite state: dedupe outreach + enforce daily caps."""
from __future__ import annotations

import datetime as dt
import sqlite3
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS people (
    profile_url   TEXT PRIMARY KEY,
    name          TEXT,
    company       TEXT,
    title         TEXT,
    email         TEXT,
    connected_at  TEXT,   -- ISO timestamp when connection request sent
    emailed_at    TEXT,   -- ISO timestamp when outreach email sent
    note          TEXT,   -- last connection note used
    created_at    TEXT
);
CREATE TABLE IF NOT EXISTS activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    day        TEXT,      -- YYYY-MM-DD
    kind       TEXT,      -- 'connect' | 'email'
    profile_url TEXT,
    ts         TEXT
);
"""


class Store:
    def __init__(self, path: str | Path = "outreach_state.db"):
        self.path = str(Path(path).expanduser())
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(_SCHEMA)
        self.db.commit()

    # ── people ───────────────────────────────────────────────
    def upsert_person(self, person: dict):
        self.db.execute(
            """INSERT INTO people (profile_url, name, company, title, created_at)
               VALUES (:profile_url, :name, :company, :title, :now)
               ON CONFLICT(profile_url) DO UPDATE SET
                 name=excluded.name, company=excluded.company, title=excluded.title""",
            {**person, "now": _now()},
        )
        self.db.commit()

    def get_person(self, profile_url: str):
        row = self.db.execute(
            "SELECT * FROM people WHERE profile_url=?", (profile_url,)
        ).fetchone()
        return dict(row) if row else None

    def already_connected(self, profile_url: str) -> bool:
        p = self.get_person(profile_url)
        return bool(p and p.get("connected_at"))

    def already_emailed(self, profile_url: str) -> bool:
        p = self.get_person(profile_url)
        return bool(p and p.get("emailed_at"))

    def set_email(self, profile_url: str, email: str):
        self.db.execute(
            "UPDATE people SET email=? WHERE profile_url=?", (email, profile_url)
        )
        self.db.commit()

    def mark_connected(self, profile_url: str, note: str):
        ts = _now()
        self.db.execute(
            "UPDATE people SET connected_at=?, note=? WHERE profile_url=?",
            (ts, note, profile_url),
        )
        self._log("connect", profile_url, ts)

    def mark_emailed(self, profile_url: str):
        ts = _now()
        self.db.execute(
            "UPDATE people SET emailed_at=? WHERE profile_url=?", (ts, profile_url)
        )
        self._log("email", profile_url, ts)

    # ── daily caps ───────────────────────────────────────────
    def count_today(self, kind: str) -> int:
        today = dt.date.today().isoformat()
        row = self.db.execute(
            "SELECT COUNT(*) c FROM activity WHERE day=? AND kind=?", (today, kind)
        ).fetchone()
        return row["c"]

    def _log(self, kind: str, profile_url: str, ts: str):
        self.db.execute(
            "INSERT INTO activity (day, kind, profile_url, ts) VALUES (?,?,?,?)",
            (dt.date.today().isoformat(), kind, profile_url, ts),
        )
        self.db.commit()


def _now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")
