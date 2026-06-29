"""Web UI self-test — no FastAPI / network required.

    python -m unittest tests.test_webui -v     (from clipper/)

FastAPI is imported lazily inside create_app/serve, so the pure helpers
(status_snapshot, review_items, sources_list), the JobRunner, and the clip
actions are all testable offline.
"""

from __future__ import annotations

import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import ledger, webui  # noqa: E402
from app.config import Config  # noqa: E402


def make_cfg(tmp: Path) -> Config:
    raw = {
        # no posting.per_platform -> approve won't try to build a real publisher
        "posting": {"enabled": True, "per_platform": {}},
        "paths": {
            "data_dir": str(tmp / "data"), "inbox": str(tmp / "data/inbox"),
            "ready": str(tmp / "data/ready"), "work": str(tmp / "data/work"),
            "transcripts": str(tmp / "data/transcripts"),
            "ledger_db": str(tmp / "data/ledger.db"),
        },
    }
    return Config(raw=raw, root=tmp)


def _seed_ready_clip(cfg: Config, permission="owner") -> int:
    with ledger.session(cfg.ledger_db) as conn:
        src = ledger.add_source(conn, "https://yt/c", "channel", permission)
        v, _ = ledger.add_or_get_video(conn, src["id"], "vid", "https://youtu.be/x")
        f = cfg.path("ready") / "clip.mp4"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")
        cid = ledger.add_clip(conn, v["id"], start_sec=1.0, end_sec=21.0, title="T",
                              caption="orig", hashtags_json=json.dumps(["#a"]),
                              hook_score=8, reason="r", status="ready")
        ledger.set_clip_status(conn, cid, "ready", file_path=str(f))
    return cid


class HelperTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.cfg = make_cfg(Path(self._tmp.name))
        ledger.init_db(self.cfg.ledger_db)

    def tearDown(self):
        self._tmp.cleanup()

    def test_review_items(self):
        _seed_ready_clip(self.cfg, "owner")
        with ledger.session(self.cfg.ledger_db) as conn:
            items = webui.review_items(conn)
        self.assertEqual(len(items), 1)
        self.assertTrue(items[0]["permission_cleared"])
        self.assertTrue(items[0]["has_video"])
        self.assertEqual(items[0]["hashtags"], ["#a"])

    def test_review_flags_uncleared(self):
        _seed_ready_clip(self.cfg, "unverified")
        with ledger.session(self.cfg.ledger_db) as conn:
            items = webui.review_items(conn)
        self.assertFalse(items[0]["permission_cleared"])

    def test_status_and_sources(self):
        _seed_ready_clip(self.cfg)
        with ledger.session(self.cfg.ledger_db) as conn:
            snap = webui.status_snapshot(conn)
            srcs = webui.sources_list(conn)
        self.assertEqual(snap["clips"].get("ready"), 1)
        self.assertEqual(len(srcs), 1)
        self.assertTrue(srcs[0]["cleared"])

    def test_clip_actions(self):
        cid = _seed_ready_clip(self.cfg)
        # reject
        self.assertEqual(webui.reject_clip(self.cfg, cid), "rejected")
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_clip(conn, cid)["status"], "rejected")

        # edit caption (no approve)
        cid2 = _seed_ready_clip(self.cfg)
        webui.edit_caption(self.cfg, cid2, "new words", do_approve=False)
        with ledger.session(self.cfg.ledger_db) as conn:
            clip = ledger.get_clip(conn, cid2)
            self.assertEqual(clip["caption"], "new words")
            self.assertEqual(clip["status"], "ready")        # not approved

        # approve (no platforms configured -> stays approved, no publisher built)
        cid3 = _seed_ready_clip(self.cfg)
        webui.approve_clip(self.cfg, cid3)
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_clip(conn, cid3)["status"], "approved")


class JobRunnerTest(unittest.TestCase):
    def test_single_flight_and_completion(self):
        jr = webui.JobRunner()
        release = threading.Event()
        started = threading.Event()

        def slow():
            started.set()
            release.wait(2)
            return "done"

        self.assertTrue(jr.start("slow", slow))
        self.assertTrue(started.wait(1))
        self.assertEqual(jr.state()["running"], "slow")
        self.assertFalse(jr.start("other", lambda: 1))     # busy -> refused
        release.set()
        for _ in range(100):
            if jr.state()["running"] is None:
                break
            time.sleep(0.02)
        last = jr.state()["last"]
        self.assertEqual(last["step"], "slow")
        self.assertTrue(last["ok"])

    def test_failure_recorded(self):
        jr = webui.JobRunner()
        def boom():
            raise RuntimeError("kaboom")
        jr.start("boom", boom)
        for _ in range(100):
            if jr.state()["last"]:
                break
            time.sleep(0.02)
        last = jr.state()["last"]
        self.assertFalse(last["ok"])
        self.assertIn("kaboom", last["result"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
