"""Stage: align -> work/<id>/align.json  (word-level timings)

Runs faster-whisper large-v3 on voice.wav to get word timestamps, which drive
both scene timing (timing.py) and the karaoke captions (captions.py).

If faster-whisper is unavailable and FACELESS_ALLOW_FALLBACKS=1, the known
narration words are spread evenly across the audio (rough but synced-ish);
otherwise the stage raises.

Run standalone:  python -m pipeline.align <video_id> [--force]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional

from . import ffutil
from .config import Config, load_config
from .paths import VideoPaths
from .script import build_narration
from .util import fallbacks_allowed, warn


def _align_whisper(voice: Path, cfg: Config) -> dict:
    from faster_whisper import WhisperModel

    model = WhisperModel(
        cfg.get("align.model", "large-v3"),
        device=cfg.get("align.device", "cuda"),
        compute_type=cfg.get("align.compute_type", "float16"),
    )
    segments, info = model.transcribe(
        str(voice),
        language=cfg.get("align.language", "en"),
        beam_size=int(cfg.get("align.beam_size", 5)),
        word_timestamps=True,
    )

    words, seg_list, texts = [], [], []
    for seg in segments:
        seg_list.append({"start": round(seg.start, 3), "end": round(seg.end, 3),
                         "text": seg.text.strip()})
        texts.append(seg.text.strip())
        for w in (seg.words or []):
            token = w.word.strip()
            if token:
                words.append({"word": token, "start": round(w.start, 3),
                              "end": round(w.end, 3)})
    return {
        "words": words,
        "segments": seg_list,
        "text": " ".join(texts),
        "language": info.language,
        "engine": "faster-whisper/" + cfg.get("align.model", "large-v3"),
    }


def _align_even(voice: Path, text: str) -> dict:
    """Fallback: spread known words evenly across the audio duration."""
    dur = ffutil.duration(voice)
    tokens = text.split()
    n = max(1, len(tokens))
    step = dur / n
    words = []
    for i, tok in enumerate(tokens):
        start = i * step
        words.append({"word": tok, "start": round(start, 3),
                      "end": round(start + step * 0.85, 3)})
    return {"words": words, "segments": [], "text": text, "engine": "even-split"}


def align(
    video_id: str,
    cfg: Optional[Config] = None,
    force: bool = False,
) -> Path:
    cfg = cfg or load_config()
    vp = VideoPaths(cfg.resolve("paths.work"), video_id).ensure()
    out = vp.align_json

    if out.exists() and not force:
        print(f"[align] {out} exists -> skipping")
        return out
    if not vp.voice_wav.exists():
        raise FileNotFoundError(f"missing narration audio: {vp.voice_wav}")

    print(f"[align] transcribing {vp.voice_wav.name} "
          f"(model={cfg.get('align.model')}, device={cfg.get('align.device')})")
    try:
        data = _align_whisper(vp.voice_wav, cfg)
    except Exception as exc:
        if not fallbacks_allowed():
            raise RuntimeError(
                f"faster-whisper failed ({exc}). Install it "
                "(pip install faster-whisper) or set FACELESS_ALLOW_FALLBACKS=1 "
                "for an even-split fallback."
            ) from exc
        warn(f"faster-whisper unavailable ({exc}); using even-split timings.")
        text = build_narration(json.loads(vp.script_json.read_text())) \
            if vp.script_json.exists() else ""
        data = _align_even(vp.voice_wav, text)

    out.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"[align] done -> {out} ({len(data['words'])} words, "
          f"engine={data.get('engine')})")
    return out


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description="Align narration to word timings.")
    ap.add_argument("video_id")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--config", default=None)
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    align(args.video_id, cfg=cfg, force=args.force)


if __name__ == "__main__":
    main()
