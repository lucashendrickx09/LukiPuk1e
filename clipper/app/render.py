"""Phase 4 — cut, reframe, caption, encode.

Turns each `candidate` clip into a finished 1080x1920 vertical short in /ready:

  1. ffmpeg cuts the segment [start, end] (already padded + word-snapped in P3).
  2. OpenCV tracks the primary face and reframes 16:9 -> 9:16 with a smoothed
     crop path; center-crop fallback (pure ffmpeg) when no face / no OpenCV.
  3. Karaoke word-by-word captions (ASS) burned from the whisper word timings.
  4. Audio loudness-normalized (ffmpeg loudnorm); H.264 ~30fps out.

The media work lives behind the :class:`ClipRenderer` protocol so orchestration
and all the pure helpers (ASS building, colour conversion, crop smoothing) are
unit-tested offline. The real :class:`FfmpegRenderer` fails loud if ffmpeg /
OpenCV are missing rather than dropping a clip (Rule 4).

Status flow: candidate -> cutting -> ready  (or -> error on failure).
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from .config import Config
from . import ledger
from .transcribe import Transcript, Word

log = logging.getLogger("clipper.render")


# ===========================================================================
# Pure helpers (unit-tested without ffmpeg/OpenCV)
# ===========================================================================
def hex_to_ass_color(hexstr: str) -> str:
    """`#RRGGBB` -> ASS `&H00BBGGRR` (alpha 00 = opaque)."""
    h = (hexstr or "").lstrip("#")
    if len(h) == 6:
        r, g, b = h[0:2], h[2:4], h[4:6]
        return f"&H00{b}{g}{r}".upper()
    return "&H00FFFFFF"


def _ass_time(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def caption_words(words: list[Word], start: float, end: float) -> list[tuple[float, float, str]]:
    """Words overlapping [start, end], rebased to clip-relative time and
    clipped to the clip bounds."""
    out: list[tuple[float, float, str]] = []
    for w in words:
        if w.end <= start or w.start >= end:
            continue
        t0 = max(0.0, w.start - start)
        t1 = max(t0, min(w.end, end) - start)
        text = (w.word or "").strip()
        if text:
            out.append((t0, t1, text))
    return out


def _ass_escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def build_ass(words_rel: list[tuple[float, float, str]], caption_cfg: dict,
              width: int, height: int) -> str:
    """Build an ASS subtitle file with karaoke (word-by-word) highlighting.

    PrimaryColour is the active/"sung" colour, SecondaryColour the base text —
    ASS sweeps Primary over each `\\k` syllable, giving the karaoke highlight.
    """
    font = caption_cfg.get("font", "Arial")
    size = int(caption_cfg.get("font_size", 64))
    highlight = hex_to_ass_color(caption_cfg.get("highlight_color", "#FFD400"))
    text_color = hex_to_ass_color(caption_cfg.get("text_color", "#FFFFFF"))
    outline_color = hex_to_ass_color(caption_cfg.get("outline_color", "#000000"))
    outline = int(caption_cfg.get("outline_width", 4))
    per_line = max(1, int(caption_cfg.get("max_words_per_line", 4)))
    pos = caption_cfg.get("position", "center")
    align = {"top": 8, "center": 5, "bottom": 2}.get(pos, 5)
    margin_v = int(caption_cfg.get("margin_v", 200))

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {width}\nPlayResY: {height}\n"
        "WrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
        "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
        "MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{font},{size},{highlight},{text_color},{outline_color},"
        f"&H64000000,1,0,0,0,100,100,0,0,1,{outline},1,{align},40,40,{margin_v},1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    lines: list[str] = []
    for i in range(0, len(words_rel), per_line):
        group = words_rel[i:i + per_line]
        if not group:
            continue
        line_start = group[0][0]
        line_end = group[-1][1]
        prev_end = line_start
        parts: list[str] = []
        for t0, t1, word in group:
            gap_cs = int(round(max(0.0, t0 - prev_end) * 100))
            if gap_cs > 0:
                parts.append(f"{{\\k{gap_cs}}}")
            dur_cs = max(1, int(round((t1 - t0) * 100)))
            parts.append(f"{{\\k{dur_cs}}}{_ass_escape(word)} ")
            prev_end = t1
        lines.append(
            f"Dialogue: 0,{_ass_time(line_start)},{_ass_time(line_end)},"
            f"Default,,0,0,0,,{''.join(parts).rstrip()}"
        )
    return header + "\n".join(lines) + "\n"


def smooth_centers(raw: list[float | None], frame_w: int, crop_w: int,
                   alpha: float) -> list[int]:
    """Exponential-moving-average smoothing of the crop centre x.

    `alpha` in [0,1] — higher = smoother/slower. `None` (no face) falls back to
    the frame centre. Each centre is clamped so the crop window stays in-frame.
    """
    half = crop_w / 2.0
    lo, hi = half, max(half, frame_w - half)
    out: list[int] = []
    prev: float | None = None
    for c in raw:
        target = (frame_w / 2.0) if c is None else float(c)
        target = min(max(target, lo), hi)
        cur = target if prev is None else (alpha * prev + (1 - alpha) * target)
        out.append(int(round(cur)))
        prev = cur
    return out


# ===========================================================================
# Renderer protocol + ffmpeg/OpenCV implementation
# ===========================================================================
class ClipRenderer(Protocol):
    def render(self, video_path: Path, start: float, end: float,
               words_rel: list[tuple[float, float, str]], out_path: Path,
               caption_cfg: dict, video_cfg: dict, work_dir: Path) -> Path:
        ...


class FfmpegRenderer:
    def __init__(self, ffmpeg_bin: str = "ffmpeg"):
        self.ffmpeg_bin = ffmpeg_bin

    def _run(self, args: list[str]) -> None:
        proc = subprocess.run([self.ffmpeg_bin, "-y", *args],
                              capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {proc.stderr.strip()[-500:]}")

    def render(self, video_path, start, end, words_rel, out_path,
               caption_cfg, video_cfg, work_dir) -> Path:
        if shutil.which(self.ffmpeg_bin) is None:
            raise RuntimeError(f"`{self.ffmpeg_bin}` not found — install ffmpeg (see README).")
        if not video_path.exists():
            raise RuntimeError(f"source video missing: {video_path}")
        work_dir.mkdir(parents=True, exist_ok=True)
        stem = out_path.stem
        tw = int(video_cfg.get("width", 1080))
        th = int(video_cfg.get("height", 1920))
        fps = int(video_cfg.get("fps", 30))
        loudnorm = bool(video_cfg.get("loudnorm", True))

        # 1) frame-accurate cut (re-encode; -ss after -i)
        cut = work_dir / f"{stem}.cut.mp4"
        self._run(["-i", str(video_path), "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
                   "-r", str(fps), "-c:v", "libx264", "-preset", "veryfast",
                   "-c:a", "aac", str(cut)])

        # 2) reframe 16:9 -> 9:16 (face-track via OpenCV, else center crop)
        reframed = work_dir / f"{stem}.reframe.mp4"
        mode = video_cfg.get("reframe", "face_track")
        used_facetrack = False
        if mode == "face_track":
            try:
                self._reframe_facetrack(cut, reframed, tw, th, fps,
                                        float(video_cfg.get("crop_smoothing", 0.85)))
                used_facetrack = True
            except Exception as exc:  # noqa: BLE001 — fall back, don't drop the clip
                log.warning("face-track reframe failed (%s); center-crop fallback", exc)
        if not used_facetrack:
            self._reframe_center(cut, reframed, tw, th, fps)

        # 3) karaoke captions
        ass = work_dir / f"{stem}.ass"
        ass.write_text(build_ass(words_rel, caption_cfg, tw, th), encoding="utf-8")

        # 4) burn captions + loudnorm + final H.264
        af = ["-af", "loudnorm"] if loudnorm else []
        ass_path = str(ass).replace("\\", "/").replace(":", "\\:")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        self._run(["-i", str(reframed), "-i", str(cut),
                   "-filter_complex", f"[0:v]ass='{ass_path}'[v]",
                   "-map", "[v]", "-map", "1:a?", *af,
                   "-r", str(fps), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                   "-c:a", "aac", "-movflags", "+faststart", str(out_path)])

        for tmp in (cut, reframed, ass):
            tmp.unlink(missing_ok=True)
        return out_path

    def _reframe_center(self, in_path, out_path, tw, th, fps) -> None:
        # crop the centre 9:16 column, scale to target. Pure ffmpeg.
        vf = (f"crop='min(iw,ih*{tw}/{th})':ih:(iw-min(iw,ih*{tw}/{th}))/2:0,"
              f"scale={tw}:{th}")
        self._run(["-i", str(in_path), "-an", "-vf", vf, "-r", str(fps),
                   "-c:v", "libx264", "-preset", "veryfast", str(out_path)])

    def _reframe_facetrack(self, in_path, out_path, tw, th, fps, alpha) -> None:
        import cv2  # noqa: import-outside-toplevel — only needed for this path

        cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        cap = cv2.VideoCapture(str(in_path))
        W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if W == 0 or H == 0:
            cap.release()
            raise RuntimeError("could not read source dimensions")
        crop_w = min(W, int(round(H * tw / th)))

        # pass 1: detect face centre per frame
        centers: list[float | None] = []
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, 1.2, 5, minSize=(60, 60))
            if len(faces):
                x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
                centers.append(x + w / 2.0)
            else:
                centers.append(None)
        cap.release()
        if not centers:
            raise RuntimeError("no frames decoded")
        smoothed = smooth_centers(centers, W, crop_w, alpha)

        # pass 2: crop + resize + write (no audio; muxed back later)
        cap = cv2.VideoCapture(str(in_path))
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(out_path), fourcc, fps, (tw, th))
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            cx = smoothed[min(i, len(smoothed) - 1)]
            x0 = int(min(max(cx - crop_w // 2, 0), W - crop_w))
            crop = frame[:, x0:x0 + crop_w]
            writer.write(cv2.resize(crop, (tw, th)))
            i += 1
        cap.release()
        writer.release()


def make_renderer(cfg: Config) -> FfmpegRenderer:
    return FfmpegRenderer(ffmpeg_bin=cfg.get("video", "ffmpeg_bin", default="ffmpeg"))


# ===========================================================================
# Orchestration
# ===========================================================================
@dataclass
class RenderReport:
    clips_seen: int = 0
    rendered: int = 0
    skipped: int = 0
    errors: int = 0
    notes: list[str] = field(default_factory=list)

    def line(self) -> str:
        return (f"clips={self.clips_seen} rendered={self.rendered} "
                f"skipped={self.skipped} errors={self.errors}")


def _video_words(video_row, cfg: Config) -> list[Word]:
    path = video_row["transcript_path"] if video_row else None
    if not path or not Path(path).exists():
        return []
    tr = Transcript.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))
    return tr.words


def run_render(
    cfg: Config,
    renderer: ClipRenderer | None = None,
    *,
    only_clip: int | None = None,
    force: bool = False,
) -> RenderReport:
    ledger.init_db(cfg.ledger_db)
    cfg.ensure_dirs()
    ready_dir = cfg.path("ready")
    work_dir = cfg.path("work")
    caption_cfg = cfg.get("caption", default={}) or {}
    video_cfg = cfg.get("video", default={}) or {}
    report = RenderReport()
    _words_cache: dict[int, list[Word]] = {}

    with ledger.session(cfg.ledger_db) as conn:
        if only_clip is not None:
            row = ledger.get_clip(conn, only_clip)
            clips = [row] if row else []
        else:
            clips = ledger.list_clips(conn, status="candidate")
            if force:
                clips += ledger.list_clips(conn, status="ready")

        if clips and renderer is None:
            renderer = make_renderer(cfg)

        for clip in clips:
            report.clips_seen += 1
            out_path = ready_dir / f"clip_{clip['id']}.mp4"

            if not force and clip["status"] == "ready" and out_path.exists():
                report.skipped += 1
                continue

            video = ledger.get_video_by_id(conn, clip["video_id"])
            if video is None or not video["file_path"] or not Path(video["file_path"]).exists():
                report.errors += 1
                msg = f"clip {clip['id']}: source video file missing — re-run ingest."
                log.error(msg)
                report.notes.append(msg)
                ledger.set_clip_status(conn, clip["id"], "error", error=msg)
                continue

            if clip["video_id"] not in _words_cache:
                _words_cache[clip["video_id"]] = _video_words(video, cfg)
            words_rel = caption_words(_words_cache[clip["video_id"]],
                                      clip["start_sec"], clip["end_sec"])

            ledger.set_clip_status(conn, clip["id"], "cutting")
            try:
                path = renderer.render(
                    Path(video["file_path"]), clip["start_sec"], clip["end_sec"],
                    words_rel, out_path, caption_cfg, video_cfg, work_dir)
                ledger.set_clip_status(conn, clip["id"], "ready", file_path=str(path))
                report.rendered += 1
                log.info("rendered clip %s -> %s", clip["id"], Path(path).name)
            except Exception as exc:  # noqa: BLE001 — fail loud, keep going
                report.errors += 1
                ledger.set_clip_status(conn, clip["id"], "error", error=str(exc))
                msg = f"render failed for clip {clip['id']}: {exc}"
                log.error(msg)
                report.notes.append(msg)

    return report
