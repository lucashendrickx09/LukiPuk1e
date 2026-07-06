from types import SimpleNamespace

from app import diagnose
from tests.conftest import GOOD_SCRIPT


def _seed_channel(ledger, channel):
    idea = ledger.add_idea(channel.name, "seeded topic one", trend=0.7, rpm=0.9)
    vid = ledger.add_video(idea, channel.name, GOOD_SCRIPT, hook_type="stat_shock",
                           fmt="explainer", est_seconds=26, score=0.8)
    ledger.set_video(vid, status="published")
    post = ledger.add_post(vid, channel.name, "t", "2026-07-01T16:30:00Z")
    ledger.set_post(post, yt_video_id="yt1", status="live")
    ledger.record_metrics(post, views=3000, likes=150, comments=20,
                          avg_view_pct=72.0, avg_view_seconds=19.0)
    ledger.log("score_discarded", "idea 9: S2=0.41 < 0.55")


def test_gather_summarizes_channel(cfg, ledger, channel):
    _seed_channel(ledger, channel)
    data = diagnose.gather(cfg, ledger, channel)
    assert data["channel"]["niche"] == "finance"
    assert data["monetization_progress"]["tracked_views_90d"] == 3000
    assert data["by_hook_type"]["stat_shock"]["videos"] == 1
    assert data["by_length_bucket"]["mid"]["avg_retention_pct"] == 72.0
    assert any(e["kind"] == "score_discarded" for e in data["recent_problems"])
    assert data["video_pipeline"]["posts_total"] == 1


def test_gather_works_on_empty_channel(cfg, ledger, channel):
    data = diagnose.gather(cfg, ledger, channel)
    assert data["published_performance"] == []
    assert data["by_hook_type"] == {}


class FakeTextClient:
    def __init__(self, text="# Channel diagnosis\n\n## Health snapshot\n- fine"):
        self.text = text
        self.calls = []
        outer = self

        class Stream:
            def __init__(self, kwargs):
                outer.calls.append(kwargs)

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get_final_message(self):
                return SimpleNamespace(
                    stop_reason="end_turn",
                    content=[SimpleNamespace(type="text", text=outer.text)])

        class Messages:
            def stream(self, **kwargs):
                return Stream(kwargs)

        self.messages = Messages()


def test_run_diagnosis_saves_report(cfg, ledger, channel):
    _seed_channel(ledger, channel)
    fake = FakeTextClient()
    text, path = diagnose.run_diagnosis(cfg, ledger, channel, client=fake)
    assert "Health snapshot" in text
    assert path is not None and path.exists() and path.read_text() == text
    # the prompt carried the actual channel data + platform facts
    prompt = fake.calls[0]["messages"][0]["content"]
    assert "stat_shock" in prompt and "seed audience" in prompt
