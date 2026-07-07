"""Karaoke captions (.ass) from word timings — the word-pop caption style natively.

Words are grouped into chunks of <=3 words / <=1.2s; each chunk is one Dialogue
event with per-word \\k karaoke timing. Unspoken words render in white, the spoken
word fills with the theme accent color — big, bold, center-screen.
"""

from __future__ import annotations

import random
import re
from pathlib import Path

from .voice import Word

MAX_WORDS_PER_CHUNK = 3
MAX_CHUNK_SECONDS = 1.2

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Pop,{font},{size},{accent},{base},&H00101010,&H96000000,-1,0,0,0,100,100,1,0,1,{outline},2,5,60,60,{margin_v},1
Style: Hook,{font},76,{accent},{accent},&H00101010,&H96000000,-1,0,0,0,100,100,1,0,1,6,2,8,70,70,340,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _ts(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int(seconds % 3600 // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _esc(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def _bgr(hex_rgb: str) -> str:
    """#RRGGBB -> ASS &H00BBGGRR."""
    h = hex_rgb.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()


def chunk_words(words: list[Word]) -> list[list[Word]]:
    chunks: list[list[Word]] = []
    current: list[Word] = []
    for w in words:
        if current and (len(current) >= MAX_WORDS_PER_CHUNK
                        or w.end - current[0].start > MAX_CHUNK_SECONDS):
            chunks.append(current)
            current = []
        current.append(w)
    if current:
        chunks.append(current)
    return chunks


_EMPHASIS_RE = re.compile(r"[\d$%€£]")


def build_ass(words: list[Word], out_path: str | Path, *, accent: str = "#FFD400",
              base: str = "#FFFFFF", font: str = "DejaVu Sans", size: int = 112,
              margin_v: int = 780, outline: int = 7,
              hook_text: str | None = None, hook_until: float | None = None,
              animate: bool = True, seed: int = 7) -> Path:
    """margin_v=780 with Alignment=5 centers the block slightly below mid-screen,
    clear of the Shorts UI (title at bottom, buttons at right).

    If hook_text is given, it is shown as a top-of-screen card from frame 0 until
    hook_until — the swipe decision happens in the first second, so the promise
    must be readable at t=0, before the first spoken word.

    animate=True gives every caption chunk a bounce-in (scale overshoot + a tiny
    seeded rotation) and money/number words a size pop — the hyper-edited look.
    """
    out_path = Path(out_path)
    rng = random.Random(seed)
    lines = [ASS_HEADER.format(font=font, size=size, accent=_bgr(accent), base=_bgr(base),
                               margin_v=margin_v, outline=outline)]
    if hook_text:
        end = hook_until if hook_until and hook_until > 0 else 2.5
        intro = ("{\\fscx84\\fscy84\\t(0,110,\\fscx103\\fscy103)"
                 "\\t(110,190,\\fscx100\\fscy100)\\fad(50,70)}") if animate else ""
        lines.append(f"Dialogue: 0,{_ts(0)},{_ts(end)},Hook,,0,0,0,,{intro}{_esc(hook_text.upper())}\n")
    for chunk in chunk_words(words):
        start, end = chunk[0].start, chunk[-1].end
        parts = []
        cursor = start
        prev_emph = False
        for w in chunk:
            # lead silence inside the chunk becomes part of the word's karaoke time
            dur_cs = max(1, round((w.end - cursor) * 100))
            tag = f"\\k{dur_cs}"
            emph = bool(_EMPHASIS_RE.search(w.text))
            if emph:
                tag += f"\\fs{int(size * 1.22)}"
            elif prev_emph:
                tag += f"\\fs{size}"
            prev_emph = emph
            parts.append(f"{{{tag}}}{_esc(w.text)}")
            cursor = w.end
        pop = ""
        if animate:
            rot = rng.uniform(-2.6, 2.6)
            pop = (f"{{\\fscx74\\fscy74\\frz{rot:.1f}"
                   f"\\t(0,80,\\fscx110\\fscy110\\frz{rot / 3:.1f})"
                   f"\\t(80,150,\\fscx100\\fscy100\\frz0)\\fad(30,0)}}")
        text = pop + " ".join(parts)
        lines.append(f"Dialogue: 0,{_ts(start)},{_ts(end)},Pop,,0,0,0,,{text}\n")
    out_path.write_text("".join(lines), encoding="utf-8")
    return out_path
