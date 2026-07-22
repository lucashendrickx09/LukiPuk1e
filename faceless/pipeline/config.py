"""Configuration loading.

`load_config()` reads config.yaml (if present), deep-merges it over the
built-in defaults, and returns a `Config` supporting dotted access:

    cfg = load_config()
    cfg["video.fps"]            -> 30
    cfg.get("upload.enabled")   -> False
    cfg.video                   -> {"width": 1080, ...}
"""

from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any

import yaml

# Repo-relative default location of config.yaml (faceless/config.yaml).
_PKG_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = _PKG_DIR.parent

DEFAULTS: dict[str, Any] = {
    "niche": "",
    "channel_name": "",
    "video": {
        "width": 1080,
        "height": 1920,
        "fps": 30,
        "encoder": "libx264",
        "crf": 19,
        "nvenc_cq": 21,
        "preset": "medium",
        "pixel_format": "yuv420p",
    },
    "kenburns": {
        "enabled": True,
        "scale_factor": 2.0,
        "zoom_max": 1.15,
        "direction": "alternate",
    },
    "tts": {
        "voice": "af_heart",
        "lang_code": "a",
        "speed": 1.0,
        "sample_rate": 24000,
    },
    "align": {
        "model": "large-v3",
        "device": "cuda",
        "compute_type": "float16",
        "language": "en",
        "beam_size": 5,
    },
    "visuals": {
        "fallback_to_card": True,
        "card": {"template": "assets/templates/card.html", "scale": 2},
        "stock": {"orientation": "portrait", "min_duration": 3, "per_page": 15},
        "generated": {
            "model": "black-forest-labs/FLUX.1-schnell",
            "steps": 4,
            "guidance": 0.0,
            "enable_cpu_offload": True,
            "vae_slicing": True,
        },
    },
    "audio": {
        "music_db": -20.0,
        "music_fade": 1.0,
        "whoosh_db": -8.0,
        "music_dir": "assets/music",
        "sfx_dir": "assets/sfx",
        "whoosh_file": "",
        "music_file": "",
        "out_sample_rate": 48000,
        "out_bitrate": "192k",
    },
    "captions": {
        "enabled": True,
        "font": "DejaVu Sans",
        "font_size": 96,
        "primary_color": "&H0000F0FF",
        "secondary_color": "&H00FFFFFF",
        "outline_color": "&H00000000",
        "outline": 6,
        "shadow": 2,
        "max_words_per_line": 3,
        "max_gap": 0.6,
        "margin_v": 420,
        "uppercase": True,
    },
    "upload": {
        "enabled": False,
        "privacy": "private",
        "category_id": "27",
        "self_declared_made_for_kids": False,
        "contains_synthetic_media": True,
        "synthetic_disclosure_text": (
            "Some sounds or visuals in this video were digitally generated "
            "or altered."
        ),
        "client_secrets": "client_secret.json",
        "token_file": "youtube_token.json",
    },
    "paths": {
        "scripts": "scripts.json",
        "state_db": "state.db",
        "work": "work",
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    """Return base deep-merged with override (override wins)."""
    out = copy.deepcopy(base)
    for key, val in (override or {}).items():
        if key in out and isinstance(out[key], dict) and isinstance(val, dict):
            out[key] = _deep_merge(out[key], val)
        else:
            out[key] = copy.deepcopy(val)
    return out


class Config:
    """Dict wrapper with dotted-key access and attribute access to sections."""

    def __init__(self, data: dict[str, Any], root: Path):
        self._data = data
        # Directory that relative paths in the config resolve against.
        self.root = root

    # -- access helpers ---------------------------------------------------
    def get(self, dotted: str, default: Any = None) -> Any:
        node: Any = self._data
        for part in dotted.split("."):
            if isinstance(node, dict) and part in node:
                node = node[part]
            else:
                return default
        return node

    def __getitem__(self, dotted: str) -> Any:
        sentinel = object()
        val = self.get(dotted, sentinel)
        if val is sentinel:
            raise KeyError(dotted)
        return val

    def __getattr__(self, name: str) -> Any:
        # Attribute access to top-level sections, e.g. cfg.video.
        data = self.__dict__.get("_data", {})
        if name in data:
            return data[name]
        raise AttributeError(name)

    def as_dict(self) -> dict[str, Any]:
        return copy.deepcopy(self._data)

    # -- path resolution --------------------------------------------------
    def resolve(self, dotted_or_path: str) -> Path:
        """Resolve a config path value (or literal path) against the project
        root. Absolute paths are returned unchanged."""
        val = self.get(dotted_or_path, dotted_or_path)
        p = Path(val)
        return p if p.is_absolute() else (self.root / p)


def load_config(path: str | os.PathLike | None = None) -> Config:
    """Load config.yaml deep-merged over DEFAULTS.

    Search order for the config file: explicit `path` arg, then
    $FACELESS_CONFIG, then <project_root>/config.yaml.
    """
    if path is None:
        path = os.environ.get("FACELESS_CONFIG")
    if path is None:
        path = PROJECT_ROOT / "config.yaml"
    path = Path(path)

    root = path.parent if path.exists() else PROJECT_ROOT
    user_data: dict[str, Any] = {}
    if path.exists():
        with open(path, "r", encoding="utf-8") as fh:
            user_data = yaml.safe_load(fh) or {}

    merged = _deep_merge(DEFAULTS, user_data)
    return Config(merged, root=root.resolve())
