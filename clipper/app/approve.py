"""Phase 6 — one-tap Telegram approval loop.

When a clip hits /ready it's sent to your Telegram with a preview and the
proposed title/caption/hashtags, hook_score, and source permission status, plus
inline buttons:

    ✅ Approve & schedule   |   ✏️ Approve but edit caption   |   ❌ Reject

This is the gate that makes Hard Rule 2 real: a clip only leaves `ready` when you
tap a button. Approve -> clip `approved` and handed to the Phase 5 publisher;
Reject -> archived (`rejected`) with a logged reason; Edit -> the next text you
send becomes the new caption, then it's approved + scheduled.

The Telegram HTTP lives behind :class:`TelegramClient` so notify/callback/edit
logic and all ledger transitions are unit-tested offline with a fake.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

from .config import Config
from . import ledger, publish

log = logging.getLogger("clipper.approve")

# callback_data is limited to 64 bytes; keep it tiny: "<action>:<clip_id>".
_ACTIONS = {"a": "approve", "e": "edit", "r": "reject"}
_CAPTION_LIMIT = 1000  # Telegram media-caption limit is 1024


# ===========================================================================
# Message + keyboard building (pure)
# ===========================================================================
def format_review(clip, source) -> str:
    try:
        tags = json.loads(clip["hashtags"]) if clip["hashtags"] else []
    except (TypeError, json.JSONDecodeError):
        tags = []
    perm = (source["permission_status"] if source else None) or "UNKNOWN"
    dur = (clip["end_sec"] or 0) - (clip["start_sec"] or 0)
    lines = [
        f"🎬 Clip #{clip['id']}   hook {clip['hook_score']}/10",
        f"🔐 source: {perm}",
        f"📝 {clip['title'] or '(no title)'}",
        "",
        (clip["caption"] or "").strip(),
        " ".join(str(t) for t in tags),
        "",
        f"⏱ {clip['start_sec']:.1f}–{clip['end_sec']:.1f}s ({dur:.0f}s)",
    ]
    text = "\n".join(l for l in lines if l is not None)
    return text[:_CAPTION_LIMIT]


def review_keyboard(clip_id: int) -> dict:
    return {"inline_keyboard": [[
        {"text": "✅ Approve & schedule", "callback_data": f"a:{clip_id}"},
        {"text": "✏️ Edit caption", "callback_data": f"e:{clip_id}"},
        {"text": "❌ Reject", "callback_data": f"r:{clip_id}"},
    ]]}


def parse_callback(data: str) -> tuple[str | None, int | None]:
    if not data or ":" not in data:
        return None, None
    code, _, sid = data.partition(":")
    action = _ACTIONS.get(code)
    try:
        return (action, int(sid)) if action else (None, None)
    except ValueError:
        return None, None


# ===========================================================================
# Telegram client (injectable)
# ===========================================================================
class TelegramClient(Protocol):
    def send_clip(self, chat_id: str, video_path: str | None, caption: str,
                  keyboard: dict) -> str: ...
    def send_message(self, chat_id: str, text: str) -> str: ...
    def edit_text(self, chat_id: str, message_id: str, text: str) -> None: ...
    def answer_callback(self, callback_id: str, text: str) -> None: ...
    def get_updates(self, offset: int, timeout: int = 0) -> list[dict]: ...


class HttpTelegramClient:
    """Real Telegram Bot API client (HTTP)."""

    def __init__(self, token: str):
        self.base = f"https://api.telegram.org/bot{token}"

    def _post(self, method: str, *, data=None, files=None) -> dict:
        import requests
        resp = requests.post(f"{self.base}/{method}", data=data, files=files, timeout=120)
        body = resp.json() if resp.content else {}
        if not body.get("ok"):
            raise RuntimeError(f"telegram {method} failed: {body or resp.text[:300]}")
        return body.get("result", {})

    def send_clip(self, chat_id, video_path, caption, keyboard) -> str:
        data = {"chat_id": chat_id, "caption": caption,
                "reply_markup": json.dumps(keyboard)}
        if video_path and Path(video_path).exists():
            with open(video_path, "rb") as fh:
                res = self._post("sendVideo", data=data, files={"video": fh})
        else:  # no media on disk — still send the text + buttons
            data["text"] = caption
            res = self._post("sendMessage", data=data)
        return str(res.get("message_id", ""))

    def send_message(self, chat_id, text) -> str:
        return str(self._post("sendMessage",
                              data={"chat_id": chat_id, "text": text}).get("message_id", ""))

    def edit_text(self, chat_id, message_id, text) -> None:
        try:
            self._post("editMessageText",
                       data={"chat_id": chat_id, "message_id": message_id, "text": text})
        except Exception as exc:  # editing is best-effort
            log.debug("editMessageText failed: %s", exc)

    def answer_callback(self, callback_id, text) -> None:
        try:
            self._post("answerCallbackQuery",
                       data={"callback_query_id": callback_id, "text": text})
        except Exception as exc:
            log.debug("answerCallbackQuery failed: %s", exc)

    def get_updates(self, offset, timeout=0) -> list[dict]:
        return self._post("getUpdates", data={"offset": offset, "timeout": timeout}) or []


def make_client(cfg: Config) -> HttpTelegramClient:
    token = Config.secret("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set (.env).")
    return HttpTelegramClient(token)


# ===========================================================================
# Action handling
# ===========================================================================
# on_approved(clip_id) -> short status string describing the publish result.
ApprovedHook = Callable[[int], str]


def default_publish_hook(cfg: Config) -> ApprovedHook:
    def _hook(clip_id: int) -> str:
        rep = publish.run_publish(cfg, only_clip=clip_id)
        if rep.blocked:
            return "blocked by permission gate"
        if rep.scheduled:
            return f"scheduled to {rep.scheduled} platform(s)"
        if rep.errors:
            return "schedule failed"
        return "nothing scheduled"
    return _hook


def apply_action(conn, action: str, clip_id: int, chat_id: str,
                 on_approved: ApprovedHook) -> str:
    clip = ledger.get_clip(conn, clip_id)
    if clip is None:
        return f"clip {clip_id} not found"
    if action == "approve":
        ledger.set_clip_status(conn, clip_id, "approved")
        detail = on_approved(clip_id)
        return f"✅ Clip {clip_id} approved — {detail}."
    if action == "reject":
        ledger.reject_clip(conn, clip_id, "rejected via Telegram")
        return f"❌ Clip {clip_id} rejected."
    if action == "edit":
        ledger.set_clip_status(conn, clip_id, "editing")
        ledger.set_meta(conn, f"edit_pending:{chat_id}", str(clip_id))
        return f"✏️ Send the new caption for clip {clip_id} as a message."
    return f"unknown action '{action}'"


# ===========================================================================
# Orchestration
# ===========================================================================
@dataclass
class ApproveReport:
    notified: int = 0
    actions: int = 0
    approved: int = 0
    rejected: int = 0
    edited: int = 0
    errors: int = 0
    notes: list[str] = field(default_factory=list)

    def line(self) -> str:
        return (f"notified={self.notified} actions={self.actions} "
                f"approved={self.approved} rejected={self.rejected} "
                f"edited={self.edited} errors={self.errors}")


def notify_pending(conn, client: TelegramClient, chat_id: str,
                   report: ApproveReport) -> None:
    for clip in ledger.list_clips_for_review(conn):
        src = ledger.get_source_for_clip(conn, clip["id"])
        try:
            mid = client.send_clip(chat_id, clip["file_path"],
                                   format_review(clip, src), review_keyboard(clip["id"]))
        except Exception as exc:  # noqa: BLE001 — record, keep going
            report.errors += 1
            msg = f"failed to send clip {clip['id']} for review: {exc}"
            log.error(msg)
            report.notes.append(msg)
            continue
        ledger.set_clip_review_message(conn, clip["id"], mid)
        report.notified += 1
        log.info("sent clip %s for review (msg %s)", clip["id"], mid)


def process_updates(conn, client: TelegramClient, chat_id: str,
                    on_approved: ApprovedHook, report: ApproveReport,
                    timeout: int = 0) -> int:
    offset = int(ledger.get_meta(conn, "telegram_offset", "0") or "0")
    updates = client.get_updates(offset, timeout=timeout)
    seen = 0
    for up in updates:
        offset = max(offset, int(up.get("update_id", offset - 1)) + 1)
        cq = up.get("callback_query")
        if cq:
            action, cid = parse_callback(cq.get("data", ""))
            client.answer_callback(cq.get("id", ""), "working…")
            if action is None or cid is None:
                continue
            result = apply_action(conn, action, cid, chat_id, on_approved)
            _tally(report, action)
            mid = (cq.get("message") or {}).get("message_id")
            if mid is not None:
                client.edit_text(chat_id, mid, result)
            seen += 1
            continue

        m = up.get("message")
        if m and m.get("text"):
            key = f"edit_pending:{chat_id}"
            pend = ledger.get_meta(conn, key)
            if pend:
                cid = int(pend)
                ledger.del_meta(conn, key)
                ledger.set_clip_caption(conn, cid, m["text"].strip())
                ledger.set_clip_status(conn, cid, "approved")
                detail = on_approved(cid)
                report.actions += 1
                report.edited += 1
                report.approved += 1
                client.send_message(
                    chat_id, f"✅ Clip {cid} caption updated, approved — {detail}.")
                seen += 1
    ledger.set_meta(conn, "telegram_offset", str(offset))
    return seen


def _tally(report: ApproveReport, action: str) -> None:
    report.actions += 1
    if action == "approve":
        report.approved += 1
    elif action == "reject":
        report.rejected += 1
    # "edit" only initiates — the completed edit is counted when the new caption
    # text arrives (see process_updates), so it isn't tallied here.


def run_approve(
    cfg: Config,
    client: TelegramClient | None = None,
    on_approved: ApprovedHook | None = None,
    *,
    poll: bool = False,
    poll_timeout: int = 25,
) -> ApproveReport:
    ledger.init_db(cfg.ledger_db)
    cfg.ensure_dirs()
    report = ApproveReport()

    if not cfg.get("telegram", "enabled", default=True):
        log.info("telegram.enabled is false — approval loop disabled.")
        return report

    chat_id = Config.secret("TELEGRAM_CHAT_ID")
    if client is None:
        client = make_client(cfg)
        if not chat_id:
            raise RuntimeError("TELEGRAM_CHAT_ID is not set (.env).")
    on_approved = on_approved or default_publish_hook(cfg)

    with ledger.session(cfg.ledger_db) as conn:
        notify_pending(conn, client, chat_id, report)
        process_updates(conn, client, chat_id, on_approved, report)

    if poll:  # continuous long-poll (Ctrl-C to stop)
        log.info("entering Telegram long-poll loop (timeout=%ss)…", poll_timeout)
        while True:
            with ledger.session(cfg.ledger_db) as conn:
                notify_pending(conn, client, chat_id, report)
                process_updates(conn, client, chat_id, on_approved, report,
                                timeout=poll_timeout)

    return report
