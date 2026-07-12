"""Mission control — a local web dashboard for the channels.

Native by design: Python stdlib HTTP server + one self-contained HTML page.
No frameworks, no CDNs, no new dependencies. Start it with `python run.py web`
and open it on any device on your network (phone included).

What it serves:
  /                    the dashboard (webui/index.html)
  GET  /api/summary    everything: channels vs goals/benchmarks, videos, learned
                       priors, insights (latest Claude report), method, tools
  POST /api/refresh    pull channel stats + per-video analytics into the ledger
  POST /api/diagnose   run a fresh Claude deep-analysis (saved to data/reports/)
"""

from __future__ import annotations

import json
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import analytics, brand, diagnose, formula

WEBUI = Path(__file__).resolve().parent.parent / "webui"

# Platform benchmarks the dashboard compares against (see RESEARCH.md).
BENCHMARKS = {
    "retention_gate_short_pct": 65.0,   # <30s videos need ~65% avg view to spread
    "retention_gate_mid_pct": 50.0,     # 30-60s videos need ~50%
    "engagement_rate_pct": 4.0,         # (likes + 2*comments) / views, healthy shorts
    "monetize_tier1_subs": 500,
    "monetize_tier2_subs": 1000,
    "monetize_tier2_views_90d": 10_000_000,
}

# The production method, step by step — the visual the AI follows.
# Every step maps to a module and an enforced rule; the dashboard draws this.
METHOD_STEPS = [
    {"step": "Research", "module": "app/research.py",
     "what": "Claude + live web search finds what is rising in the niche right now",
     "rule": "Original angles only; every topic must carry a number, name, or testable claim"},
    {"step": "Score ideas", "module": "app/formula.py",
     "what": "S1 = trend + RPM tier + novelty + learned prior",
     "rule": "Epsilon-greedy: 80% best ideas, 20% deliberate exploration"},
    {"step": "Script", "module": "app/scriptgen.py",
     "what": "Claude writes to the retention contract + storyboard + emoji + pin comment",
     "rule": "HOOK <=12 words -> 3-6 escalating beats -> PAYOFF -> LOOP; 60-95 spoken words"},
    {"step": "Quality gate", "module": "app/scriptgen.py",
     "what": "Validator + S2 score (idea x hook x retention prediction)",
     "rule": "Below threshold = rewritten once, then discarded. A weak short hurts more than none"},
    {"step": "Voice", "module": "app/voice.py",
     "what": "Kokoro TTS locally, word-level timestamps, 1.08x pace",
     "rule": "One consistent voice per channel — voice IS brand"},
    {"step": "Scenes", "module": "app/scenes.py",
     "what": "Storyboard drawn natively: stats, charts, timelines, figures + emoji",
     "rule": "Starfield Noir only; numbers on screen match numbers spoken"},
    {"step": "Assemble", "module": "app/render.py",
     "what": "Punch-in cuts per beat, karaoke captions, emoji pops, whoosh/pop SFX, progress bar",
     "rule": "Something moves or changes every ~2 seconds; hook readable at frame 0"},
    {"step": "Review", "module": "app/review.py",
     "what": "Human gate (or autopilot above score floor)",
     "rule": "Nothing weak ships; rejects teach the gate what to block"},
    {"step": "Publish", "module": "app/publish.py",
     "what": "Scheduled into peak slots, engagement comment when live",
     "rule": "1-2/day/channel; never two videos in one slot"},
    {"step": "Learn", "module": "app/analytics.py + app/diagnose.py",
     "what": "Retention per video updates the formula's priors; Claude dissects issues weekly",
     "rule": "prior <- 0.7*prior + 0.3*performance; retention is the metric that matters"},
]

MILESTONES = [
    {"at": "0-500 subs", "focus": "Nail the format. 2/day, review everything, kill weak hooks fast."},
    {"at": "500 subs", "focus": "Monetization tier 1 (fan funding). Double down on top-3 hook types."},
    {"at": "1,000 subs", "focus": "Tier 2 sub requirement met — now it's a views game: 10M/90d."},
    {"at": "10,000 subs", "focus": "Series & recurring characters; the priors know what works — trust them."},
    {"at": "100,000 subs", "focus": "THE GOAL. Silver play button + established revenue share."},
]


# ------------------------------------------------------------------ data
def _stat_cache_get(ledger, channel_name: str) -> dict:
    return {
        "subscribers": int(ledger.get_weight(channel_name, "stat:subscribers", -1)),
        "total_views": int(ledger.get_weight(channel_name, "stat:total_views", -1)),
        "uploads": int(ledger.get_weight(channel_name, "stat:uploads", -1)),
    }


def refresh(cfg, ledger) -> dict:
    """Pull channel stats + per-video analytics for every channel. Best-effort."""
    out = {}
    for ch in cfg.channels:
        entry = {"channel_stats": None, "videos_updated": 0, "error": None}
        try:
            stats = analytics.channel_stats(ch)
            if stats:
                for k, v in (("subscribers", stats["subscribers"]),
                             ("total_views", stats["total_views"]),
                             ("uploads", stats["uploads"])):
                    ledger.set_weight(ch.name, f"stat:{k}", float(v))
                entry["channel_stats"] = stats
            entry["videos_updated"] = analytics.pull(cfg, ledger, ch)
            analytics.learn(ledger, ch)
        except Exception as e:
            entry["error"] = str(e)
        out[ch.name] = entry
    return out


def _channel_summary(cfg, ledger, ch) -> dict:
    b = brand.brand_for(ch.name)
    perf = analytics.report(ledger, ch)
    stats = _stat_cache_get(ledger, ch.name)
    subs = max(stats["subscribers"], 0)
    views_90d = sum(r["views"] or 0 for r in perf)
    rows = ledger.performance_rows(ch.name)
    total_likes = sum(r["likes"] or 0 for r in rows)
    total_comments = sum(r["comments"] or 0 for r in rows)
    retentions = [r["avg_view_pct"] for r in perf if r["avg_view_pct"]]
    avg_ret = round(sum(retentions) / len(retentions), 1) if retentions else None
    eng = round((total_likes + 2 * total_comments) / views_90d * 100, 2) if views_90d else None

    videos = ledger.videos(ch.name)
    by_status: dict[str, int] = {}
    for v in videos:
        by_status[v["status"]] = by_status.get(v["status"], 0) + 1

    goal = cfg.goal_subscribers
    return {
        "id": ch.name,
        "display": b["display"],
        "handle": b["handle"],
        "tagline": b["tagline"],
        "niche": ch.niche,
        "mark": b.get("mark", "trajectory"),
        "stats_known": stats["subscribers"] >= 0,
        "subscribers": subs if stats["subscribers"] >= 0 else None,
        "total_views": stats["total_views"] if stats["total_views"] >= 0 else None,
        "views_90d": views_90d,
        "likes": total_likes,
        "comments": total_comments,
        "avg_retention_pct": avg_ret,
        "engagement_rate_pct": eng,
        "videos_by_status": by_status,
        "published": len(perf),
        "goal": {
            "subscribers": goal,
            "pct_to_goal": round(min(100.0, subs / goal * 100), 2) if goal else 0,
            "tier1_pct": round(min(100.0, subs / BENCHMARKS["monetize_tier1_subs"] * 100), 1),
            "tier2_subs_pct": round(min(100.0, subs / BENCHMARKS["monetize_tier2_subs"] * 100), 1),
            "tier2_views_pct": round(min(100.0, views_90d / BENCHMARKS["monetize_tier2_views_90d"] * 100), 2),
        },
        "retention_series": [round(r["avg_view_pct"], 1) for r in reversed(perf)][-40:],
        "views_series": [r["views"] or 0 for r in reversed(perf)][-40:],
        "videos": [{
            "post_id": r["post_id"], "hook_type": r["hook_type"], "format": r["format"],
            "seconds": r["seconds"], "views": r["views"], "avg_view_pct": r["avg_view_pct"],
            "performance": r["performance"],
        } for r in perf[:25]],
        "priors": [{"key": w["key"].replace("prior:", ""), "value": round(w["value"], 3),
                    "samples": w["samples"]}
                   for w in ledger.weights_rows(ch.name) if w["key"].startswith("prior:")][:12],
    }


def _insights(cfg) -> dict:
    reports_dir = cfg.data_dir / "reports"
    reports = sorted(reports_dir.glob("*.md"), reverse=True) if reports_dir.exists() else []
    latest = reports[0].read_text() if reports else ""
    return {"count": len(reports),
            "latest_name": reports[0].name if reports else None,
            "latest_markdown": latest[:20000],
            "history": [p.name for p in reports[:14]]}


def tools_status(cfg) -> list[dict]:
    def probe(fn):
        try:
            return bool(fn())
        except Exception:
            return False
    checks = [
        ("ffmpeg", "renders every video", lambda: shutil.which("ffmpeg")),
        ("Claude API key", "research, scripts, deep analysis", lambda: cfg.anthropic_api_key),
        ("anthropic sdk", "talks to Claude", lambda: __import__("anthropic")),
        ("Pillow", "draws scenes + brand assets", lambda: __import__("PIL")),
        ("color emoji font", "emoji layer in videos", lambda: __import__("app.scenes", fromlist=["x"])._emoji_font()[0]),
        ("Kokoro TTS", "local voice (best)", lambda: __import__("kokoro")),
        ("edge-tts fallback", "cloud voice fallback", lambda: __import__("edge_tts")),
    ]
    out = [{"name": n, "role": r, "ok": probe(f)} for n, r, f in checks]
    for ch in cfg.channels:
        tok = Path(ch.token_file or f"secrets/{ch.name}_token.json")
        out.append({"name": f"YouTube auth — {brand.brand_for(ch.name)['display']}",
                    "role": "upload + analytics", "ok": tok.exists()})
    return out


def summary(cfg, ledger) -> dict:
    return {
        "goal_subscribers": cfg.goal_subscribers,
        "benchmarks": BENCHMARKS,
        "channels": [_channel_summary(cfg, ledger, ch) for ch in cfg.channels],
        "insights": _insights(cfg),
        "method": METHOD_STEPS,
        "milestones": MILESTONES,
        "tools": tools_status(cfg),
    }


# ------------------------------------------------------------------ server
def make_handler(cfg, ledger_factory):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, obj, code=200):
            body = json.dumps(obj, default=str).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                page = (WEBUI / "index.html").read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(page)))
                self.end_headers()
                self.wfile.write(page)
            elif self.path == "/api/summary":
                led = ledger_factory()
                try:
                    self._json(summary(cfg, led))
                finally:
                    led.close()
            else:
                self._json({"error": "not found"}, 404)

        def do_POST(self):
            led = ledger_factory()
            try:
                if self.path == "/api/refresh":
                    self._json(refresh(cfg, led))
                elif self.path == "/api/diagnose":
                    results = {}
                    for ch in cfg.channels:
                        try:
                            text, path = diagnose.run_diagnosis(cfg, led, ch)
                            results[ch.name] = {"ok": True, "report": path.name if path else None}
                        except Exception as e:
                            results[ch.name] = {"ok": False, "error": str(e)}
                    self._json(results)
                else:
                    self._json({"error": "not found"}, 404)
            finally:
                led.close()

    return Handler


def serve(cfg, ledger_factory, host: str = "0.0.0.0", port: int = 8787) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), make_handler(cfg, ledger_factory))
    return server


def serve_forever(cfg, ledger_factory, host: str = "0.0.0.0", port: int = 8787):
    server = serve(cfg, ledger_factory, host, port)
    print(f"Mission control: http://localhost:{port}  (same URL works from your "
          f"phone on the same Wi-Fi via this machine's IP)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
