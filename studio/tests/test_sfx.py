import shutil

import pytest

from app import render, sfx, visuals

HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
THEME = visuals.THEMES["noir"]


@pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg not installed")
def test_sfx_bank_synthesizes_and_caches(tmp_path):
    bank = sfx.ensure(tmp_path)
    assert set(bank) == {"whoosh", "pop"}
    for p in bank.values():
        assert p.exists() and p.stat().st_size > 1000
    mtimes = {k: p.stat().st_mtime for k, p in bank.items()}
    bank2 = sfx.ensure(tmp_path)  # second call reuses cache
    assert {k: p.stat().st_mtime for k, p in bank2.items()} == mtimes


def test_story_events_ordering_and_cap(tmp_path):
    bank = {"whoosh": tmp_path / "w.wav", "pop": tmp_path / "p.wav"}
    events = sfx.story_events([3.0, 6.0, 9.0], [0.5, 3.2], bank)
    assert [round(t, 2) for _, t, _ in events] == [0.5, 2.9, 3.2, 5.9, 8.9]
    whoosh_gains = {g for p, t, g in events if p == bank["whoosh"]}
    assert whoosh_gains == {sfx.WHOOSH_GAIN}
    many = sfx.story_events(list(range(1, 30)), [], bank, max_events=16)
    assert len(many) == 16


def test_story_command_mixes_sfx(tmp_path):
    pairs = [(tmp_path / "s0.png", 3.0), (tmp_path / "s1.png", 4.0)]
    w = tmp_path / "whoosh.wav"
    cmd = render.build_story_command(pairs, tmp_path / "v.wav", tmp_path / "c.ass",
                                     tmp_path / "o.mp4", THEME, 7.0,
                                     sfx_events=[(w, 2.9, 0.3)])
    joined = " ".join(cmd)
    assert "amix=inputs=2:normalize=0" in joined
    assert "adelay=2900|2900,volume=0.30" in joined
    # without sfx: no amix
    cmd2 = render.build_story_command(pairs, tmp_path / "v.wav", tmp_path / "c.ass",
                                      tmp_path / "o.mp4", THEME, 7.0)
    assert "amix" not in " ".join(cmd2)


@pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg not installed")
def test_render_with_sfx_produces_audible_output(tmp_path):
    """Mock voice is silence, so any audio energy in the output proves the SFX mixed in."""
    import subprocess
    from app import scenes
    from app.voice import MockEngine

    text = "one two three four five six seven eight nine ten"
    wav = tmp_path / "v.wav"
    words, _ = MockEngine().synth(text, "x", wav)
    pngs = [scenes.render_scene({"kind": "big_stat", "value": "$1M"}, THEME, i, tmp_path / f"s{i}.png")
            for i in range(2)]
    seg_ends = [words[4].end, words[-1].end]
    out, _ = render.render_story(wav, words, pngs, seg_ends, tmp_path / "o.mp4",
                                 theme=THEME, segment_emojis=["💰", ""],
                                 sfx_dir=tmp_path / "sfxcache", workdir=tmp_path)
    probe = subprocess.run(
        ["ffmpeg", "-i", str(out), "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True)
    assert "max_volume" in probe.stderr
    max_line = [l for l in probe.stderr.splitlines() if "max_volume" in l][0]
    max_db = float(max_line.split("max_volume:")[1].replace("dB", "").strip())
    assert max_db > -60.0, f"output is silent ({max_db} dB) — SFX did not mix"
