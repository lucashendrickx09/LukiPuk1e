"""Claude-powered channel diagnosis: reads everything the ledger and the YouTube
APIs know about a channel, then has Claude dissect what's working, what's broken,
and which roadblocks are coming (monetization thresholds, quota, policy risk).

Output: a dated markdown report in data/reports/ + printed to the terminal.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from . import analytics, formula

PLATFORM_FACTS = """Platform facts to reason against (2026 YouTube Shorts):
- Every Short is tested on a seed audience (~50-500 viewers, ~70% non-subscribers).
- Retention gates for wider distribution: ~65% avg view for <30s, ~50% for 30-60s.
- Watch time per impression, completed views and re-watches (loops) rank; fast swipes kill reach.
- Monetization tier 1: 500 subs + 3 public uploads/90d (fan funding).
- Monetization tier 2: 1,000 subs AND 10M public Shorts views/90d (or 4,000 long-form
  watch-hours) -> 45% of pooled Shorts ad revenue by view share.
- Inauthentic-content policy: mass-produced/templated AI content gets demonetized;
  originality, own visual style, and human curation are the shields.
- Posts with under ~25 views never left the seed test - treat their data as noise.
- API quota: uploads cost 1600 units of 10k/day per GCP project (~6/day/project)."""

DIAGNOSIS_PROMPT = """You are the growth strategist for a YouTube Shorts channel run by an
automated pipeline. Below is the channel's full operational data (JSON) and the
platform facts to reason against.

{facts}

CHANNEL DATA:
```json
{data}
```

Write a diagnosis in markdown with exactly these sections:
# Channel diagnosis — {channel_name}
## Health snapshot        (3-5 bullet facts, numbers included)
## What's working         (evidence-based; name hook types/formats/lengths)
## Issues found           (each issue: the evidence, why it matters, the fix)
## Upcoming roadblocks    (monetization thresholds, quota limits, policy/compliance risks,
                           data gaps - with time horizon estimates)
## Next actions           (max 5, ordered by impact, each concrete and doable this week)
## Config tweaks          (exact config.yaml keys/values to change, if any are justified)

Rules: only claim what the data supports. Where samples are thin (<25 views or <5
videos per group), say so instead of concluding. Be direct - this is an internal
ops report, not marketing."""


def _length_groups(perf: list[dict]) -> dict:
    groups: dict[str, list] = {}
    for r in perf:
        groups.setdefault(formula.length_bucket(r["seconds"]), []).append(r)
    return {
        k: {
            "videos": len(v),
            "avg_retention_pct": round(sum(x["avg_view_pct"] for x in v) / len(v), 1),
            "avg_performance": round(sum(x["performance"] for x in v) / len(v), 3),
        } for k, v in groups.items()
    }


def gather(cfg, ledger, channel) -> dict:
    """Everything the diagnosis needs, from the ledger + (best-effort) YouTube APIs."""
    perf = analytics.report(ledger, channel)

    def group_by(key: str) -> dict:
        groups: dict[str, list] = {}
        for r in perf:
            groups.setdefault(str(r[key]), []).append(r)
        return {
            k: {
                "videos": len(v),
                "total_views": sum(x["views"] or 0 for x in v),
                "avg_retention_pct": round(sum(x["avg_view_pct"] for x in v) / len(v), 1),
                "avg_performance": round(sum(x["performance"] for x in v) / len(v), 3),
            } for k, v in groups.items()
        }

    stats = None
    try:
        stats = analytics.channel_stats(channel)
    except Exception:
        pass  # not authed yet / offline — diagnosis still works from ledger data

    videos = ledger.videos(channel.name)
    status_counts: dict[str, int] = {}
    for v in videos:
        status_counts[v["status"]] = status_counts.get(v["status"], 0) + 1

    posts = ledger.posts(channel.name)
    views_90d = sum(r["views"] or 0 for r in perf)

    events = [
        {"when": dt.datetime.fromtimestamp(e["ts"]).isoformat(timespec="minutes"),
         "kind": e["kind"], "detail": e["detail"]}
        for e in ledger.recent_events((
            "script_discarded", "score_discarded", "publish_error", "comment_error",
            "research_error", "scenes_fallback", "rejected", "sweep_error", "analytics_error"), 40)
    ]

    monetization = {
        "subscribers": stats.get("subscribers") if stats else "unknown (run: python run.py auth)",
        "tier1_fan_funding_needs": "500 subs + 3 public uploads/90d",
        "tier2_ad_revenue_needs": "1000 subs + 10M Shorts views/90d",
        "tracked_views_90d": views_90d,
    }

    return {
        "channel": {"name": channel.name, "niche": channel.niche, "rpm_tier": channel.rpm,
                    "audience": channel.audience, "slots": channel.slots,
                    "visual_style": channel.visual_style,
                    "cadence_per_day": cfg.videos_per_day},
        "channel_stats": stats,
        "monetization_progress": monetization,
        "video_pipeline": {
            "by_status": status_counts,
            "posts_total": len(posts),
            "posts_by_status": {s: sum(1 for p in posts if p["status"] == s)
                                for s in {p["status"] for p in posts}},
        },
        "published_performance": perf[:30],
        "by_hook_type": group_by("hook_type"),
        "by_format": group_by("format"),
        "by_length_bucket": _length_groups(perf),
        "learned_priors": [{"key": w["key"], "value": round(w["value"], 3), "samples": w["samples"]}
                           for w in ledger.weights_rows(channel.name)],
        "recent_problems": events,
        "formula_settings": {"stage1": cfg.weights_stage1, "stage2": cfg.weights_stage2,
                             "epsilon": cfg.epsilon, "script_threshold": cfg.script_threshold},
    }


def run_diagnosis(cfg, ledger, channel, client=None, save: bool = True) -> tuple[str, Path | None]:
    """Gather -> Claude -> markdown report. Returns (report_text, saved_path)."""
    if client is None:
        from .research import make_client
        client = make_client(cfg)
    data = gather(cfg, ledger, channel)
    prompt = DIAGNOSIS_PROMPT.format(facts=PLATFORM_FACTS,
                                     data=json.dumps(data, indent=1, default=str),
                                     channel_name=channel.name)
    with client.messages.stream(model=cfg.model, max_tokens=16000,
                                thinking={"type": "adaptive"},
                                messages=[{"role": "user", "content": prompt}]) as stream:
        message = stream.get_final_message()
    if getattr(message, "stop_reason", None) == "refusal":
        raise RuntimeError("diagnosis request was refused; retry")
    text = "".join(b.text for b in message.content if getattr(b, "type", "") == "text")

    path = None
    if save:
        path = cfg.data_dir / "reports" / f"{dt.date.today().isoformat()}_{channel.name}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        ledger.log("diagnosis", f"{channel.name} -> {path}")
    return text, path
