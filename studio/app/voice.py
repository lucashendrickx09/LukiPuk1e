"""Text-to-speech with word-level timings.

Engines (in preference order for `auto`):
  kokoro — Kokoro-82M, local, Apache-2.0, near-commercial quality, real word timestamps
  edge   — edge-tts (Microsoft neural voices, free, network) with WordBoundary timings
  mock   — silent audio + uniform timings; used by tests and `--dry-run`

All engines return (wav_path, words, duration) where words is a list of
Word(text, start, end) in seconds, aligned to the written wav.
"""

from __future__ import annotations

import shutil
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path

from . import formula


@dataclass
class Word:
    text: str
    start: float
    end: float


class MockEngine:
    """Silence at speaking pace — deterministic, offline, instant."""
    name = "mock"

    def synth(self, text: str, voice: str, out_wav: Path) -> tuple[list[Word], float]:
        tokens = text.split()
        duration = max(1.0, len(tokens) / formula.WORDS_PER_SECOND)
        rate = 24000
        n = int(duration * rate)
        with wave.open(str(out_wav), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(b"\x00\x00" * n)
        per = duration / max(1, len(tokens))
        words = [Word(t, i * per, (i + 1) * per) for i, t in enumerate(tokens)]
        return words, duration


class KokoroEngine:
    """Kokoro-82M local TTS. `pip install -r requirements-voice.txt`."""
    name = "kokoro"

    def __init__(self):
        from kokoro import KPipeline  # noqa — heavy import, only when selected
        import numpy as np
        self._np = np
        self._pipeline = KPipeline(lang_code="a")  # American English

    def synth(self, text: str, voice: str, out_wav: Path) -> tuple[list[Word], float]:
        np = self._np
        rate = 24000
        chunks, words, offset = [], [], 0.0
        for result in self._pipeline(text, voice=voice or "af_heart"):
            audio = result.audio
            if hasattr(audio, "numpy"):
                audio = audio.numpy()
            chunks.append(audio)
            for tok in (result.tokens or []):
                if tok.start_ts is None or tok.end_ts is None or not tok.text.strip():
                    continue
                words.append(Word(tok.text.strip(), offset + tok.start_ts, offset + tok.end_ts))
            offset += len(audio) / rate
        full = np.concatenate(chunks) if chunks else np.zeros(rate, dtype="float32")
        pcm = (np.clip(full, -1, 1) * 32767).astype("<i2")
        with wave.open(str(out_wav), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(pcm.tobytes())
        return words, offset


class EdgeEngine:
    """edge-tts fallback (network). Voices like en-US-ChristopherNeural.
    Kokoro-style voice names (af_*/am_*/bf_*/bm_*) are mapped to Edge equivalents
    so a channel config written for Kokoro still works on the fallback."""
    name = "edge"

    KOKORO_MAP = {"af": "en-US-AriaNeural", "am": "en-US-ChristopherNeural",
                  "bf": "en-GB-SoniaNeural", "bm": "en-GB-RyanNeural"}

    def synth(self, text: str, voice: str, out_wav: Path) -> tuple[list[Word], float]:
        import asyncio
        import edge_tts  # noqa

        if voice and "Neural" not in voice:
            voice = self.KOKORO_MAP.get(voice.split("_")[0], "en-US-ChristopherNeural")

        async def run():
            communicate = edge_tts.Communicate(text, voice or "en-US-ChristopherNeural")
            mp3_path = out_wav.with_suffix(".mp3")
            words = []
            with open(mp3_path, "wb") as f:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        f.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        start = chunk["offset"] / 10_000_000
                        end = start + chunk["duration"] / 10_000_000
                        words.append(Word(chunk["text"], start, end))
            return mp3_path, words

        mp3_path, words = asyncio.run(run())
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp3_path),
                        "-ar", "24000", "-ac", "1", str(out_wav)], check=True)
        mp3_path.unlink(missing_ok=True)
        duration = words[-1].end + 0.3 if words else 1.0
        return words, duration


def pick_engine(preference: str = "auto"):
    """Resolve the configured engine; `auto` prefers local kokoro, then edge, then mock."""
    if preference == "mock":
        return MockEngine()
    if preference in ("kokoro", "auto"):
        try:
            return KokoroEngine()
        except Exception:
            if preference == "kokoro":
                raise RuntimeError("kokoro requested but not installed — pip install -r requirements-voice.txt")
    if preference in ("edge", "auto"):
        try:
            import edge_tts  # noqa
            return EdgeEngine()
        except ImportError:
            if preference == "edge":
                raise RuntimeError("edge-tts requested but not installed — pip install edge-tts")
    if preference == "auto":
        return MockEngine()  # last resort; doctor warns about this
    raise ValueError(f"unknown tts engine {preference!r}")


def apply_rate(wav_path: Path, words: list[Word], rate: float) -> tuple[Path, list[Word]]:
    """Speed the VO up (atempo) and rescale word timings to match. Shorts VO plays ~1.05-1.15x."""
    if abs(rate - 1.0) < 1e-3:
        return wav_path, words
    if shutil.which("ffmpeg") is None:
        return wav_path, words
    out = wav_path.with_name(wav_path.stem + f"_r{rate:.2f}.wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path),
                    "-filter:a", f"atempo={rate}", str(out)], check=True)
    scaled = [Word(w.text, w.start / rate, w.end / rate) for w in words]
    return out, scaled
