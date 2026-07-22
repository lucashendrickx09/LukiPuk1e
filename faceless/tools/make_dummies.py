"""Generate dummy assets so assemble.py can be validated without the model
stages (TTS / whisper / visuals). Produces, for a given video id:

    work/<id>/voice.wav        24kHz mono tone (stands in for narration)
    work/<id>/scenes/00.png    card still  (drawtext on a solid colour)
    work/<id>/scenes/01.png    generated still
    work/<id>/scenes/02.mp4    stock clip  (landscape + short -> loop/crop test)
    work/<id>/scenes/03.png    card still
    work/<id>/scenes.json      manifest with per-scene timings
    work/<id>/align.json       fake word-level timings for the caption test

and drops a music bed + whoosh SFX into assets/ so the audio mix runs.

    python -m tools.make_dummies [video_id]
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.config import load_config  # noqa: E402
from pipeline.paths import VideoPaths  # noqa: E402

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def ff(args: list[str]) -> None:
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args]
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True)


def make_card(path: Path, text: str, bg: str, w: int, h: int) -> None:
    ff([
        "-f", "lavfi", "-i", f"color=c={bg}:s={w}x{h}:d=1",
        "-vf",
        (f"drawtext=fontfile={FONT}:text='{text}':fontcolor=white:"
         f"fontsize=110:x=(w-tw)/2:y=(h-th)/2:borderw=6:bordercolor=black"),
        "-frames:v", "1", str(path),
    ])


def main() -> None:
    video_id = sys.argv[1] if len(sys.argv) > 1 else "dummy"
    cfg = load_config()
    w, h = int(cfg["video.width"]), int(cfg["video.height"])
    sr = int(cfg["tts.sample_rate"])

    vp = VideoPaths(cfg.resolve("paths.work"), video_id).ensure()

    scenes_spec = [
        {"type": "card", "text": "THE HOOK", "bg": "0x0f172a", "dur": 3.0},
        {"type": "generated", "text": "A TWIST", "bg": "0x3b0764", "dur": 4.0},
        {"type": "stock", "text": None, "bg": None, "dur": 4.0},
        {"type": "card", "text": "THE PAYOFF", "bg": "0x134e4a", "dur": 3.0},
    ]

    scenes = []
    t = 0.0
    for i, spec in enumerate(scenes_spec):
        still = spec["type"] in ("card", "generated")
        if still:
            asset = vp.scene_asset(i, "png")
            make_card(asset, spec["text"], spec["bg"], w, h)
        else:
            # Landscape 1280x720, only 2s (< scene dur) -> exercises the
            # scale/crop-to-portrait and -stream_loop code paths.
            asset = vp.scene_asset(i, "mp4")
            ff([
                "-f", "lavfi", "-i", "testsrc2=s=1280x720:d=2:r=30",
                "-pix_fmt", "yuv420p", str(asset),
            ])
        scenes.append({
            "index": i,
            "type": spec["type"],
            "asset": str(asset.relative_to(vp.dir)),
            "start": round(t, 3),
            "end": round(t + spec["dur"], 3),
            "duration": spec["dur"],
            "still": still,
            "text": spec["text"] or "",
        })
        t += spec["dur"]

    total = round(t, 3)

    # Narration stand-in: 24kHz mono tone for the whole duration.
    ff([
        "-f", "lavfi", "-i",
        f"sine=frequency=200:duration={total}:sample_rate={sr}",
        "-ac", "1", str(vp.voice_wav),
    ])

    # scenes.json
    vp.scenes_json.write_text(json.dumps(
        {"scenes": scenes, "total_duration": total}, indent=2))

    # align.json: fake ~2 words/sec so captions have something to render.
    words = []
    sample = ("this is a dummy narration used to prove the karaoke caption "
              "timing and the whoosh cuts and the ducked music bed all line "
              "up correctly across every scene in the finished short").split()
    n = len(sample)
    step = total / n
    for i, wd in enumerate(sample):
        start = round(i * step, 3)
        words.append({"word": wd, "start": start, "end": round(start + step * 0.85, 3)})
    vp.align_json.write_text(json.dumps({"words": words, "text": " ".join(sample)}, indent=2))

    # Music bed (short -> loop test) + whoosh SFX, into assets/.
    music_dir = cfg.resolve("audio.music_dir"); music_dir.mkdir(parents=True, exist_ok=True)
    sfx_dir = cfg.resolve("audio.sfx_dir"); sfx_dir.mkdir(parents=True, exist_ok=True)
    ff([
        "-f", "lavfi", "-i", "sine=frequency=90:duration=5",
        "-af", "tremolo=f=4:d=0.6", str(music_dir / "dummy_bed.mp3"),
    ])
    ff([
        "-f", "lavfi", "-i", "anoisesrc=d=0.45:color=pink:amplitude=0.6",
        "-af", "afade=t=in:st=0:d=0.05,afade=t=out:st=0.15:d=0.3",
        str(sfx_dir / "dummy_whoosh.wav"),
    ])

    print(f"\nDummy assets ready for video_id='{video_id}' "
          f"({len(scenes)} scenes, {total:.1f}s).")
    print(f"  {vp.dir}")


if __name__ == "__main__":
    main()
