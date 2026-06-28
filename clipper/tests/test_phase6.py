"""Phase 6 self-test — no Telegram / network required.

    python -m unittest tests.test_phase6 -v     (from clipper/)

Covers review message/keyboard building, callback parsing, notify (idempotent),
and the approve / reject / edit-caption flows end-to-end with a fake Telegram
client and a fake publish hook.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import approve, ledger  # noqa: E402
from app.approve import format_review, parse_callback, review_keyboard, run_approve  # noqa: E402
from app.config import Config  # noqa: E402


def make_cfg(tmp: Path) -> Config:
    raw = {
        "telegram": {"enabled": True},
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


class FakeTelegram:
    def __init__(self, updates=None):
        self.sent: list[dict] = []
        self.messages: list[str] = []
        self.edits: list[str] = []
        self.answers: list[str] = []
        self._updates = list(updates or [])

    def send_clip(self, chat_id, video_path, caption, keyboard) -> str:
        mid = str(100 + len(self.sent))
        self.sent.append({"caption": caption, "keyboard": keyboard, "path": video_path,
                          "message_id": mid})
        return mid

    def send_message(self, chat_id, text) -> str:
        self.messages.append(text)
        return str(900 + len(self.messages))

    def edit_text(self, chat_id, message_id, text) -> None:
        self.edits.append(text)

    def answer_callback(self, callback_id, text) -> None:
        self.answers.append(text)

    def get_updates(self, offset, timeout=0):
        out = [u for u in self._updates if u["update_id"] >= offset]
        self._updates = [u for u in self._updates if u["update_id"] < offset]
        return out


def _seed_ready_clip(cfg: Config, permission: str = "owner", caption: str = "old caption") -> int:
    with ledger.session(cfg.ledger_db) as conn:
        src = ledger.add_source(conn, "https://yt/c", "channel", permission)
        v, _ = ledger.add_or_get_video(conn, src["id"], "vid", "https://youtu.be/x")
        f = cfg.path("ready") / "clip.mp4"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")
        cid = ledger.add_clip(conn, v["id"], start_sec=1.0, end_sec=21.0, title="Title",
                              caption=caption, hashtags_json=json.dumps(["#a", "#b"]),
                              hook_score=8, reason="r", status="ready")
        ledger.set_clip_status(conn, cid, "ready", file_path=str(f))
    return cid


def _cb(update_id, data, message_id=100):
    return {"update_id": update_id,
            "callback_query": {"id": f"cb{update_id}", "data": data,
                               "message": {"message_id": message_id}}}


def _msg(update_id, text):
    return {"update_id": update_id, "message": {"text": text}}


class PureTest(unittest.TestCase):
    def test_parse_callback(self):
        self.assertEqual(parse_callback("a:12"), ("approve", 12))
        self.assertEqual(parse_callback("e:3"), ("edit", 3))
        self.assertEqual(parse_callback("r:7"), ("reject", 7))
        self.assertEqual(parse_callback("x:1"), (None, None))
        self.assertEqual(parse_callback("garbage"), (None, None))

    def test_review_message_and_keyboard(self):
        clip = {"id": 5, "hook_score": 9, "title": "Big claim", "caption": "wow",
                "hashtags": json.dumps(["#a", "#b"]), "start_sec": 2.0, "end_sec": 25.0}
        src = {"permission_status": "licensed"}
        text = format_review(clip, src)
        self.assertIn("Clip #5", text)
        self.assertIn("9/10", text)
        self.assertIn("licensed", text)
        self.assertIn("#a", text)
        kb = review_keyboard(5)
        datas = [b["callback_data"] for row in kb["inline_keyboard"] for b in row]
        self.assertEqual(datas, ["a:5", "e:5", "r:5"])


class FlowTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.cfg = make_cfg(self.tmp)
        ledger.init_db(self.cfg.ledger_db)
        self.published: list[int] = []

    def tearDown(self):
        self._tmp.cleanup()

    def _hook(self):
        def h(cid):
            self.published.append(cid)
            return "scheduled to 2 platform(s)"
        return h

    def test_notify_is_idempotent(self):
        cid = _seed_ready_clip(self.cfg)
        tg = FakeTelegram()
        rep = run_approve(self.cfg, tg, self._hook())
        self.assertEqual(rep.notified, 1)
        self.assertEqual(len(tg.sent), 1)
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertIsNotNone(ledger.get_clip(conn, cid)["review_message_id"])

        # second pass must not re-send (review_message_id is set)
        tg2 = FakeTelegram()
        rep2 = run_approve(self.cfg, tg2, self._hook())
        self.assertEqual(rep2.notified, 0)
        self.assertEqual(len(tg2.sent), 0)

    def test_approve_button_schedules(self):
        cid = _seed_ready_clip(self.cfg)
        run_approve(self.cfg, FakeTelegram(), self._hook())   # notify first
        tg = FakeTelegram(updates=[_cb(1, f"a:{cid}")])
        rep = run_approve(self.cfg, tg, self._hook())
        self.assertEqual(rep.approved, 1)
        self.assertEqual(self.published, [cid])
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_clip(conn, cid)["status"], "approved")
        self.assertTrue(any("approved" in e for e in tg.edits))

    def test_reject_button_archives(self):
        cid = _seed_ready_clip(self.cfg)
        run_approve(self.cfg, FakeTelegram(), self._hook())
        tg = FakeTelegram(updates=[_cb(1, f"r:{cid}")])
        rep = run_approve(self.cfg, tg, self._hook())
        self.assertEqual(rep.rejected, 1)
        self.assertEqual(self.published, [])
        with ledger.session(self.cfg.ledger_db) as conn:
            clip = ledger.get_clip(conn, cid)
            self.assertEqual(clip["status"], "rejected")
            self.assertIn("Telegram", clip["rejected_reason"])

    def test_edit_caption_then_approve(self):
        cid = _seed_ready_clip(self.cfg, caption="old caption")
        run_approve(self.cfg, FakeTelegram(), self._hook())
        # tap edit -> sets pending; then send the new caption as a message
        tg = FakeTelegram(updates=[_cb(1, f"e:{cid}"), _msg(2, "BRAND NEW CAPTION")])
        rep = run_approve(self.cfg, tg, self._hook())
        self.assertEqual(rep.edited, 1)
        self.assertEqual(self.published, [cid])
        with ledger.session(self.cfg.ledger_db) as conn:
            clip = ledger.get_clip(conn, cid)
            self.assertEqual(clip["caption"], "BRAND NEW CAPTION")
            self.assertEqual(clip["status"], "approved")

    def test_offset_advances_so_updates_not_reprocessed(self):
        cid = _seed_ready_clip(self.cfg)
        run_approve(self.cfg, FakeTelegram(), self._hook())
        tg = FakeTelegram(updates=[_cb(5, f"a:{cid}")])
        run_approve(self.cfg, tg, self._hook())
        with ledger.session(self.cfg.ledger_db) as conn:
            self.assertEqual(ledger.get_meta(conn, "telegram_offset"), "6")

    def test_disabled_telegram_noops(self):
        self.cfg.raw["telegram"]["enabled"] = False
        _seed_ready_clip(self.cfg)
        rep = run_approve(self.cfg, FakeTelegram(), self._hook())
        self.assertEqual(rep.notified, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
