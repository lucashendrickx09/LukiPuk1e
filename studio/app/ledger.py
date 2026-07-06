"""SQLite ledger — single source of truth for ideas, videos, posts, metrics, learned weights.

Idempotency lives here: ideas are keyed by a content hash, posts by video id,
so re-running any pipeline step never duplicates work.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY,
    hash TEXT UNIQUE NOT NULL,
    channel TEXT NOT NULL,
    topic TEXT NOT NULL,
    angle TEXT DEFAULT '',
    keywords TEXT DEFAULT '[]',          -- json list
    trend REAL DEFAULT 0.5,
    rpm REAL DEFAULT 0.5,
    novelty REAL DEFAULT 1.0,
    prior REAL DEFAULT 0.5,
    score REAL DEFAULT 0,                -- stage-1 score
    source TEXT DEFAULT 'research',      -- research | seed | manual
    status TEXT DEFAULT 'candidate',     -- candidate | selected | scripted | discarded | done
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY,
    idea_id INTEGER NOT NULL REFERENCES ideas(id),
    channel TEXT NOT NULL,
    script TEXT NOT NULL,                -- json Script
    hook_type TEXT DEFAULT '',
    format TEXT DEFAULT '',
    est_seconds REAL DEFAULT 0,
    score REAL DEFAULT 0,                -- stage-2 score
    video_path TEXT DEFAULT '',
    duration REAL DEFAULT 0,
    status TEXT DEFAULT 'scripted',      -- scripted | rendered | approved | rejected | published
    reject_reason TEXT DEFAULT '',
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY,
    video_id INTEGER UNIQUE NOT NULL REFERENCES videos(id),
    channel TEXT NOT NULL,
    yt_video_id TEXT DEFAULT '',
    title TEXT DEFAULT '',
    publish_at TEXT DEFAULT '',          -- ISO8601 UTC
    status TEXT DEFAULT 'scheduled',     -- scheduled | uploaded | exported | live | failed
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id),
    fetched_at REAL NOT NULL,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    avg_view_pct REAL DEFAULT 0,         -- averageViewedPercentage
    avg_view_seconds REAL DEFAULT 0,
    UNIQUE(post_id, fetched_at)
);
CREATE TABLE IF NOT EXISTS weights (
    channel TEXT NOT NULL,
    key TEXT NOT NULL,                   -- e.g. prior:hook_type=question|format=listicle|len=short
    value REAL NOT NULL,
    samples INTEGER DEFAULT 0,
    updated_at REAL NOT NULL,
    PRIMARY KEY (channel, key)
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    ts REAL NOT NULL,
    kind TEXT NOT NULL,
    detail TEXT DEFAULT ''
);
"""


def idea_hash(channel: str, topic: str) -> str:
    return hashlib.sha256(f"{channel}\x00{topic.strip().lower()}".encode()).hexdigest()[:16]


class Ledger:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.path))
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self.db.commit()

    def close(self):
        self.db.close()

    # -- events ------------------------------------------------------------
    def log(self, kind: str, detail: str = ""):
        self.db.execute("INSERT INTO events(ts, kind, detail) VALUES (?,?,?)", (time.time(), kind, detail))
        self.db.commit()

    # -- ideas -------------------------------------------------------------
    def add_idea(self, channel: str, topic: str, *, angle: str = "", keywords: list[str] | None = None,
                 trend: float = 0.5, rpm: float = 0.5, novelty: float = 1.0, prior: float = 0.5,
                 score: float = 0.0, source: str = "research") -> int | None:
        """Insert an idea; returns row id, or None if it already exists (dedupe)."""
        h = idea_hash(channel, topic)
        try:
            cur = self.db.execute(
                "INSERT INTO ideas(hash, channel, topic, angle, keywords, trend, rpm, novelty, prior, score, source, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (h, channel, topic, angle, json.dumps(keywords or []), trend, rpm, novelty, prior, score, source, time.time()),
            )
            self.db.commit()
            return cur.lastrowid
        except sqlite3.IntegrityError:
            return None

    def ideas(self, channel: str | None = None, status: str | None = None, limit: int = 200) -> list[sqlite3.Row]:
        q, args = "SELECT * FROM ideas WHERE 1=1", []
        if channel:
            q += " AND channel=?"; args.append(channel)
        if status:
            q += " AND status=?"; args.append(status)
        q += " ORDER BY score DESC, created_at DESC LIMIT ?"; args.append(limit)
        return self.db.execute(q, args).fetchall()

    def recent_topics(self, channel: str, limit: int = 40) -> list[tuple[str, list[str]]]:
        rows = self.db.execute(
            "SELECT topic, keywords FROM ideas WHERE channel=? AND status IN ('selected','scripted','done')"
            " ORDER BY created_at DESC LIMIT ?", (channel, limit)).fetchall()
        return [(r["topic"], json.loads(r["keywords"])) for r in rows]

    def set_idea_status(self, idea_id: int, status: str):
        self.db.execute("UPDATE ideas SET status=? WHERE id=?", (status, idea_id))
        self.db.commit()

    # -- videos ------------------------------------------------------------
    def add_video(self, idea_id: int, channel: str, script: dict, *, hook_type: str, fmt: str,
                  est_seconds: float, score: float) -> int:
        cur = self.db.execute(
            "INSERT INTO videos(idea_id, channel, script, hook_type, format, est_seconds, score, created_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (idea_id, channel, json.dumps(script), hook_type, fmt, est_seconds, score, time.time()),
        )
        self.db.commit()
        return cur.lastrowid

    def video(self, video_id: int) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM videos WHERE id=?", (video_id,)).fetchone()

    def videos(self, channel: str | None = None, status: str | None = None) -> list[sqlite3.Row]:
        q, args = "SELECT * FROM videos WHERE 1=1", []
        if channel:
            q += " AND channel=?"; args.append(channel)
        if status:
            q += " AND status=?"; args.append(status)
        q += " ORDER BY created_at DESC"
        return self.db.execute(q, args).fetchall()

    def set_video(self, video_id: int, **fields):
        allowed = {"video_path", "duration", "status", "reject_reason", "score"}
        sets, args = [], []
        for k, v in fields.items():
            if k not in allowed:
                raise ValueError(f"cannot set {k}")
            sets.append(f"{k}=?"); args.append(v)
        args.append(video_id)
        self.db.execute(f"UPDATE videos SET {', '.join(sets)} WHERE id=?", args)
        self.db.commit()

    # -- posts ---------------------------------------------------------------
    def add_post(self, video_id: int, channel: str, title: str, publish_at: str, status: str = "scheduled") -> int | None:
        try:
            cur = self.db.execute(
                "INSERT INTO posts(video_id, channel, title, publish_at, status, created_at) VALUES (?,?,?,?,?,?)",
                (video_id, channel, title, publish_at, status, time.time()))
            self.db.commit()
            return cur.lastrowid
        except sqlite3.IntegrityError:
            return None

    def set_post(self, post_id: int, **fields):
        allowed = {"yt_video_id", "status", "publish_at"}
        sets, args = [], []
        for k, v in fields.items():
            if k not in allowed:
                raise ValueError(f"cannot set {k}")
            sets.append(f"{k}=?"); args.append(v)
        args.append(post_id)
        self.db.execute(f"UPDATE posts SET {', '.join(sets)} WHERE id=?", args)
        self.db.commit()

    def posts(self, channel: str | None = None, status: str | None = None) -> list[sqlite3.Row]:
        q, args = "SELECT * FROM posts WHERE 1=1", []
        if channel:
            q += " AND channel=?"; args.append(channel)
        if status:
            q += " AND status=?"; args.append(status)
        q += " ORDER BY publish_at DESC"
        return self.db.execute(q, args).fetchall()

    def taken_slots(self, channel: str) -> set[str]:
        rows = self.db.execute(
            "SELECT publish_at FROM posts WHERE channel=? AND status IN ('scheduled','uploaded','exported','live')",
            (channel,)).fetchall()
        return {r["publish_at"] for r in rows if r["publish_at"]}

    # -- metrics -------------------------------------------------------------
    def record_metrics(self, post_id: int, *, views: int, likes: int, comments: int,
                       avg_view_pct: float, avg_view_seconds: float, fetched_at: float | None = None):
        self.db.execute(
            "INSERT OR REPLACE INTO metrics(post_id, fetched_at, views, likes, comments, avg_view_pct, avg_view_seconds)"
            " VALUES (?,?,?,?,?,?,?)",
            (post_id, fetched_at or time.time(), views, likes, comments, avg_view_pct, avg_view_seconds))
        self.db.commit()

    def latest_metrics(self, post_id: int) -> sqlite3.Row | None:
        return self.db.execute(
            "SELECT * FROM metrics WHERE post_id=? ORDER BY fetched_at DESC LIMIT 1", (post_id,)).fetchone()

    def performance_rows(self, channel: str) -> list[sqlite3.Row]:
        """Join posts+videos+latest metrics for formula updates and reporting."""
        return self.db.execute("""
            SELECT p.id AS post_id, v.hook_type, v.format, v.est_seconds, v.idea_id,
                   m.views, m.likes, m.comments, m.avg_view_pct, m.avg_view_seconds
            FROM posts p
            JOIN videos v ON v.id = p.video_id
            JOIN metrics m ON m.post_id = p.id
              AND m.fetched_at = (SELECT MAX(fetched_at) FROM metrics WHERE post_id = p.id)
            WHERE p.channel=? AND p.status IN ('uploaded','live','exported')
        """, (channel,)).fetchall()

    # -- weights ---------------------------------------------------------------
    def get_weight(self, channel: str, key: str, default: float = 0.5) -> float:
        row = self.db.execute("SELECT value FROM weights WHERE channel=? AND key=?", (channel, key)).fetchone()
        return row["value"] if row else default

    def set_weight(self, channel: str, key: str, value: float, samples: int | None = None):
        prev = self.db.execute("SELECT samples FROM weights WHERE channel=? AND key=?", (channel, key)).fetchone()
        n = samples if samples is not None else ((prev["samples"] if prev else 0) + 1)
        self.db.execute(
            "INSERT INTO weights(channel, key, value, samples, updated_at) VALUES (?,?,?,?,?)"
            " ON CONFLICT(channel, key) DO UPDATE SET value=excluded.value, samples=excluded.samples, updated_at=excluded.updated_at",
            (channel, key, value, n, time.time()))
        self.db.commit()

    def counts(self) -> dict:
        out = {}
        for table in ("ideas", "videos", "posts", "metrics"):
            out[table] = self.db.execute(f"SELECT COUNT(*) c FROM {table}").fetchone()["c"]
        return out
