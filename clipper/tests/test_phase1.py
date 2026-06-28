"""Phase 1 self-test — no network, no yt-dlp required.

Exercises the ingest rules with a fake provider so the pipeline logic is
verifiable in CI:

    python -m unittest discover -s clipper/tests   (from repo root)
    python -m unittest tests.test_phase1           (from clipper/)

Covers:
- Hard Rule 1: an `unverified` source is blocked (never enumerated/downloaded).
- Hard Rule 3: re-running ingest re-downloads nothing (idempotency).
- New uploads on a channel are picked up on the next poll; last_seen advances.
- Hard Rule 4: a per-video download failure is recorded, doesn't abort the run.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import ledger  # noqa: E402
from app.config import Config  # noqa: E402
from app.ingest import run_ingest  # noqa: E402
from app.ytdlp import Entry  # noqa: E402


class FakeProvider:
    """In-memory stand-in for yt-dlp. Maps source URL -> list[Entry]."""

    def __init__(self, catalog: dict[str, list[Entry]], fail_ids: set[str] | None = None):
        self.catalog = catalog
        self.fail_ids = fail_ids or set()
        self.downloaded: list[str] = []

    def enumerate(self, url, source_type, limit):
        entries = self.catalog.get(url, [])
        return entries[:limit] if limit else entries

    def download(self, entry: Entry, dest_dir: Path) -> Path:
        if entry.id in self.fail_ids:
            raise RuntimeError("simulated download failure")
        self.downloaded.append(entry.id)
        path = dest_dir / f"{entry.id}.mp4"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fake")
        return path


def make_cfg(tmp: Path, sources: list[dict]) -> Config:
    raw = {
        "sources": sources,
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


class Phase1Test(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_permission_gate_blocks_unverified(self):
        cfg = make_cfg(self.tmp, [
            {"url": "https://yt/owned", "type": "channel", "permission_status": "owner"},
            {"url": "https://yt/sketchy", "type": "channel", "permission_status": "unverified"},
        ])
        prov = FakeProvider({
            "https://yt/owned": [Entry("a1", "https://youtu.be/a1", "Owned A")],
            "https://yt/sketchy": [Entry("b1", "https://youtu.be/b1", "Sketchy B")],
        })
        rep = run_ingest(cfg, prov)
        self.assertEqual(rep.sources_blocked, 1)
        self.assertEqual(rep.downloaded, 1)
        self.assertIn("a1", prov.downloaded)
        self.assertNotIn("b1", prov.downloaded)  # blocked source never touched
        with ledger.session(cfg.ledger_db) as conn:
            self.assertTrue(ledger.video_exists(conn, "a1"))
            self.assertFalse(ledger.video_exists(conn, "b1"))

    def test_idempotent_rerun_downloads_nothing_new(self):
        cfg = make_cfg(self.tmp, [
            {"url": "https://yt/ch", "type": "channel", "permission_status": "licensed"},
        ])
        catalog = {"https://yt/ch": [
            Entry("v2", "https://youtu.be/v2", "Two"),
            Entry("v1", "https://youtu.be/v1", "One"),
        ]}
        prov1 = FakeProvider(dict(catalog))
        rep1 = run_ingest(cfg, prov1)
        self.assertEqual(rep1.downloaded, 2)

        prov2 = FakeProvider(dict(catalog))
        rep2 = run_ingest(cfg, prov2)
        self.assertEqual(rep2.downloaded, 0)          # nothing re-downloaded
        self.assertEqual(rep2.skipped_existing, 2)
        self.assertEqual(prov2.downloaded, [])

    def test_new_upload_picked_up_and_last_seen_advances(self):
        cfg = make_cfg(self.tmp, [
            {"url": "https://yt/ch", "type": "channel", "permission_status": "owner"},
        ])
        run_ingest(cfg, FakeProvider({"https://yt/ch": [
            Entry("old1", "https://youtu.be/old1"),
        ]}))
        with ledger.session(cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_source_by_url(conn, "https://yt/ch")["last_seen_video_id"], "old1")

        # A newer upload appears at the top of the list.
        prov = FakeProvider({"https://yt/ch": [
            Entry("new2", "https://youtu.be/new2"),
            Entry("old1", "https://youtu.be/old1"),
        ]})
        rep = run_ingest(cfg, prov)
        self.assertEqual(rep.downloaded, 1)
        self.assertEqual(prov.downloaded, ["new2"])
        self.assertEqual(rep.skipped_existing, 1)
        with ledger.session(cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_source_by_url(conn, "https://yt/ch")["last_seen_video_id"], "new2")

    def test_download_failure_is_recorded_and_does_not_abort(self):
        cfg = make_cfg(self.tmp, [
            {"url": "https://yt/ch", "type": "channel", "permission_status": "owner"},
        ])
        prov = FakeProvider(
            {"https://yt/ch": [
                Entry("good", "https://youtu.be/good"),
                Entry("bad", "https://youtu.be/bad"),
            ]},
            fail_ids={"bad"},
        )
        rep = run_ingest(cfg, prov)
        self.assertEqual(rep.errors, 1)
        self.assertEqual(rep.downloaded, 1)            # good one still made it
        with ledger.session(cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_video(conn, "bad")["status"], "error")
            self.assertIsNotNone(ledger.get_video(conn, "bad")["error"])
            self.assertEqual(ledger.get_video(conn, "good")["status"], "downloaded")

    def test_dry_run_ledgers_but_does_not_download(self):
        cfg = make_cfg(self.tmp, [
            {"url": "https://yt/v", "type": "video", "permission_status": "owner"},
        ])
        prov = FakeProvider({"https://yt/v": [Entry("z1", "https://youtu.be/z1")]})
        rep = run_ingest(cfg, prov, dry_run=True)
        self.assertEqual(rep.new_videos, 1)
        self.assertEqual(rep.downloaded, 0)
        self.assertEqual(prov.downloaded, [])
        with ledger.session(cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_video(conn, "z1")["status"], "new")  # resumable


if __name__ == "__main__":
    unittest.main(verbosity=2)
