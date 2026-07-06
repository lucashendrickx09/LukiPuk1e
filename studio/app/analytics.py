"""The feedback half of the dynamic formula: pull YouTube Analytics for published
shorts, store metrics, update the learned priors, and report what's working.
"""

from __future__ import annotations

import datetime as dt

from . import formula, publish


def pull(cfg, ledger, channel) -> int:
    """Fetch per-video metrics for this channel's uploaded posts. Returns #updated."""
    posts = [p for p in ledger.posts(channel.name) if p["yt_video_id"] and p["status"] in ("uploaded", "live")]
    if not posts:
        return 0
    service = publish.get_service(channel, "youtubeAnalytics", "v2")
    ids = ",".join(p["yt_video_id"] for p in posts)
    today = dt.date.today()
    resp = service.reports().query(
        ids="channel==MINE",
        startDate=(today - dt.timedelta(days=90)).isoformat(),
        endDate=today.isoformat(),
        metrics="views,likes,comments,averageViewDuration,averageViewPercentage",
        dimensions="video",
        filters=f"video=={ids}",
    ).execute()
    by_id = {row[0]: row for row in resp.get("rows", [])}
    updated = 0
    for p in posts:
        row = by_id.get(p["yt_video_id"])
        if not row:
            continue
        _, views, likes, comments, avg_dur, avg_pct = row[:6]
        ledger.record_metrics(p["id"], views=int(views), likes=int(likes), comments=int(comments),
                              avg_view_pct=float(avg_pct), avg_view_seconds=float(avg_dur))
        updated += 1
    return updated


def learn(ledger, channel) -> dict[str, float]:
    """Update formula priors from the freshest metrics. The 'dynamic' in the formula."""
    updated = formula.update_priors(ledger, channel.name)
    if updated:
        ledger.log("weights_updated", f"{channel.name}: {len(updated)} keys")
    return updated


def report(ledger, channel) -> list[dict]:
    """Human-readable performance table for `run.py analyze`."""
    rows = ledger.performance_rows(channel.name)
    out = []
    for r in rows:
        p = formula.performance_index(r["views"] or 0, r["avg_view_pct"] or 0.0,
                                      r["likes"] or 0, r["comments"] or 0)
        out.append({
            "post_id": r["post_id"], "hook_type": r["hook_type"], "format": r["format"],
            "seconds": round(r["est_seconds"], 1), "views": r["views"],
            "avg_view_pct": round(r["avg_view_pct"] or 0.0, 1), "performance": round(p, 3),
        })
    out.sort(key=lambda d: d["performance"], reverse=True)
    return out
