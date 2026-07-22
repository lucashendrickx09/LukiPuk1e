"""Fast self-test of the pure logic (no models, no GPU, no network).

    python -m tools.selftest

Covers config merge, the state DB queue/stages, narration building, scene-time
assignment, and ASS caption generation. ffmpeg/Kokoro/whisper are NOT exercised
here — see tools/make_dummies.py + `python -m pipeline.assemble` for that.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import captions, timing  # noqa: E402
from pipeline.config import load_config  # noqa: E402
from pipeline.script import build_narration, slugify  # noqa: E402
from pipeline.state import State, script_key  # noqa: E402

_passed = 0


def check(name: str, cond: bool) -> None:
    global _passed
    mark = "\033[32mPASS\033[0m" if cond else "\033[31mFAIL\033[0m"
    print(f"  [{mark}] {name}")
    if not cond:
        raise AssertionError(name)
    _passed += 1


def test_config() -> None:
    cfg = load_config()
    check("config: dotted access", cfg["video.width"] == 1080)
    check("config: default fallback", cfg.get("nope.nope", 7) == 7)
    check("config: section attr", isinstance(cfg.video, dict))


def test_state() -> None:
    with tempfile.TemporaryDirectory() as d:
        st = State(Path(d) / "state.db")
        s1 = {"title": "One", "hook": "h1", "scenes": []}
        s2 = {"title": "Two", "hook": "h2", "scenes": []}
        check("state: sync adds 2", st.sync_scripts([s1, s2]) == 2)
        check("state: sync dedupes", st.sync_scripts([s1, s2]) == 0)
        nxt = st.peek_next_script()
        check("state: peek is first", nxt["title"] == "One")
        st.create_video("0001_one", script_key(s1), "One")
        st.claim_script(script_key(s1), "0001_one")
        check("state: next after claim is Two",
              st.peek_next_script()["title"] == "Two")
        st.set_stage("0001_one", "tts", "done", "voice.wav")
        check("state: stage recorded",
              st.stage_map("0001_one").get("tts") == "done")
        st.set_upload("0001_one", "YTID123", "uploaded")
        check("state: upload recorded",
              st.get_video("0001_one")["youtube_id"] == "YTID123")
        st.close()


def test_script_helpers() -> None:
    script = {"scenes": [{"text": "Hello world"}, {"text": "Second line"}]}
    narr = build_narration(script)
    check("narration: joins scenes + punctuation",
          narr == "Hello world. Second line.")
    check("slugify", slugify("The Lighthouse: Keepers!") == "the-lighthouse-keepers")


def test_timing() -> None:
    scenes = [{"text": "one two three"}, {"text": "four five"},
              {"text": "six seven eight nine"}]
    words = [{"word": w, "start": i * 1.0, "end": i * 1.0 + 0.8}
             for i, w in enumerate(
                 "one two three four five six seven eight nine".split())]
    times = timing.assign_scene_times(scenes, words, audio_duration=9.0)
    check("timing: one range per scene", len(times) == 3)
    check("timing: starts at 0", times[0]["start"] == 0.0)
    check("timing: contiguous (no gaps)",
          all(abs(times[i]["end"] - times[i + 1]["start"]) < 1e-6
              for i in range(len(times) - 1)))
    check("timing: covers full audio", abs(times[-1]["end"] - 9.0) < 1e-6)
    check("timing: monotonic",
          all(t["end"] > t["start"] for t in times))
    # Fallback path (no usable words) -> even split.
    even = timing.assign_scene_times(scenes, [], audio_duration=9.0)
    check("timing: fallback even split", abs(even[0]["duration"] - 3.0) < 1e-6)


def test_captions() -> None:
    words = [{"word": w, "start": i * 0.5, "end": i * 0.5 + 0.4}
             for i, w in enumerate("alpha beta gamma delta epsilon".split())]
    caps = load_config().as_dict()["captions"]
    ass = captions.build_ass(words, caps, 1080, 1920)
    check("captions: has header", "[V4+ Styles]" in ass and "PlayResX: 1080" in ass)
    check("captions: has dialogue", "Dialogue:" in ass)
    check("captions: has karaoke tags", "\\k" in ass)
    check("captions: wraps by max_words",
          ass.count("Dialogue:") == 2)  # 5 words / 3 per line -> 2 lines
    # Timestamp of first line == first word start.
    check("captions: first line starts at 0", "0:00:00.00," in ass)


def main() -> int:
    print("faceless selftest")
    for fn in (test_config, test_state, test_script_helpers, test_timing,
               test_captions):
        print(f"\n{fn.__name__}:")
        fn()
    print(f"\n\033[32mALL {_passed} CHECKS PASSED\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
