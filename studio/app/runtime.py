"""Runtime environment helpers — the same code runs three ways:

  1. from source (dev / tests)         -> repo `studio/` is both resources and data
  2. as a PyInstaller one-file app     -> resources live in the extracted bundle
                                          (sys._MEIPASS), data lives in %APPDATA%
  3. as a PyInstaller one-folder app   -> resources next to the executable

The point: read-only things (config.yaml default, webui, assets, bundled ffmpeg)
come from the *resource root*, while everything we write (ledger, renders, .env,
brand kit, reports) goes to a *writable user dir* that survives app updates.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "ShortsStudio"


def is_frozen() -> bool:
    """True when running inside a PyInstaller bundle."""
    return bool(getattr(sys, "frozen", False))


def resource_root() -> Path:
    """Where bundled read-only resources live (config.yaml, webui, assets, ffmpeg)."""
    if is_frozen():
        # one-file: _MEIPASS is the temp extraction dir; one-folder: exe's dir
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parent.parent  # the repo's studio/ directory


def user_dir() -> Path:
    """Writable location for data, .env, renders. In dev this is the repo's
    studio/ dir (so behavior and tests are unchanged); as a bundled app it's a
    per-user folder that persists across app updates."""
    if is_frozen():
        base = os.environ.get("APPDATA") or os.environ.get("XDG_DATA_HOME") \
            or os.path.expanduser("~")
        d = Path(base) / APP_NAME
    else:
        d = resource_root()
    d.mkdir(parents=True, exist_ok=True)
    return d


def ensure_ffmpeg_on_path() -> bool:
    """If a bundled ffmpeg/ffprobe ships with the app, put its folder on PATH so
    shutil.which('ffmpeg') finds it. Returns True if bundled binaries were added.
    A system ffmpeg (dev machines) still works — this just adds a fallback."""
    exe = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    candidates = [
        resource_root() / "ffmpeg",
        resource_root(),
        Path(sys.executable).resolve().parent / "ffmpeg",
    ]
    for folder in candidates:
        if (folder / exe).exists():
            os.environ["PATH"] = str(folder) + os.pathsep + os.environ.get("PATH", "")
            return True
    return False
