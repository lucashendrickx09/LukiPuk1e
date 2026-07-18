"""Native story graphics: each script segment gets a drawn scene (PIL) that the
renderer animates (slow zoom + hard cuts on beat boundaries).

Everything is generated — typography, charts, timelines, stylized figures — so
"how X got rich" stories get real visuals with zero stock footage, zero image
rights, and a consistent brand look. Scenes are drawn at 1.25x the video size to
give the zoom room to move.

Layout contract: the karaoke captions occupy the vertical center band of the
video, and the hook card sits at the top for the first seconds — so scenes put
primary content in the upper third and secondary labels in the lower third.
"""

from __future__ import annotations

import random
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SCENE_W, SCENE_H = 1350, 2400          # 1.25x of 1080x1920
PRIMARY_Y = 620                        # main content anchor (upper third)
SECONDARY_Y = 1780                     # label zone (lower third, above Shorts UI)
CONTENT_W = 1120                       # max text width

KINDS = ("ambient", "title_card", "big_stat", "chart_up", "timeline",
         "quote", "list_reveal", "figure")

ASSETS_FONTS = Path(__file__).resolve().parent.parent / "assets" / "fonts"

# Heavy display face first (bundled with the repo — Apache 2.0), then system fallbacks.
_FONT_PATHS = [
    str(ASSETS_FONTS / "Roboto-Black.ttf"),
    "/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Black.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
_FONT_PATHS_BOLD = [
    str(ASSETS_FONTS / "Roboto-Bold.ttf"),
    "/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Bold.ttf",
    *_FONT_PATHS[2:],
]
_EMOJI_PATHS = [
    "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",   # linux (fonts-noto-color-emoji)
    "/System/Library/Fonts/Apple Color Emoji.ttc",         # macOS
]


@lru_cache(maxsize=96)
def _font(size: int, weight: str = "black") -> ImageFont.FreeTypeFont:
    for p in (_FONT_PATHS if weight == "black" else _FONT_PATHS_BOLD):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _glow_text(im: Image.Image, xy, text: str, font, fill, anchor="mm",
               glow=(18, 90), shadow=(5, 7, 150)) -> None:
    """Premium type: soft bloom behind + hard drop shadow under, then the text.
    glow=(radius, alpha), shadow=(dx, dy, alpha)."""
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.text(xy, text, font=font, fill=(*fill[:3], 255), anchor=anchor)
    if glow:
        bloom = layer.filter(ImageFilter.GaussianBlur(glow[0]))
        bloom.putalpha(bloom.getchannel("A").point(lambda a: int(a * glow[1] / 255)))
        im.alpha_composite(bloom)
    if shadow:
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).text((xy[0] + shadow[0], xy[1] + shadow[1]), text,
                                font=font, fill=(5, 8, 6, shadow[2]), anchor=anchor)
        im.alpha_composite(sh)
    im.alpha_composite(layer)


@lru_cache(maxsize=1)
def _emoji_font() -> tuple[ImageFont.FreeTypeFont | None, int]:
    """Color-emoji fonts are bitmap strikes — only specific sizes load."""
    for path in _EMOJI_PATHS:
        for size in (160, 137, 128, 109, 96, 72, 64, 48, 32):
            try:
                return ImageFont.truetype(path, size), size
            except OSError:
                continue
    return None, 0


def emoji_image(emoji: str, px: int) -> Image.Image | None:
    """Rasterize 1-2 emoji to a transparent RGBA image `px` tall. None if no
    color-emoji font is installed (callers degrade gracefully)."""
    emoji = emoji.strip()
    f, native = _emoji_font()
    if not f or not emoji:
        return None
    canvas = Image.new("RGBA", (native * (len(emoji) + 1), native * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    try:
        d.text((canvas.width // 2, canvas.height // 2), emoji, font=f,
               embedded_color=True, anchor="mm")
    except Exception:
        return None
    box = canvas.getbbox()
    if not box:
        return None
    im = canvas.crop(box)
    scale = px / im.height
    return im.resize((max(1, int(im.width * scale)), px), Image.LANCZOS)


def emoji_png(emoji: str, px: int, out_png: str | Path) -> Path | None:
    im = emoji_image(emoji, px)
    if im is None:
        return None
    out_png = Path(out_png)
    im.save(out_png, "PNG")
    return out_png


def _rgb(hex_rgb: str) -> tuple[int, int, int]:
    h = hex_rgb.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _mix(a, b, t: float) -> tuple[int, int, int]:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# ------------------------------------------------------------- text helpers
def _wrap(draw, text: str, font, max_width: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        cand = f"{cur} {w}".strip()
        if draw.textlength(cand, font=font) <= max_width or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _fit(draw, text: str, max_width: int, start: int, min_size: int = 40,
         max_lines: int = 3) -> ImageFont.FreeTypeFont:
    size = start
    while size > min_size:
        f = _font(size)
        lines = _wrap(draw, text, f, max_width)
        if len(lines) <= max_lines and all(draw.textlength(l, font=f) <= max_width for l in lines):
            return f
        size = int(size * 0.88)
    return _font(min_size)


def _draw_block(draw, text: str, cx: int, top: int, font, fill, max_width: int,
                align_center: bool = True) -> int:
    """Draw wrapped text; returns the y just below the block."""
    lines = _wrap(draw, text, font, max_width)
    line_h = int(font.size * 1.22)
    y = top
    for line in lines:
        draw.text((cx, y), line, font=font, fill=fill,
                  anchor="ma" if align_center else "la")
        y += line_h
    return y


# ------------------------------------------------------------- background
def _background(theme: dict, seed: int) -> Image.Image:
    c = [_rgb(x) for x in theme["colors"]]
    im = Image.new("RGB", (SCENE_W, SCENE_H))
    d = ImageDraw.Draw(im)
    for y in range(SCENE_H):
        t = y / SCENE_H
        col = _mix(c[0], c[1], t * 2) if t < 0.5 else _mix(c[1], c[2], (t - 0.5) * 2)
        d.line([(0, y), (SCENE_W, y)], fill=col)
    rng = random.Random(seed)
    overlay = Image.new("RGBA", (SCENE_W, SCENE_H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    accent = _rgb(theme["accent"])
    stars = bool(theme.get("stars"))
    for _ in range(rng.randint(1, 2) if stars else rng.randint(3, 5)):
        r = rng.randint(120, 520)
        x, y = rng.randint(-100, SCENE_W + 100), rng.choice(
            [rng.randint(-100, 500), rng.randint(1900, SCENE_H + 100)])
        od.ellipse([x - r, y - r, x + r, y + r], outline=(*accent, rng.randint(10, 26) if stars else rng.randint(16, 44)),
                   width=rng.randint(2, 7))
    if stars:
        # a field of miniscule stars: mostly white pinpricks, a few accent, rare sparkles
        for _ in range(rng.randint(110, 160)):
            x, y = rng.randint(0, SCENE_W), rng.randint(0, SCENE_H)
            r = rng.choice([1, 1, 1, 1, 2, 2, 3])
            col = accent if rng.random() < 0.18 else (255, 255, 255)
            od.ellipse([x - r, y - r, x + r, y + r], fill=(*col, rng.randint(36, 150)))
        for _ in range(rng.randint(3, 6)):  # 4-point sparkles
            x, y = rng.randint(60, SCENE_W - 60), rng.randint(60, SCENE_H - 60)
            s = rng.randint(9, 18)
            col = accent if rng.random() < 0.4 else (255, 255, 255)
            od.line([(x - s, y), (x + s, y)], fill=(*col, 90), width=2)
            od.line([(x, y - s), (x, y + s)], fill=(*col, 90), width=2)
    else:
        for _ in range(2):
            r = rng.randint(260, 620)
            x, y = rng.randint(0, SCENE_W), rng.choice([rng.randint(0, 400), rng.randint(2000, SCENE_H)])
            od.ellipse([x - r, y - r, x + r, y + r], fill=(*_mix(c[1], accent, 0.3), 12))
    im = Image.alpha_composite(im.convert("RGBA"), overlay)
    # a soft off-frame "studio light" in the accent hue + corner falloff: depth,
    # not a flat backdrop
    light = Image.new("RGBA", (SCENE_W, SCENE_H), (0, 0, 0, 0))
    lg = ImageDraw.Draw(light)
    lx = rng.choice([-200, SCENE_W + 200])
    lg.ellipse([lx - 620, -520, lx + 620, 720], fill=(*accent, 34))
    im.alpha_composite(light.filter(ImageFilter.GaussianBlur(180)))
    vig = Image.new("RGBA", (SCENE_W, SCENE_H), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vig)
    vd.rectangle([0, 0, SCENE_W, SCENE_H], fill=(0, 0, 0, 70))
    vd.ellipse([-SCENE_W // 3, -SCENE_H // 5, SCENE_W + SCENE_W // 3, SCENE_H + SCENE_H // 5],
               fill=(0, 0, 0, 0))
    im.alpha_composite(vig.filter(ImageFilter.GaussianBlur(120)))
    return im


# ------------------------------------------------------------- scene kinds
def _ambient(im, d, scene, theme, rng):
    accent = _rgb(theme["accent"])
    cx = SCENE_W // 2
    for i, r in enumerate((180, 300, 430)):
        d.ellipse([cx - r, PRIMARY_Y - r + 60, cx + r, PRIMARY_Y + r + 60],
                  outline=(*accent, 60 - i * 15), width=5 - i)
    for _ in range(14):
        x, y = rng.randint(80, SCENE_W - 80), rng.randint(200, 900)
        s = rng.randint(3, 9)
        d.ellipse([x - s, y - s, x + s, y + s], fill=(*accent, rng.randint(40, 110)))


def _title_card(im, d, scene, theme, rng):
    accent = _rgb(theme["accent"])
    head = scene.get("headline") or scene.get("sub") or ""
    if head:
        f = _fit(d, head, CONTENT_W, 128)
        bottom = _draw_block(d, head, SCENE_W // 2, PRIMARY_Y - 120, f, (255, 255, 255), CONTENT_W)
        d.rounded_rectangle([SCENE_W // 2 - 140, bottom + 36, SCENE_W // 2 + 140, bottom + 52],
                            radius=8, fill=(*accent, 255))
        if scene.get("sub"):
            _draw_block(d, scene["sub"], SCENE_W // 2, bottom + 110, _font(58),
                        (235, 235, 235), CONTENT_W - 100)


def _big_stat(im, d, scene, theme, rng):
    accent = _rgb(theme["accent"])
    cx = SCENE_W // 2
    # double ring with a soft bloom — depth instead of a flat outline
    ring = Image.new("RGBA", im.size, (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    for r, w, a in ((400, 12, 120), (352, 4, 70)):
        rd.ellipse([cx - r, PRIMARY_Y - r + 40, cx + r, PRIMARY_Y + r + 40],
                   outline=(*accent, a), width=w)
    im.alpha_composite(ring.filter(ImageFilter.GaussianBlur(10)))
    im.alpha_composite(ring)
    value = scene.get("value") or scene.get("headline") or ""
    if value:
        f = _fit(d, value, CONTENT_W, 250, min_size=90, max_lines=1)
        _glow_text(im, (cx, PRIMARY_Y + 40), value, f, accent, glow=(26, 110), shadow=(6, 9, 160))
    label = scene.get("label") or scene.get("sub") or ""
    if label:
        d = ImageDraw.Draw(im, "RGBA")
        _draw_block(d, label, cx, PRIMARY_Y + 250, _font(56, "bold"), (240, 240, 240), CONTENT_W - 140)


def _chart_up(im, d, scene, theme, rng):
    accent = _rgb(theme["accent"])
    pts = [float(p) for p in (scene.get("points") or []) if isinstance(p, (int, float))]
    if len(pts) < 3:
        pts = [1, 1.6, 2.1, 3.4, 5.2, 8.5]
    head = scene.get("headline") or ""
    if head:
        _draw_block(d, head, SCENE_W // 2, 300, _fit(d, head, CONTENT_W, 88, max_lines=2),
                    (255, 255, 255), CONTENT_W)
    x0, x1, y0, y1 = 180, SCENE_W - 180, 520, 1020
    lo, hi = min(pts), max(pts)
    span = (hi - lo) or 1.0
    coords = [(x0 + (x1 - x0) * i / (len(pts) - 1),
               y1 - (y1 - y0) * (p - lo) / span) for i, p in enumerate(pts)]
    for y in range(y0, y1 + 1, 125):  # faint grid
        d.line([(x0, y), (x1, y)], fill=(255, 255, 255, 22), width=2)
    # gradient area fill under the line (soft financial-chart depth)
    area = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ad = ImageDraw.Draw(area)
    ad.polygon([*coords, (coords[-1][0], y1), (coords[0][0], y1)], fill=(*accent, 70))
    grad_mask = Image.new("L", im.size, 0)
    gm = ImageDraw.Draw(grad_mask)
    for y in range(y0 - 40, y1 + 1):
        gm.line([(x0 - 30, y), (x1 + 60, y)],
                fill=int(max(0, 255 * (1 - (y - y0 + 40) / (y1 - y0 + 40)))))
    area.putalpha(Image.composite(area.getchannel("A"), Image.new("L", im.size, 0), grad_mask))
    im.alpha_composite(area.filter(ImageFilter.GaussianBlur(2)))
    # bloomed line
    line = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(line)
    ld.line(coords, fill=(*accent, 255), width=9, joint="curve")
    lx, ly = coords[-1]
    ld.polygon([(lx + 10, ly - 26), (lx + 52, ly - 2), (lx + 10, ly + 20)], fill=(*accent, 255))
    bloom = line.filter(ImageFilter.GaussianBlur(14))
    bloom.putalpha(bloom.getchannel("A").point(lambda a: int(a * 0.55)))
    im.alpha_composite(bloom)
    im.alpha_composite(line)
    d = ImageDraw.Draw(im, "RGBA")
    for i, (x, y) in enumerate(coords):
        s = 16 if i == len(coords) - 1 else 9
        d.ellipse([x - s, y - s, x + s, y + s], fill=(255, 255, 255, 255))
        if i == len(coords) - 1:
            d.ellipse([x - 26, y - 26, x + 26, y + 26], outline=(255, 255, 255, 90), width=3)
    label = scene.get("label") or scene.get("sub") or ""
    if label:
        _draw_block(d, label, SCENE_W // 2, 1090, _font(54, "bold"), (235, 235, 235), CONTENT_W)


def _timeline(im, d, scene, theme, rng):
    accent = _rgb(theme["accent"])
    items = [s.strip() for s in (scene.get("sub") or "").split(";") if s.strip()][:4]
    if not items:
        items = ["...", "...", "..."]
    head = scene.get("headline") or ""
    if head:
        _draw_block(d, head, SCENE_W // 2, 300, _fit(d, head, CONTENT_W, 84, max_lines=2),
                    (255, 255, 255), CONTENT_W)
    y = 760
    x_positions = [int(200 + (SCENE_W - 400) * i / max(1, len(items) - 1)) for i in range(len(items))]
    d.line([(x_positions[0], y), (x_positions[-1], y)], fill=(*accent, 140), width=6)
    for x, item in zip(x_positions, items):
        d.ellipse([x - 18, y - 18, x + 18, y + 18], fill=(*accent, 255))
        d.ellipse([x - 30, y - 30, x + 30, y + 30], outline=(*accent, 90), width=4)
        parts = item.split(" ", 1)
        year, rest = (parts[0], parts[1] if len(parts) > 1 else "")
        d.text((x, y - 120), year, font=_font(56), fill=(*accent, 255), anchor="ma")
        if rest:
            f = _font(42)
            for j, line in enumerate(_wrap(d, rest, f, 260)[:3]):
                d.text((x, y + 52 + j * 52), line, font=f, fill=(235, 235, 235), anchor="ma")


def _quote(im, d, scene, theme, rng):
    accent = _rgb(theme["accent"])
    d.text((190, 300), "“", font=_font(300), fill=(*accent, 170), anchor="la")
    text = scene.get("headline") or scene.get("sub") or ""
    if text:
        f = _fit(d, text, CONTENT_W - 80, 96, max_lines=4)
        bottom = _draw_block(d, text, SCENE_W // 2, 560, f, (255, 255, 255), CONTENT_W - 80)
        who = scene.get("label") or scene.get("value") or ""
        if who:
            d.text((SCENE_W // 2, bottom + 70), f"— {who}", font=_font(58),
                   fill=(*accent, 255), anchor="ma")


def _list_reveal(im, d, scene, theme, rng):
    accent = _rgb(theme["accent"])
    head = scene.get("headline") or ""
    y = 320
    if head:
        y = _draw_block(d, head, SCENE_W // 2, y, _fit(d, head, CONTENT_W, 88, max_lines=2),
                        (255, 255, 255), CONTENT_W) + 60
    items = [s.strip() for s in (scene.get("sub") or "").split(";") if s.strip()][:4]
    f = _font(64)
    for item in items:
        d.text((170, y), "›", font=_font(80), fill=(*accent, 255), anchor="la")
        lines = _wrap(d, item, f, CONTENT_W - 160)
        for line in lines:
            d.text((260, y + 6), line, font=f, fill=(240, 240, 240), anchor="la")
            y += int(f.size * 1.25)
        y += 44


def _figure(im, d, scene, theme, rng):
    """Stylized person card — silhouette, name, their number. No likeness, no rights issues."""
    accent = _rgb(theme["accent"])
    cx = SCENE_W // 2
    head = scene.get("headline") or ""
    if head:  # the name, on top
        _draw_block(d, head, cx, 290, _fit(d, head, CONTENT_W, 104, max_lines=2),
                    (255, 255, 255), CONTENT_W)
    # silhouette
    sil_y = 640
    ring = 330
    d.ellipse([cx - ring, sil_y - ring + 130, cx + ring, sil_y + ring + 130],
              outline=(*accent, 60), width=8)
    dark = _mix(_rgb(theme["colors"][0]), accent, 0.22)
    d.ellipse([cx - 130, sil_y - 60, cx + 130, sil_y + 200], fill=(*dark, 255))          # head
    d.ellipse([cx - 128, sil_y - 58, cx + 128, sil_y + 198], outline=(*accent, 130), width=5)
    d.pieslice([cx - 300, sil_y + 220, cx + 300, sil_y + 820], 180, 360, fill=(*dark, 255))  # shoulders
    d.arc([cx - 300, sil_y + 220, cx + 300, sil_y + 820], 180, 360, fill=(*accent, 130), width=5)
    value = scene.get("value") or ""
    if value:
        f = _fit(d, value, CONTENT_W, 170, min_size=80, max_lines=1)
        d.text((cx, SECONDARY_Y - 40), value, font=f, fill=(*accent, 255), anchor="mm")
    label = scene.get("label") or scene.get("sub") or ""
    if label:
        _draw_block(d, label, cx, SECONDARY_Y + 80, _font(52), (235, 235, 235), CONTENT_W - 120)


def _photo_scene(im, d, scene, theme, rng, image_path):
    """A real archival photo as a tilted, framed card in the upper zone, with the
    scene's text stacked in the lower third (clear of hook card and captions)."""
    accent = _rgb(theme["accent"])
    try:
        photo = Image.open(image_path).convert("RGB")
    except Exception:
        return _DISPATCH.get(scene.get("kind", "ambient"), _ambient)(im, d, scene, theme, rng)

    photo = _grade_photo(photo)
    box_w, box_h = 940, 850
    scale = max(box_w / photo.width, box_h / photo.height)
    photo = photo.resize((int(photo.width * scale) + 1, int(photo.height * scale) + 1), Image.LANCZOS)
    left = (photo.width - box_w) // 2
    top = max(0, (photo.height - box_h) // 3)  # bias toward the top (faces live there)
    photo = photo.crop((left, top, left + box_w, top + box_h))

    border = 16
    card = Image.new("RGBA", (box_w + border * 2, box_h + border * 2), (245, 245, 242, 255))
    mask = Image.new("L", photo.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, photo.width, photo.height], radius=26, fill=255)
    card.paste(photo, (border, border), mask)
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle([0, 0, card.width - 1, card.height - 1], radius=34,
                         outline=(*accent, 255), width=5)
    card = card.rotate(rng.uniform(-3.2, 3.2), expand=True, resample=Image.BICUBIC)

    shadow = Image.new("RGBA", im.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    cx, cy = SCENE_W // 2, 590
    sd.rounded_rectangle([cx - card.width // 2 + 14, cy - card.height // 2 + 20,
                          cx + card.width // 2 + 14, cy + card.height // 2 + 20],
                         radius=40, fill=(0, 0, 0, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    im.alpha_composite(shadow)
    im.paste(card, (cx - card.width // 2, cy - card.height // 2), card)

    d = ImageDraw.Draw(im, "RGBA")
    y = SECONDARY_Y - 190
    head = scene.get("headline") or ""
    if head:
        f = _fit(d, head, CONTENT_W, 96, max_lines=2)
        y = _draw_block(d, head, SCENE_W // 2, y, f, (255, 255, 255), CONTENT_W) + 8
    value = scene.get("value") or ""
    if value:
        f = _fit(d, value, CONTENT_W, 150, min_size=70, max_lines=1)
        d.text((SCENE_W // 2, y + f.size // 2), value, font=f, fill=(*accent, 255), anchor="mm")
        y += int(f.size * 1.25)
    label = scene.get("label") or scene.get("sub") or ""
    if label:
        _draw_block(d, label, SCENE_W // 2, y + 10, _font(52), (225, 225, 225), CONTENT_W - 100)


def _photo_text_block(im, scene, theme):
    """Scene text stacked in the lower third — shared by both photo styles."""
    d = ImageDraw.Draw(im, "RGBA")
    accent = _rgb(theme["accent"])
    y = SECONDARY_Y - 190
    head = scene.get("headline") or ""
    if head:
        f = _fit(d, head, CONTENT_W, 96, max_lines=2)
        y = _draw_block(d, head, SCENE_W // 2, y, f, (255, 255, 255), CONTENT_W) + 8
    value = scene.get("value") or ""
    if value:
        f = _fit(d, value, CONTENT_W, 150, min_size=70, max_lines=1)
        d.text((SCENE_W // 2, y + f.size // 2), value, font=f, fill=(*accent, 255), anchor="mm")
        y += int(f.size * 1.25)
    label = scene.get("label") or scene.get("sub") or ""
    if label:
        _draw_block(d, label, SCENE_W // 2, y + 10, _font(52), (225, 225, 225), CONTENT_W - 100)


def _grade_photo(photo: Image.Image) -> Image.Image:
    """Cinematic grade for archival images: contrast + saturation lift so raw
    scans stop looking flat, without fighting the noir palette."""
    from PIL import ImageEnhance
    photo = ImageEnhance.Contrast(photo).enhance(1.10)
    photo = ImageEnhance.Color(photo).enhance(1.08)
    return ImageEnhance.Brightness(photo).enhance(0.99)


def _photo_full(scene, theme, rng, image_path) -> Image.Image:
    """Full-bleed archival photo: cover-cropped to the frame, graded dark at the
    top (hook card zone) and bottom (text zone) so type stays readable. The
    punch-in zoom animates it at render time — the classic story-short look."""
    photo = _grade_photo(Image.open(image_path).convert("RGB"))
    scale = max(SCENE_W / photo.width, SCENE_H / photo.height)
    photo = photo.resize((int(photo.width * scale) + 1, int(photo.height * scale) + 1), Image.LANCZOS)
    left = (photo.width - SCENE_W) // 2
    top = max(0, (photo.height - SCENE_H) // 3)
    im = photo.crop((left, top, left + SCENE_W, top + SCENE_H)).convert("RGBA")

    grade = Image.new("RGBA", (SCENE_W, SCENE_H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grade)
    gd.rectangle([0, 0, SCENE_W, SCENE_H], fill=(4, 6, 5, 70))          # global dim
    for y in range(0, 620):                                              # hook zone
        gd.line([(0, y), (SCENE_W, y)], fill=(4, 6, 5, int(170 * (1 - y / 620))))
    for y in range(1500, SCENE_H):                                       # text zone
        t = (y - 1500) / (SCENE_H - 1500)
        gd.line([(0, y), (SCENE_W, y)], fill=(4, 6, 5, int(215 * t)))
    im = Image.alpha_composite(im, grade)

    accent = _rgb(theme["accent"])
    d = ImageDraw.Draw(im, "RGBA")
    d.rectangle([0, SCENE_H - 8, SCENE_W, SCENE_H], fill=(*accent, 200))  # brand keel
    return im


_DISPATCH = {
    "ambient": _ambient, "title_card": _title_card, "big_stat": _big_stat,
    "chart_up": _chart_up, "timeline": _timeline, "quote": _quote,
    "list_reveal": _list_reveal, "figure": _figure,
}


def render_scene(scene: dict, theme: dict, seed: int, out_png: str | Path,
                 image_path: str | Path | None = None,
                 image_style: str = "auto") -> Path:
    """Draw one scene card to PNG (1350x2400).

    With an image: 'card' = framed tilted photo-card (portraits/figure scenes),
    'full' = full-bleed graded photo (story beats), 'auto' picks by scene kind.
    Without an image (or if it fails to load): the drawn Starfield Noir styles.
    """
    out_png = Path(out_png)
    rng = random.Random(seed)
    if image_path and Path(image_path).exists():
        style = image_style
        if style == "auto":
            style = "card" if scene.get("kind") == "figure" else "full"
        try:
            if style == "full":
                im = _photo_full(scene, theme, rng, image_path)
                _photo_text_block(im, scene, theme)
                im.convert("RGB").save(out_png, "PNG")
                return out_png
            im = _background(theme, seed)
            d = ImageDraw.Draw(im, "RGBA")
            _photo_scene(im, d, scene, theme, rng, image_path)
            im.convert("RGB").save(out_png, "PNG")
            return out_png
        except Exception:
            pass  # unreadable image -> drawn style below
    im = _background(theme, seed)
    d = ImageDraw.Draw(im, "RGBA")
    _DISPATCH.get(scene.get("kind", "ambient"), _ambient)(im, d, scene, theme, rng)
    # bake the emoji into the card only when the top zone is free of text —
    # other kinds still get the animated pop-in emoji at render time
    if scene.get("kind", "ambient") in ("ambient", "big_stat", "quote"):
        em = emoji_image(scene.get("emoji", ""), 250)
        if em is not None:  # tilted; rides the zoom with the scene
            em = em.rotate(rng.uniform(-14, 14), expand=True, resample=Image.BICUBIC)
            x = SCENE_W - em.width - rng.randint(90, 150)
            y = rng.randint(150, 230)
            im.paste(em, (x, y), em)
    im.convert("RGB").save(out_png, "PNG")
    return out_png
