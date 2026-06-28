"""yt-dlp wrapper (Phase 1).

Thin, testable layer over the ``yt-dlp`` CLI. Two jobs:

- ``enumerate(source)`` -> the list of videos a source points at (one entry for
  a single video; newest-first uploads for a channel/playlist).
- ``download(entry, dest)`` -> pull the media file into ``/inbox``.

The pipeline depends only on the :class:`Provider` protocol, so tests inject a
fake and CI never needs the network (Hard Rule: fail loud, stay resumable —
real failures surface as exceptions the caller records in the ledger).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


class YtDlpError(RuntimeError):
    """Raised when yt-dlp is missing or returns a non-zero / unparseable result."""


@dataclass
class Entry:
    """One video discovered from a source."""

    id: str
    url: str
    title: str | None = None
    duration_sec: float | None = None


def classify_url(url: str) -> str:
    """Best-effort URL type: ``video`` | ``channel`` | ``playlist``.

    yt-dlp is the final authority at enumerate time; this just gives a sensible
    default for ``source add --type auto``.
    """
    u = url.lower()
    if "/playlist" in u or ("list=" in u and "watch?v=" not in u):
        return "playlist"
    if "/@" in u or any(s in u for s in ("/channel/", "/c/", "/user/")):
        return "channel"
    return "video"


class Provider(Protocol):
    def enumerate(self, url: str, source_type: str, limit: int | None) -> list[Entry]:
        ...

    def download(self, entry: Entry, dest_dir: Path) -> Path:
        ...


class YtDlpProvider:
    """Real provider backed by the ``yt-dlp`` binary."""

    def __init__(self, binary: str = "yt-dlp", extra_args: list[str] | None = None):
        self.binary = binary
        self.extra_args = extra_args or []

    # -- internals ----------------------------------------------------------
    def _ensure(self) -> None:
        if shutil.which(self.binary) is None:
            raise YtDlpError(
                f"`{self.binary}` not found. Install it (see README): "
                "python3 -m pip install -U yt-dlp"
            )

    def _run_json(self, args: list[str]) -> list[dict]:
        """Run yt-dlp with -J/-j and return parsed JSON objects (one per line)."""
        self._ensure()
        proc = subprocess.run(
            [self.binary, *self.extra_args, *args],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise YtDlpError(
                f"yt-dlp failed ({proc.returncode}): {proc.stderr.strip()[:500]}"
            )
        out: list[dict] = []
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        if not out:
            raise YtDlpError("yt-dlp returned no parseable JSON for: " + " ".join(args))
        return out

    # -- protocol -----------------------------------------------------------
    def enumerate(self, url: str, source_type: str, limit: int | None) -> list[Entry]:
        if source_type == "video":
            data = self._run_json(["-J", "--no-playlist", url])[0]
            return [
                Entry(
                    id=data["id"],
                    url=data.get("webpage_url", url),
                    title=data.get("title"),
                    duration_sec=data.get("duration"),
                )
            ]

        # channel / playlist: flat (fast) listing, newest-first as yt-dlp returns.
        args = ["-J", "--flat-playlist"]
        if limit:
            args += ["--playlist-end", str(limit)]
        args.append(url)
        top = self._run_json(args)[0]
        entries = top.get("entries") or []
        out: list[Entry] = []
        for e in entries:
            if not e or not e.get("id"):
                continue
            out.append(
                Entry(
                    id=e["id"],
                    url=e.get("url") or e.get("webpage_url") or f"https://youtu.be/{e['id']}",
                    title=e.get("title"),
                    duration_sec=e.get("duration"),
                )
            )
        return out

    def download(self, entry: Entry, dest_dir: Path) -> Path:
        self._ensure()
        dest_dir.mkdir(parents=True, exist_ok=True)
        out_tmpl = str(dest_dir / "%(id)s.%(ext)s")
        cmd = [
            self.binary,
            *self.extra_args,
            "--no-playlist",
            "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
            "--merge-output-format", "mp4",
            "-o", out_tmpl,
            entry.url,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise YtDlpError(
                f"download failed for {entry.id} ({proc.returncode}): "
                f"{proc.stderr.strip()[:500]}"
            )
        matches = sorted(dest_dir.glob(f"{entry.id}.*"))
        # Prefer the merged mp4 if multiple intermediate files lingered.
        for m in matches:
            if m.suffix.lower() == ".mp4":
                return m
        if matches:
            return matches[0]
        raise YtDlpError(
            f"download reported success but no file found for {entry.id} in {dest_dir}"
        )


def make_provider(cfg) -> YtDlpProvider:
    """Build the default provider from config."""
    binary = cfg.get("ingest", "yt_dlp_bin", default="yt-dlp")
    extra = cfg.get("ingest", "yt_dlp_extra_args", default=None) or []
    return YtDlpProvider(binary=binary, extra_args=list(extra))
