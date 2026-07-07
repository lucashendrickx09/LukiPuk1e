"""Procedural visuals — the channel's own look, generated natively by ffmpeg.

No stock footage, no downloads: an animated multi-color gradient (seeded per video
so every upload is unique but on-brand), film grain, a vignette, and a progress bar.
This is deliberate: original visuals + original scripts keep the channel on the right
side of YouTube's inauthentic-content policy, and render in seconds on any CPU.
"""

from __future__ import annotations

import random

# Each theme: gradient colors (3), caption accent, progress bar color.
# "stars": scatter tiny stars into the background (scene renderer).
THEMES = {
    "noir":     {"colors": ["#050606", "#0B0D0C", "#101816"], "accent": "#35E87A", "bar": "#35E87A",
                 "stars": True},
    "midnight": {"colors": ["#0B1026", "#3B1D5A", "#0E4C92"], "accent": "#FFD400", "bar": "#FFD400"},
    "ember":    {"colors": ["#1A0B0B", "#7A1F1F", "#E25822"], "accent": "#FFE082", "bar": "#FF7043"},
    "forest":   {"colors": ["#07130D", "#14532D", "#1F7A4D"], "accent": "#B9F6CA", "bar": "#69F0AE"},
    "steel":    {"colors": ["#0B0F14", "#26323F", "#4A6572"], "accent": "#80D8FF", "bar": "#40C4FF"},
    "royal":    {"colors": ["#0D0221", "#3D087B", "#7B2CBF"], "accent": "#F9F871", "bar": "#C77DFF"},
}

W, H, FPS = 1080, 1920, 30


def theme_for(name: str) -> dict:
    return THEMES.get(name, THEMES["midnight"])


def _jitter_color(hex_rgb: str, rng: random.Random, amount: int = 18) -> str:
    """Small per-video hue drift so every upload is visually unique but on-brand."""
    h = hex_rgb.lstrip("#")
    channels = [int(h[i:i + 2], 16) for i in (0, 2, 4)]
    jittered = [max(0, min(255, c + rng.randint(-amount, amount))) for c in channels]
    return "0x" + "".join(f"{c:02X}" for c in jittered)


def background_input(theme: dict, duration: float, seed: int) -> list[str]:
    """The lavfi input args for the animated gradient background."""
    rng = random.Random(seed)
    c0, c1, c2 = (_jitter_color(c, rng) for c in theme["colors"])
    grad = (f"gradients=s={W}x{H}:d={duration:.3f}:speed=0.02:nb_colors=3"
            f":c0={c0}:c1={c1}:c2={c2}:seed={seed % 2**31}:type=linear:r={FPS}")
    return ["-f", "lavfi", "-i", grad]


def video_filters(theme: dict, duration: float, ass_path: str, progress_bar: bool = True) -> str:
    """Filter chain applied to the background: grain -> vignette -> progress bar -> captions."""
    bar_color = "0x" + theme["bar"].lstrip("#")
    steps = [
        "noise=alls=5:allf=t",          # film grain (temporal)
        "vignette=PI/5",                # focus the center
    ]
    if progress_bar:
        # drawbox width grows with t — reads as "almost done, stay" (retention aid)
        steps.append(f"drawbox=x=0:y=ih-14:w=iw*min(t/{duration:.3f}\\,1):h=14:color={bar_color}@0.9:t=fill")
    ass_escaped = ass_path.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    steps.append(f"ass='{ass_escaped}'")
    steps.append("format=yuv420p")
    return ",".join(steps)
