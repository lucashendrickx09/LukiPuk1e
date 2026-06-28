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
import sys
from pathlib import Path

# Make `app` importable no matter where run.py is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import __version__  # noqa: E402
from app.config import (  # noqa: E402
    PERMISSION_CLEARED,
    SECRET_KEYS,
    Config,
    load_config,
)
from app import deps, ledger  # noqa: E402

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


def cmd_doctor(cfg: Config) -> int:
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


def _not_yet(name: str, phase: str):
    def _runner(cfg: Config) -> int:
        print(f"`{name}` arrives in {phase}. Phase 0 only ships `doctor`.")
        return 0

    return _runner


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="run.py",
        description="Automated YouTube -> Short-Form Clipper (Phase 0 scaffold).",
    )
    parser.add_argument("--version", action="version", version=f"clipper {__version__}")
    sub = parser.add_subparsers(dest="command")
    doctor_p = sub.add_parser(
        "doctor", help="Verify config/binaries/secrets and init the ledger."
    )
    doctor_p.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero if any required binary is missing (CI gate).",
    )
    # Stubs so the CLI surface is discoverable; implemented in later phases.
    for name, phase in (
        ("ingest", "Phase 1"),
        ("transcribe", "Phase 2"),
        ("analyze", "Phase 3"),
        ("render", "Phase 4"),
        ("publish", "Phase 5"),
        ("run", "Phase 7"),
    ):
        sub.add_parser(name, help=f"({phase})")

    args = parser.parse_args(argv)

    try:
        cfg = load_config()
    except Exception as exc:  # fail loud (Hard Rule 4)
        print(f"{_BAD} Failed to load configuration: {exc}", file=sys.stderr)
        return 2

    command = args.command or "doctor"
    handlers = {
        "doctor": cmd_doctor,
        "ingest": _not_yet("ingest", "Phase 1"),
        "transcribe": _not_yet("transcribe", "Phase 2"),
        "analyze": _not_yet("analyze", "Phase 3"),
        "render": _not_yet("render", "Phase 4"),
        "publish": _not_yet("publish", "Phase 5"),
        "run": _not_yet("run", "Phase 7"),
    }
    result = handlers[command](cfg)

    if command == "doctor" and getattr(args, "strict", False) and result:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
