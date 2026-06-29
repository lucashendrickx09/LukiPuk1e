"""Phase 8 (extra) — mobile web dashboard (PWA).

A small FastAPI server you run on your Mac/PC. Your phone reaches it (over
Tailscale, LAN, or a tunnel) and gets a phone-friendly control panel that can:
  - run every pipeline step (ingest/transcribe/analyze/render/publish/run),
  - manage sources,
  - review clips: preview the rendered video + Approve / Edit caption / Reject.

Same Hard Rules as the Telegram loop: approving hands the clip to the Phase 5
publisher (which still blocks non-permission-cleared sources); nothing posts
without your tap.

FastAPI/uvicorn are imported lazily inside `create_app`/`serve` so the pure
helpers (status snapshot, review payload, JobRunner) stay importable — and
unit-testable — without the web deps installed.

NOTE: this module deliberately does NOT use `from __future__ import annotations`.
FastAPI resolves route-parameter types from the function signature; with the
locally-imported `Request`/`HTTPException` types that only works when the
annotations are real objects, not strings.
"""

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from .config import PERMISSION_CLEARED, Config
from . import (
    analyze, approve, ingest, ledger, publish, render, transcribe,
)
from .ytdlp import classify_url, make_provider

log = logging.getLogger("clipper.webui")

STATIC_DIR = Path(__file__).resolve().parent.parent / "webui" / "static"

# step name -> callable(cfg) building/running that step's report
STEP_FUNCS: dict[str, Callable[[Config], object]] = {
    "ingest": lambda cfg: ingest.run_ingest(cfg, make_provider(cfg)),
    "transcribe": lambda cfg: transcribe.run_transcribe(cfg),
    "analyze": lambda cfg: analyze.run_analyze(cfg),
    "render": lambda cfg: render.run_render(cfg),
    "publish": lambda cfg: publish.run_publish(cfg),
    "run": None,  # filled below to avoid a forward ref
}


def _run_all(cfg: Config):
    from . import pipeline
    return pipeline.run_all(cfg, send_summary=False)


STEP_FUNCS["run"] = _run_all


# ===========================================================================
# Pure helpers (unit-tested without FastAPI)
# ===========================================================================
def status_snapshot(conn) -> dict:
    def by_status(table):
        return {r["status"]: r["n"] for r in
                conn.execute(f"SELECT status, COUNT(*) AS n FROM {table} GROUP BY status")}
    return {
        "videos": by_status("videos"),
        "clips": by_status("clips"),
        "posts": {r["status"]: r["n"] for r in
                  conn.execute("SELECT status, COUNT(*) AS n FROM posts GROUP BY status")},
    }


def review_items(conn) -> list[dict]:
    """Clips awaiting approval (status=ready), newest first, with their source
    permission status and whether a preview video exists."""
    out: list[dict] = []
    for clip in ledger.list_clips(conn, status="ready"):
        src = ledger.get_source_for_clip(conn, clip["id"])
        try:
            tags = json.loads(clip["hashtags"]) if clip["hashtags"] else []
        except (TypeError, json.JSONDecodeError):
            tags = []
        out.append({
            "id": clip["id"],
            "title": clip["title"],
            "caption": clip["caption"],
            "hashtags": tags,
            "hook_score": clip["hook_score"],
            "start": clip["start_sec"],
            "end": clip["end_sec"],
            "permission": (src["permission_status"] if src else None) or "unknown",
            "permission_cleared": bool(src) and (src["permission_status"] or "").lower() in PERMISSION_CLEARED,
            "has_video": bool(clip["file_path"] and Path(clip["file_path"]).exists()),
        })
    return sorted(out, key=lambda c: c["id"], reverse=True)


def sources_list(conn) -> list[dict]:
    return [{
        "id": r["id"], "url": r["url"], "type": r["type"],
        "permission_status": r["permission_status"],
        "cleared": (r["permission_status"] or "").lower() in PERMISSION_CLEARED,
        "last_seen": r["last_seen_video_id"],
    } for r in ledger.list_sources(conn)]


class JobRunner:
    """Runs one pipeline step at a time in a background thread so the phone UI
    stays responsive. Single-flight: refuses to start a second step while one
    is running."""

    def __init__(self):
        self._lock = threading.Lock()
        self.running: str | None = None
        self.last: dict | None = None

    def start(self, name: str, fn: Callable[[], object]) -> bool:
        with self._lock:
            if self.running is not None:
                return False
            self.running = name
        threading.Thread(target=self._run, args=(name, fn), daemon=True).start()
        return True

    def _run(self, name: str, fn: Callable[[], object]) -> None:
        ok, result = True, ""
        try:
            rep = fn()
            result = rep.line() if hasattr(rep, "line") else str(rep)
        except Exception as exc:  # noqa: BLE001 — surface in the UI, don't crash
            ok, result = False, str(exc)
            log.error("step %s failed: %s", name, exc)
        with self._lock:
            self.running = None
            self.last = {"step": name, "ok": ok, "result": result,
                         "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}

    def state(self) -> dict:
        with self._lock:
            return {"running": self.running, "last": self.last}


# ===========================================================================
# Clip actions (shared by the web routes; mirror the Telegram loop)
# ===========================================================================
def approve_clip(cfg: Config, clip_id: int) -> str:
    hook = approve.default_publish_hook(cfg)
    with ledger.session(cfg.ledger_db) as conn:
        if ledger.get_clip(conn, clip_id) is None:
            return "clip not found"
        ledger.set_clip_status(conn, clip_id, "approved")
    return hook(clip_id)  # opens its own session via publish.run_publish


def reject_clip(cfg: Config, clip_id: int) -> str:
    with ledger.session(cfg.ledger_db) as conn:
        ledger.reject_clip(conn, clip_id, "rejected via web UI")
    return "rejected"


def edit_caption(cfg: Config, clip_id: int, caption: str, do_approve: bool) -> str:
    with ledger.session(cfg.ledger_db) as conn:
        ledger.set_clip_caption(conn, clip_id, caption)
    return approve_clip(cfg, clip_id) if do_approve else "caption updated"


# ===========================================================================
# FastAPI app (lazy import)
# ===========================================================================
def create_app(cfg: Config):
    try:
        from fastapi import FastAPI, HTTPException, Request
        from fastapi.responses import FileResponse, JSONResponse
        from fastapi.staticfiles import StaticFiles
    except ImportError as exc:
        raise RuntimeError(
            "web UI needs FastAPI + uvicorn: python3 -m pip install "
            "'fastapi' 'uvicorn[standard]'"
        ) from exc

    ledger.init_db(cfg.ledger_db)
    cfg.ensure_dirs()
    jobs = JobRunner()
    token = cfg.get("webui", "token", default=None) or Config.secret("CLIPPER_WEB_TOKEN")

    app = FastAPI(title="Clipper", docs_url=None, redoc_url=None)

    def _auth(request: Request) -> None:
        if not token:
            return
        supplied = (request.headers.get("x-clipper-token")
                    or request.query_params.get("token")
                    or request.cookies.get("clipper_token"))
        if supplied != token:
            raise HTTPException(status_code=401, detail="bad or missing token")

    @app.get("/")
    def index():
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/manifest.webmanifest")
    def manifest():
        return FileResponse(STATIC_DIR / "manifest.webmanifest",
                            media_type="application/manifest+json")

    @app.get("/sw.js")
    def sw():
        return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript")

    @app.get("/api/status")
    def api_status(request: Request):
        _auth(request)
        with ledger.session(cfg.ledger_db) as conn:
            snap = status_snapshot(conn)
        return {"counts": snap, "job": jobs.state(),
                "threshold": cfg.hook_score_threshold}

    @app.post("/api/run/{step}")
    def api_run(step: str, request: Request):
        _auth(request)
        fn = STEP_FUNCS.get(step)
        if fn is None and step not in STEP_FUNCS:
            raise HTTPException(404, f"unknown step '{step}'")
        started = jobs.start(step, lambda: STEP_FUNCS[step](cfg))
        if not started:
            return JSONResponse({"started": False, "reason": "a step is already running"},
                                status_code=409)
        return {"started": True, "step": step}

    @app.get("/api/sources")
    def api_sources(request: Request):
        _auth(request)
        with ledger.session(cfg.ledger_db) as conn:
            return sources_list(conn)

    @app.post("/api/sources")
    async def api_add_source(request: Request):
        _auth(request)
        body = await request.json()
        url = (body.get("url") or "").strip()
        perm = (body.get("permission") or "unverified").lower()
        stype = body.get("type") or "auto"
        if not url:
            raise HTTPException(400, "url required")
        if stype == "auto":
            stype = classify_url(url)
        with ledger.session(cfg.ledger_db) as conn:
            row = ledger.add_source(conn, url, stype, perm)
            return {"id": row["id"]}

    @app.delete("/api/sources/{source_id}")
    def api_del_source(source_id: int, request: Request):
        _auth(request)
        with ledger.session(cfg.ledger_db) as conn:
            ledger.remove_source(conn, source_id)
        return {"ok": True}

    @app.get("/api/review")
    def api_review(request: Request):
        _auth(request)
        with ledger.session(cfg.ledger_db) as conn:
            return review_items(conn)

    @app.get("/clip/{clip_id}/video")
    def api_clip_video(clip_id: int, request: Request):
        _auth(request)
        with ledger.session(cfg.ledger_db) as conn:
            clip = ledger.get_clip(conn, clip_id)
        if clip is None or not clip["file_path"] or not Path(clip["file_path"]).exists():
            raise HTTPException(404, "no rendered video for this clip")
        return FileResponse(clip["file_path"], media_type="video/mp4")

    @app.post("/api/clip/{clip_id}/approve")
    def api_approve(clip_id: int, request: Request):
        _auth(request)
        return {"result": approve_clip(cfg, clip_id)}

    @app.post("/api/clip/{clip_id}/reject")
    def api_reject(clip_id: int, request: Request):
        _auth(request)
        return {"result": reject_clip(cfg, clip_id)}

    @app.post("/api/clip/{clip_id}/caption")
    async def api_caption(clip_id: int, request: Request):
        _auth(request)
        body = await request.json()
        caption = (body.get("caption") or "").strip()
        if not caption:
            raise HTTPException(400, "caption required")
        return {"result": edit_caption(cfg, clip_id, caption, bool(body.get("approve")))}

    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    return app


def serve(cfg: Config, host: str | None = None, port: int | None = None) -> None:
    try:
        import uvicorn
    except ImportError as exc:
        raise RuntimeError(
            "web UI needs uvicorn: python3 -m pip install 'uvicorn[standard]'"
        ) from exc
    host = host or cfg.get("webui", "host", default="0.0.0.0")
    port = int(port or cfg.get("webui", "port", default=8765))
    log.info("serving Clipper web UI on http://%s:%s", host, port)
    uvicorn.run(create_app(cfg), host=host, port=port, log_level="info")
