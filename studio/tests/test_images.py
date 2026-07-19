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
    monkeypatch.setattr(images, "search_openverse", lambda q, limit=8: [])
    assert images.ensure(tmp_path, "nobody famous") == (None, None)
    assert images.ensure(tmp_path, "nobody famous") == (None, None)  # cached miss
    assert len(calls) == 1
    assert images.ensure(tmp_path, "") == (None, None)  # empty query never searches


def test_ensure_never_caches_network_failures(tmp_path, monkeypatch):
    def offline(q, limit=8):
        raise OSError("network unreachable")
    monkeypatch.setattr(images, "search", offline)
    monkeypatch.setattr(images, "search_openverse", offline)
    assert images.ensure(tmp_path, "Sam Walton") == (None, None)
    # offline is not "the image doesn't exist" — the query must retry next run
    assert not list(tmp_path.glob("*.json"))


def test_resolve_covers_every_scene_and_collects_credits(cfg, tmp_path, monkeypatch):
    fake = tmp_path / "p.jpg"
    Image.new("RGB", (800, 600), (90, 90, 90)).save(fake)
    monkeypatch.setattr(images, "ensure", lambda d, q: (fake, f"credit for {q}"))
    script = Script.from_dict(GOOD_SCRIPT)
    script.scenes[0]["image_query"] = "bank vault"           # hook backdrop
    script.scenes[1]["image_query"] = "Sam Walton;Walmart store;Arkansas 1960s"
    script.scenes[2]["image_query"] = "Sam Walton"           # duplicate credit collapses
    paths = images.resolve_for_script(cfg, script)
    assert len(paths[0]) == 1                                # hook scene has its photo
    assert len(paths[1]) == 3                                # one path per ';' query
    assert len(paths[2]) == 1
    assert set(paths) == set(range(len(script.scenes)))      # EVERY scene covered
    assert script.image_credits[:3] == ["credit for bank vault",
                                        "credit for Sam Walton",
                                        "credit for Walmart store"]


def test_resolve_derives_query_when_scene_has_none(cfg, tmp_path, monkeypatch):
    fake = tmp_path / "p.jpg"
    Image.new("RGB", (800, 600), (90, 90, 90)).save(fake)
    asked = []
    monkeypatch.setattr(images, "ensure", lambda d, q: asked.append(q) or (fake, ""))
    script = Script.from_dict(GOOD_SCRIPT)
    script.scenes[3]["image_query"] = ""                     # chart scene, no query
    images.resolve_for_script(cfg, script)
    # fell back to the scene's own headline text
    assert any("over" in q and "years" in q for q in asked)


def test_resolve_borrows_nearest_photo_on_miss(cfg, tmp_path, monkeypatch):
    fake = tmp_path / "p.jpg"
    Image.new("RGB", (800, 600), (90, 90, 90)).save(fake)
    monkeypatch.setattr(images, "ensure",
                        lambda d, q: (fake, "c") if q == "Sam Walton" else (None, None))
    script = Script.from_dict(GOOD_SCRIPT)
    for sc in script.scenes:
        sc["image_query"] = "nobody"
    script.scenes[2]["image_query"] = "Sam Walton"
    paths = images.resolve_for_script(cfg, script)
    # every scene still gets a photo — the miss scenes borrow the nearest hit
    assert set(paths) == set(range(len(script.scenes)))
    assert paths[0] == [str(fake)]


def test_fallback_query_prefers_scene_text():
    script = Script.from_dict(GOOD_SCRIPT)
    assert images.fallback_query({"headline": "Sam Walton", "label": ""}, script) == "Sam Walton"
    assert images.fallback_query({"headline": "", "label": "priced below everyone"},
                                 script) == "priced below everyone"
    # a text-free scene falls back to the story's title words
    assert "Banks" in images.fallback_query({"headline": "", "label": "", "sub": ""}, script)


def test_expand_photo_cuts_math():
    from app.pipeline import _expand_photo_cuts
    scenes_list = [{"emoji": "🧠"}, {"emoji": "💰"}, {"emoji": ""}]
    seg_ends = [3.0, 9.0, 12.0]
    photo_map = {1: ["a.jpg", "b.jpg", "c.jpg"]}
    specs, ends, emojis = _expand_photo_cuts(scenes_list, seg_ends, photo_map)
    assert len(specs) == 5                                   # 1 + 3 + 1
    assert [s[1] for s in specs] == [None, "a.jpg", "b.jpg", "c.jpg", None]
    assert ends == [3.0, 5.0, 7.0, 9.0, 12.0]
    assert emojis == ["🧠", "💰", "", "", ""]                # emoji pops once per scene
    # a short segment can't absorb 3 cuts: the photos merge into ONE collage cut
    specs2, ends2, _ = _expand_photo_cuts([{"emoji": ""}, {"emoji": ""}],
                                          [1.5, 2.9], {1: ["a.jpg", "b.jpg", "c.jpg"]})
    assert len(specs2) == 2 and ends2 == [1.5, 2.9]
    assert specs2[1][1] == ["a.jpg", "b.jpg", "c.jpg"]       # collage keeps all three
    # ...except in the hook segment, where the card owns the top: singles only
    specs3, _, _ = _expand_photo_cuts([{"emoji": ""}], [1.5], {0: ["a.jpg", "b.jpg"]})
    assert [s[1] for s in specs3] == ["a.jpg"]
    # 3 photos over 2 available cuts: front-loaded collage + single
    specs4, _, _ = _expand_photo_cuts([{"emoji": ""}, {"emoji": ""}],
                                      [1.0, 3.0], {1: ["a.jpg", "b.jpg", "c.jpg"]})
    assert [s[1] for s in specs4] == [None, ["a.jpg", "b.jpg"], "c.jpg"]


def test_full_bleed_photo_render(tmp_path):
    photo = tmp_path / "photo.jpg"
    Image.new("RGB", (1600, 900), (140, 110, 90)).save(photo)
    scene = {"kind": "title_card", "headline": "The empire begins", "value": "",
             "label": "Bentonville, 1962", "sub": "", "points": [], "emoji": ""}
    out = scenes.render_scene(scene, THEME, seed=4, out_png=tmp_path / "f.png",
                              image_path=photo)  # non-figure kind -> full bleed
    im = Image.open(out).convert("RGB")
    assert im.size == (scenes.SCENE_W, scenes.SCENE_H)
    mid = im.getpixel((scenes.SCENE_W // 2, 1100))
    assert sum(mid) > 120, f"expected photo pixels mid-frame, got {mid}"
    top = im.getpixel((scenes.SCENE_W // 2, 30))
    assert sum(top) < sum(mid), "top should be graded darker for the hook zone"


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


def test_collage_renders_multiple_photos(tmp_path):
    reds = tmp_path / "r.jpg"
    Image.new("RGB", (1000, 800), (200, 60, 60)).save(reds)
    blues = tmp_path / "b.jpg"
    Image.new("RGB", (800, 1000), (60, 60, 200)).save(blues)
    scene = {"kind": "big_stat", "headline": "", "value": "$1M", "label": "the deal",
             "sub": "", "points": [], "emoji": ""}
    out = scenes.render_scene(scene, THEME, seed=9, out_png=tmp_path / "c2.png",
                              image_path=[reds, blues])
    im = Image.open(out).convert("RGB")
    assert im.size == (scenes.SCENE_W, scenes.SCENE_H)
    upper = [im.getpixel((x, y)) for x in range(200, scenes.SCENE_W - 200, 90)
             for y in range(250, 1000, 90)]
    assert any(p[0] > 140 and p[2] < 110 for p in upper), "red card missing"
    assert any(p[2] > 140 and p[0] < 110 for p in upper), "blue card missing"
    # three photos also render (uses the 3-slot layout)
    out3 = scenes.render_scene(scene, THEME, seed=9, out_png=tmp_path / "c3.png",
                               image_path=[reds, blues, reds])
    assert Image.open(out3).size == (scenes.SCENE_W, scenes.SCENE_H)


def test_single_item_list_behaves_like_single_photo(tmp_path):
    photo = tmp_path / "photo.jpg"
    Image.new("RGB", (1600, 900), (140, 110, 90)).save(photo)
    scene = {"kind": "title_card", "headline": "x", "value": "", "label": "",
             "sub": "", "points": [], "emoji": ""}
    out = scenes.render_scene(scene, THEME, seed=4, out_png=tmp_path / "one.png",
                              image_path=[photo])  # list of one -> full bleed
    im = Image.open(out).convert("RGB")
    mid = im.getpixel((scenes.SCENE_W // 2, 1100))
    assert sum(mid) > 120


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
