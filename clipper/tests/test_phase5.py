"""Phase 5 self-test — no Postiz / network required.

    python -m unittest tests.test_phase5 -v     (from clipper/)

Covers per-platform metadata mapping/truncation, day-spaced scheduling, and
orchestration with a fake publisher (permission gate, idempotency, fully
dispatched -> clip posted, failure handling), plus the no-auto-post guarantee.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import ledger  # noqa: E402
from app.config import Config  # noqa: E402
from app.publish import (  # noqa: E402
    PLATFORM_LIMITS,
    Scheduler,
    build_platform_meta,
    next_slot,
    run_publish,
)


def make_cfg(tmp: Path, platforms=None) -> Config:
    per = platforms or {
        "instagram_reels": {"timezone": "UTC", "times": ["11:00", "17:00"]},
        "youtube_shorts": {"timezone": "UTC", "times": ["12:00"]},
    }
    raw = {
        "posting": {"enabled": True, "default_timezone": "UTC",
                    "max_per_day_per_platform": 3, "per_platform": per},
        "paths": {
            "data_dir": str(tmp / "data"),
            "inbox": str(tmp / "data/inbox"),
            "ready": str(tmp / "data/ready"),
            "work": str(tmp / "data/work"),
            "transcripts": str(tmp / "data/transcripts"),
            "ledger_db": str(tmp / "data/ledger.db"),
        },
    }
    return Config(raw=raw, root=tmp)


class FakePublisher:
    name = "fake"

    def __init__(self, fail_platforms=None):
        self.fail = set(fail_platforms or [])
        self.calls: list[dict] = []

    def schedule(self, *, video_path, platform, meta, when):
        self.calls.append({"platform": platform, "when": when, "caption": meta.caption,
                           "title": meta.title})
        if platform in self.fail:
            raise RuntimeError("simulated publish failure")
        return f"ext-{platform}-{len(self.calls)}"


def _seed_clip(cfg: Config, *, permission: str, status: str = "approved",
               caption: str = "c", hashtags=None, title: str = "T") -> int:
    with ledger.session(cfg.ledger_db) as conn:
        src = ledger.add_source(conn, f"https://yt/{permission}", "channel", permission)
        v, _ = ledger.add_or_get_video(conn, src["id"], f"vid_{permission}",
                                       "https://youtu.be/x")
        media = cfg.path("inbox") / "v.mp4"
        media.parent.mkdir(parents=True, exist_ok=True)
        media.write_bytes(b"x")
        ledger.set_video_status(conn, v["youtube_id"], "analyzed", file_path=str(media))
        cid = ledger.add_clip(conn, v["id"], start_sec=1.0, end_sec=20.0, title=title,
                              caption=caption, hashtags_json=json.dumps(hashtags or []),
                              hook_score=9, reason="r", status=status)
    return cid


class MetadataTest(unittest.TestCase):
    def test_youtube_title_truncation(self):
        clip = {"title": "x" * 200, "caption": "hi", "hashtags": json.dumps(["#a"])}
        meta = build_platform_meta(clip, "youtube_shorts")
        self.assertLessEqual(len(meta.title), PLATFORM_LIMITS["youtube_shorts"]["title_max"])

    def test_hashtag_count_capped(self):
        clip = {"title": "t", "caption": "hi", "hashtags": json.dumps([f"#{i}" for i in range(40)])}
        meta = build_platform_meta(clip, "youtube_shorts")  # cap 15
        self.assertLessEqual(len(meta.hashtags), 15)

    def test_caption_plus_hashtags_within_limit(self):
        clip = {"title": "t", "caption": "y" * 3000, "hashtags": json.dumps(["#a", "#b"])}
        meta = build_platform_meta(clip, "instagram_reels")  # cap 2200
        self.assertLessEqual(len(meta.caption), 2200)
        self.assertTrue(meta.caption.endswith("#a #b"))


class SchedulerTest(unittest.TestCase):
    def setUp(self):
        self.tz = ZoneInfo("UTC")
        self.now = datetime(2026, 6, 28, 9, 0, tzinfo=self.tz)  # 09:00 UTC

    def test_first_future_slot(self):
        slot = next_slot(["11:00", "17:00"], self.tz, self.now, set(), 3)
        self.assertEqual((slot.hour, slot.minute), (11, 0))
        self.assertEqual(slot.date(), self.now.date())

    def test_past_times_skipped_same_day(self):
        slot = next_slot(["07:00", "17:00"], self.tz, self.now, set(), 3)
        self.assertEqual(slot.hour, 17)        # 07:00 already passed

    def test_taken_slots_advance(self):
        first = next_slot(["11:00", "17:00"], self.tz, self.now, set(), 3)
        slot2 = next_slot(["11:00", "17:00"], self.tz, self.now, {first}, 3)
        self.assertNotEqual(first, slot2)
        self.assertEqual(slot2.hour, 17)

    def test_max_per_day_rolls_to_next_day(self):
        taken = {datetime(2026, 6, 28, 11, 0, tzinfo=self.tz),
                 datetime(2026, 6, 28, 17, 0, tzinfo=self.tz)}
        slot = next_slot(["11:00", "17:00"], self.tz, self.now, taken, max_per_day=2)
        self.assertEqual(slot.date().day, 29)  # day full -> next day

    def test_scheduler_reserve_spaces_clips(self):
        cfg = make_cfg(Path("/tmp"))
        s = Scheduler(cfg, taken={})
        a = s.reserve("instagram_reels", now=self.now)
        b = s.reserve("instagram_reels", now=self.now)
        self.assertNotEqual(a, b)              # never the same slot


class OrchestrationTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.cfg = make_cfg(self.tmp)
        ledger.init_db(self.cfg.ledger_db)
        self.now = datetime(2026, 6, 28, 9, 0, tzinfo=ZoneInfo("UTC"))

    def tearDown(self):
        self._tmp.cleanup()

    def test_cleared_clip_scheduled_to_all_platforms(self):
        cid = _seed_clip(self.cfg, permission="owner", hashtags=["#a"])
        pub = FakePublisher()
        rep = run_publish(self.cfg, pub, now=self.now)
        self.assertEqual(rep.scheduled, 2)         # 2 platforms
        self.assertEqual(rep.posted_clips, 1)
        self.assertEqual({c["platform"] for c in pub.calls},
                         {"instagram_reels", "youtube_shorts"})
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_clip(conn, cid)["status"], "posted")
            posts = ledger.list_posts(conn)
            self.assertEqual(len(posts), 2)
            self.assertTrue(all(p["status"] == "scheduled" for p in posts))

    def test_permission_gate_blocks_unverified(self):
        cid = _seed_clip(self.cfg, permission="unverified")
        pub = FakePublisher()
        rep = run_publish(self.cfg, pub, now=self.now)
        self.assertEqual(rep.blocked, 1)
        self.assertEqual(rep.scheduled, 0)
        self.assertEqual(len(pub.calls), 0)        # publisher never touched
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_clip(conn, cid)["status"], "approved")  # untouched
            self.assertEqual(len(ledger.list_posts(conn)), 0)

    def test_only_approved_clips_post(self):
        # a `ready` clip (not yet approved) must NOT be scheduled (Rule 2)
        _seed_clip(self.cfg, permission="owner", status="ready")
        pub = FakePublisher()
        rep = run_publish(self.cfg, pub, now=self.now)
        self.assertEqual(rep.clips_seen, 0)
        self.assertEqual(len(pub.calls), 0)

    def test_idempotent_no_double_post(self):
        _seed_clip(self.cfg, permission="owner")
        run_publish(self.cfg, FakePublisher(), now=self.now)
        pub2 = FakePublisher()
        rep = run_publish(self.cfg, pub2, now=self.now)
        # clip is now 'posted', not re-selected; nothing re-scheduled
        self.assertEqual(rep.clips_seen, 0)
        self.assertEqual(len(pub2.calls), 0)

    def test_partial_failure_retries_only_failed_platform(self):
        cid = _seed_clip(self.cfg, permission="owner")
        pub = FakePublisher(fail_platforms=["youtube_shorts"])
        rep = run_publish(self.cfg, pub, now=self.now)
        self.assertEqual(rep.scheduled, 1)
        self.assertEqual(rep.errors, 1)
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_clip(conn, cid)["status"], "approved")  # not done
            self.assertEqual(ledger.get_post(conn, cid, "youtube_shorts")["status"], "failed")

        # retry: the already-scheduled platform is skipped, failed one retried
        pub2 = FakePublisher()
        rep2 = run_publish(self.cfg, pub2, now=self.now)
        self.assertEqual([c["platform"] for c in pub2.calls], ["youtube_shorts"])
        self.assertEqual(rep2.skipped, 1)
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_clip(conn, cid)["status"], "posted")


if __name__ == "__main__":
    unittest.main(verbosity=2)
