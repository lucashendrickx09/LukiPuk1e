"""Phase 4 self-test — no ffmpeg / OpenCV / network required.

    python -m unittest tests.test_phase4 -v     (from clipper/)

Covers the pure helpers (colour conversion, caption windowing, ASS karaoke
generation, crop-path smoothing) and orchestration with a fake renderer
(status transitions, idempotency, --force, missing source, render failure).
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
from app.render import (  # noqa: E402
    build_ass,
    caption_words,
    hex_to_ass_color,
    run_render,
    smooth_centers,
)
from app.transcribe import Segment, Transcript, Word  # noqa: E402


def make_cfg(tmp: Path) -> Config:
    raw = {
        "caption": {"font": "Arial", "font_size": 64, "position": "center",
                    "text_color": "#FFFFFF", "highlight_color": "#FFD400",
                    "outline_color": "#000000", "outline_width": 4,
                    "max_words_per_line": 3},
        "video": {"width": 1080, "height": 1920, "fps": 30,
                  "reframe": "center_crop", "loudnorm": True},
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


class FakeRenderer:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.calls: list[dict] = []

    def render(self, video_path, start, end, words_rel, out_path,
               caption_cfg, video_cfg, work_dir):
        self.calls.append({"clip_out": out_path.name, "start": start, "end": end,
                           "n_words": len(words_rel)})
        if self.fail:
            raise RuntimeError("simulated render failure")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"fake mp4")
        return out_path


def _seed(cfg: Config, yt: str, words: list[Word], start: float, end: float,
          status: str = "candidate") -> int:
    media = cfg.path("inbox") / f"{yt}.mp4"
    media.parent.mkdir(parents=True, exist_ok=True)
    media.write_bytes(b"fake video")
    tr = Transcript(yt, "f", "m", "en", words[-1].end if words else end, "...",
                    segments=[Segment(0.0, end, "s")], words=words)
    tpath = cfg.path("transcripts") / f"{yt}.json"
    tpath.parent.mkdir(parents=True, exist_ok=True)
    tpath.write_text(json.dumps(tr.to_dict()))
    with ledger.session(cfg.ledger_db) as conn:
        v, _ = ledger.add_or_get_video(conn, None, yt, f"https://youtu.be/{yt}")
        ledger.set_video_status(conn, yt, "analyzed", file_path=str(media),
                                transcript_path=str(tpath))
        cid = ledger.add_clip(conn, v["id"], start_sec=start, end_sec=end,
                              title="T", caption="C", hashtags_json="[]",
                              hook_score=9, reason="r", status=status)
    return cid


class PureHelperTest(unittest.TestCase):
    def test_hex_to_ass_color_swaps_to_bgr(self):
        self.assertEqual(hex_to_ass_color("#FFD400"), "&H0000D4FF")
        self.assertEqual(hex_to_ass_color("#000000"), "&H00000000")
        self.assertEqual(hex_to_ass_color("bad"), "&H00FFFFFF")

    def test_caption_words_windows_and_rebases(self):
        words = [Word(9.0, 9.5, "before"), Word(10.2, 10.6, "hello"),
                 Word(10.7, 11.4, "world"), Word(70.0, 70.5, "after")]
        out = caption_words(words, 10.0, 12.0)
        self.assertEqual([w[2] for w in out], ["hello", "world"])
        self.assertAlmostEqual(out[0][0], 0.2, places=3)   # rebased to clip start

    def test_build_ass_has_karaoke_and_style(self):
        words_rel = [(0.0, 0.4, "Hello"), (0.5, 1.0, "world"), (1.1, 1.6, "again")]
        ass = build_ass(words_rel, {"position": "center", "highlight_color": "#FFD400",
                                    "max_words_per_line": 2}, 1080, 1920)
        self.assertIn("[V4+ Styles]", ass)
        self.assertIn("\\k", ass)                       # karaoke timing tags
        self.assertIn("Hello", ass)
        self.assertIn("&H0000D4FF", ass)                # highlight = PrimaryColour
        self.assertIn("PlayResX: 1080", ass)
        # 3 words, 2 per line -> 2 Dialogue events
        self.assertEqual(ass.count("Dialogue:"), 2)

    def test_smooth_centers_clamps_and_smooths(self):
        # None -> frame centre, clamped so crop window stays in-frame
        out = smooth_centers([None, None], frame_w=1920, crop_w=1080, alpha=0.8)
        self.assertTrue(all(540 <= c <= 1380 for c in out))
        # a target beyond the right edge is clamped
        out2 = smooth_centers([5000.0], frame_w=1920, crop_w=1080, alpha=0.0)
        self.assertEqual(out2[0], 1380)                 # 1920 - 540
        # constant target stays put
        out3 = smooth_centers([960.0] * 5, 1920, 1080, 0.9)
        self.assertTrue(all(c == 960 for c in out3))


class OrchestrationTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.cfg = make_cfg(self.tmp)
        ledger.init_db(self.cfg.ledger_db)
        self.words = [Word(float(i) / 2, float(i) / 2 + 0.4, f"w{i}") for i in range(0, 60)]

    def tearDown(self):
        self._tmp.cleanup()

    def test_renders_candidate_to_ready(self):
        cid = _seed(self.cfg, "abc", self.words, 2.0, 25.0)
        r = FakeRenderer()
        rep = run_render(self.cfg, r)
        self.assertEqual(rep.rendered, 1)
        self.assertEqual(len(r.calls), 1)
        self.assertGreater(r.calls[0]["n_words"], 0)     # caption words passed in
        out = self.cfg.path("ready") / f"clip_{cid}.mp4"
        self.assertTrue(out.exists())
        with ledger.session(self.cfg.ledger_db) as conn:
            clip = ledger.get_clip(conn, cid)
            self.assertEqual(clip["status"], "ready")
            self.assertEqual(clip["file_path"], str(out))

    def test_idempotent_skip_and_force(self):
        cid = _seed(self.cfg, "abc", self.words, 2.0, 25.0)
        run_render(self.cfg, FakeRenderer())

        # ready clips aren't re-selected without --force
        r2 = FakeRenderer()
        rep = run_render(self.cfg, r2)
        self.assertEqual(rep.clips_seen, 0)
        self.assertEqual(len(r2.calls), 0)

        # targeting the ready clip selects it, then skips
        r2b = FakeRenderer()
        repb = run_render(self.cfg, r2b, only_clip=cid)
        self.assertEqual(repb.skipped, 1)
        self.assertEqual(len(r2b.calls), 0)

        # force re-renders
        r3 = FakeRenderer()
        rep3 = run_render(self.cfg, r3, force=True)
        self.assertEqual(rep3.rendered, 1)
        self.assertEqual(len(r3.calls), 1)

    def test_missing_source_video_errors(self):
        cid = _seed(self.cfg, "abc", self.words, 2.0, 25.0)
        (self.cfg.path("inbox") / "abc.mp4").unlink()
        rep = run_render(self.cfg, FakeRenderer())
        self.assertEqual(rep.errors, 1)
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_clip(conn, cid)["status"], "error")

    def test_render_failure_recorded_and_continues(self):
        c1 = _seed(self.cfg, "aaa", self.words, 1.0, 22.0)
        c2 = _seed(self.cfg, "bbb", self.words, 1.0, 22.0)
        rep = run_render(self.cfg, FakeRenderer(fail=True))
        self.assertEqual(rep.errors, 2)
        self.assertEqual(rep.rendered, 0)
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_clip(conn, c1)["status"], "error")
            self.assertEqual(ledger.get_clip(conn, c2)["status"], "error")
            self.assertIsNotNone(ledger.get_clip(conn, c1)["error"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
