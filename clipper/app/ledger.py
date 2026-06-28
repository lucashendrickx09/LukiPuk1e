"""SQLite ledger — the single source of truth for idempotency (Hard Rule 3).

Every source, video, clip, and post is tracked here with an explicit status
and timestamps. Nothing gets re-downloaded, re-clipped, or re-posted because
later phases check this ledger first.

Tables
------
sources : the YouTube videos/channels/playlists we're allowed to mine.
videos  : individual videos pulled from sources (channels expand into many).
clips   : candidate/finished short-form cuts derived from a video.
posts   : a clip scheduled/published to a specific platform.

Status vocabularies (kept as plain strings for portability):
    source.status  : active | paused | blocked
    video.status   : new | downloaded | transcribed | analyzed | done | error
    clip.status    : candidate | rejected | cutting | ready | approved
                     | editing | posted | error
    post.status    : queued | scheduled | posted | failed
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

SCHEMA_VERSION = 1

# Status vocabularies, exported so other phases use the same strings.
SOURCE_STATUS = ("active", "paused", "blocked")
VIDEO_STATUS = ("new", "downloaded", "transcribed", "analyzed", "done", "error")
CLIP_STATUS = (
    "candidate", "rejected", "cutting", "ready",
    "approved", "editing", "posted", "error",
)
POST_STATUS = ("queued", "scheduled", "posted", "failed")

PLATFORMS = ("instagram_reels", "youtube_shorts", "tiktok")


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    url                 TEXT NOT NULL UNIQUE,
    type                TEXT NOT NULL DEFAULT 'video',      -- video|channel|playlist
    permission_status   TEXT NOT NULL DEFAULT 'unverified', -- owner|licensed|fair_use|unverified
    status              TEXT NOT NULL DEFAULT 'active',     -- active|paused|blocked
    last_seen_video_id  TEXT,                               -- for channel/playlist polling
    note                TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id        INTEGER REFERENCES sources(id) ON DELETE SET NULL,
    youtube_id       TEXT NOT NULL UNIQUE,                 -- idempotency key
    url              TEXT NOT NULL,
    title            TEXT,
    duration_sec     REAL,
    file_path        TEXT,                                 -- in /inbox once downloaded
    transcript_path  TEXT,
    status           TEXT NOT NULL DEFAULT 'new',
    error            TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clips (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id         INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    start_sec        REAL NOT NULL,
    end_sec          REAL NOT NULL,
    title            TEXT,
    caption          TEXT,
    hashtags         TEXT,                                 -- JSON array string
    hook_score       INTEGER,
    reason           TEXT,
    status           TEXT NOT NULL DEFAULT 'candidate',
    rejected_reason  TEXT,
    file_path        TEXT,                                 -- in /ready once rendered
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    clip_id        INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    platform       TEXT NOT NULL,                          -- instagram_reels|youtube_shorts|tiktok
    scheduled_for  TEXT,                                   -- ISO8601 in platform tz
    external_id    TEXT,                                   -- id returned by publisher
    status         TEXT NOT NULL DEFAULT 'queued',
    error          TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    UNIQUE (clip_id, platform)                             -- never double-post a clip to a platform
);

CREATE INDEX IF NOT EXISTS idx_videos_source ON videos(source_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_clips_video  ON clips(video_id);
CREATE INDEX IF NOT EXISTS idx_clips_status ON clips(status);
CREATE INDEX IF NOT EXISTS idx_posts_clip   ON posts(clip_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
"""


def utcnow() -> str:
    """ISO8601 UTC timestamp used for all created_at/updated_at columns."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(db_path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


@contextmanager
def session(db_path: Path | str) -> Iterator[sqlite3.Connection]:
    conn = connect(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: Path | str) -> bool:
    """Create the schema if needed. Returns True if the DB was newly created."""
    path = Path(db_path)
    fresh = not path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    with session(path) as conn:
        conn.executescript(SCHEMA)
        cur = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'")
        row = cur.fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO meta(key, value) VALUES('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
            conn.execute(
                "INSERT OR IGNORE INTO meta(key, value) VALUES('created_at', ?)",
                (utcnow(),),
            )
    return fresh


def schema_version(db_path: Path | str) -> int | None:
    if not Path(db_path).exists():
        return None
    with session(db_path) as conn:
        try:
            row = conn.execute(
                "SELECT value FROM meta WHERE key = 'schema_version'"
            ).fetchone()
        except sqlite3.OperationalError:
            return None
    return int(row["value"]) if row else None


def counts(db_path: Path | str) -> dict[str, int]:
    """Quick row counts per table for status reporting."""
    out: dict[str, int] = {}
    if not Path(db_path).exists():
        return {t: 0 for t in ("sources", "videos", "clips", "posts")}
    with session(db_path) as conn:
        for table in ("sources", "videos", "clips", "posts"):
            try:
                out[table] = conn.execute(
                    f"SELECT COUNT(*) AS n FROM {table}"
                ).fetchone()["n"]
            except sqlite3.OperationalError:
                out[table] = 0
    return out


# ===========================================================================
# Data access helpers (Phase 1+). All take an open connection so callers can
# batch work in one transaction via `session(...)`.
# ===========================================================================

# ---- sources --------------------------------------------------------------
def add_source(
    conn: sqlite3.Connection,
    url: str,
    type: str,
    permission_status: str,
    note: str | None = None,
) -> sqlite3.Row:
    """Insert a source, or update it in place if the URL already exists.

    Re-adding the same URL updates type/permission/note (so you can clear a
    previously-unverified source) without creating a duplicate row.
    """
    now = utcnow()
    conn.execute(
        """
        INSERT INTO sources(url, type, permission_status, status, note, created_at, updated_at)
        VALUES(?, ?, ?, 'active', ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
            type = excluded.type,
            permission_status = excluded.permission_status,
            note = excluded.note,
            updated_at = excluded.updated_at
        """,
        (url, type, permission_status, note, now, now),
    )
    return get_source_by_url(conn, url)  # type: ignore[return-value]


def get_source_by_url(conn: sqlite3.Connection, url: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM sources WHERE url = ?", (url,)).fetchone()


def get_source_by_id(conn: sqlite3.Connection, source_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()


def list_sources(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM sources ORDER BY id").fetchall()


def remove_source(conn: sqlite3.Connection, source_id: int) -> int:
    cur = conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))
    return cur.rowcount


def set_source_last_seen(
    conn: sqlite3.Connection, source_id: int, youtube_id: str
) -> None:
    conn.execute(
        "UPDATE sources SET last_seen_video_id = ?, updated_at = ? WHERE id = ?",
        (youtube_id, utcnow(), source_id),
    )


# ---- videos ---------------------------------------------------------------
def get_video(conn: sqlite3.Connection, youtube_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM videos WHERE youtube_id = ?", (youtube_id,)
    ).fetchone()


def video_exists(conn: sqlite3.Connection, youtube_id: str) -> bool:
    return get_video(conn, youtube_id) is not None


def add_or_get_video(
    conn: sqlite3.Connection,
    source_id: int | None,
    youtube_id: str,
    url: str,
    title: str | None = None,
    duration_sec: float | None = None,
) -> tuple[sqlite3.Row, bool]:
    """Idempotent insert keyed on youtube_id. Returns (row, created)."""
    existing = get_video(conn, youtube_id)
    if existing is not None:
        return existing, False
    now = utcnow()
    conn.execute(
        """
        INSERT INTO videos(source_id, youtube_id, url, title, duration_sec,
                           status, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, 'new', ?, ?)
        """,
        (source_id, youtube_id, url, title, duration_sec, now, now),
    )
    return get_video(conn, youtube_id), True  # type: ignore[return-value]


def set_video_status(
    conn: sqlite3.Connection,
    youtube_id: str,
    status: str,
    *,
    file_path: str | None = None,
    transcript_path: str | None = None,
    error: str | None = None,
    title: str | None = None,
    duration_sec: float | None = None,
) -> None:
    """Update a video's status and any provided fields. Clears `error` on
    any non-error status so a resumed job isn't left with a stale message."""
    fields: list[str] = ["status = ?", "updated_at = ?"]
    params: list[object] = [status, utcnow()]
    if file_path is not None:
        fields.append("file_path = ?"); params.append(file_path)
    if transcript_path is not None:
        fields.append("transcript_path = ?"); params.append(transcript_path)
    if title is not None:
        fields.append("title = ?"); params.append(title)
    if duration_sec is not None:
        fields.append("duration_sec = ?"); params.append(duration_sec)
    if status == "error":
        fields.append("error = ?"); params.append(error)
    else:
        fields.append("error = NULL")
    params.append(youtube_id)
    conn.execute(
        f"UPDATE videos SET {', '.join(fields)} WHERE youtube_id = ?", params
    )
