from PIL import Image

from app import brand


def test_write_all_produces_correct_assets(cfg, channel):
    paths = brand.write_all(cfg, channel)
    assert Image.open(paths["avatar"]).size == (brand.AVATAR, brand.AVATAR)
    assert Image.open(paths["banner"]).size == (brand.BANNER_W, brand.BANNER_H)
    wm = Image.open(paths["watermark"])
    assert wm.size == (brand.WATERMARK, brand.WATERMARK)
    assert wm.mode == "RGBA" and wm.getchannel("A").getextrema()[0] == 0  # transparency kept


def test_about_contains_paste_ready_copy(cfg, channel):
    paths = brand.write_all(cfg, channel)
    text = paths["about"].read_text()
    b = brand.brand_for(channel.name)
    assert b["handle"] in text and b["display"] in text
    assert "Altered content: Yes" in text


def test_both_logomark_styles_render():
    theme = {"colors": ["#050606", "#0B0D0C", "#101816"], "accent": "#35E87A", "bar": "#35E87A"}
    for style in ("trajectory", "glitch"):
        im = brand.logomark(200, theme, style)
        assert im.size == (200, 200) and im.mode == "RGBA"
        assert im.getbbox() is not None  # something was actually drawn


def test_unknown_channel_gets_fallback_brand():
    b = brand.brand_for("mystery_channel")
    assert b["display"] == "Mystery Channel"
    assert b["wordmark"][0] == "MYSTERY CHANNEL"
