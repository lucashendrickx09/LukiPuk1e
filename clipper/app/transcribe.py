"""Phase 2 — transcription (word-level timestamps).

Turns each downloaded video into a normalized transcript with both a sentence
*segment* map and *word*-level timestamps (needed for clean cuts in Phase 3 and
karaoke captions in Phase 4). The transcript is cached to disk as JSON and keyed
into the ledger.

Backends (chosen by config `transcription.engine`):
- whisper.cpp (default): extract 16 kHz mono WAV with ffmpeg, run the binary
  with full JSON output, reconstruct words from token offsets.
- faster-whisper (fallback): pure-Python, returns word timestamps directly.

Hard rules:
- Rule 3 (idempotency): a video already `transcribed` with its JSON on disk is
  skipped unless --force.
- Rule 4 (fail loud, resumable): per-video failures are logged and recorded as
  status=error; the run continues.
- Rule 5 (free/self-hosted): both backends are local; no API involved.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Protocol

from .config import Config
from . import ledger

log = logging.getLogger("clipper.transcribe")

# whisper.cpp special/non-text tokens look like "[_BEG_]", "[_TT_123]", etc.
_SPECIAL_TOKEN = re.compile(r"^\[_.*_?\]$|^\[_")


# ===========================================================================
# Normalized transcript model — the canonical shape every later phase reads.
# ===========================================================================
@dataclass
class Word:
    start: float
    end: float
    word: str
    prob: float | None = None


@dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclass
class Transcript:
    video_id: str
    engine: str
    model: str | None
    language: str | None
    duration_sec: float | None
    text: str
    segments: list[Segment] = field(default_factory=list)
    words: list[Word] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "video_id": self.video_id,
            "engine": self.engine,
            "model": self.model,
            "language": self.language,
            "duration_sec": self.duration_sec,
            "text": self.text,
            "segments": [asdict(s) for s in self.segments],
            "words": [asdict(w) for w in self.words],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Transcript":
        return cls(
            video_id=d["video_id"],
            engine=d["engine"],
            model=d.get("model"),
            language=d.get("language"),
            duration_sec=d.get("duration_sec"),
            text=d.get("text", ""),
            segments=[Segment(**s) for s in d.get("segments", [])],
            words=[Word(**w) for w in d.get("words", [])],
        )


# ===========================================================================
# whisper.cpp JSON parsing (pure functions — unit-tested without the binary)
# ===========================================================================
def _is_special(text: str) -> bool:
    return not text.strip() or bool(_SPECIAL_TOKEN.match(text.strip()))


def words_from_tokens(tokens: list[dict]) -> list[Word]:
    """Merge whisper.cpp sub-word tokens into whole words.

    A token whose text starts with a space begins a new word; offsets are in ms.
    Special tokens (timestamps/markers) are skipped.
    """
    words: list[Word] = []
    cur: list[str] = []
    cur_start: float | None = None
    cur_end: float | None = None
    probs: list[float] = []

    def flush() -> None:
        nonlocal cur, cur_start, cur_end, probs
        if cur and cur_start is not None:
            txt = "".join(cur).strip()
            if txt:
                avg = sum(probs) / len(probs) if probs else None
                words.append(Word(round(cur_start, 3), round(cur_end or cur_start, 3), txt, avg))
        cur, cur_start, cur_end, probs = [], None, None, []

    for tk in tokens:
        text = tk.get("text", "")
        if _is_special(text):
            continue
        off = tk.get("offsets") or {}
        s = off.get("from", 0) / 1000.0
        e = off.get("to", off.get("from", 0)) / 1000.0
        if text.startswith(" ") and cur:
            flush()
        if cur_start is None:
            cur_start = s
        cur.append(text)
        cur_end = e
        if tk.get("p") is not None:
            probs.append(float(tk["p"]))
    flush()
    return words


def parse_whisper_cpp_json(data: dict, video_id: str, model: str | None) -> Transcript:
    """Convert whisper.cpp ``--output-json-full`` output to a Transcript."""
    pieces = data.get("transcription", []) or []
    seg_objs: list[Segment] = []
    words: list[Word] = []
    full_text: list[str] = []

    for seg in pieces:
        off = seg.get("offsets") or {}
        s = off.get("from", 0) / 1000.0
        e = off.get("to", off.get("from", 0)) / 1000.0
        text = (seg.get("text") or "").strip()
        if text:
            seg_objs.append(Segment(round(s, 3), round(e, 3), text))
            full_text.append(text)
        words.extend(words_from_tokens(seg.get("tokens", []) or []))

    language = (data.get("result") or {}).get("language")
    duration = seg_objs[-1].end if seg_objs else None
    return Transcript(
        video_id=video_id,
        engine="whisper.cpp",
        model=model,
        language=language,
        duration_sec=duration,
        text=" ".join(full_text).strip(),
        segments=seg_objs,
        words=words,
    )


# ===========================================================================
# Backends
# ===========================================================================
class Transcriber(Protocol):
    name: str

    def transcribe(self, media_path: Path, video_id: str, language: str | None) -> Transcript:
        ...


def _extract_wav(media_path: Path, dest: Path, ffmpeg_bin: str = "ffmpeg") -> Path:
    """16 kHz mono PCM WAV — what whisper.cpp expects."""
    if shutil.which(ffmpeg_bin) is None:
        raise RuntimeError(f"`{ffmpeg_bin}` not found — needed to prep audio for whisper.cpp.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [ffmpeg_bin, "-y", "-i", str(media_path),
           "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(dest)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg audio extraction failed: {proc.stderr.strip()[:400]}")
    return dest


class WhisperCppTranscriber:
    name = "whisper.cpp"

    def __init__(self, binary: str, model_path: str, work_dir: Path,
                 ffmpeg_bin: str = "ffmpeg", extra_args: list[str] | None = None):
        self.binary = binary
        self.model_path = model_path
        self.work_dir = work_dir
        self.ffmpeg_bin = ffmpeg_bin
        self.extra_args = extra_args or []

    def transcribe(self, media_path: Path, video_id: str, language: str | None) -> Transcript:
        if shutil.which(self.binary) is None:
            raise RuntimeError(
                f"`{self.binary}` not found. Build whisper.cpp (see README) or set "
                "transcription.engine: faster-whisper."
            )
        if not Path(self.model_path).exists():
            raise RuntimeError(f"whisper model not found: {self.model_path}")

        wav = _extract_wav(media_path, self.work_dir / f"{video_id}.wav", self.ffmpeg_bin)
        out_base = self.work_dir / f"{video_id}.whisper"
        cmd = [self.binary, "-m", self.model_path, "-f", str(wav),
               "--output-json-full", "--output-file", str(out_base), "-np"]
        if language:
            cmd += ["-l", language]
        cmd += self.extra_args
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"whisper.cpp failed: {proc.stderr.strip()[:400]}")

        json_path = Path(str(out_base) + ".json")
        if not json_path.exists():
            raise RuntimeError(f"whisper.cpp produced no JSON at {json_path}")
        data = json.loads(json_path.read_text(encoding="utf-8"))
        wav.unlink(missing_ok=True)  # clean scratch audio
        return parse_whisper_cpp_json(data, video_id, Path(self.model_path).name)


class FasterWhisperTranscriber:
    name = "faster-whisper"

    def __init__(self, model: str, compute_type: str = "int8", device: str = "cpu"):
        self.model = model
        self.compute_type = compute_type
        self.device = device
        self._impl = None

    def _load(self):
        if self._impl is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise RuntimeError(
                    "faster-whisper not installed: python3 -m pip install faster-whisper"
                ) from exc
            self._impl = WhisperModel(self.model, device=self.device,
                                      compute_type=self.compute_type)
        return self._impl

    def transcribe(self, media_path: Path, video_id: str, language: str | None) -> Transcript:
        model = self._load()
        seg_iter, info = model.transcribe(
            str(media_path), language=language, word_timestamps=True,
        )
        seg_objs: list[Segment] = []
        words: list[Word] = []
        full_text: list[str] = []
        for seg in seg_iter:
            text = (seg.text or "").strip()
            if text:
                seg_objs.append(Segment(round(seg.start, 3), round(seg.end, 3), text))
                full_text.append(text)
            for w in (seg.words or []):
                words.append(Word(round(w.start, 3), round(w.end, 3),
                                  w.word.strip(), getattr(w, "probability", None)))
        return Transcript(
            video_id=video_id,
            engine="faster-whisper",
            model=self.model,
            language=getattr(info, "language", language),
            duration_sec=getattr(info, "duration", None),
            text=" ".join(full_text).strip(),
            segments=seg_objs,
            words=words,
        )


def make_transcriber(cfg: Config) -> Transcriber:
    engine = cfg.get("transcription", "engine", default="whisper.cpp")
    if engine == "faster-whisper":
        return FasterWhisperTranscriber(
            model=cfg.get("transcription", "model", default="base.en"),
            compute_type=cfg.get("transcription", "compute_type", default="int8"),
        )
    return WhisperCppTranscriber(
        binary=cfg.get("transcription", "whisper_cpp_bin", default="whisper-cli"),
        model_path=str(_resolve(cfg, cfg.get("transcription", "whisper_cpp_model_path",
                                             default="models/ggml-base.en.bin"))),
        work_dir=cfg.path("work"),
        ffmpeg_bin=cfg.get("transcription", "ffmpeg_bin", default="ffmpeg"),
        extra_args=list(cfg.get("transcription", "whisper_cpp_extra_args", default=[]) or []),
    )


def _resolve(cfg: Config, p: str) -> Path:
    path = Path(p)
    return path if path.is_absolute() else (cfg.root / path)


# ===========================================================================
# Orchestration
# ===========================================================================
@dataclass
class TranscribeReport:
    videos_seen: int = 0
    transcribed: int = 0
    skipped: int = 0
    errors: int = 0
    notes: list[str] = field(default_factory=list)

    def line(self) -> str:
        return (f"videos={self.videos_seen} transcribed={self.transcribed} "
                f"skipped={self.skipped} errors={self.errors}")


def run_transcribe(
    cfg: Config,
    transcriber: Transcriber | None = None,
    *,
    only_video: str | None = None,
    force: bool = False,
) -> TranscribeReport:
    ledger.init_db(cfg.ledger_db)
    cfg.ensure_dirs()
    transcripts_dir = cfg.path("transcripts")
    transcriber = transcriber or make_transcriber(cfg)
    report = TranscribeReport()

    with ledger.session(cfg.ledger_db) as conn:
        if only_video:
            row = ledger.get_video(conn, only_video)
            videos = [row] if row else []
        else:
            # transcribe downloaded videos; with --force also redo already-done ones
            videos = ledger.list_videos(conn, status="downloaded")
            if force:
                videos += ledger.list_videos(conn, status="transcribed")

        for v in videos:
            report.videos_seen += 1
            yt = v["youtube_id"]
            out_path = transcripts_dir / f"{yt}.json"

            # Rule 3: idempotency
            if not force and v["status"] == "transcribed" and out_path.exists():
                report.skipped += 1
                log.debug("skip %s (already transcribed)", yt)
                continue
            if not v["file_path"] or not Path(v["file_path"]).exists():
                report.errors += 1
                msg = f"{yt}: media file missing ({v['file_path']}) — re-run ingest."
                log.error(msg)
                report.notes.append(msg)
                ledger.set_video_status(conn, yt, "error", error=msg)
                continue

            # Rule 4: per-video fail-loud, resumable
            try:
                log.info("transcribing %s with %s ...", yt, transcriber.name)
                tr = transcriber.transcribe(Path(v["file_path"]), yt,
                                            cfg.get("transcription", "language", default=None))
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(json.dumps(tr.to_dict(), ensure_ascii=False, indent=2),
                                    encoding="utf-8")
                ledger.set_video_status(conn, yt, "transcribed",
                                        transcript_path=str(out_path),
                                        duration_sec=tr.duration_sec)
                ledger.upsert_transcript(
                    conn, v["id"], engine=tr.engine, model=tr.model,
                    language=tr.language, duration_sec=tr.duration_sec,
                    path=str(out_path), n_segments=len(tr.segments),
                    n_words=len(tr.words),
                    segments_json=json.dumps([asdict(s) for s in tr.segments]),
                )
                report.transcribed += 1
                log.info("done %s: %d segments, %d words", yt, len(tr.segments), len(tr.words))
            except Exception as exc:  # noqa: BLE001
                report.errors += 1
                ledger.set_video_status(conn, yt, "error", error=str(exc))
                msg = f"transcription failed for {yt}: {exc}"
                log.error(msg)
                report.notes.append(msg)

    return report
