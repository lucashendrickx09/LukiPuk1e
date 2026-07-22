"""Generate ASS karaoke captions from word-level timings (align.json).

Style: a few words per line, big and bold, centered in the lower third, each
word "popping" from the secondary colour to the primary colour exactly when
it is spoken. This is the standard TikTok/Shorts caption look.

Karaoke maths: within a Dialogue line, each word gets a `{\\k<cs>}` tag whose
centisecond value equals the time until the *next* word starts. Because those
durations telescope, word i flips colour at exactly (word[i].start - line
start), i.e. precisely when it is spoken.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def _fmt_ts(seconds: float) -> str:
    """Seconds -> ASS timestamp H:MM:SS.cs (centisecond precision)."""
    seconds = max(0.0, seconds)
    cs = int(round(seconds * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def _escape(text: str) -> str:
    return text.replace("{", "(").replace("}", ")").replace("\n", " ")


def group_words(
    words: list[dict], max_words: int, max_gap: float
) -> list[list[dict]]:
    """Chunk words into caption lines by word count and pause length."""
    lines: list[list[dict]] = []
    current: list[dict] = []
    for w in words:
        if not str(w.get("word", "")).strip():
            continue
        if current:
            gap = float(w["start"]) - float(current[-1]["end"])
            if len(current) >= max_words or gap > max_gap:
                lines.append(current)
                current = []
        current.append(w)
    if current:
        lines.append(current)
    return lines


def build_ass(
    words: list[dict],
    caps: dict[str, Any],
    width: int,
    height: int,
) -> str:
    """Return a complete ASS document string."""
    font = caps.get("font", "DejaVu Sans")
    size = int(caps.get("font_size", 96))
    primary = caps.get("primary_color", "&H0000F0FF")
    secondary = caps.get("secondary_color", "&H00FFFFFF")
    outline_color = caps.get("outline_color", "&H00000000")
    outline = caps.get("outline", 6)
    shadow = caps.get("shadow", 2)
    margin_v = int(caps.get("margin_v", 420))
    upper = bool(caps.get("uppercase", True))

    # Alignment 2 = bottom-center; MarginV lifts it into the lower third.
    style = (
        "Style: Karaoke,{font},{size},{primary},{secondary},{outline_c},"
        "&H64000000,-1,0,0,0,100,100,0,0,1,{outline},{shadow},2,60,60,"
        "{mv},1".format(
            font=font, size=size, primary=primary, secondary=secondary,
            outline_c=outline_color, outline=outline, shadow=shadow, mv=margin_v,
        )
    )

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{style}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events: list[str] = []
    for line in group_words(words, caps.get("max_words_per_line", 3),
                            caps.get("max_gap", 0.6)):
        start = float(line[0]["start"])
        end = float(line[-1]["end"])
        parts: list[str] = []
        for i, w in enumerate(line):
            text = str(w["word"]).strip()
            if upper:
                text = text.upper()
            if i + 1 < len(line):
                dur = float(line[i + 1]["start"]) - float(w["start"])
            else:
                dur = float(w["end"]) - float(w["start"])
            k = max(1, int(round(dur * 100)))
            parts.append(f"{{\\k{k}}}{_escape(text)}")
        # Plain spaces so libass can wrap a wide line (WrapStyle 0) instead of
        # letting it run off both edges of the frame.
        text = " ".join(parts)
        events.append(
            f"Dialogue: 0,{_fmt_ts(start)},{_fmt_ts(end)},Karaoke,,0,0,0,,{text}"
        )

    return header + "\n".join(events) + "\n"


def write_ass(
    path: str | Path,
    words: list[dict],
    caps: dict[str, Any],
    width: int,
    height: int,
) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build_ass(words, caps, width, height), encoding="utf-8")
    return path
