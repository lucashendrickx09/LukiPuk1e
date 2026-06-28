"""Phase 7 self-test — end-to-end chain with fakes, no network/binaries.

    python -m unittest tests.test_phase7 -v     (from clipper/)

Drives the whole pipeline (ingest -> ... -> render -> approve-notify) with fakes,
proving the chain runs in order, is idempotent on re-run, isolates a failing
step, and sends the daily summary at most once per day.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import ledger, pipeline  # noqa: E402
from app.config import Config  # noqa: E402
from app.transcribe import Segment, Transcript, Word  # noqa: E402
from app.ytdlp import Entry  # noqa: E402


def make_cfg(tmp: Path) -> Config:
    raw = {
        "sources": [{"url": "https://yt/ch", "type": "channel", "permission_status": "owner"}],
        "clip": {"min_seconds": 5, "max_seconds": 60, "padding_seconds": 0.3,
                 "hook_score_threshold": 7},
        "telegram": {"enabled": True, "daily_summary": True},
        "paths": {
            "data_dir": str(tmp / "data"), "inbox": str(tmp / "data/inbox"),
            "ready": str(tmp / "data/ready"), "work": str(tmp / "data/work"),
            "transcripts": str(tmp / "data/transcripts"),
            "ledger_db": str(tmp / "data/ledger.db"),
        },
    }
    return Config(raw=raw, root=tmp)


# ---- fakes for each external-dependent step -------------------------------
class FakeProvider:
    def __init__(self):
        self.downloads = 0

    def enumerate(self, url, source_type, limit):
        return [Entry("vid1", "https://youtu.be/vid1", "Title", 90.0)]

    def download(self, entry, dest_dir):
        self.downloads += 1
        p = dest_dir / f"{entry.id}.mp4"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"video")
        return p


class FakeTranscriber:
    name = "fake"

    def __init__(self):
        self.calls = 0

    def transcribe(self, media_path, video_id, language):
        self.calls += 1
        words = [Word(float(i), float(i) + 0.8, f"w{i}") for i in range(30)]
        return Transcript(video_id, "fake", "m", "en", 30.0, "hello world",
                          segments=[Segment(0.0, 30.0, "hello world")], words=words)


class FakeAnalyzer:
    def __init__(self):
        self.calls = 0

    def complete(self, system, user):
        self.calls += 1
        return json.dumps([{"start": 1, "end": 20, "title": "Hook", "caption": "c",
                            "hashtags": ["#a"], "hook_score": 9, "reason": "r"}])


class FakeRenderer:
    def __init__(self):
        self.calls = 0

    def render(self, video_path, start, end, words_rel, out_path, caption_cfg,
               video_cfg, work_dir):
        self.calls += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"mp4")
        return out_path


class FakeTelegram:
    def __init__(self):
        self.sent = 0
        self.messages: list[str] = []

    def send_clip(self, chat_id, video_path, caption, keyboard) -> str:
        self.sent += 1
        return f"m{self.sent}"

    def send_message(self, chat_id, text) -> str:
        self.messages.append(text)
        return "s1"

    def edit_text(self, *a, **k): ...
    def answer_callback(self, *a, **k): ...
    def get_updates(self, offset, timeout=0): return []


def _run(cfg, fakes, **kw):
    return pipeline.run_all(
        cfg, provider=fakes["prov"], transcriber=fakes["tr"], analyzer=fakes["an"],
        renderer=fakes["rn"], telegram=fakes["tg"], on_approved=lambda cid: "ok",
        **kw)


class ChainTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.cfg = make_cfg(self.tmp)
        # secrets needed by summary path
        import os
        os.environ["TELEGRAM_CHAT_ID"] = "123"
        self.fakes = {"prov": FakeProvider(), "tr": FakeTranscriber(),
                      "an": FakeAnalyzer(), "rn": FakeRenderer(), "tg": FakeTelegram()}
        self.now = datetime(2026, 6, 28, 9, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self._tmp.cleanup()

    def test_full_chain_runs_in_order(self):
        rep = _run(self.cfg, self.fakes, now=self.now)
        self.assertEqual(rep.errors, [])
        # every step produced a report
        for name in pipeline.STEP_ORDER:
            self.assertIn(name, rep.steps, name)
        self.assertEqual(self.fakes["prov"].downloads, 1)
        self.assertEqual(self.fakes["tr"].calls, 1)
        self.assertEqual(self.fakes["rn"].calls, 1)
        self.assertEqual(self.fakes["tg"].sent, 1)        # clip sent for review
        with ledger.session(self.cfg.ledger_db) as conn:
            clips = ledger.list_clips(conn, status="ready")
            self.assertEqual(len(clips), 1)               # rendered, awaiting approval
        self.assertTrue(rep.summary_sent)

    def test_rerun_is_idempotent(self):
        _run(self.cfg, self.fakes, now=self.now)
        f2 = {"prov": FakeProvider(), "tr": FakeTranscriber(), "an": FakeAnalyzer(),
              "rn": FakeRenderer(), "tg": FakeTelegram()}
        rep = _run(self.cfg, f2, now=self.now)
        self.assertEqual(f2["prov"].downloads, 0)         # already downloaded
        self.assertEqual(f2["tr"].calls, 0)               # already transcribed
        self.assertEqual(f2["an"].calls, 0)               # already analyzed
        self.assertEqual(f2["rn"].calls, 0)               # already rendered
        self.assertEqual(f2["tg"].sent, 0)                # already notified
        self.assertFalse(rep.summary_sent)                # already sent today

    def test_summary_sent_once_per_day(self):
        _run(self.cfg, self.fakes, now=self.now)          # sends summary
        later = datetime(2026, 6, 28, 18, 0, tzinfo=timezone.utc)  # same day
        f2 = {**self.fakes, "tg": FakeTelegram()}
        rep = _run(self.cfg, f2, now=later)
        self.assertFalse(rep.summary_sent)
        next_day = datetime(2026, 6, 29, 9, 0, tzinfo=timezone.utc)
        f3 = {**self.fakes, "tg": FakeTelegram()}
        rep3 = _run(self.cfg, f3, now=next_day)
        self.assertTrue(rep3.summary_sent)

    def test_failing_step_is_isolated(self):
        class Boom(FakeAnalyzer):
            def complete(self, system, user):
                raise RuntimeError("anthropic down")
        fakes = {**self.fakes, "an": Boom()}
        rep = _run(self.cfg, fakes, now=self.now)
        # The whole chain still completed every step despite the analyze failure.
        for name in pipeline.STEP_ORDER:
            self.assertIn(name, rep.steps, name)
        # The failure was captured at the analyze phase and the video marked error.
        self.assertGreaterEqual(rep.steps["analyze"].errors, 1)
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_video(conn, "vid1")["status"], "error")

    def test_skip_steps(self):
        rep = _run(self.cfg, self.fakes, skip=frozenset({"approve", "publish"}),
                   send_summary=False, now=self.now)
        self.assertNotIn("approve", rep.steps)
        self.assertNotIn("publish", rep.steps)
        self.assertIn("render", rep.steps)
        self.assertEqual(self.fakes["tg"].sent, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
