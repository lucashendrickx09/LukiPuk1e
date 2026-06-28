"""Phase 7 — end-to-end run loop + daily reporting.

`run_all` chains the whole pipeline in order:

    ingest -> transcribe -> analyze -> render -> approve(notify+drain) -> publish

Every step is idempotent and operates on whatever the ledger holds, so the chain
is safe to run repeatedly (cron-friendly). Each step is wrapped: a failure (e.g.
a missing API key for one stage) is recorded and the chain continues — later
stages still process whatever earlier runs already produced (Hard Rule 4).

A once-per-day Telegram summary (videos scanned, clips made, posted, rejected,
errors) is sent on the first run of each day.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .config import Config
from . import analyze, approve, ingest, ledger, publish, render, transcribe
from .ytdlp import make_provider

log = logging.getLogger("clipper.run")

STEP_ORDER = ("ingest", "transcribe", "analyze", "render", "approve", "publish")


@dataclass
class RunReport:
    steps: dict[str, object] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    summary_sent: bool = False

    def line(self, name: str) -> str | None:
        rep = self.steps.get(name)
        return rep.line() if rep is not None and hasattr(rep, "line") else None


def run_all(
    cfg: Config,
    *,
    provider=None,
    transcriber=None,
    analyzer=None,
    renderer=None,
    telegram=None,
    on_approved=None,
    publisher=None,
    skip: frozenset[str] = frozenset(),
    send_summary: bool = True,
    now: datetime | None = None,
) -> RunReport:
    ledger.init_db(cfg.ledger_db)
    cfg.ensure_dirs()
    report = RunReport()

    def step(name: str, fn) -> None:
        if name in skip:
            log.info("skipping %s", name)
            return
        try:
            report.steps[name] = fn()
        except Exception as exc:  # noqa: BLE001 — isolate the step, keep going
            report.errors.append(f"{name}: {exc}")
            log.error("step %s failed: %s", name, exc)

    step("ingest", lambda: ingest.run_ingest(cfg, provider or make_provider(cfg)))
    step("transcribe", lambda: transcribe.run_transcribe(cfg, transcriber))
    step("analyze", lambda: analyze.run_analyze(cfg, analyzer))
    step("render", lambda: render.run_render(cfg, renderer))
    step("approve", lambda: approve.run_approve(cfg, telegram, on_approved, poll=False))
    step("publish", lambda: publish.run_publish(cfg, publisher, now=now))

    if send_summary:
        try:
            report.summary_sent = _maybe_send_summary(cfg, telegram, now)
        except Exception as exc:  # noqa: BLE001
            report.errors.append(f"summary: {exc}")
            log.error("daily summary failed: %s", exc)

    return report


# ===========================================================================
# Daily summary
# ===========================================================================
def _status_counts(conn, table: str) -> dict[str, int]:
    rows = conn.execute(f"SELECT status, COUNT(*) AS n FROM {table} GROUP BY status")
    return {r["status"]: r["n"] for r in rows}


def summary_text(conn, now: datetime) -> str:
    v = _status_counts(conn, "videos")
    c = _status_counts(conn, "clips")
    p = _status_counts(conn, "posts")
    errs = v.get("error", 0) + c.get("error", 0) + p.get("failed", 0)
    return (
        f"📊 Clipper daily summary — {now.date().isoformat()}\n"
        f"videos scanned: {sum(v.values())}  "
        f"(transcribed {v.get('transcribed', 0)}, analyzed {v.get('analyzed', 0)})\n"
        f"clips made: {sum(c.values())}  "
        f"(ready {c.get('ready', 0)}, approved {c.get('approved', 0)}, "
        f"posted {c.get('posted', 0)}, rejected {c.get('rejected', 0)})\n"
        f"scheduled posts: {p.get('scheduled', 0) + p.get('posted', 0)}\n"
        f"errors: {errs}"
    )


def _maybe_send_summary(cfg: Config, telegram, now: datetime | None) -> bool:
    if not cfg.get("telegram", "enabled", default=True):
        return False
    if not cfg.get("telegram", "daily_summary", default=True):
        return False
    now = now or datetime.now(timezone.utc)
    today = now.date().isoformat()

    with ledger.session(cfg.ledger_db) as conn:
        if ledger.get_meta(conn, "last_summary_date") == today:
            return False  # already sent today
        client = telegram or approve.make_client(cfg)
        chat_id = Config.secret("TELEGRAM_CHAT_ID")
        if not chat_id:
            raise RuntimeError("TELEGRAM_CHAT_ID is not set (.env).")
        client.send_message(chat_id, summary_text(conn, now))
        ledger.set_meta(conn, "last_summary_date", today)
    log.info("sent daily summary for %s", today)
    return True
