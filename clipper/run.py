#!/usr/bin/env python3
"""Single cron-able entrypoint for the YouTube -> Short-Form Clipper.

Phase 0 implements the foundation:
    python run.py doctor   # verify config, binaries, secrets; init the ledger

Later phases extend this CLI (ingest, transcribe, analyze, render, publish,
approve, run). Everything is idempotent and safe to re-run.

Run with no arguments to perform the full startup check (== `doctor`).
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# Make `app` importable no matter where run.py is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import __version__  # noqa: E402
from app.config import (  # noqa: E402
    PERMISSION_CLEARED,
    PERMISSION_STATES,
    SECRET_KEYS,
    Config,
    load_config,
)
from app import (  # noqa: E402
    analyze, approve, deps, ingest, ledger, pipeline, publish, render, transcribe,
)
from app.ytdlp import classify_url, make_provider  # noqa: E402

# ---- tiny ANSI helpers (no dependency) ----------------------------------
_OK = "\033[92m✔\033[0m"
_BAD = "\033[91m✘\033[0m"
_WARN = "\033[93m●\033[0m"
_DIM = "\033[2m"
_RST = "\033[0m"
_BOLD = "\033[1m"


def _hr(title: str) -> None:
    print(f"\n{_BOLD}{title}{_RST}")
    print(_DIM + "-" * max(8, len(title)) + _RST)


def cmd_doctor(cfg: Config, args: argparse.Namespace) -> int:
    """Verify everything Phase 0 promises and print a setup checklist."""
    problems = 0

    # 1) Config + paths --------------------------------------------------
    _hr("1. Config & paths")
    print(f"  {_OK} config.yaml loaded ({cfg.root / 'config.yaml'})")
    created = cfg.ensure_dirs()
    for d in cfg.data_dirs:
        tag = "created" if d in created else "ok"
        print(f"  {_OK} {d.relative_to(cfg.root)}  {_DIM}({tag}){_RST}")

    # 2) Ledger ----------------------------------------------------------
    _hr("2. Ledger (SQLite)")
    fresh = ledger.init_db(cfg.ledger_db)
    ver = ledger.schema_version(cfg.ledger_db)
    state = "created" if fresh else "exists"
    print(f"  {_OK} {cfg.ledger_db.relative_to(cfg.root)}  {_DIM}({state}, schema v{ver}){_RST}")
    c = ledger.counts(cfg.ledger_db)
    print(
        f"  {_DIM}rows{_RST}  sources={c['sources']}  videos={c['videos']}  "
        f"clips={c['clips']}  posts={c['posts']}"
    )

    # 3) External binaries ----------------------------------------------
    _hr("3. External binaries")
    checks = deps.check_binaries(cfg)
    for ch in checks:
        if ch.found:
            ver_txt = f"  {_DIM}{ch.version}{_RST}" if ch.version else ""
            print(f"  {_OK} {ch.name}{ver_txt}")
        else:
            problems += 1
            print(f"  {_BAD} {ch.name}  {_DIM}— {ch.needed_for}{_RST}")
            print(f"        Ubuntu: {ch.install_ubuntu}")
            print(f"        macOS : {ch.install_macos}")

    # 4) Secrets (.env) --------------------------------------------------
    _hr("4. Secrets (.env)")
    env_example = cfg.root / ".env.example"
    env_file = cfg.root / ".env"
    if not env_file.exists():
        print(f"  {_WARN} .env not found — copy it:  cp {env_example.name} .env")
    for key in SECRET_KEYS:
        present = bool(Config.secret(key))
        mark = _OK if present else _WARN
        print(f"  {mark} {key}  {_DIM}({'set' if present else 'missing'}){_RST}")
    print(
        f"  {_DIM}Missing secrets are only fatal for the phase that needs them "
        f"(Anthropic=P3, Postiz=P5, Telegram=P6).{_RST}"
    )

    # 5) Sources & permission gate (Hard Rule 1) ------------------------
    _hr("5. Sources & permission gate")
    srcs = cfg.sources
    if not srcs:
        print(f"  {_DIM}No sources configured yet — add them in config.yaml (Phase 1).{_RST}")
    for s in srcs:
        cleared = s.permission_status in PERMISSION_CLEARED
        mark = _OK if cleared else _BAD
        note = "" if cleared else "  ← BLOCKED from pipeline until cleared"
        print(f"  {mark} [{s.permission_status}] {s.type}: {s.url}{note}")

    # ---- verdict -------------------------------------------------------
    _hr("Summary")
    if problems == 0:
        print(f"  {_OK} Phase 0 ready. Next: install whatever's flagged above, then build Phase 1.")
    else:
        print(
            f"  {_WARN} {problems} external binar{'y' if problems == 1 else 'ies'} missing. "
            "Install per the checklist above, then re-run:  python run.py doctor"
        )
    # Phase 0 doctor is informational: exit 0 even with missing optional bits,
    # so cron/CI can run it without failing the job. Use --strict to fail hard.
    return problems


# ===========================================================================
# Phase 1 — source management + ingest
# ===========================================================================
def cmd_source_add(cfg: Config, args: argparse.Namespace) -> int:
    perm = args.permission.lower()
    if perm not in PERMISSION_STATES:
        print(f"{_BAD} --permission must be one of: {', '.join(PERMISSION_STATES)}",
              file=sys.stderr)
        return 2
    stype = args.type if args.type != "auto" else classify_url(args.url)
    ledger.init_db(cfg.ledger_db)
    with ledger.session(cfg.ledger_db) as conn:
        row = ledger.add_source(conn, args.url, stype, perm, note=args.note)
    cleared = perm in PERMISSION_CLEARED
    mark = _OK if cleared else _WARN
    print(f"{mark} source #{row['id']} added: [{perm}] {stype} {args.url}")
    if not cleared:
        print(f"  {_WARN} permission '{perm}' is NOT cleared — this source is "
              f"BLOCKED from the pipeline until you re-add it as "
              f"owner/licensed/fair_use.")
    return 0


def cmd_source_list(cfg: Config, args: argparse.Namespace) -> int:
    ledger.init_db(cfg.ledger_db)
    with ledger.session(cfg.ledger_db) as conn:
        rows = ledger.list_sources(conn)
    if not rows:
        print(f"{_DIM}No sources yet. Add one:  python run.py source add <url> "
              f"--permission owner{_RST}")
        return 0
    print(f"{_BOLD}{'ID':>3}  {'PERM':<10} {'TYPE':<8} {'LAST_SEEN':<13} URL{_RST}")
    for r in rows:
        cleared = (r["permission_status"] or "").lower() in PERMISSION_CLEARED
        mark = _OK if cleared else _BAD
        last = (r["last_seen_video_id"] or "-")[:11]
        print(f"{mark}{r['id']:>3}  {r['permission_status']:<10} "
              f"{r['type']:<8} {last:<13} {r['url']}")
    return 0


def cmd_source_rm(cfg: Config, args: argparse.Namespace) -> int:
    ledger.init_db(cfg.ledger_db)
    with ledger.session(cfg.ledger_db) as conn:
        target = args.source
        row = (ledger.get_source_by_id(conn, int(target)) if target.isdigit()
               else ledger.get_source_by_url(conn, target))
        if row is None:
            print(f"{_BAD} no source matching '{target}'", file=sys.stderr)
            return 1
        ledger.remove_source(conn, row["id"])
    print(f"{_OK} removed source #{row['id']} {row['url']}")
    return 0


def cmd_ingest(cfg: Config, args: argparse.Namespace) -> int:
    provider = make_provider(cfg)
    report = ingest.run_ingest(
        cfg, provider,
        only_source=args.source,
        dry_run=args.dry_run,
        limit=args.limit,
    )
    _hr("Ingest summary" + (" (dry-run)" if args.dry_run else ""))
    print(f"  {report.line()}")
    for note in report.notes:
        print(f"  {_WARN} {note}")
    # Non-zero only if every scanned source errored with nothing accomplished.
    if report.errors and report.downloaded == 0 and report.new_videos == 0:
        return 1
    return 0


# ===========================================================================
# Phase 2 — transcribe
# ===========================================================================
def cmd_transcribe(cfg: Config, args: argparse.Namespace) -> int:
    report = transcribe.run_transcribe(
        cfg, only_video=args.video, force=args.force,
    )
    _hr("Transcribe summary")
    print(f"  {report.line()}")
    for note in report.notes:
        print(f"  {_WARN} {note}")
    if report.errors and report.transcribed == 0:
        return 1
    return 0


# ===========================================================================
# Phase 3 — analyze (Claude picks the clips)
# ===========================================================================
def cmd_analyze(cfg: Config, args: argparse.Namespace) -> int:
    report = analyze.run_analyze(
        cfg, only_video=args.video, force=args.force, dry_run=args.dry_run,
    )
    _hr("Analyze summary" + (" (dry-run)" if args.dry_run else ""))
    print(f"  {report.line()}")
    for note in report.notes:
        print(f"  {_WARN} {note}")
    if report.errors and report.analyzed == 0:
        return 1
    return 0


# ===========================================================================
# Phase 4 — render (cut, reframe, caption, encode)
# ===========================================================================
def cmd_render(cfg: Config, args: argparse.Namespace) -> int:
    report = render.run_render(cfg, only_clip=args.clip, force=args.force)
    _hr("Render summary")
    print(f"  {report.line()}")
    for note in report.notes:
        print(f"  {_WARN} {note}")
    if report.errors and report.rendered == 0:
        return 1
    return 0


# ===========================================================================
# Phase 5 — publish (schedule approved clips)
# ===========================================================================
def cmd_publish(cfg: Config, args: argparse.Namespace) -> int:
    report = publish.run_publish(cfg, only_clip=args.clip)
    _hr("Publish summary")
    print(f"  {report.line()}")
    for note in report.notes:
        print(f"  {_WARN} {note}")
    if report.errors and report.scheduled == 0:
        return 1
    return 0


# ===========================================================================
# Phase 6 — approve (Telegram one-tap loop)
# ===========================================================================
def cmd_approve(cfg: Config, args: argparse.Namespace) -> int:
    report = approve.run_approve(cfg, poll=args.poll)
    _hr("Approve summary")
    print(f"  {report.line()}")
    for note in report.notes:
        print(f"  {_WARN} {note}")
    return 1 if report.errors and report.notified == 0 and report.actions == 0 else 0


# ===========================================================================
# Phase 7 — run (end-to-end chain) + reporting
# ===========================================================================
def cmd_run(cfg: Config, args: argparse.Namespace) -> int:
    skip = frozenset(s.strip() for s in (args.skip or "").split(",") if s.strip())
    report = pipeline.run_all(cfg, skip=skip, send_summary=not args.no_summary)
    _hr("Run summary")
    for name in pipeline.STEP_ORDER:
        line = report.line(name)
        if line is not None:
            print(f"  {_OK} {name:<11} {line}")
        elif name in skip:
            print(f"  {_DIM}- {name:<11} (skipped){_RST}")
        else:
            print(f"  {_BAD} {name:<11} (failed — see errors)")
    if report.summary_sent:
        print(f"  {_DIM}daily summary sent.{_RST}")
    for err in report.errors:
        print(f"  {_WARN} {err}")
    return 1 if report.errors and not report.steps else 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run.py",
        description="Automated YouTube -> Short-Form Clipper.",
    )
    parser.add_argument("--version", action="version", version=f"clipper {__version__}")
    parser.add_argument("-v", "--verbose", action="store_true", help="Debug logging.")
    sub = parser.add_subparsers(dest="command")

    doctor_p = sub.add_parser("doctor", help="Verify config/binaries/secrets; init ledger.")
    doctor_p.add_argument("--strict", action="store_true",
                          help="Exit non-zero if any required binary is missing (CI gate).")

    # ---- source <add|list|rm> --------------------------------------------
    src_p = sub.add_parser("source", help="Manage sources (add/list/rm).")
    src_sub = src_p.add_subparsers(dest="source_cmd", required=True)
    add_p = src_sub.add_parser("add", help="Add a video/channel/playlist URL.")
    add_p.add_argument("url")
    add_p.add_argument("--permission", required=True,
                       choices=list(PERMISSION_STATES),
                       help="REQUIRED. owner/licensed/fair_use are pipeline-cleared; "
                            "unverified is blocked.")
    add_p.add_argument("--type", default="auto",
                       choices=["auto", "video", "channel", "playlist"])
    add_p.add_argument("--note", default=None)
    src_sub.add_parser("list", help="List all sources.")
    rm_p = src_sub.add_parser("rm", help="Remove a source by id or URL.")
    rm_p.add_argument("source")

    # ---- ingest ----------------------------------------------------------
    ing_p = sub.add_parser("ingest", help="Download new, un-ledgered videos to /inbox.")
    ing_p.add_argument("--source", default=None,
                       help="Limit to one source (id or URL). Default: all.")
    ing_p.add_argument("--dry-run", action="store_true",
                       help="Enumerate + ledger new videos, but don't download.")
    ing_p.add_argument("--limit", type=int, default=None,
                       help="Max newest items to inspect per source.")

    # ---- transcribe ------------------------------------------------------
    tr_p = sub.add_parser("transcribe",
                          help="Transcribe downloaded videos (word-level timestamps).")
    tr_p.add_argument("--video", default=None, help="Limit to one youtube_id.")
    tr_p.add_argument("--force", action="store_true",
                      help="Re-transcribe even if already done.")

    # ---- analyze ---------------------------------------------------------
    an_p = sub.add_parser("analyze",
                          help="Claude picks clip candidates from transcripts.")
    an_p.add_argument("--video", default=None, help="Limit to one youtube_id.")
    an_p.add_argument("--force", action="store_true",
                      help="Re-analyze even if already done (drops prior candidates).")
    an_p.add_argument("--dry-run", action="store_true",
                      help="Call Claude and print picks, but don't write to the ledger.")

    # ---- render ----------------------------------------------------------
    rn_p = sub.add_parser("render",
                          help="Cut/reframe/caption candidate clips -> /ready.")
    rn_p.add_argument("--clip", type=int, default=None, help="Limit to one clip id.")
    rn_p.add_argument("--force", action="store_true",
                      help="Re-render even clips already marked ready.")

    # ---- publish ---------------------------------------------------------
    pub_p = sub.add_parser("publish",
                           help="Schedule APPROVED clips to platforms (no auto-post).")
    pub_p.add_argument("--clip", type=int, default=None, help="Limit to one clip id.")

    # ---- approve ---------------------------------------------------------
    ap_p = sub.add_parser("approve",
                          help="Send /ready clips to Telegram and handle approvals.")
    ap_p.add_argument("--poll", action="store_true",
                      help="Stay running and long-poll for taps (Ctrl-C to stop).")

    # ---- run (end-to-end) ------------------------------------------------
    run_p = sub.add_parser("run",
                           help="Run the whole chain end-to-end (cron-friendly).")
    run_p.add_argument("--skip", default=None,
                       help="Comma-separated steps to skip "
                            "(ingest,transcribe,analyze,render,approve,publish).")
    run_p.add_argument("--no-summary", action="store_true",
                       help="Don't send the daily Telegram summary.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if getattr(args, "verbose", False) else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    try:
        cfg = load_config()
    except Exception as exc:  # fail loud (Hard Rule 4)
        print(f"{_BAD} Failed to load configuration: {exc}", file=sys.stderr)
        return 2

    command = args.command or "doctor"
    if command == "source":
        handler = {"add": cmd_source_add, "list": cmd_source_list,
                   "rm": cmd_source_rm}[args.source_cmd]
    else:
        handler = {
            "doctor": cmd_doctor,
            "ingest": cmd_ingest,
            "transcribe": cmd_transcribe,
            "analyze": cmd_analyze,
            "render": cmd_render,
            "publish": cmd_publish,
            "approve": cmd_approve,
            "run": cmd_run,
        }[command]

    try:
        result = handler(cfg, args)
    except KeyboardInterrupt:
        print("\ninterrupted.", file=sys.stderr)
        return 130
    except Exception as exc:  # fail loud, but cleanly (Hard Rule 4)
        if getattr(args, "verbose", False):
            raise
        print(f"{_BAD} {command} failed: {exc}", file=sys.stderr)
        return 2

    if command == "doctor":
        # doctor's result is a problem count; only --strict turns it into failure.
        return 1 if (getattr(args, "strict", False) and result) else 0
    return result or 0


if __name__ == "__main__":
    raise SystemExit(main())
