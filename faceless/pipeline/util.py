"""Small shared helpers."""

from __future__ import annotations

import os


def fallbacks_allowed() -> bool:
    """Whether model-free fallbacks (placeholder TTS, naive alignment) may run.

    Off by default so a production run *fails loudly* when Kokoro / whisper are
    missing instead of silently emitting a broken video. Enable for smoke tests
    with FACELESS_ALLOW_FALLBACKS=1.
    """
    return os.environ.get("FACELESS_ALLOW_FALLBACKS", "0").lower() in (
        "1", "true", "yes", "on"
    )


def warn(msg: str) -> None:
    print(f"\033[1;33m[warn] {msg}\033[0m", flush=True)
