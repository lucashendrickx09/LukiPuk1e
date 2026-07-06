from app import ledger as ledger_mod


def test_idea_dedupe(ledger):
    a = ledger.add_idea("ch", "Same Topic Here")
    b = ledger.add_idea("ch", "same topic here  ")  # case/space-insensitive hash
    assert a is not None and b is None


def test_video_lifecycle(ledger):
    idea = ledger.add_idea("ch", "topic one")
    vid = ledger.add_video(idea, "ch", {"hook": "x"}, hook_type="question",
                           fmt="story", est_seconds=25, score=0.7)
    ledger.set_video(vid, video_path="/tmp/x.mp4", duration=25.5, status="rendered")
    row = ledger.video(vid)
    assert row["status"] == "rendered" and row["duration"] == 25.5


def test_post_unique_per_video(ledger):
    idea = ledger.add_idea("ch", "topic two")
    vid = ledger.add_video(idea, "ch", {}, hook_type="q", fmt="f", est_seconds=20, score=0.5)
    p1 = ledger.add_post(vid, "ch", "title", "2026-07-07T12:30:00Z")
    p2 = ledger.add_post(vid, "ch", "title", "2026-07-08T12:30:00Z")
    assert p1 is not None and p2 is None  # one post per video, ever


def test_weights_roundtrip(ledger):
    assert ledger.get_weight("ch", "prior:hook=question", 0.5) == 0.5
    ledger.set_weight("ch", "prior:hook=question", 0.73)
    assert abs(ledger.get_weight("ch", "prior:hook=question") - 0.73) < 1e-9


def test_taken_slots(ledger):
    idea = ledger.add_idea("ch", "topic three")
    vid = ledger.add_video(idea, "ch", {}, hook_type="q", fmt="f", est_seconds=20, score=0.5)
    ledger.add_post(vid, "ch", "t", "2026-07-07T12:30:00Z")
    assert "2026-07-07T12:30:00Z" in ledger.taken_slots("ch")
