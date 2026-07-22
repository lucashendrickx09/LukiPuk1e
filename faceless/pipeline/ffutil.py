"""Thin wrappers around ffmpeg / ffprobe.

Central place for: locating the binaries, *logging every ffmpeg command to the
console before running it* (a hard requirement), and probing media.
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Optional

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")


class FfmpegError(RuntimeError):
    pass


def require_binaries() -> None:
    missing = [b for b in (FFMPEG, FFPROBE) if shutil.which(b) is None]
    if missing:
        raise FfmpegError(
            f"Required binaries not found on PATH: {', '.join(missing)}. "
            "Install ffmpeg (it ships ffprobe too)."
        )


def pretty(argv: list[str]) -> str:
    """Render an argv as a copy-pasteable one-liner."""
    return " ".join(shlex.quote(a) for a in argv)


def run(
    argv: list[str],
    log_path: Optional[Path] = None,
    quiet: bool = False,
    cwd: Optional[str] = None,
) -> None:
    """Run an ffmpeg (or any) command, echoing it first.

    stderr is streamed to `log_path` if given (and also surfaced on error).
    `cwd` sets the working directory (used so the ass filter can reference the
    caption file by basename, sidestepping Windows path escaping in filters).
    """
    if not quiet:
        print("\n\033[1;36m$ " + pretty(argv) + "\033[0m\n", flush=True)

    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(log_path, "w", encoding="utf-8") as log:
            proc = subprocess.run(
                argv, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                text=True, cwd=cwd,
            )
            log.write(proc.stderr or "")
    else:
        proc = subprocess.run(argv, stderr=subprocess.PIPE, text=True, cwd=cwd)

    if proc.returncode != 0:
        tail = "\n".join((proc.stderr or "").strip().splitlines()[-25:])
        raise FfmpegError(
            f"Command failed ({proc.returncode}):\n  {pretty(argv)}\n\n{tail}"
        )


def probe(path: str | Path) -> dict:
    argv = [
        FFPROBE, "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]
    out = subprocess.run(argv, capture_output=True, text=True)
    if out.returncode != 0:
        raise FfmpegError(f"ffprobe failed for {path}:\n{out.stderr}")
    return json.loads(out.stdout)


def duration(path: str | Path) -> float:
    """Duration in seconds (from container, falling back to a stream)."""
    info = probe(path)
    fmt_dur = info.get("format", {}).get("duration")
    if fmt_dur is not None:
        return float(fmt_dur)
    for stream in info.get("streams", []):
        if stream.get("duration") is not None:
            return float(stream["duration"])
    raise FfmpegError(f"Could not determine duration of {path}")


def video_dimensions(path: str | Path) -> tuple[int, int]:
    for stream in probe(path).get("streams", []):
        if stream.get("codec_type") == "video":
            return int(stream["width"]), int(stream["height"])
    raise FfmpegError(f"No video stream in {path}")


def has_video_stream(path: str | Path) -> bool:
    return any(
        s.get("codec_type") == "video" for s in probe(path).get("streams", [])
    )
