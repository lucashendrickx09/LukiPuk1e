"""SQLite state: script queue, videos, per-stage status, upload results.

The scripts.json file is the *source* queue you edit. `sync_scripts()` imports
any new entries into the DB (deduped by a stable content key) so that "used"
state survives across runs even as you append to scripts.json.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

STAGES = ["script", "tts", "align", "visuals", "assemble", "upload"]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scripts (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    key       TEXT UNIQUE NOT NULL,
    position  INTEGER NOT NULL,
    title     TEXT,
    json      TEXT NOT NULL,
    used      INTEGER NOT NULL DEFAULT 0,
    used_at   TEXT,
    video_id  TEXT
);

CREATE TABLE IF NOT EXISTS videos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id      TEXT UNIQUE NOT NULL,
    script_key    TEXT,
    title         TEXT,
    status        TEXT NOT NULL DEFAULT 'in_progress',
    youtube_id    TEXT,
    upload_status TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id   TEXT NOT NULL,
    stage      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    output     TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(video_id, stage)
);
"""


def script_key(script: dict) -> str:
    """Stable dedupe key for a script (survives reordering of scripts.json)."""
    basis = "\n".join(
        str(script.get(k, ""))
        for k in ("title", "hook", "payoff", "yt_title")
    )
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())


class State:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> "State":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- script queue -----------------------------------------------------
    def sync_scripts(self, scripts: list[dict]) -> int:
        """Import scripts not already present. Returns number newly added."""
        cur = self.conn.cursor()
        cur.execute("SELECT COALESCE(MAX(position), -1) AS m FROM scripts")
        pos = cur.fetchone()["m"] + 1
        added = 0
        for script in scripts:
            key = script_key(script)
            cur.execute("SELECT 1 FROM scripts WHERE key = ?", (key,))
            if cur.fetchone():
                continue
            cur.execute(
                "INSERT INTO scripts (key, position, title, json) "
                "VALUES (?, ?, ?, ?)",
                (key, pos, script.get("title", ""), json.dumps(script)),
            )
            pos += 1
            added += 1
        self.conn.commit()
        return added

    def peek_next_script(self) -> Optional[sqlite3.Row]:
        cur = self.conn.cursor()
        cur.execute(
            "SELECT * FROM scripts WHERE used = 0 ORDER BY position LIMIT 1"
        )
        return cur.fetchone()

    def claim_script(self, key: str, video_id: str) -> None:
        self.conn.execute(
            "UPDATE scripts SET used = 1, used_at = ?, video_id = ? "
            "WHERE key = ?",
            (_now(), video_id, key),
        )
        self.conn.commit()

    def script_for_video(self, video_id: str) -> Optional[dict]:
        cur = self.conn.cursor()
        cur.execute("SELECT json FROM scripts WHERE video_id = ?", (video_id,))
        row = cur.fetchone()
        return json.loads(row["json"]) if row else None

    # -- videos -----------------------------------------------------------
    def video_count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) AS c FROM videos").fetchone()["c"]

    def create_video(self, video_id: str, script_key_: str, title: str) -> None:
        now = _now()
        self.conn.execute(
            "INSERT OR IGNORE INTO videos "
            "(video_id, script_key, title, status, created_at, updated_at) "
            "VALUES (?, ?, ?, 'in_progress', ?, ?)",
            (video_id, script_key_, title, now, now),
        )
        self.conn.commit()

    def get_video(self, video_id: str) -> Optional[sqlite3.Row]:
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM videos WHERE video_id = ?", (video_id,))
        return cur.fetchone()

    def latest_incomplete_video(self) -> Optional[sqlite3.Row]:
        cur = self.conn.cursor()
        cur.execute(
            "SELECT * FROM videos WHERE status != 'done' "
            "ORDER BY id DESC LIMIT 1"
        )
        return cur.fetchone()

    def set_video_status(self, video_id: str, status: str) -> None:
        self.conn.execute(
            "UPDATE videos SET status = ?, updated_at = ? WHERE video_id = ?",
            (status, _now(), video_id),
        )
        self.conn.commit()

    def set_upload(self, video_id: str, youtube_id: str, status: str) -> None:
        self.conn.execute(
            "UPDATE videos SET youtube_id = ?, upload_status = ?, updated_at = ? "
            "WHERE video_id = ?",
            (youtube_id, status, _now(), video_id),
        )
        self.conn.commit()

    # -- stages -----------------------------------------------------------
    def set_stage(
        self, video_id: str, stage: str, status: str, output: str | None = None
    ) -> None:
        self.conn.execute(
            "INSERT INTO stages (video_id, stage, status, output, updated_at) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(video_id, stage) DO UPDATE SET "
            "status = excluded.status, output = excluded.output, "
            "updated_at = excluded.updated_at",
            (video_id, stage, status, output, _now()),
        )
        self.conn.commit()

    def get_stage(self, video_id: str, stage: str) -> Optional[sqlite3.Row]:
        cur = self.conn.cursor()
        cur.execute(
            "SELECT * FROM stages WHERE video_id = ? AND stage = ?",
            (video_id, stage),
        )
        return cur.fetchone()

    def stage_map(self, video_id: str) -> dict[str, str]:
        cur = self.conn.cursor()
        cur.execute(
            "SELECT stage, status FROM stages WHERE video_id = ?", (video_id,)
        )
        return {r["stage"]: r["status"] for r in cur.fetchall()}
