import json
import threading
import urllib.request

from app import webapp
from tests.conftest import GOOD_SCRIPT


def _seed(ledger, channel):
    idea = ledger.add_idea(channel.name, "dash topic", trend=0.7, rpm=0.9)
    vid = ledger.add_video(idea, channel.name, GOOD_SCRIPT, hook_type="stat_shock",
                           fmt="explainer", est_seconds=26, score=0.8)
    ledger.set_video(vid, status="published")
    post = ledger.add_post(vid, channel.name, "t", "2026-07-01T16:30:00Z")
    ledger.set_post(post, yt_video_id="yt1", status="live")
    ledger.record_metrics(post, views=4000, likes=180, comments=25,
                          avg_view_pct=71.0, avg_view_seconds=18.0)
    ledger.set_weight(channel.name, "stat:subscribers", 850)
    ledger.set_weight(channel.name, "stat:total_views", 120000)
    ledger.set_weight(channel.name, "stat:uploads", 30)


def test_summary_structure(cfg, ledger, channel):
    _seed(ledger, channel)
    s = webapp.summary(cfg, ledger)
    assert s["goal_subscribers"] == 100_000
    ch = s["channels"][0]
    assert ch["subscribers"] == 850
    assert ch["views_90d"] == 4000
    assert ch["avg_retention_pct"] == 71.0
    assert ch["goal"]["tier1_pct"] == 100.0          # 850/500 capped
    assert 0 < ch["goal"]["pct_to_goal"] < 1          # 850/100k
    assert ch["retention_series"] == [71.0]
    assert len(s["method"]) == 10
    assert s["milestones"][-1]["at"].startswith("100,000")
    assert any(t["name"] == "ffmpeg" for t in s["tools"])


def test_summary_empty_channel_is_safe(cfg, ledger, channel):
    s = webapp.summary(cfg, ledger)
    ch = s["channels"][0]
    assert ch["subscribers"] is None and ch["avg_retention_pct"] is None
    assert ch["videos"] == [] and ch["retention_series"] == []


def test_http_server_serves_dashboard_and_api(cfg, ledger, channel, tmp_path):
    _seed(ledger, channel)
    server = webapp.serve(cfg, lambda: type(ledger)(cfg.ledger_path), host="127.0.0.1", port=0)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        page = urllib.request.urlopen(f"http://127.0.0.1:{port}/").read().decode()
        assert "MISSION CONTROL" in page and "api/summary" in page
        api = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/summary").read())
        assert api["channels"][0]["subscribers"] == 850
        # unknown route -> 404 json
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/nope")
            assert False, "expected 404"
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        server.shutdown()


def test_refresh_survives_missing_auth(cfg, ledger, channel):
    out = webapp.refresh(cfg, ledger)
    assert channel.name in out
    assert out[channel.name]["error"]  # no google auth in tests — captured, not raised
