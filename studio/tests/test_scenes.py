import shutil

import pytest
from PIL import Image

from app import pipeline, render, scenes, visuals
from app.scriptgen import Script
from app.voice import MockEngine, Word
from tests.conftest import GOOD_SCRIPT

HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None

THEME = visuals.THEMES["midnight"]


@pytest.mark.parametrize("kind", scenes.KINDS)
def test_every_scene_kind_renders(tmp_path, kind):
    scene = {"kind": kind, "headline": "Sam Walton bet everything", "sub": "1962 First store;1970 IPO;1985 Richest",
             "value": "$2.8B", "label": "net worth, 1985", "points": [1, 3, 8, 20, 55]}
    out = scenes.render_scene(scene, THEME, seed=7, out_png=tmp_path / f"{kind}.png")
    im = Image.open(out)
    assert im.size == (scenes.SCENE_W, scenes.SCENE_H)
    assert out.stat().st_size > 5_000


def test_scene_tolerates_empty_fields(tmp_path):
    for kind in scenes.KINDS:
        out = scenes.render_scene({"kind": kind}, THEME, seed=1, out_png=tmp_path / f"e_{kind}.png")
        assert out.exists()


def test_aligned_scenes_pads_and_truncates():
    script = Script.from_dict(GOOD_SCRIPT)  # 4 beats -> needs 6 scenes; fixture has 6
    aligned = pipeline._aligned_scenes(script)
    assert len(aligned) == 6
    script.scenes = script.scenes[:2]  # too few -> pad with ambient
    aligned = pipeline._aligned_scenes(script)
    assert len(aligned) == 6 and aligned[-1]["kind"] == "ambient"
    script.scenes = [dict(s) for s in GOOD_SCRIPT["scenes"]] * 3  # too many -> truncate
    assert len(pipeline._aligned_scenes(script)) == 6


def test_segment_ends_monotonic_and_cover_voice():
    script = Script.from_dict(GOOD_SCRIPT)
    engine = MockEngine()
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as td:
        words, _ = engine.synth(script.spoken_text(), "x", Path(td) / "v.wav")
    ends = pipeline._segment_ends(script, words)
    assert len(ends) == 2 + len(script.beats)
    assert all(b > a for a, b in zip(ends, ends[1:]))
    assert abs(ends[-1] - words[-1].end) < 1e-6


def test_build_story_command_structure(tmp_path):
    pairs = [(tmp_path / "s0.png", 3.0), (tmp_path / "s1.png", 4.5)]
    cmd = render.build_story_command(pairs, tmp_path / "v.wav", tmp_path / "c.ass",
                                     tmp_path / "o.mp4", THEME, total_duration=7.5)
    joined = " ".join(cmd)
    assert joined.count("zoompan") == 2
    assert "concat=n=2:v=1:a=0" in joined
    assert "loudnorm" in joined and "libx264" in joined
    assert "-t 3.000" in joined and "-t 4.500" in joined  # per-scene input durations


@pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg not installed")
def test_story_render_end_to_end(tmp_path):
    words = [Word(w, i * 0.4, (i + 1) * 0.4) for i, w in enumerate(
        "sam walton was broke then he built walmart stores".split())]
    wav = tmp_path / "v.wav"
    MockEngine().synth("sam walton was broke then he built walmart stores", "x", wav)
    pngs = [
        scenes.render_scene({"kind": "big_stat", "value": "$2.8B", "label": "1985"}, THEME, 1, tmp_path / "a.png"),
        scenes.render_scene({"kind": "chart_up", "points": [1, 4, 9]}, THEME, 2, tmp_path / "b.png"),
    ]
    seg_ends = [1.6, words[-1].end]
    out, dur = render.render_story(wav, words, pngs, seg_ends, tmp_path / "story.mp4",
                                   theme=THEME, hook_text="Broke at 44", hook_seconds=1.6,
                                   workdir=tmp_path)
    assert out.exists() and out.stat().st_size > 10_000
    expected = words[-1].end + render.LEAD_IN + render.TAIL
    assert abs(dur - expected) < 0.6
