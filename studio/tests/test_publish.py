import datetime as dt
import json

from app import publish, review
from app.scriptgen import Script
from tests.conftest import GOOD_SCRIPT


def test_next_slot_picks_first_free(channel):
    now = dt.datetime(2026, 7, 7, 12, 0, tzinfo=dt.timezone.utc)  # 08:00 New York
    slot = publish.next_slot(channel, taken=set(), now=now, min_lead_minutes=45)
    assert slot == "2026-07-07T16:30:00Z"  # 12:30 EDT


def test_next_slot_skips_taken_and_respects_lead(channel):
    now = dt.datetime(2026, 7, 7, 16, 0, tzinfo=dt.timezone.utc)  # 12:00 NY; 12:30 is <45min away
    slot = publish.next_slot(channel, taken={"2026-07-07T23:30:00Z"}, now=now, min_lead_minutes=45)
    # 12:30 too soon, 19:30 (23:30Z) taken -> next day 12:30
    assert slot == "2026-07-08T16:30:00Z"


def test_export_pack_writes_everything(tmp_path, channel):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"0" * 20_000)
    script = Script.from_dict(GOOD_SCRIPT)
    dest = publish.export_pack(str(video), script, channel, "2026-07-07T16:30:00Z", tmp_path / "outbox")
    assert (dest / "video.mp4").exists()
    meta = (dest / "metadata.txt").read_text()
    assert GOOD_SCRIPT["title"] in meta and "2026-07-07T16:30:00Z" in meta
    assert "Narration is AI-generated" in meta  # disclosure present
    assert json.loads((dest / "script.json").read_text())["hook"] == GOOD_SCRIPT["hook"]


def test_publish_approved_export_mode(cfg, ledger, channel, tmp_path):
    video_file = tmp_path / "v.mp4"
    video_file.write_bytes(b"0" * 20_000)
    idea = ledger.add_idea(channel.name, "publish flow topic")
    vid = ledger.add_video(idea, channel.name, GOOD_SCRIPT, hook_type="stat_shock",
                           fmt="explainer", est_seconds=26, score=0.8)
    ledger.set_video(vid, video_path=str(video_file), duration=26.0, status="rendered")
    review.approve(ledger, vid)

    results = publish.publish_approved(cfg, ledger, channel)  # cfg.publish_mode == export
    assert len(results) == 1 and results[0]["mode"] == "export"
    assert ledger.video(vid)["status"] == "published"
    posts = ledger.posts(channel.name)
    assert posts and posts[0]["status"] == "exported"

    # idempotent: second run publishes nothing new
    assert publish.publish_approved(cfg, ledger, channel) == []
