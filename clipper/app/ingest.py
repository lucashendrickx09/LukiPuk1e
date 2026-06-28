"""Phase 1 — source management + ingest.

Orchestrates: sync config sources -> ledger, enumerate each source's videos,
download new (un-ledgered) ones to /inbox.

Hard rules enforced here:
- Rule 1 (permission gate): a source whose ``permission_status`` is not one of
  owner/licensed/fair_use is BLOCKED — never enumerated, never downloaded.
- Rule 3 (idempotency): a video already in the ledger is skipped; nothing is
  re-downloaded.
- Rule 4 (fail loud, stay resumable): a per-video failure is logged and written
  to the ledger as status=error; it never aborts the run or drops other clips.
"""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

from .config import PERMISSION_CLEARED, Config
from . import ledger
from .ytdlp import Entry, Provider, classify_url

log = logging.getLogger("clipper.ingest")

# Default cap on how many newest items to inspect per channel/playlist poll.
DEFAULT_CHANNEL_LIMIT = 25


@dataclass
class IngestReport:
    sources_scanned: int = 0
    sources_blocked: int = 0
    new_videos: int = 0
    skipped_existing: int = 0
    downloaded: int = 0
    errors: int = 0
    notes: list[str] = field(default_factory=list)

    def line(self) -> str:
        return (
            f"sources={self.sources_scanned} blocked={self.sources_blocked} "
            f"new={self.new_videos} skipped={self.skipped_existing} "
            f"downloaded={self.downloaded} errors={self.errors}"
        )


def permission_cleared(status: str | None) -> bool:
    return (status or "").lower() in PERMISSION_CLEARED


def sync_config_sources(conn: sqlite3.Connection, cfg: Config) -> int:
    """Upsert any sources listed in config.yaml into the ledger (idempotent)."""
    n = 0
    for s in cfg.sources:
        stype = s.type if s.type in ("video", "channel", "playlist") else classify_url(s.url)
        ledger.add_source(conn, s.url, stype, s.permission_status, note="from config.yaml")
        n += 1
    return n


def ingest_source(
    conn: sqlite3.Connection,
    source: sqlite3.Row,
    provider: Provider,
    inbox: Path,
    *,
    dry_run: bool = False,
    limit: int | None = None,
    report: IngestReport | None = None,
) -> IngestReport:
    """Enumerate and (unless dry-run) download new videos for one source."""
    report = report or IngestReport()
    report.sources_scanned += 1

    # ---- Rule 1: permission gate -----------------------------------------
    if not permission_cleared(source["permission_status"]):
        report.sources_blocked += 1
        msg = (
            f"BLOCKED source #{source['id']} [{source['permission_status']}] "
            f"{source['url']} — clear permission before it can enter the pipeline."
        )
        log.warning(msg)
        report.notes.append(msg)
        return report

    if source["status"] and source["status"] != "active":
        log.info("Skipping source #%s (status=%s)", source["id"], source["status"])
        return report

    eff_limit = limit
    if eff_limit is None and source["type"] != "video":
        eff_limit = DEFAULT_CHANNEL_LIMIT

    # ---- enumerate (fail loud, but don't kill the whole run) -------------
    try:
        entries = provider.enumerate(source["url"], source["type"], eff_limit)
    except Exception as exc:  # noqa: BLE001 — surface, record, continue
        report.errors += 1
        msg = f"enumerate failed for source #{source['id']} {source['url']}: {exc}"
        log.error(msg)
        report.notes.append(msg)
        return report

    if not entries:
        log.info("Source #%s: no videos found.", source["id"])
        return report

    newest_id = entries[0].id  # provider returns newest-first

    for entry in entries:
        # ---- Rule 3: idempotency ----------------------------------------
        if ledger.video_exists(conn, entry.id):
            report.skipped_existing += 1
            log.debug("skip existing %s (%s)", entry.id, entry.title)
            continue

        row, created = ledger.add_or_get_video(
            conn,
            source_id=source["id"],
            youtube_id=entry.id,
            url=entry.url,
            title=entry.title,
            duration_sec=entry.duration_sec,
        )
        if created:
            report.new_videos += 1
            log.info("NEW video %s — %s", entry.id, entry.title or "(untitled)")

        if dry_run:
            continue

        # ---- download (Rule 4: per-video try/except) --------------------
        try:
            path = provider.download(entry, inbox)
            ledger.set_video_status(
                conn, entry.id, "downloaded", file_path=str(path)
            )
            report.downloaded += 1
            log.info("downloaded %s -> %s", entry.id, path.name)
        except Exception as exc:  # noqa: BLE001
            report.errors += 1
            ledger.set_video_status(conn, entry.id, "error", error=str(exc))
            msg = f"download failed for {entry.id}: {exc}"
            log.error(msg)
            report.notes.append(msg)
            # keep going — one bad video must not drop the rest

    # Record newest seen id for fast channel polling (ledger dedupe is the
    # real guarantee; this is an optimization + audit trail).
    if not dry_run:
        ledger.set_source_last_seen(conn, source["id"], newest_id)

    return report


def run_ingest(
    cfg: Config,
    provider: Provider,
    *,
    only_source: str | None = None,
    dry_run: bool = False,
    limit: int | None = None,
) -> IngestReport:
    """Top-level ingest entrypoint used by the CLI."""
    ledger.init_db(cfg.ledger_db)
    cfg.ensure_dirs()
    inbox = cfg.path("inbox")
    report = IngestReport()

    # An explicit --limit wins; otherwise fall back to the configured channel cap.
    if limit is None:
        limit = int(cfg.get("ingest", "channel_poll_limit", default=DEFAULT_CHANNEL_LIMIT))

    with ledger.session(cfg.ledger_db) as conn:
        synced = sync_config_sources(conn, cfg)
        if synced:
            log.info("Synced %d source(s) from config.yaml.", synced)

        sources = _select_sources(conn, only_source)
        if not sources:
            log.warning("No matching sources to ingest.")
            return report

        for src in sources:
            ingest_source(
                conn, src, provider, inbox,
                dry_run=dry_run, limit=limit, report=report,
            )

    return report


def _select_sources(
    conn: sqlite3.Connection, only_source: str | None
) -> list[sqlite3.Row]:
    if only_source is None:
        return ledger.list_sources(conn)
    # accept either a numeric id or an exact URL
    if only_source.isdigit():
        row = ledger.get_source_by_id(conn, int(only_source))
    else:
        row = ledger.get_source_by_url(conn, only_source)
    return [row] if row else []
