"""Phase 2 self-test — no whisper/ffmpeg/network required.

    python -m unittest tests.test_phase2 -v     (from clipper/)

Covers:
- whisper.cpp token->word reconstruction and full-JSON parsing (pure functions).
- Orchestration with a fake transcriber: transcript cached to disk, ledger
  `transcripts` row written, video status -> transcribed.
- Hard Rule 3: re-run skips an already-transcribed video; --force redoes it.
- Hard Rule 4: a transcriber failure is recorded as status=error, run continues.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import ledger  # noqa: E402
from app.config import Config  # noqa: E402
from app.transcribe import (  # noqa: E402
    Segment,
    Transcript,
    Word,
    parse_whisper_cpp_json,
    run_transcribe,
    words_from_tokens,
)


def make_cfg(tmp: Path) -> Config:
    raw = {
        "transcription": {"engine": "whisper.cpp", "language": "en"},
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


class FakeTranscriber:
    name = "fake"

    def __init__(self, fail: bool = False):
        self.fail = fail
        self.calls = 0

    def transcribe(self, media_path: Path, video_id: str, language):
        self.calls += 1
        if self.fail:
            raise RuntimeError("simulated transcription failure")
        return Transcript(
            video_id=video_id, engine="fake", model="m", language=language,
            duration_sec=2.0, text="Hello world",
            segments=[Segment(0.0, 2.0, "Hello world")],
            words=[Word(0.0, 0.5, "Hello", 0.9), Word(0.6, 2.0, "world", 0.8)],
        )


def _seed_downloaded_video(cfg: Config, yt: str) -> None:
    media = cfg.path("inbox") / f"{yt}.mp4"
    media.parent.mkdir(parents=True, exist_ok=True)
    media.write_bytes(b"fake video")
    with ledger.session(cfg.ledger_db) as conn:
        ledger.add_or_get_video(conn, None, yt, f"https://youtu.be/{yt}")
        ledger.set_video_status(conn, yt, "downloaded", file_path=str(media))


class WhisperCppParserTest(unittest.TestCase):
    def test_words_from_tokens_merges_subwords(self):
        tokens = [
            {"text": "[_BEG_]", "offsets": {"from": 0, "to": 0}},          # special, skipped
            {"text": " Hel", "offsets": {"from": 0, "to": 200}, "p": 0.9},
            {"text": "lo", "offsets": {"from": 200, "to": 400}, "p": 0.8},  # same word
            {"text": " world", "offsets": {"from": 500, "to": 900}, "p": 0.95},
        ]
        words = words_from_tokens(tokens)
        self.assertEqual([w.word for w in words], ["Hello", "world"])
        self.assertAlmostEqual(words[0].start, 0.0)
        self.assertAlmostEqual(words[0].end, 0.4)
        self.assertAlmostEqual(words[1].start, 0.5)

    def test_parse_full_json(self):
        data = {
            "result": {"language": "en"},
            "transcription": [
                {
                    "offsets": {"from": 0, "to": 1500},
                    "text": " Hello world",
                    "tokens": [
                        {"text": " Hello", "offsets": {"from": 0, "to": 500}, "p": 0.9},
                        {"text": " world", "offsets": {"from": 600, "to": 1500}, "p": 0.9},
                    ],
                }
            ],
        }
        tr = parse_whisper_cpp_json(data, "vid1", "ggml-base.en.bin")
        self.assertEqual(tr.language, "en")
        self.assertEqual(tr.text, "Hello world")
        self.assertEqual(len(tr.segments), 1)
        self.assertEqual([w.word for w in tr.words], ["Hello", "world"])
        # round-trips through the on-disk JSON shape
        self.assertEqual(Transcript.from_dict(tr.to_dict()).text, "Hello world")


class TranscribeOrchestrationTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.cfg = make_cfg(self.tmp)
        ledger.init_db(self.cfg.ledger_db)

    def tearDown(self):
        self._tmp.cleanup()

    def test_transcribes_and_caches_and_ledgers(self):
        _seed_downloaded_video(self.cfg, "abc")
        rep = run_transcribe(self.cfg, FakeTranscriber())
        self.assertEqual(rep.transcribed, 1)

        out = self.cfg.path("transcripts") / "abc.json"
        self.assertTrue(out.exists())
        doc = json.loads(out.read_text())
        self.assertEqual(len(doc["words"]), 2)

        with ledger.session(self.cfg.ledger_db) as conn:
            v = ledger.get_video(conn, "abc")
            self.assertEqual(v["status"], "transcribed")
            self.assertEqual(v["transcript_path"], str(out))
            t = ledger.get_transcript(conn, v["id"])
            self.assertIsNotNone(t)
            self.assertEqual(t["n_words"], 2)
            self.assertEqual(t["n_segments"], 1)

    def test_idempotent_skip_and_force(self):
        _seed_downloaded_video(self.cfg, "abc")
        run_transcribe(self.cfg, FakeTranscriber())

        ft = FakeTranscriber()
        rep = run_transcribe(self.cfg, ft)          # status is now 'transcribed'
        self.assertEqual(rep.transcribed, 0)
        self.assertEqual(ft.calls, 0)               # nothing recomputed

        ft2 = FakeTranscriber()
        rep2 = run_transcribe(self.cfg, ft2, force=True)
        self.assertEqual(rep2.transcribed, 1)
        self.assertEqual(ft2.calls, 1)

    def test_failure_recorded_and_resumable(self):
        _seed_downloaded_video(self.cfg, "abc")
        rep = run_transcribe(self.cfg, FakeTranscriber(fail=True))
        self.assertEqual(rep.errors, 1)
        self.assertEqual(rep.transcribed, 0)
        with ledger.session(self.cfg.ledger_db) as conn:
            v = ledger.get_video(conn, "abc")
            self.assertEqual(v["status"], "error")
            self.assertIsNotNone(v["error"])

    def test_missing_media_file_errors(self):
        # ledger says downloaded but the file isn't there -> loud error, not a crash
        with ledger.session(self.cfg.ledger_db) as conn:
            ledger.add_or_get_video(conn, None, "ghost", "https://youtu.be/ghost")
            ledger.set_video_status(conn, "ghost", "downloaded",
                                    file_path=str(self.cfg.path("inbox") / "ghost.mp4"))
        rep = run_transcribe(self.cfg, FakeTranscriber())
        self.assertEqual(rep.errors, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
