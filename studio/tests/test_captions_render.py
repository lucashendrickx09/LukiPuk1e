import shutil
from pathlib import Path

import pytest

from app import captions, render, visuals
from app.voice import MockEngine, Word

HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def test_chunking_respects_limits():
    words = [Word(f"w{i}", i * 0.4, (i + 1) * 0.4) for i in range(10)]
    chunks = captions.chunk_words(words)
    assert all(len(c) <= captions.MAX_WORDS_PER_CHUNK for c in chunks)
    assert sum(len(c) for c in chunks) == 10


def test_ass_file_has_karaoke_tags(tmp_path):
    words = [Word("hello", 0.0, 0.4), Word("brave", 0.4, 0.8), Word("world", 0.8, 1.3)]
    out = captions.build_ass(words, tmp_path / "t.ass", accent="#FFD400")
    text = out.read_text()
    assert "PlayResX: 1080" in text and "PlayResY: 1920" in text
    assert "\\k" in text
    assert "hello" in text and "world" in text
    # accent #FFD400 -> ASS BGR &H0000D4FF
    assert "&H0000D4FF" in text


def test_ass_escapes_braces(tmp_path):
    words = [Word("{evil}", 0.0, 0.5)]
    out = captions.build_ass(words, tmp_path / "t.ass")
    assert "{evil}" not in out.read_text()
    assert "(evil)" in out.read_text()


def test_build_command_structure(tmp_path):
    theme = visuals.theme_for("midnight")
    cmd = render.build_command(tmp_path / "v.wav", tmp_path / "c.ass", tmp_path / "o.mp4",
                               theme, duration=25.0, seed=42)
    joined = " ".join(cmd)
    assert cmd[0] == "ffmpeg"
    assert "gradients=s=1080x1920" in joined
    assert "loudnorm" in joined
    assert "libx264" in joined
    assert "-t 25.000" in joined


def test_theme_fallback():
    assert visuals.theme_for("nonexistent") == visuals.THEMES["midnight"]


@pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg not installed")
def test_full_render_produces_playable_video(tmp_path):
    engine = MockEngine()
    wav = tmp_path / "voice.wav"
    words, duration = engine.synth("this is a five second render test okay now", "x", wav)
    out = tmp_path / "out.mp4"
    path, dur = render.render(wav, words, out, theme=visuals.theme_for("ember"),
                              seed=7, workdir=tmp_path)
    assert path.exists() and path.stat().st_size > 10_000
    expected = words[-1].end + render.LEAD_IN + render.TAIL
    assert abs(dur - expected) < 0.6
