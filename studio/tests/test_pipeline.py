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
