"""Human approval gate. Nothing publishes without a person saying yes —
this is both a quality gate (a weak short hurts the channel) and the human-in-the-loop
that keeps the channel compliant with the inauthentic-content policy.
"""

from __future__ import annotations

import json


def queue(ledger, channel: str | None = None) -> list[dict]:
    rows = ledger.videos(channel=channel, status="rendered")
    out = []
    for r in rows:
        script = json.loads(r["script"])
        out.append({
            "id": r["id"], "channel": r["channel"], "title": script.get("title", ""),
            "hook": script.get("hook", ""), "score": r["score"],
            "duration": r["duration"], "path": r["video_path"],
        })
    return out


def approve(ledger, video_id: int):
    row = ledger.video(video_id)
    if row is None:
        raise KeyError(f"no video {video_id}")
    if row["status"] != "rendered":
        raise ValueError(f"video {video_id} is {row['status']!r}, expected 'rendered'")
    ledger.set_video(video_id, status="approved")
    ledger.log("approved", f"video {video_id}")


def reject(ledger, video_id: int, reason: str = ""):
    row = ledger.video(video_id)
    if row is None:
        raise KeyError(f"no video {video_id}")
    ledger.set_video(video_id, status="rejected", reject_reason=reason)
    ledger.set_idea_status(row["idea_id"], "discarded")
    ledger.log("rejected", f"video {video_id}: {reason}")
