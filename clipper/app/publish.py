"""Phase 5 — posting abstraction.

A swappable :class:`Publisher` interface (default :class:`PostizPublisher`),
per-platform metadata mapping, day-spaced scheduling, and the hard posting
gate for non-permission-cleared sources.

CRITICAL — Hard Rule 2: nothing auto-posts without approval. `run_publish` only
acts on clips with status `approved` (set by the Phase 6 Telegram loop), so it
no-ops until a human has approved. Scheduling an approved clip hands it to the
Publisher with a spaced future slot — never all at once.

Hard Rule 1: a clip whose source isn't permission-cleared is BLOCKED here — no
post is ever created for it, even if it somehow reached `approved`.

Status: a clip with all enabled platforms scheduled -> `posted`; per-platform
rows in the `posts` table carry queued/scheduled/posted/failed.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Protocol
from zoneinfo import ZoneInfo

from .config import PERMISSION_CLEARED, Config
from . import ledger

log = logging.getLogger("clipper.publish")

# Per-platform metadata limits (conservative; truncation happens at map time).
PLATFORM_LIMITS = {
    "instagram_reels": {"title_max": None, "caption_max": 2200, "hashtag_max": 30},
    "youtube_shorts":  {"title_max": 100,  "caption_max": 5000, "hashtag_max": 15},
    "tiktok":          {"title_max": None, "caption_max": 2200, "hashtag_max": 30},
}


# ===========================================================================
# Per-platform metadata mapping
# ===========================================================================
@dataclass
class PlatformMeta:
    platform: str
    title: str | None
    caption: str            # caption + hashtags, within the platform caption limit
    hashtags: list[str]


def _truncate(text: str, limit: int | None) -> str:
    if limit is None or len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def build_platform_meta(clip, platform: str) -> PlatformMeta:
    """Map a clip row (sqlite3.Row or dict) to platform-appropriate metadata,
    truncated to the platform's title/caption/hashtag limits."""
    limits = PLATFORM_LIMITS.get(platform, {"title_max": None, "caption_max": 2200,
                                            "hashtag_max": 30})
    title = clip["title"] or ""
    caption = clip["caption"] or ""
    try:
        tags = json.loads(clip["hashtags"]) if clip["hashtags"] else []
    except (TypeError, json.JSONDecodeError):
        tags = []
    tags = [str(t) for t in tags]
    if limits["hashtag_max"] is not None:
        tags = tags[: limits["hashtag_max"]]

    tags_str = " ".join(tags)
    cap_max = limits["caption_max"]
    if cap_max is not None and tags_str:
        body = _truncate(caption, max(0, cap_max - len(tags_str) - 1))
        full = (body + " " + tags_str).strip()
    else:
        full = _truncate((caption + " " + tags_str).strip(), cap_max)

    return PlatformMeta(
        platform=platform,
        title=_truncate(title, limits["title_max"]) if limits["title_max"] else title or None,
        caption=full,
        hashtags=tags,
    )


# ===========================================================================
# Scheduling — spaced slots across the day, per platform
# ===========================================================================
def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:
        log.warning("unknown timezone %r, using UTC", name)
        return ZoneInfo("UTC")


def next_slot(times_hhmm: list[str], tz: ZoneInfo, now: datetime,
              taken: set[datetime], max_per_day: int, horizon_days: int = 60) -> datetime:
    """First future slot (from `times_hhmm`, in `tz`) not already in `taken`,
    respecting `max_per_day`. Raises if none within the horizon."""
    parsed = sorted(tuple(int(x) for x in t.split(":")) for t in times_hhmm)
    now_local = now.astimezone(tz)
    for day_offset in range(horizon_days):
        day = (now_local + timedelta(days=day_offset)).date()
        day_count = sum(1 for t in taken if t.astimezone(tz).date() == day)
        if day_count >= max_per_day:
            continue
        for h, m in parsed:
            cand = datetime(day.year, day.month, day.day, h, m, tzinfo=tz)
            if cand <= now:
                continue
            if any(abs((cand - t).total_seconds()) < 60 for t in taken):
                continue
            return cand
    raise RuntimeError("no free posting slot within horizon — widen the schedule")


class Scheduler:
    def __init__(self, cfg: Config, taken: dict[str, set[datetime]]):
        self.default_tz = cfg.get("posting", "default_timezone", default="UTC")
        self.max_per_day = int(cfg.get("posting", "max_per_day_per_platform", default=3))
        self.per_platform = cfg.get("posting", "per_platform", default={}) or {}
        self.taken = taken

    def platforms(self) -> list[str]:
        return list(self.per_platform.keys())

    def reserve(self, platform: str, now: datetime | None = None) -> datetime:
        pcfg = self.per_platform.get(platform, {})
        tz = _tz(pcfg.get("timezone", self.default_tz))
        times = pcfg.get("times") or ["12:00"]
        now = now or datetime.now(tz)
        slot = next_slot(times, tz, now, self.taken.setdefault(platform, set()),
                         self.max_per_day)
        self.taken[platform].add(slot)
        return slot


# ===========================================================================
# Publisher interface + Postiz implementation
# ===========================================================================
class Publisher(Protocol):
    name: str

    def schedule(self, *, video_path: Path, platform: str, meta: PlatformMeta,
                 when: datetime) -> str:
        ...


class PostizPublisher:
    """Posts to a self-hosted Postiz instance.

    Postiz's REST shape varies by version; this isolates the one HTTP call so a
    different backend (e.g. Ayrshare) can be dropped in without touching the
    rest of the pipeline. `channels` maps our platform names to Postiz
    integration/channel ids (configured in config.yaml).
    """

    name = "postiz"

    def __init__(self, base_url: str, api_key: str, channels: dict[str, str]):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.channels = channels

    def schedule(self, *, video_path, platform, meta, when) -> str:
        import requests  # local import so the module loads without it installed

        channel = self.channels.get(platform)
        if not channel:
            raise RuntimeError(f"no Postiz channel configured for platform '{platform}'")
        payload = {
            "type": "scheduled",
            "date": when.astimezone().isoformat(),
            "content": meta.caption,
            "title": meta.title,
            "integration": channel,
            "media": [str(video_path)],
        }
        resp = requests.post(
            f"{self.base_url}/public/v1/posts",
            json=payload,
            headers={"Authorization": self.api_key},
            timeout=60,
        )
        if resp.status_code >= 300:
            raise RuntimeError(f"Postiz error {resp.status_code}: {resp.text[:300]}")
        data = resp.json() if resp.content else {}
        return str(data.get("id") or data.get("postId") or "scheduled")


def make_publisher(cfg: Config) -> Publisher:
    backend = cfg.get("publisher", "backend", default="postiz")
    if backend != "postiz":
        raise RuntimeError(f"publisher backend '{backend}' not implemented yet.")
    base_url = cfg.get("publisher", "postiz", "base_url", default=None)
    if not base_url:
        raise RuntimeError("publisher.postiz.base_url is not configured.")
    api_key = Config.secret("POSTIZ_API_KEY")
    if not api_key:
        raise RuntimeError("POSTIZ_API_KEY is not set (.env).")
    channels = cfg.get("publisher", "postiz", "channels", default={}) or {}
    return PostizPublisher(base_url, api_key, channels)


# ===========================================================================
# Orchestration
# ===========================================================================
@dataclass
class PublishReport:
    clips_seen: int = 0
    scheduled: int = 0      # platform-posts scheduled
    posted_clips: int = 0   # clips fully dispatched
    blocked: int = 0        # clips blocked by permission gate
    skipped: int = 0        # already-scheduled platform-posts
    errors: int = 0
    notes: list[str] = field(default_factory=list)

    def line(self) -> str:
        return (f"clips={self.clips_seen} scheduled={self.scheduled} "
                f"posted_clips={self.posted_clips} blocked={self.blocked} "
                f"skipped={self.skipped} errors={self.errors}")


def _existing_taken(conn) -> dict[str, set[datetime]]:
    taken: dict[str, set[datetime]] = {}
    for row in ledger.list_posts(conn):
        if row["status"] in ("scheduled", "posted") and row["scheduled_for"]:
            try:
                dt = datetime.fromisoformat(row["scheduled_for"])
            except ValueError:
                continue
            taken.setdefault(row["platform"], set()).add(dt)
    return taken


def run_publish(
    cfg: Config,
    publisher: Publisher | None = None,
    *,
    only_clip: int | None = None,
    now: datetime | None = None,
) -> PublishReport:
    ledger.init_db(cfg.ledger_db)
    cfg.ensure_dirs()
    report = PublishReport()

    if not cfg.get("posting", "enabled", default=True):
        log.info("posting.enabled is false — nothing scheduled.")
        return report

    with ledger.session(cfg.ledger_db) as conn:
        scheduler = Scheduler(cfg, _existing_taken(conn))
        platforms = scheduler.platforms()
        if not platforms:
            log.warning("no platforms configured under posting.per_platform.")
            return report

        if only_clip is not None:
            row = ledger.get_clip(conn, only_clip)
            clips = [row] if row and row["status"] == "approved" else []
        else:
            clips = ledger.list_clips(conn, status="approved")

        if clips and publisher is None:
            publisher = make_publisher(cfg)

        for clip in clips:
            report.clips_seen += 1
            cid = clip["id"]

            # ---- Hard Rule 1: permission gate ----------------------------
            src = ledger.get_source_for_clip(conn, cid)
            cleared = src is not None and (src["permission_status"] or "").lower() in PERMISSION_CLEARED
            if not cleared:
                report.blocked += 1
                why = "no source" if src is None else f"permission '{src['permission_status']}'"
                msg = f"BLOCKED clip {cid}: {why} not cleared — refusing to post (rule 1)."
                log.warning(msg)
                report.notes.append(msg)
                continue

            video = ledger.get_video_by_id(conn, clip["video_id"])
            video_path = Path(video["file_path"]) if video and video["file_path"] else None

            all_ok = True
            for platform in platforms:
                existing = ledger.get_post(conn, cid, platform)
                if existing and existing["status"] in ("scheduled", "posted"):
                    report.skipped += 1
                    continue
                meta = build_platform_meta(clip, platform)
                try:
                    when = scheduler.reserve(platform, now=now)
                    ext = publisher.schedule(video_path=video_path, platform=platform,
                                             meta=meta, when=when)
                    ledger.upsert_post(conn, cid, platform,
                                       scheduled_for=when.isoformat(),
                                       external_id=ext, status="scheduled")
                    report.scheduled += 1
                    log.info("scheduled clip %s -> %s @ %s", cid, platform, when.isoformat())
                except Exception as exc:  # noqa: BLE001 — record, keep going
                    all_ok = False
                    report.errors += 1
                    ledger.upsert_post(conn, cid, platform, scheduled_for=None,
                                       external_id=None, status="failed", error=str(exc))
                    msg = f"schedule failed clip {cid} -> {platform}: {exc}"
                    log.error(msg)
                    report.notes.append(msg)

            if all_ok:
                ledger.set_clip_status(conn, cid, "posted")
                report.posted_clips += 1

    return report
