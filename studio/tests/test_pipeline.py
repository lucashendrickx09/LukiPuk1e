import shutil

import pytest

from app import ideate, pipeline, review
from app.voice import MockEngine
from tests.conftest import FakeClaude

HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def test_refresh_ideas_stores_scored_candidates(cfg, channel, ledger):
    fake = FakeClaude()
    n = ideate.refresh_ideas(cfg, channel, ledger, client=fake, use_web_search=False)
    assert n >= 6  # research + seed topics
    rows = ledger.ideas(channel.name, status="candidate")
    assert all(0 <= r["score"] <= 1 for r in rows)
    assert any(r["source"] == "seed" for r in rows)


def test_refresh_survives_research_failure(cfg, channel, ledger):
    class Boom:
        class messages:
            @staticmethod
            def stream(**kw):
                raise RuntimeError("network down")
    n = ideate.refresh_ideas(cfg, channel, ledger, client=Boom())
    assert n >= 1  # seed topics still land


def test_select_marks_selected(cfg, channel, ledger):
    fake = FakeClaude()
    ideate.refresh_ideas(cfg, channel, ledger, client=fake, use_web_search=False)
    picked = ideate.select_ideas(cfg, channel, ledger, k=2)
    assert len(picked) == 2
    assert all(ledger.db.execute("SELECT status FROM ideas WHERE id=?", (p["id"],)).fetchone()[0] == "selected"
               for p in picked)


@pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg not installed")
def test_produce_video_end_to_end(cfg, channel, ledger):
    fake = FakeClaude()
    idea_id = ledger.add_idea(channel.name, "end to end topic", trend=0.8, rpm=0.9,
                              novelty=1.0, prior=0.6, score=0.8)
    idea = dict(ledger.ideas(channel.name)[0])
    assert idea["id"] == idea_id
    vid = pipeline.produce_video(cfg, channel, ledger, idea, client=fake, engine=MockEngine())
    assert vid is not None
    row = ledger.video(vid)
    assert row["status"] == "rendered"
    assert row["duration"] > 15
    q = review.queue(ledger, channel.name)
    assert len(q) == 1 and q[0]["id"] == vid


def test_low_score_idea_gets_gated(cfg, channel, ledger):
    fake = FakeClaude()
    ledger.add_idea(channel.name, "weak idea topic", trend=0.0, rpm=0.0, novelty=0.0,
                    prior=0.0, score=0.0)
    idea = dict(ledger.ideas(channel.name)[0])
    cfg.script_threshold = 0.95  # force the gate shut
    vid = pipeline.produce_video(cfg, channel, ledger, idea, client=fake, engine=MockEngine())
    assert vid is None
    assert ledger.ideas(channel.name, status="discarded")


@pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg not installed")
def test_sample_video_renders(cfg, channel, ledger):
    path = pipeline.sample_video(cfg, ledger, channel)
    assert path.exists() and path.stat().st_size > 10_000


def test_autopilot_approves_above_threshold(cfg, channel, ledger, tmp_path, monkeypatch):
    # two rendered videos: one above the autopilot floor, one below
    vids = []
    for score in (0.85, 0.40):
        idea = ledger.add_idea(channel.name, f"auto topic {score}")
        vid = ledger.add_video(idea, channel.name, dict(__import__('tests.conftest', fromlist=['GOOD_SCRIPT']).GOOD_SCRIPT),
                               hook_type="stat_shock", fmt="explainer", est_seconds=26, score=score)
        f = tmp_path / f"v{vid}.mp4"
        f.write_bytes(b"0" * 20_000)
        ledger.set_video(vid, video_path=str(f), duration=26.0, status="rendered")
        vids.append(vid)

    cfg.review_auto_above = 0.72
    monkeypatch.setattr(pipeline, "run_channel", lambda *a, **k: list(vids))
    summary = pipeline.run_daily(cfg, ledger)  # publish_mode=export in fixture

    assert ledger.video(vids[0])["status"] == "published"      # auto-approved + exported
    assert ledger.video(vids[1])["status"] == "rendered"       # still waiting for a human
    assert summary["channels"][channel.name]["awaiting_review"] == [vids[1]]
