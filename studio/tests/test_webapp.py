import json
import threading
import urllib.request

from app import webapp
from tests.conftest import GOOD_SCRIPT


def _seed(ledger, channel, n=6):
    for i in range(n):
        idea = ledger.add_idea(channel.name, f"dash topic {i}", trend=0.7, rpm=0.9)
        vid = ledger.add_video(idea, channel.name, GOOD_SCRIPT,
                               hook_type="stat_shock" if i % 2 else "question",
                               fmt="explainer", est_seconds=26, score=0.8)
        ledger.set_video(vid, status="published")
        ledger.set_idea_status(idea, "done")
        post = ledger.add_post(vid, channel.name, f"t{i}", f"2026-07-0{i+1}T16:30:00Z")
        ledger.set_post(post, yt_video_id=f"yt{i}", status="live")
        ledger.record_metrics(post, views=2000 + i * 800, likes=150, comments=25,
                              avg_view_pct=60.0 + i * 4, avg_view_seconds=18.0)
    ledger.set_weight(channel.name, "stat:subscribers", 850)
    ledger.set_weight(channel.name, "stat:total_views", 120000)
    ledger.set_weight(channel.name, "stat:uploads", n)


def test_summary_structure(cfg, ledger, channel):
    _seed(ledger, channel)
    s = webapp.summary(cfg, ledger)
    ch = s["channels"][0]
    assert ch["subscribers"] == 850
    assert ch["published"] == 6
    assert ch["goal"]["tier1_pct"] == 100.0
    assert len(ch["retention_series"]) == 6
    assert s["milestones"][-1]["at"].startswith("100,000")
    assert any(t["name"] == "ffmpeg" for t in s["tools"])


def test_analytics_evidence_and_guidance(cfg, ledger, channel):
    _seed(ledger, channel)
    a = webapp.analytics_data(cfg, ledger)
    ch = a["channels"][0]
    hooks = {g["group"]: g for g in ch["by_hook"]}
    assert set(hooks) == {"stat_shock", "question"}
    assert hooks["stat_shock"]["videos"] == 3
    slots = ch["slots"]
    assert slots and slots[0]["videos"] == 6  # all posted 16:30Z -> one local slot
    # improving retention (60 -> 80) must produce a 'good' trend finding with evidence
    kinds = {g["level"] for g in ch["guidance"]}
    assert "good" in kinds or "act" in kinds
    assert all("evidence" in g and g["evidence"] for g in ch["guidance"])


def test_analytics_empty_channel_guidance(cfg, ledger, channel):
    a = webapp.analytics_data(cfg, ledger)
    g = a["channels"][0]["guidance"]
    assert len(g) == 1 and g[0]["level"] == "info"


def test_pipeline_data_shapes(cfg, ledger, channel):
    idea = ledger.add_idea(channel.name, "console topic", trend=0.8, rpm=0.9, score=0.7)
    vid = ledger.add_video(idea, channel.name, GOOD_SCRIPT, hook_type="stat_shock",
                           fmt="explainer", est_seconds=26, score=0.8)
    ledger.set_video(vid, status="rendered", video_path="/nonexistent.mp4", duration=26.0)
    p = webapp.pipeline_data(cfg, ledger)
    ch = p["channels"][0]
    assert ch["ideas"][0]["topic"] == "console topic"
    v = ch["videos"][0]
    assert v["hook"] == GOOD_SCRIPT["hook"]
    assert len(v["beats"]) == 4 and v["has_file"] is False
    assert len(p["method"]) == 10


def test_http_pages_api_and_actions(cfg, ledger, channel, tmp_path):
    _seed(ledger, channel, n=2)
    # one reviewable video with a real file for /video/<id>
    idea = ledger.add_idea(channel.name, "http review topic")
    vid = ledger.add_video(idea, channel.name, GOOD_SCRIPT, hook_type="question",
                           fmt="story", est_seconds=25, score=0.75)
    fake_mp4 = tmp_path / "v.mp4"
    fake_mp4.write_bytes(b"FAKEMP4" * 4000)
    ledger.set_video(vid, status="rendered", video_path=str(fake_mp4), duration=25.0)

    server = webapp.serve(cfg, lambda: type(ledger)(cfg.ledger_path), host="127.0.0.1", port=0)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    try:
        page = urllib.request.urlopen(base + "/").read().decode()
        for anchor in ("page-dashboard", "page-analytics", "page-method"):
            assert anchor in page
        for ep in ("/api/summary", "/api/analytics", "/api/pipeline", "/api/jobs"):
            assert urllib.request.urlopen(base + ep).status == 200

        # range-aware video streaming
        req = urllib.request.Request(f"{base}/video/{vid}", headers={"Range": "bytes=0-99"})
        resp = urllib.request.urlopen(req)
        assert resp.status == 206 and len(resp.read()) == 100

        # approve via HTTP
        req = urllib.request.Request(f"{base}/api/action/approve", method="POST",
                                     data=json.dumps({"video_id": vid}).encode(),
                                     headers={"Content-Type": "application/json"})
        assert json.loads(urllib.request.urlopen(req).read())["ok"] is True
        assert ledger.video(vid)["status"] == "approved"

        # research action returns a job id and the job eventually settles
        req = urllib.request.Request(f"{base}/api/action/research", method="POST",
                                     data=json.dumps({"channel": channel.name}).encode(),
                                     headers={"Content-Type": "application/json"})
        job = json.loads(urllib.request.urlopen(req).read())["job"]
        import time
        for _ in range(40):
            jobs = json.loads(urllib.request.urlopen(base + "/api/jobs").read())
            j = next(x for x in jobs if x["id"] == job)
            if j["status"] != "running":
                break
            time.sleep(0.1)
        assert j["status"] in ("done", "failed")  # no API key here -> seeds still land or error captured
    finally:
        server.shutdown()


def test_refresh_survives_missing_auth(cfg, ledger, channel):
    out = webapp.refresh(cfg, ledger)
    assert out[channel.name]["error"]
