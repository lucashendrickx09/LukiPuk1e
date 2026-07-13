import json

from PIL import Image

from app import images, metadata, scenes, visuals
from app.scriptgen import Script
from tests.conftest import GOOD_SCRIPT

THEME = visuals.THEMES["noir"]


def test_license_filter():
    ok = ["Public domain", "CC BY 2.0", "CC BY-SA 4.0", "CC0", "PD-US"]
    bad = ["CC BY-NC 2.0", "CC BY-ND 4.0", "Fair use", "", "All rights reserved",
           "CC BY-NC-SA 3.0"]
    assert all(images._license_ok(x) for x in ok)
    assert not any(images._license_ok(x) for x in bad)


def test_credit_strips_html():
    assert images._strip_html('<a href="x">Jane <b>Doe</b></a>') == "Jane Doe"


def test_ensure_caches_misses(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(images, "search", lambda q, limit=8: calls.append(q) or [])
    assert images.ensure(tmp_path, "nobody famous") == (None, None)
    assert images.ensure(tmp_path, "nobody famous") == (None, None)  # cached miss
    assert len(calls) == 1
    assert images.ensure(tmp_path, "") == (None, None)  # empty query never searches


def test_resolve_skips_hook_scene_and_collects_credits(cfg, tmp_path, monkeypatch):
    fake = tmp_path / "p.jpg"
    Image.new("RGB", (800, 600), (90, 90, 90)).save(fake)
    monkeypatch.setattr(images, "ensure", lambda d, q: (fake, f"credit for {q}"))
    script = Script.from_dict(GOOD_SCRIPT)
    script.scenes[0]["image_query"] = "should be ignored"   # hook scene
    script.scenes[1]["image_query"] = "Sam Walton"
    script.scenes[2]["image_query"] = "Sam Walton"          # duplicate credit collapses
    paths = images.resolve_for_script(cfg, script)
    assert 0 not in paths and 1 in paths and 2 in paths
    assert script.image_credits == ["credit for Sam Walton"]


def test_photo_scene_renders(tmp_path):
    photo = tmp_path / "photo.jpg"
    Image.new("RGB", (900, 1200), (120, 100, 80)).save(photo)
    scene = {"kind": "figure", "headline": "Sam Walton", "value": "$2.8B",
             "label": "net worth, 1985", "sub": "", "points": [], "emoji": ""}
    out = scenes.render_scene(scene, THEME, seed=3, out_png=tmp_path / "s.png",
                              image_path=photo)
    im = Image.open(out)
    assert im.size == (scenes.SCENE_W, scenes.SCENE_H)
    # photo pixels present in the upper zone (not the near-black background)
    px = im.convert("RGB").getpixel((scenes.SCENE_W // 2, 500))
    assert sum(px) > 150, f"expected photo pixels, got {px}"


def test_photo_scene_falls_back_when_image_missing(tmp_path):
    scene = {"kind": "big_stat", "value": "$1M", "label": "x", "headline": "", "sub": "",
             "points": [], "emoji": ""}
    out = scenes.render_scene(scene, THEME, seed=3, out_png=tmp_path / "s.png",
                              image_path=tmp_path / "nope.jpg")
    assert out.exists()


def test_metadata_includes_image_credits(channel):
    script = Script.from_dict(GOOD_SCRIPT)
    script.image_credits = ["Ann Author (CC BY 2.0)", "Wikimedia Commons (Public domain)"]
    meta = metadata.build(script, channel)
    assert "Images: Ann Author (CC BY 2.0)" in meta["description"]


def test_script_roundtrip_keeps_credits():
    script = Script.from_dict(GOOD_SCRIPT)
    script.image_credits = ["c1"]
    again = Script.from_dict(json.loads(json.dumps(script.to_dict())))
    assert again.image_credits == ["c1"]
