"""Native sound effects — synthesized once with ffmpeg, cached, mixed into renders.

Two effects cover the reference-video sound language:
  whoosh — a shaped noise burst on every scene cut (the "edit impact")
  pop    — a pitch-drop blip when an emoji lands

Both are pure synthesis (lavfi), so there are no sample-pack licenses and no
downloads. Gains are deliberately conservative: effects must sit under the voice,
never compete with it.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

WHOOSH_GAIN = 0.30
POP_GAIN = 0.45

_RECIPES = {
    # brown noise, band-limited, quick fade in / longer fade out
    "whoosh.wav": [
        "-f", "lavfi", "-i", "anoisesrc=d=0.42:c=brown:r=48000:a=0.9",
        "-af", "highpass=f=150,lowpass=f=1600,"
               "afade=t=in:d=0.10,afade=t=out:st=0.18:d=0.24,volume=1.4",
    ],
    # descending sine blip with an exponential decay
    "pop.wav": [
        "-f", "lavfi", "-i",
        "aevalsrc=sin(2*PI*(760-950*t)*t)*exp(-20*t):d=0.22:s=48000",
        "-af", "volume=0.9",
    ],
}


def ensure(cache_dir: str | Path) -> dict[str, Path]:
    """Synthesize the SFX bank into cache_dir if missing. Returns name->path."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found")
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    for name, args in _RECIPES.items():
        path = cache_dir / name
        if not path.exists() or path.stat().st_size < 1000:
            proc = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args, str(path)],
                                  capture_output=True, text=True)
            if proc.returncode != 0:
                raise RuntimeError(f"sfx synth failed for {name}:\n{proc.stderr[-500:]}")
        out[name.split(".")[0]] = path
    return out


def story_events(cut_times: list[float], emoji_times: list[float],
                 bank: dict[str, Path], max_events: int = 16) -> list[tuple[Path, float, float]]:
    """(wav, at_seconds, gain) for a story render: whoosh slightly before each cut
    lands, pop when each emoji drops in."""
    events: list[tuple[Path, float, float]] = []
    for t in cut_times:
        events.append((bank["whoosh"], max(0.0, t - 0.10), WHOOSH_GAIN))
    for t in emoji_times:
        events.append((bank["pop"], t, POP_GAIN))
    events.sort(key=lambda e: e[1])
    return events[:max_events]
