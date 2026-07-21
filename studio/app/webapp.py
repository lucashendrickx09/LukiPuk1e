"""Mission control — the channels' website, served locally next to the pipeline.

Three pages (one self-contained HTML, hash-routed):
  #dashboard  short-term overview: channels vs goals/benchmarks, tools, latest insight
  #analytics  deep analytics: evidence tables, slot analysis, rule-based guidance,
              learned priors, full Claude report history
  #method     the production console: every pipeline step is visible AND drivable —
              research ideas, produce, watch renders in the browser, approve/reject,
              publish — plus the step-by-step method the AI follows

Native by design: Python stdlib HTTP server, no frameworks, no CDNs.
Start with `python run.py web`; phone-friendly over LAN.

API:
  GET  /api/summary      dashboard data
  GET  /api/analytics    deep analytics + guidance + reports list
  GET  /api/report?name= one saved Claude report (markdown)
  GET  /api/pipeline     ideas/scripts/renders/queue/schedule per channel
  GET  /api/jobs         background job states
  GET  /video/<video_id> stream a rendered mp4 (Range-aware) for in-browser review
  POST /api/refresh      pull channel stats + per-video analytics
  POST /api/diagnose     run Claude deep analysis (background job)
  POST /api/action/research|produce|publish   {channel}  (background jobs)
  POST /api/action/approve|reject             {video_id, reason?}
"""

from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import threading
import time
import uuid
import zoneinfo
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import analytics, brand, diagnose, formula, runtime

WEBUI = runtime.resource_root() / "webui"


def _save_api_key(cfg, key: str) -> None:
    """Persist the Anthropic key to the writable .env and make it live on cfg
    (so the running app can research/produce immediately, no restart)."""
    key = (key or "").strip()
    env_path = runtime.user_dir() / ".env"
    lines = []
    if env_path.exists():
        lines = [l for l in env_path.read_text().splitlines()
                 if not l.strip().startswith("ANTHROPIC_API_KEY")]
    lines.append(f"ANTHROPIC_API_KEY={key}")
    env_path.write_text("\n".join(lines) + "\n", encoding="ascii")
    cfg.anthropic_api_key = key
    os.environ["ANTHROPIC_API_KEY"] = key

BENCHMARKS = {
    "retention_gate_short_pct": 65.0,
    "retention_gate_mid_pct": 50.0,
    "engagement_rate_pct": 4.0,
    "monetize_tier1_subs": 500,
    "monetize_tier2_subs": 1000,
    "monetize_tier2_views_90d": 10_000_000,
}

METHOD_STEPS = [
    {"step": "Research", "module": "app/research.py", "page": "ideas",
     "what": "Claude + live web search finds what is rising in the niche right now",
     "rule": "Original angles only; every topic must carry a number, name, or testable claim"},
    {"step": "Score ideas", "module": "app/formula.py", "page": "ideas",
     "what": "S1 = trend + RPM tier + novelty + learned prior",
     "rule": "Epsilon-greedy: 80% best ideas, 20% deliberate exploration"},
    {"step": "Script", "module": "app/scriptgen.py", "page": "production",
     "what": "Claude writes to the retention contract + storyboard + emoji + pin comment",
     "rule": "HOOK <=12 words -> 3-6 escalating beats -> PAYOFF -> LOOP; 60-95 spoken words"},
    {"step": "Quality gate", "module": "app/scriptgen.py", "page": "production",
     "what": "Validator + S2 score (idea x hook x retention prediction)",
     "rule": "Below threshold = rewritten once, then discarded"},
    {"step": "Voice", "module": "app/voice.py", "page": "production",
     "what": "Kokoro TTS locally, word-level timestamps, 1.08x pace",
     "rule": "One consistent voice per channel — voice IS brand"},
    {"step": "Scenes", "module": "app/scenes.py", "page": "production",
     "what": "Storyboard drawn natively: stats, charts, timelines, figures + emoji, with licensed archival photos fetched per scene",
     "rule": "Starfield Noir only; every scene carries >=1 real photo (backdrop, card, or collage); numbers on screen match numbers spoken"},
    {"step": "Assemble", "module": "app/render.py", "page": "production",
     "what": "Punch-in cuts, karaoke captions, emoji pops, whoosh/pop SFX, progress bar",
     "rule": "Something moves or changes every ~2 seconds; hook readable at frame 0"},
    {"step": "Review", "module": "app/review.py", "page": "review",
     "what": "Human gate (or autopilot above score floor) — watch, approve, reject",
     "rule": "Nothing weak ships; rejects teach the gate what to block"},
    {"step": "Publish", "module": "app/publish.py", "page": "publish",
     "what": "Scheduled into peak slots, engagement comment when live",
     "rule": "1-2/day/channel; never two videos in one slot"},
    {"step": "Learn", "module": "app/analytics.py", "page": "analytics",
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


# ================================================================= dashboard
def _stat_cache_get(ledger, channel_name: str) -> dict:
    return {
        "subscribers": int(ledger.get_weight(channel_name, "stat:subscribers", -1)),
        "total_views": int(ledger.get_weight(channel_name, "stat:total_views", -1)),
        "uploads": int(ledger.get_weight(channel_name, "stat:uploads", -1)),
    }


def refresh(cfg, ledger) -> dict:
    out = {}
    for ch in cfg.channels:
        entry = {"channel_stats": None, "videos_updated": 0, "error": None}
        try:
            stats = analytics.channel_stats(ch)
            if stats:
                for k in ("subscribers", "total_views", "uploads"):
                    ledger.set_weight(ch.name, f"stat:{k}", float(stats[k]))
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
        "id": ch.name, "display": b["display"], "handle": b["handle"],
        "tagline": b["tagline"], "niche": ch.niche, "mark": b.get("mark", "trajectory"),
        "stats_known": stats["subscribers"] >= 0,
        "subscribers": subs if stats["subscribers"] >= 0 else None,
        "total_views": stats["total_views"] if stats["total_views"] >= 0 else None,
        "views_90d": views_90d, "likes": total_likes, "comments": total_comments,
        "avg_retention_pct": avg_ret, "engagement_rate_pct": eng,
        "videos_by_status": by_status, "published": len(perf),
        "goal": {
            "subscribers": goal,
            "pct_to_goal": round(min(100.0, subs / goal * 100), 2) if goal else 0,
            "tier1_pct": round(min(100.0, subs / BENCHMARKS["monetize_tier1_subs"] * 100), 1),
            "tier2_subs_pct": round(min(100.0, subs / BENCHMARKS["monetize_tier2_subs"] * 100), 1),
            "tier2_views_pct": round(min(100.0, views_90d / BENCHMARKS["monetize_tier2_views_90d"] * 100), 2),
        },
        "retention_series": [round(r["avg_view_pct"], 1) for r in reversed(perf)][-40:],
        "views_series": [r["views"] or 0 for r in reversed(perf)][-40:],
        "videos": [{k: r[k] for k in ("post_id", "hook_type", "format", "seconds",
                                      "views", "avg_view_pct", "performance")} for r in perf[:25]],
    }


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
        ("color emoji font", "emoji layer in videos",
         lambda: __import__("app.scenes", fromlist=["x"])._emoji_font()[0]),
        ("Kokoro TTS", "local voice (best)", lambda: __import__("kokoro")),
        ("edge-tts fallback", "cloud voice fallback", lambda: __import__("edge_tts")),
    ]
    out = [{"name": n, "role": r, "ok": probe(f)} for n, r, f in checks]
    for ch in cfg.channels:
        tok = Path(ch.token_file or f"secrets/{ch.name}_token.json")
        out.append({"name": f"YouTube auth — {brand.brand_for(ch.name)['display']}",
                    "role": "upload + analytics", "ok": tok.exists()})
    return out


def _reports(cfg) -> list[Path]:
    d = cfg.data_dir / "reports"
    return sorted(d.glob("*.md"), reverse=True) if d.exists() else []


def summary(cfg, ledger) -> dict:
    reports = _reports(cfg)
    return {
        "goal_subscribers": cfg.goal_subscribers,
        "benchmarks": BENCHMARKS,
        "channels": [_channel_summary(cfg, ledger, ch) for ch in cfg.channels],
        "insights": {"count": len(reports),
                     "latest_name": reports[0].name if reports else None,
                     "latest_markdown": reports[0].read_text()[:20000] if reports else ""},
        "milestones": MILESTONES,
        "tools": tools_status(cfg),
    }


# ================================================================= analytics
def _group(perf: list[dict], key) -> list[dict]:
    groups: dict[str, list] = {}
    for r in perf:
        groups.setdefault(str(key(r)), []).append(r)
    out = []
    for k, v in groups.items():
        rets = [x["avg_view_pct"] for x in v if x["avg_view_pct"] is not None]
        out.append({
            "group": k, "videos": len(v),
            "views": sum(x["views"] or 0 for x in v),
            "avg_retention_pct": round(sum(rets) / len(rets), 1) if rets else None,
            "avg_performance": round(sum(x["performance"] for x in v) / len(v), 3),
        })
    out.sort(key=lambda d: -(d["avg_performance"] or 0))
    return out


def _slot_analysis(cfg, ledger, ch) -> list[dict]:
    """Performance by channel-local posting slot."""
    tz = zoneinfo.ZoneInfo(ch.timezone)
    rows = ledger.db.execute("""
        SELECT p.publish_at, m.views, m.avg_view_pct
        FROM posts p JOIN metrics m ON m.post_id = p.id
          AND m.fetched_at = (SELECT MAX(fetched_at) FROM metrics WHERE post_id = p.id)
        WHERE p.channel=? AND p.status IN ('uploaded','live','exported') AND p.publish_at != ''
    """, (ch.name,)).fetchall()
    groups: dict[str, list] = {}
    for r in rows:
        try:
            when = dt.datetime.fromisoformat(r["publish_at"].replace("Z", "+00:00")).astimezone(tz)
        except ValueError:
            continue
        groups.setdefault(when.strftime("%H:%M"), []).append(r)
    out = []
    for slot, v in sorted(groups.items()):
        rets = [x["avg_view_pct"] for x in v if x["avg_view_pct"] is not None]
        out.append({"slot": slot, "videos": len(v),
                    "avg_views": int(sum(x["views"] or 0 for x in v) / len(v)),
                    "avg_retention_pct": round(sum(rets) / len(rets), 1) if rets else None})
    return out


def _guidance(cfg, ch, perf, by_hook, by_format, by_length, slots, funnel) -> list[dict]:
    """Rule-based findings — each with the evidence that produced it."""
    out = []
    solid = [g for g in by_hook if g["videos"] >= 3 and g["avg_retention_pct"] is not None]
    if len(solid) >= 2:
        best, worst = solid[0], solid[-1]
        gap = round((best["avg_retention_pct"] or 0) - (worst["avg_retention_pct"] or 0), 1)
        if gap >= 5:
            out.append({"level": "act",
                        "finding": f"Hook type '{best['group']}' clearly beats '{worst['group']}'",
                        "evidence": f"{best['avg_retention_pct']}% vs {worst['avg_retention_pct']}% avg retention "
                                    f"(n={best['videos']} vs {worst['videos']})",
                        "action": f"Add seed topics that suit '{best['group']}' hooks; let epsilon keep testing the rest"})
    for g in by_length:
        if g["videos"] >= 3 and g["avg_retention_pct"] is not None:
            gate = BENCHMARKS["retention_gate_short_pct"] if g["group"] == "short" else BENCHMARKS["retention_gate_mid_pct"]
            if g["avg_retention_pct"] < gate:
                out.append({"level": "fix",
                            "finding": f"'{g['group']}' videos fall below their retention gate",
                            "evidence": f"{g['avg_retention_pct']}% avg vs {gate}% gate (n={g['videos']})",
                            "action": "Cap length harder or tighten beats — cut the weakest beat before rendering"})
    slot_solid = [s for s in slots if s["videos"] >= 3 and s["avg_views"]]
    if len(slot_solid) >= 2:
        best = max(slot_solid, key=lambda s: s["avg_views"])
        worst = min(slot_solid, key=lambda s: s["avg_views"])
        if worst["avg_views"] and best["avg_views"] / max(worst["avg_views"], 1) >= 1.3:
            out.append({"level": "act",
                        "finding": f"The {best['slot']} slot outperforms {worst['slot']}",
                        "evidence": f"{best['avg_views']} vs {worst['avg_views']} avg views "
                                    f"(n={best['videos']} vs {worst['videos']})",
                        "action": f"Shift the {worst['slot']} slot 60-90 min and re-measure for two weeks"})
    if funnel["discarded"] + funnel["scripted_total"] > 0:
        rate = funnel["discarded"] / max(1, funnel["scripted_total"] + funnel["discarded"])
        if rate > 0.5:
            out.append({"level": "fix",
                        "finding": "More than half of scripts die at the quality gate",
                        "evidence": f"{funnel['discarded']} discarded vs {funnel['scripted_total']} passed",
                        "action": "Broaden niche wording / seed topics — don't lower script_threshold"})
    rets = [r["avg_view_pct"] for r in reversed(perf) if r["avg_view_pct"] is not None]
    if len(rets) >= 6:
        half = len(rets) // 2
        older, newer = sum(rets[:half]) / half, sum(rets[half:]) / (len(rets) - half)
        delta = round(newer - older, 1)
        out.append({"level": "good" if delta >= 0 else "fix",
                    "finding": f"Retention is {'improving' if delta >= 0 else 'declining'} over time",
                    "evidence": f"last {len(rets)-half} videos avg {round(newer,1)}% vs previous {round(older,1)}% ({'+' if delta>=0 else ''}{delta} pts)",
                    "action": "Keep the current direction" if delta >= 0 else "Run the Claude deep analysis and change ONE variable"})
    if not perf:
        out.append({"level": "info", "finding": "No published data yet",
                    "evidence": "guidance activates as soon as videos collect views",
                    "action": "Produce, publish, then refresh analytics"})
    elif not out:
        rets_all = [r["avg_view_pct"] for r in perf if r["avg_view_pct"] is not None]
        avg = round(sum(rets_all) / len(rets_all), 1) if rets_all else 0
        out.append({"level": "good", "finding": "No red flags in the current data",
                    "evidence": f"{len(perf)} published, {avg}% avg retention; no group differs enough (n>=3, gap>=5pts) to act on",
                    "action": "Keep cadence; findings sharpen as sample sizes grow"})
    return out


def analytics_data(cfg, ledger) -> dict:
    channels = []
    for ch in cfg.channels:
        perf = analytics.report(ledger, ch)
        by_hook = _group(perf, lambda r: r["hook_type"])
        by_format = _group(perf, lambda r: r["format"])
        by_length = _group(perf, lambda r: formula.length_bucket(r["seconds"]))
        slots = _slot_analysis(cfg, ledger, ch)
        ideas = ledger.ideas(ch.name, status=None, limit=500)
        funnel = {
            "candidates": sum(1 for i in ideas if i["status"] == "candidate"),
            "discarded": sum(1 for i in ideas if i["status"] == "discarded"),
            "scripted_total": sum(1 for i in ideas if i["status"] in ("scripted", "done")),
        }
        channels.append({
            "id": ch.name, "display": brand.brand_for(ch.name)["display"],
            "by_hook": by_hook, "by_format": by_format, "by_length": by_length,
            "slots": slots, "funnel": funnel,
            "guidance": _guidance(cfg, ch, perf, by_hook, by_format, by_length, slots, funnel),
            "priors": [{"key": w["key"].replace("prior:", ""), "value": round(w["value"], 3),
                        "samples": w["samples"]}
                       for w in ledger.weights_rows(ch.name) if w["key"].startswith("prior:")],
            "videos": [{k: r[k] for k in ("post_id", "hook_type", "format", "seconds",
                                          "views", "avg_view_pct", "performance")} for r in perf],
        })
    return {"benchmarks": BENCHMARKS, "channels": channels,
            "reports": [p.name for p in _reports(cfg)][:30]}


# ================================================================= method / production
def pipeline_data(cfg, ledger) -> dict:
    channels = []
    for ch in cfg.channels:
        ideas = [dict(r) for r in ledger.ideas(ch.name, status="candidate", limit=30)]
        for i in ideas:
            i["keywords"] = json.loads(i["keywords"] or "[]")
        vids = []
        for v in ledger.videos(ch.name):
            script = json.loads(v["script"])
            vids.append({
                "id": v["id"], "status": v["status"], "score": round(v["score"], 2),
                "duration": round(v["duration"] or v["est_seconds"], 1),
                "hook_type": v["hook_type"], "format": v["format"],
                "title": script.get("title", ""), "hook": script.get("hook", ""),
                "beats": script.get("beats", []), "payoff": script.get("payoff", ""),
                "loop_line": script.get("loop_line", ""),
                "pin_comment": script.get("pin_comment", ""),
                "scenes": [{"kind": s.get("kind"), "emoji": s.get("emoji", "")}
                           for s in script.get("scenes", [])],
                "has_file": bool(v["video_path"]) and Path(v["video_path"]).exists(),
                "reject_reason": v["reject_reason"],
            })
        posts = [{"id": p["id"], "title": p["title"], "publish_at": p["publish_at"],
                  "status": p["status"], "yt_video_id": p["yt_video_id"]}
                 for p in ledger.posts(ch.name)][:20]
        channels.append({"id": ch.name, "display": brand.brand_for(ch.name)["display"],
                         "ideas": ideas, "videos": vids, "posts": posts})
    return {"channels": channels, "method": METHOD_STEPS,
            "publish_mode": cfg.publish_mode, "review_required": cfg.review_required}


# ================================================================= background jobs
JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()


def _job_start(kind: str, detail: str, target, *args) -> str:
    job_id = uuid.uuid4().hex[:8]
    with _JOBS_LOCK:
        JOBS[job_id] = {"id": job_id, "kind": kind, "detail": detail,
                        "status": "running", "started": time.time(), "result": None}

    def run():
        try:
            result = target(*args)
            with _JOBS_LOCK:
                JOBS[job_id].update(status="done", result=str(result)[:500])
        except Exception as e:
            with _JOBS_LOCK:
                JOBS[job_id].update(status="failed", result=str(e)[:500])

    threading.Thread(target=run, daemon=True).start()
    return job_id


def jobs_snapshot() -> list[dict]:
    with _JOBS_LOCK:
        out = sorted(JOBS.values(), key=lambda j: -j["started"])[:12]
        return [dict(j) for j in out]


# ================================================================= http server
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

        def _with_ledger(self, fn):
            led = ledger_factory()
            try:
                return fn(led)
            finally:
                led.close()

        def do_GET(self):
            path, _, query = self.path.partition("?")
            params = dict(q.split("=", 1) for q in query.split("&") if "=" in q)
            if path in ("/", "/index.html"):
                page = (WEBUI / "index.html").read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(page)))
                self.end_headers()
                self.wfile.write(page)
            elif path == "/api/summary":
                self._json(self._with_ledger(lambda led: summary(cfg, led)))
            elif path == "/api/analytics":
                self._json(self._with_ledger(lambda led: analytics_data(cfg, led)))
            elif path == "/api/pipeline":
                self._json(self._with_ledger(lambda led: pipeline_data(cfg, led)))
            elif path == "/api/jobs":
                self._json(jobs_snapshot())
            elif path == "/api/settings":
                self._json({"has_key": bool(cfg.anthropic_api_key),
                            "frozen": runtime.is_frozen(),
                            "channels": [c.name for c in cfg.channels]})
            elif path == "/api/report":
                name = Path(params.get("name", "")).name  # no traversal
                f = cfg.data_dir / "reports" / name
                if f.exists() and f.suffix == ".md":
                    self._json({"name": name, "markdown": f.read_text()[:40000]})
                else:
                    self._json({"error": "not found"}, 404)
            elif path.startswith("/video/"):
                self._serve_video(path.split("/")[-1])
            else:
                self._json({"error": "not found"}, 404)

        def _serve_video(self, video_id: str):
            row = self._with_ledger(lambda led: led.video(int(video_id)) if video_id.isdigit() else None)
            if not row or not row["video_path"] or not Path(row["video_path"]).exists():
                self._json({"error": "no file"}, 404)
                return
            data = Path(row["video_path"]).read_bytes()
            start, end = 0, len(data) - 1
            rng = self.headers.get("Range")
            if rng and rng.startswith("bytes="):
                part = rng[6:].split(",")[0]
                s, _, e = part.partition("-")
                start = int(s) if s else 0
                end = int(e) if e else len(data) - 1
                end = min(end, len(data) - 1)
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
            else:
                self.send_response(200)
            chunk = data[start:end + 1]
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(len(chunk)))
            self.end_headers()
            self.wfile.write(chunk)

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if not n:
                return {}
            try:
                return json.loads(self.rfile.read(n))
            except Exception:
                return {}

        def do_POST(self):
            body = self._body()
            if self.path == "/api/settings/key":
                key = (body.get("key") or "").strip()
                if not key.startswith("sk-"):
                    self._json({"error": "that doesn't look like an Anthropic key "
                                         "(it should start with 'sk-')"}, 400)
                else:
                    _save_api_key(cfg, key)
                    self._json({"ok": True, "has_key": True})
            elif self.path == "/api/refresh":
                self._json(self._with_ledger(lambda led: refresh(cfg, led)))
            elif self.path == "/api/diagnose":
                def run():
                    led = ledger_factory()
                    try:
                        names = []
                        for ch in cfg.channels:
                            _, p = diagnose.run_diagnosis(cfg, led, ch)
                            names.append(p.name if p else "?")
                        return ", ".join(names)
                    finally:
                        led.close()
                self._json({"job": _job_start("diagnose", "Claude deep analysis", run)})
            elif self.path == "/api/action/research":
                ch = cfg.channel(body.get("channel", ""))
                def run():
                    from . import ideate
                    led = ledger_factory()
                    try:
                        return f"+{ideate.refresh_ideas(cfg, ch, led)} ideas"
                    finally:
                        led.close()
                self._json({"job": _job_start("research", f"researching {ch.name}", run)})
            elif self.path == "/api/action/produce":
                ch = cfg.channel(body.get("channel", ""))
                count = int(body.get("count", 1))
                def run():
                    from . import pipeline
                    led = ledger_factory()
                    try:
                        made = pipeline.run_channel(cfg, ch, led, count=count)
                        return f"produced {len(made)} video(s): {made}"
                    finally:
                        led.close()
                self._json({"job": _job_start("produce", f"producing {count} for {ch.name}", run)})
            elif self.path == "/api/action/publish":
                ch = cfg.channel(body.get("channel", ""))
                def run():
                    from . import publish as pub
                    led = ledger_factory()
                    try:
                        res = pub.publish_approved(cfg, led, ch)
                        pub.sweep_live(cfg, led, ch)
                        return f"{len(res)} scheduled"
                    finally:
                        led.close()
                self._json({"job": _job_start("publish", f"publishing {ch.name}", run)})
            elif self.path == "/api/action/approve":
                from . import review
                self._with_ledger(lambda led: review.approve(led, int(body["video_id"])))
                self._json({"ok": True})
            elif self.path == "/api/action/reject":
                from . import review
                self._with_ledger(lambda led: review.reject(led, int(body["video_id"]),
                                                            body.get("reason", "")))
                self._json({"ok": True})
            else:
                self._json({"error": "not found"}, 404)

    return Handler


def serve(cfg, ledger_factory, host: str = "0.0.0.0", port: int = 8787) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), make_handler(cfg, ledger_factory))


def serve_forever(cfg, ledger_factory, host: str = "0.0.0.0", port: int = 8787):
    server = serve(cfg, ledger_factory, host, port)
    print(f"Mission control: http://localhost:{port}  (same URL works from your "
          f"phone on the same Wi-Fi via this machine's IP)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
