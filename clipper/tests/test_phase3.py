"""Phase 3 self-test — no Anthropic API / network required.

    python -m unittest tests.test_phase3 -v     (from clipper/)

Covers:
- Defensive JSON parsing: code fences, surrounding prose, malformed elements.
- Retry once on malformed output, then succeed.
- Threshold gating: >= threshold -> candidate, below -> rejected with reason.
- Word-boundary snapping + length clamping.
- Orchestration: clips written to ledger, video -> analyzed, idempotent skip,
  --force re-analyze, and per-video failure recorded as status=error.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import ledger  # noqa: E402
from app.analyze import (  # noqa: E402
    ClipCandidate,
    extract_json_array,
    parse_candidates,
    run_analyze,
    snap_and_clamp,
)
from app.config import Config  # noqa: E402
from app.transcribe import Segment, Transcript, Word  # noqa: E402


def make_cfg(tmp: Path) -> Config:
    raw = {
        "clip": {"min_seconds": 20, "max_seconds": 60, "padding_seconds": 0.3,
                 "hook_score_threshold": 7},
        "claude": {"model": "claude-opus-4-8", "max_candidates_per_video": 12,
                   "max_transcript_chars": 60000},
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


class ScriptedClient:
    """Returns canned completions in sequence (one per .complete call)."""

    def __init__(self, replies: list[str]):
        self.replies = list(replies)
        self.calls = 0

    def complete(self, system: str, user: str) -> str:
        self.calls += 1
        return self.replies.pop(0) if self.replies else "[]"


def _transcript(tmp: Path, yt: str) -> Path:
    # 0..90s, words on tidy boundaries
    words = [Word(float(i), float(i) + 0.9, f"w{i}") for i in range(0, 90)]
    segs = [Segment(float(i), float(i) + 10.0, f"sentence {i}") for i in range(0, 90, 10)]
    tr = Transcript(video_id=yt, engine="fake", model="m", language="en",
                    duration_sec=90.0, text="...", segments=segs, words=words)
    p = tmp / "data/transcripts" / f"{yt}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(tr.to_dict()))
    return p


def _seed_transcribed_video(cfg: Config, yt: str) -> None:
    tpath = _transcript(cfg.root, yt)
    with ledger.session(cfg.ledger_db) as conn:
        ledger.add_or_get_video(conn, None, yt, f"https://youtu.be/{yt}")
        ledger.set_video_status(conn, yt, "transcribed", transcript_path=str(tpath))


class ParseTest(unittest.TestCase):
    def test_strips_code_fences_and_prose(self):
        text = ('Here are the clips:\n```json\n'
                '[{"start":1.0,"end":25.0,"title":"T","caption":"C",'
                '"hashtags":["#a"],"hook_score":8,"reason":"hook"}]\n```\nDone.')
        arr = extract_json_array(text)
        self.assertTrue(arr.strip().startswith("["))
        cands = parse_candidates(text)
        self.assertEqual(len(cands), 1)
        self.assertEqual(cands[0].hook_score, 8)

    def test_drops_malformed_elements_keeps_good(self):
        text = ('[{"start":1,"end":20,"title":"ok","caption":"c","hashtags":["#a"],'
                '"hook_score":9,"reason":"r"},'
                '{"start":2,"missing":"fields"},'
                '"not an object"]')
        cands = parse_candidates(text)
        self.assertEqual(len(cands), 1)

    def test_no_array_raises(self):
        with self.assertRaises(ValueError):
            extract_json_array("there is no array here")


class SnapTest(unittest.TestCase):
    def setUp(self):
        self.tr = Transcript("v", "f", "m", "en", 90.0, "...",
                             segments=[], words=[Word(float(i), float(i) + 0.9, f"w{i}")
                                                 for i in range(0, 90)])

    def test_snaps_to_word_boundaries_and_clamps_max(self):
        c = ClipCandidate(10.4, 200.0, "t", "c", [], 8, "r")  # end way past dur
        out = snap_and_clamp(c, self.tr, min_s=20, max_s=60, pad=0.3)
        self.assertIsNotNone(out)
        start, end = out
        self.assertLessEqual(end - start, 60 + 0.6)   # clamped to max (+pad)
        self.assertGreaterEqual(start, 0.0)

    def test_extends_to_min_length(self):
        c = ClipCandidate(10.0, 12.0, "t", "c", [], 8, "r")  # 2s, below min
        out = snap_and_clamp(c, self.tr, min_s=20, max_s=60, pad=0.3)
        self.assertIsNotNone(out)
        start, end = out
        self.assertGreaterEqual(end - start, 19.0)


class OrchestrationTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.cfg = make_cfg(self.tmp)
        ledger.init_db(self.cfg.ledger_db)

    def tearDown(self):
        self._tmp.cleanup()

    def _reply(self, clips):
        return json.dumps(clips)

    def test_threshold_gating_and_ledger(self):
        _seed_transcribed_video(self.cfg, "abc")
        clips = [
            {"start": 2, "end": 30, "title": "Strong", "caption": "c",
             "hashtags": ["#a", "#b"], "hook_score": 9, "reason": "great hook"},
            {"start": 40, "end": 65, "title": "Weak", "caption": "c",
             "hashtags": ["#a"], "hook_score": 4, "reason": "meh"},
        ]
        client = ScriptedClient([self._reply(clips)])
        rep = run_analyze(self.cfg, client)
        self.assertEqual(rep.candidates, 1)
        self.assertEqual(rep.rejected, 1)
        self.assertEqual(rep.analyzed, 1)

        with ledger.session(self.cfg.ledger_db) as conn:
            v = ledger.get_video(conn, "abc")
            self.assertEqual(v["status"], "analyzed")
            cand = ledger.list_clips(conn, v["id"], status="candidate")
            rej = ledger.list_clips(conn, v["id"], status="rejected")
            self.assertEqual(len(cand), 1)
            self.assertEqual(cand[0]["title"], "Strong")
            self.assertEqual(json.loads(cand[0]["hashtags"]), ["#a", "#b"])
            self.assertEqual(len(rej), 1)
            self.assertIn("< threshold", rej[0]["rejected_reason"])

    def test_retry_once_on_malformed_then_succeeds(self):
        _seed_transcribed_video(self.cfg, "abc")
        good = self._reply([{"start": 1, "end": 25, "title": "T", "caption": "c",
                             "hashtags": ["#a"], "hook_score": 8, "reason": "r"}])
        client = ScriptedClient(["this is not json at all", good])
        rep = run_analyze(self.cfg, client)
        self.assertEqual(client.calls, 2)     # malformed + retry
        self.assertEqual(rep.candidates, 1)

    def test_idempotent_skip_and_force(self):
        _seed_transcribed_video(self.cfg, "abc")
        run_analyze(self.cfg, ScriptedClient([self._reply(
            [{"start": 1, "end": 25, "title": "T", "caption": "c",
              "hashtags": [], "hook_score": 8, "reason": "r"}])]))

        # No-force run selects only `transcribed` videos, so an analyzed video
        # isn't re-selected at all — nothing seen, no API call.
        c2 = ScriptedClient([self._reply([])])
        rep = run_analyze(self.cfg, c2)
        self.assertEqual(rep.videos_seen, 0)
        self.assertEqual(c2.calls, 0)

        # Targeting it explicitly selects it, then skips (already analyzed).
        c2b = ScriptedClient([self._reply([])])
        rep_b = run_analyze(self.cfg, c2b, only_video="abc")
        self.assertEqual(rep_b.skipped, 1)
        self.assertEqual(c2b.calls, 0)

        c3 = ScriptedClient([self._reply(
            [{"start": 5, "end": 30, "title": "New", "caption": "c",
              "hashtags": [], "hook_score": 9, "reason": "r"}])])
        rep3 = run_analyze(self.cfg, c3, force=True)
        self.assertEqual(rep3.candidates, 1)
        with ledger.session(self.cfg.ledger_db) as conn:
            v = ledger.get_video(conn, "abc")
            cands = ledger.list_clips(conn, v["id"], status="candidate")
            self.assertEqual(len(cands), 1)     # old candidate dropped, one new
            self.assertEqual(cands[0]["title"], "New")

    def test_persistent_malformed_records_error(self):
        _seed_transcribed_video(self.cfg, "abc")
        client = ScriptedClient(["garbage", "still garbage"])
        rep = run_analyze(self.cfg, client)
        self.assertEqual(rep.errors, 1)
        self.assertEqual(rep.analyzed, 0)
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_video(conn, "abc")["status"], "error")

    def test_dry_run_writes_nothing(self):
        _seed_transcribed_video(self.cfg, "abc")
        client = ScriptedClient([self._reply(
            [{"start": 1, "end": 25, "title": "T", "caption": "c",
              "hashtags": [], "hook_score": 8, "reason": "r"}])])
        rep = run_analyze(self.cfg, client, dry_run=True)
        self.assertEqual(rep.candidates, 1)
        with ledger.session(self.cfg.ledger_db) as conn:
            v = ledger.get_video(conn, "abc")
            self.assertEqual(v["status"], "transcribed")     # unchanged
            self.assertEqual(len(ledger.list_clips(conn, v["id"])), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
