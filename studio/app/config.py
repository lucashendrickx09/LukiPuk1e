"""Configuration loading: config.yaml + .env, resolved paths, channel definitions."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent

# Niche monetization tiers (RPM component of the formula, 0..1).
# Sources: 2026 Shorts RPM-by-niche surveys — finance/business/tech monetize
# 3-10x entertainment; see RESEARCH.md §2.
RPM_TIERS = {
    "finance": 1.00, "business": 0.95, "investing": 1.00, "tech": 0.85,
    "ai": 0.85, "career": 0.80, "productivity": 0.75, "education": 0.70,
    "health": 0.70, "psychology": 0.65, "history": 0.55, "science": 0.60,
    "luxury": 0.60, "travel": 0.50, "sports": 0.45, "gaming": 0.35,
    "entertainment": 0.30, "facts": 0.40,
}


@dataclass
class ChannelConfig:
    name: str                      # internal id, e.g. "channel_a"
    handle: str = ""               # @handle on YouTube (informational)
    niche: str = "finance"         # key into RPM_TIERS (or free text w/ rpm_tier set)
    audience: str = "US"           # primary audience geo (informational, prompts use it)
    persona: str = ""              # one-line voice/brand persona used in prompts
    voice: str = "af_heart"        # kokoro voice (or edge-tts voice name)
    voice_rate: float = 1.08       # speech speed multiplier applied after synthesis
    theme: str = "midnight"        # visual theme key (app/visuals.py)
    visual_style: str = "scenes"   # scenes (animated story graphics) | gradient (plain)
    slots: list[str] = field(default_factory=lambda: ["12:30", "19:30"])
    timezone: str = "America/New_York"  # viewers' timezone for slot scheduling
    category_id: str = "27"        # YouTube category (27=Education, 28=Sci&Tech, 24=Entertainment)
    client_secret_file: str = ""   # OAuth client secret JSON (own GCP project recommended)
    token_file: str = ""           # stored OAuth token path (created by `run.py auth`)
    seed_topics: list[str] = field(default_factory=list)  # evergreen idea bank
    rpm_tier: float | None = None  # explicit override of RPM_TIERS lookup

    @property
    def rpm(self) -> float:
        if self.rpm_tier is not None:
            return max(0.0, min(1.0, float(self.rpm_tier)))
        return RPM_TIERS.get(self.niche.lower(), 0.5)


@dataclass
class Config:
    root: Path
    data_dir: Path
    model: str = "claude-opus-4-8"
    anthropic_api_key: str = ""
    channels: list[ChannelConfig] = field(default_factory=list)
    # formula
    weights_stage1: dict = field(default_factory=lambda: {"trend": 0.30, "rpm": 0.25, "novelty": 0.20, "prior": 0.25})
    weights_stage2: dict = field(default_factory=lambda: {"idea": 0.45, "hook": 0.30, "retention": 0.25})
    epsilon: float = 0.20            # exploration share of slots
    script_threshold: float = 0.55   # minimum S2 score to render
    target_seconds: tuple = (18, 40)  # hard band; scoring peaks at 20-32s
    # cadence
    videos_per_day: int = 2          # per channel (2 slots)
    review_required: bool = True     # nothing publishes without human approval
    review_auto_above: float | None = None  # auto-approve videos scoring >= this (full autopilot)
    # voice / sound
    tts_engine: str = "auto"         # auto | kokoro | edge | mock
    sfx: bool = True                 # whoosh on cuts + pop on emoji lands
    # publishing
    publish_mode: str = "api"        # api | export  (export = pack for manual upload)
    min_lead_minutes: int = 45       # earliest schedulable slot from "now"
    # goals (mission control tracks progress against these)
    goal_subscribers: int = 100_000

    def channel(self, name: str) -> ChannelConfig:
        for ch in self.channels:
            if ch.name == name:
                return ch
        raise KeyError(f"unknown channel: {name!r} (have: {[c.name for c in self.channels]})")

    @property
    def ledger_path(self) -> Path:
        return self.data_dir / "ledger.db"


def _load_env(root: Path) -> dict:
    """Tiny .env parser (KEY=VALUE lines, # comments). Env vars win over file."""
    env: dict[str, str] = {}
    envfile = root / ".env"
    if envfile.exists():
        for line in envfile.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip("'\"")
    env.update({k: v for k, v in os.environ.items() if k.startswith(("ANTHROPIC", "STUDIO"))})
    return env


def load_config(path: str | Path | None = None) -> Config:
    from . import runtime
    root = runtime.resource_root()          # read-only: config.yaml default, assets, webui
    udir = runtime.user_dir()               # writable: .env, data, renders (== root in dev)
    # prefer a user-editable config.yaml (bundled app writes one on first run);
    # fall back to the default shipped in the bundle
    if path:
        cfg_path = Path(path)
    elif (udir / "config.yaml").exists():
        cfg_path = udir / "config.yaml"
    else:
        cfg_path = root / "config.yaml"
    raw = yaml.safe_load(cfg_path.read_text()) if cfg_path.exists() else {}
    raw = raw or {}
    env = _load_env(udir)

    channels = [ChannelConfig(**c) for c in raw.get("channels", [])]
    # resolve per-channel OAuth secret/token paths into the writable user dir so
    # they work no matter what folder the app is launched from
    for ch in channels:
        for attr in ("client_secret_file", "token_file"):
            v = getattr(ch, attr)
            if v and not Path(v).is_absolute():
                setattr(ch, attr, str(udir / v))
    data_dir = Path(raw.get("data_dir", udir / "data"))
    data_dir.mkdir(parents=True, exist_ok=True)

    formula = raw.get("formula", {})
    cadence = raw.get("cadence", {})
    publishing = raw.get("publishing", {})

    cfg = Config(
        root=root,
        data_dir=data_dir,
        model=raw.get("model", "claude-opus-4-8"),
        anthropic_api_key=env.get("ANTHROPIC_API_KEY", ""),
        channels=channels,
        weights_stage1=formula.get("weights_stage1", Config.__dataclass_fields__["weights_stage1"].default_factory()),
        weights_stage2=formula.get("weights_stage2", Config.__dataclass_fields__["weights_stage2"].default_factory()),
        epsilon=float(formula.get("epsilon", 0.20)),
        script_threshold=float(formula.get("script_threshold", 0.55)),
        target_seconds=tuple(formula.get("target_seconds", (18, 40))),
        videos_per_day=int(cadence.get("videos_per_day", 2)),
        review_required=bool(raw.get("review", {}).get("required", True)),
        review_auto_above=(float(raw["review"]["auto_above"])
                           if raw.get("review", {}).get("auto_above") is not None else None),
        tts_engine=raw.get("voice", {}).get("engine", "auto"),
        sfx=bool(raw.get("sound", {}).get("effects", True)),
        publish_mode=publishing.get("mode", "api"),
        min_lead_minutes=int(publishing.get("min_lead_minutes", 45)),
        goal_subscribers=int(raw.get("goals", {}).get("subscribers", 100_000)),
    )
    return cfg
