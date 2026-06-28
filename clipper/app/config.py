"""Configuration loading for the clipper.

Responsibilities
----------------
- Load ``config.yaml`` (non-secret settings, checked into git).
- Load secrets from ``.env`` (NEVER committed; see ``.env.example``).
- Resolve all filesystem paths relative to the project root so the app can be
  run from anywhere (cron, CI, your shell).

Hard rule enforcement that lives here:
- Secrets are *only* ever read from the environment (``.env`` -> ``os.environ``),
  never from ``config.yaml`` and never hardcoded.
- ``permission_status`` is normalised and ``unverified`` sources are flagged so
  the rest of the pipeline can block them (Phase 1/5).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# Project root = the directory that contains config.yaml (clipper/).
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Valid permission states. Anything not "owner/licensed/fair_use" is treated as
# blocked-by-default for the pipeline.
PERMISSION_STATES = ("owner", "licensed", "fair_use", "unverified")
PERMISSION_CLEARED = ("owner", "licensed", "fair_use")

# Secrets we expect in .env. Presence is reported by `doctor`; absence is only
# fatal for the phase that actually needs the secret.
SECRET_KEYS = (
    "ANTHROPIC_API_KEY",  # Phase 3 — highlight selection
    "POSTIZ_API_KEY",     # Phase 5 — posting
    "TELEGRAM_BOT_TOKEN",  # Phase 6 — approval bot
    "TELEGRAM_CHAT_ID",    # Phase 6 — where to send approvals
    "AYRSHARE_API_KEY",   # optional alt publisher
    "OPENAI_API_KEY",     # optional, only if whisper-api opt-in
)


def _load_dotenv(path: Path) -> dict[str, str]:
    """Minimal .env parser.

    We avoid a hard dependency on python-dotenv so that the startup
    ``doctor`` check runs even on a bare machine. If python-dotenv *is*
    installed we use it (handles quoting/export edge cases); otherwise we
    fall back to this small parser. Values already present in the real
    environment win, so you can override .env from the shell.
    """
    loaded: dict[str, str] = {}
    if not path.exists():
        return loaded

    try:  # Prefer python-dotenv when available.
        from dotenv import dotenv_values

        for k, v in dotenv_values(path).items():
            if v is not None:
                loaded[k] = v
    except Exception:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[len("export "):]
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key:
                loaded[key] = val

    # Push into the process environment without clobbering real env vars.
    for k, v in loaded.items():
        os.environ.setdefault(k, v)
    return loaded


@dataclass
class Source:
    url: str
    type: str = "video"  # video | channel | playlist
    permission_status: str = "unverified"

    @property
    def is_permission_cleared(self) -> bool:
        return self.permission_status in PERMISSION_CLEARED


@dataclass
class Config:
    """Parsed, path-resolved configuration."""

    raw: dict[str, Any]
    root: Path = PROJECT_ROOT

    # ---- convenience accessors -------------------------------------------
    def get(self, *keys: str, default: Any = None) -> Any:
        node: Any = self.raw
        for k in keys:
            if not isinstance(node, dict) or k not in node:
                return default
            node = node[k]
        return node

    @property
    def sources(self) -> list[Source]:
        out: list[Source] = []
        for item in self.raw.get("sources") or []:
            if isinstance(item, str):
                out.append(Source(url=item))
            elif isinstance(item, dict) and item.get("url"):
                out.append(
                    Source(
                        url=item["url"],
                        type=item.get("type", "video"),
                        permission_status=str(
                            item.get("permission_status", "unverified")
                        ).lower(),
                    )
                )
        return out

    # ---- resolved paths ---------------------------------------------------
    def path(self, key: str) -> Path:
        """Return a configured path under ``paths:`` resolved to the root."""
        raw = self.get("paths", key, default=None)
        if raw is None:
            raise KeyError(f"paths.{key} is not configured")
        p = Path(raw)
        return p if p.is_absolute() else (self.root / p)

    @property
    def ledger_db(self) -> Path:
        return self.path("ledger_db")

    @property
    def data_dirs(self) -> list[Path]:
        keys = ("data_dir", "inbox", "ready", "work", "transcripts")
        return [self.path(k) for k in keys if self.get("paths", k)]

    def ensure_dirs(self) -> list[Path]:
        created: list[Path] = []
        for d in self.data_dirs:
            if not d.exists():
                d.mkdir(parents=True, exist_ok=True)
                created.append(d)
        self.ledger_db.parent.mkdir(parents=True, exist_ok=True)
        return created

    # ---- secrets ----------------------------------------------------------
    @staticmethod
    def secret(key: str) -> str | None:
        return os.environ.get(key)

    @property
    def hook_score_threshold(self) -> int:
        return int(self.get("clip", "hook_score_threshold", default=7))

    @property
    def claude_model(self) -> str:
        return str(self.get("claude", "model", default="claude-opus-4-8"))


def load_config(config_path: Path | None = None, env_path: Path | None = None) -> Config:
    """Load config.yaml + .env into a :class:`Config`."""
    cfg_path = config_path or (PROJECT_ROOT / "config.yaml")
    env_file = env_path or (PROJECT_ROOT / ".env")

    _load_dotenv(env_file)

    if not cfg_path.exists():
        raise FileNotFoundError(
            f"config.yaml not found at {cfg_path}. Copy it from the repo or run setup."
        )

    with cfg_path.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    if not isinstance(raw, dict):
        raise ValueError("config.yaml must parse to a mapping/object at the top level")

    return Config(raw=raw)
