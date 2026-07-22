"""Map word-level alignment onto script scenes.

The narration TTS speaks is the concatenation of the scenes' text in order, so
the aligned word stream can be sliced back into per-scene time ranges by word
count. Scenes are tiled contiguously (each scene ends exactly where the next
begins) so the visuals cover the whole audio track with no gaps.
"""

from __future__ import annotations

import re
from typing import Any


def _word_count(text: str) -> int:
    return len(re.findall(r"[^\s]+", text or ""))


def assign_scene_times(
    scenes: list[dict[str, Any]],
    words: list[dict[str, Any]],
    audio_duration: float,
) -> list[dict[str, float]]:
    """Return [{start, end, duration}] per scene, contiguous over the audio.

    Boundaries are placed by cumulative word proportion, which is robust to
    small mismatches between the script's word split and whisper's tokens.
    Falls back to equal division if there is no usable alignment.
    """
    n_scenes = len(scenes)
    if n_scenes == 0:
        return []

    counts = [max(1, _word_count(s.get("text", ""))) for s in scenes]
    total_words = sum(counts)

    usable = [w for w in words if str(w.get("word", "")).strip()]
    if len(usable) < n_scenes:
        # No / too few timings: split the audio evenly.
        step = audio_duration / n_scenes
        return [
            {"start": round(i * step, 3),
             "end": round((i + 1) * step, 3),
             "duration": round(step, 3)}
            for i in range(n_scenes)
        ]

    # Cumulative word index -> boundary time (start of the word at that index).
    cum = 0
    starts = [0.0]
    for c in counts[:-1]:
        cum += c
        idx = min(len(usable) - 1, round(cum / total_words * len(usable)))
        starts.append(float(usable[idx]["start"]))

    # Keep boundaries monotonically increasing.
    for i in range(1, len(starts)):
        if starts[i] <= starts[i - 1]:
            starts[i] = starts[i - 1] + 0.05

    ends = starts[1:] + [max(audio_duration, starts[-1] + 0.1)]

    out = []
    for s, e in zip(starts, ends):
        out.append({"start": round(s, 3), "end": round(e, 3),
                    "duration": round(e - s, 3)})
    return out
