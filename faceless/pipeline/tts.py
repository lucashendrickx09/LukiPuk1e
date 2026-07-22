"""Stage: tts -> work/<id>/voice.wav  (24kHz mono)

Narration via Kokoro-82M. The spoken text is build_narration(script) so it
matches what the align stage will later time.

Kokoro is a small (82M) local model and needs no API. If it is unavailable and
FACELESS_ALLOW_FALLBACKS=1, a silent placeholder of the estimated length is
written instead (smoke tests only) — otherwise the stage raises.

Run standalone:  python -m pipeline.tts <video_id> [--force]
"""

from __future__ import annotations

import argparse
import json
import wave
from pathlib import Path
from typing import Optional

from .config import Config, load_config
from .paths import VideoPaths
from .script import build_narration
from .util import fallbacks_allowed, warn


def _write_wav_mono(path: Path, samples, sample_rate: int) -> None:
    """Write float [-1,1] samples as 16-bit mono WAV (no soundfile dep)."""
    import numpy as np

    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(np.asarray(samples, dtype="float32"), -1.0, 1.0) * 32767.0)
    pcm = pcm.astype("<i2")
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())


def _synth_kokoro(text: str, out: Path, cfg: Config) -> None:
    import numpy as np
    from kokoro import KPipeline

    voice = cfg.get("tts.voice", "af_heart")
    lang = cfg.get("tts.lang_code", "a")
    speed = float(cfg.get("tts.speed", 1.0))
    sr = int(cfg.get("tts.sample_rate", 24000))

    pipeline = KPipeline(lang_code=lang)
    chunks = []
    for _, _, audio in pipeline(text, voice=voice, speed=speed):
        arr = audio.detach().cpu().numpy() if hasattr(audio, "detach") else \
            np.asarray(audio)
        chunks.append(arr.astype("float32"))
    if not chunks:
        raise RuntimeError("Kokoro produced no audio")
    _write_wav_mono(out, np.concatenate(chunks), sr)


def _synth_placeholder(text: str, out: Path, cfg: Config) -> None:
    """Estimated-length near-silence (smoke tests). Not real speech."""
    import numpy as np

    sr = int(cfg.get("tts.sample_rate", 24000))
    words = max(1, len(text.split()))
    seconds = words / 2.6 + 0.8          # ~157 wpm + a little padding
    n = int(seconds * sr)
    # A very quiet tone so the file isn't pure digital silence.
    t = np.arange(n) / sr
    samples = 0.02 * np.sin(2 * np.pi * 180 * t)
    _write_wav_mono(out, samples, sr)
    warn(f"TTS placeholder written ({seconds:.1f}s) — install Kokoro for real "
         f"narration.")


def tts(
    video_id: str,
    cfg: Optional[Config] = None,
    force: bool = False,
) -> Path:
    cfg = cfg or load_config()
    vp = VideoPaths(cfg.resolve("paths.work"), video_id).ensure()
    out = vp.voice_wav

    if out.exists() and not force:
        print(f"[tts] {out} exists -> skipping")
        return out
    if not vp.script_json.exists():
        raise FileNotFoundError(f"missing script: {vp.script_json}")

    script = json.loads(vp.script_json.read_text())
    text = build_narration(script)
    if not text:
        raise ValueError("script produced empty narration")
    (vp.dir / "narration.txt").write_text(text, encoding="utf-8")

    print(f"[tts] synthesizing {len(text.split())} words "
          f"(voice={cfg.get('tts.voice')})")
    try:
        _synth_kokoro(text, out, cfg)
    except Exception as exc:
        if not fallbacks_allowed():
            raise RuntimeError(
                f"Kokoro TTS failed ({exc}). Install it "
                "(pip install kokoro soundfile) or set "
                "FACELESS_ALLOW_FALLBACKS=1 for a silent placeholder."
            ) from exc
        warn(f"Kokoro unavailable ({exc}); using placeholder.")
        _synth_placeholder(text, out, cfg)

    print(f"[tts] done -> {out}")
    return out


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description="Synthesize narration.")
    ap.add_argument("video_id")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--config", default=None)
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    tts(args.video_id, cfg=cfg, force=args.force)


if __name__ == "__main__":
    main()
