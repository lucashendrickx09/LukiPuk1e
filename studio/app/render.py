"""Final assembly: voice + procedural background + karaoke captions -> 1080x1920 mp4."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from . import captions, visuals
from .voice import Word

LEAD_IN = 0.20   # silence before the first word (frame 1 must already show the hook text soon)
TAIL = 0.60      # hold after the last word so the loop line lands


def ffprobe_duration(path: str | Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, check=True)
    return float(json.loads(out.stdout)["format"]["duration"])


def build_command(voice_wav: Path, ass_path: Path, out_mp4: Path, theme: dict,
                  duration: float, seed: int) -> list[str]:
    """Pure function -> ffmpeg argv (unit-testable without running ffmpeg)."""
    vf = visuals.video_filters(theme, duration, str(ass_path))
    return [
        "ffmpeg", "-y", "-loglevel", "error",
        *visuals.background_input(theme, duration, seed),
        "-i", str(voice_wav),
        "-filter_complex",
        f"[0:v]{vf}[v];[1:a]adelay={int(LEAD_IN*1000)}|{int(LEAD_IN*1000)},apad,"
        f"loudnorm=I=-14:TP=-1.5:LRA=11[a]",
        "-map", "[v]", "-map", "[a]",
        "-t", f"{duration:.3f}",
        "-r", str(visuals.FPS),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
        "-movflags", "+faststart",
        str(out_mp4),
    ]


def render(voice_wav: Path, words: list[Word], out_mp4: Path, *, theme: dict,
           seed: int, workdir: Path | None = None,
           hook_text: str | None = None, hook_seconds: float | None = None) -> tuple[Path, float]:
    """Render the final short. Returns (path, duration_seconds).

    hook_text/hook_seconds put the hook on screen as a card from frame 0 until
    the spoken hook ends (hook_seconds, unshifted voice timeline).
    """
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found — install it (brew install ffmpeg / apt install ffmpeg)")
    out_mp4 = Path(out_mp4)
    workdir = Path(workdir) if workdir else out_mp4.parent
    workdir.mkdir(parents=True, exist_ok=True)

    shifted = [Word(w.text, w.start + LEAD_IN, w.end + LEAD_IN) for w in words]
    ass_path = workdir / (out_mp4.stem + ".ass")
    hook_until = (hook_seconds + LEAD_IN) if hook_seconds else None
    captions.build_ass(shifted, ass_path, accent=theme["accent"],
                       hook_text=hook_text, hook_until=hook_until)

    duration = (shifted[-1].end if shifted else LEAD_IN + 1.0) + TAIL
    cmd = build_command(voice_wav, ass_path, out_mp4, theme, duration, seed)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{proc.stderr[-2000:]}")
    if not out_mp4.exists() or out_mp4.stat().st_size < 10_000:
        raise RuntimeError("render produced no/empty output")
    return out_mp4, ffprobe_duration(out_mp4)
