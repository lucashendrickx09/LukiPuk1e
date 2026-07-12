"""Brand asset generator — the channel identity, drawn in the same Starfield Noir
style as the videos themselves (one visual system across avatar, banner, watermark,
and every frame of content).

Everything is programmatic (PIL): regenerate at any size, tweak one constant and
re-run. `python run.py brand` writes data/brand/<channel>/.

The logomark: an ascending chart line that breaks OUT of a ring through a gap —
the "escape trajectory". It's the chart_up scene from the videos, distilled to
an icon. Reads at 40px (YouTube comment avatars) and at 800px.
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from . import visuals
from .scenes import _font, _rgb, _mix

# Identity per internal channel id. display/tagline/description are the brand;
# regenerate assets after editing. Handles must be verified for availability in
# the YouTube app (can differ from these suggestions — assets don't bake them in).
BRANDS = {
    "channel_a": {
        "display": "Broke to Billions",
        "wordmark": ("BROKE", "TO", "BILLIONS"),   # white, accent, white
        "handle": "@BrokeToBillions",
        "tagline": "How they got rich — in 30 seconds.",
        "cadence": "NEW MONEY STORIES DAILY",
        "description": (
            "The real stories behind the world's biggest fortunes — told in 30 seconds, "
            "with the actual numbers and timelines.\n\n"
            "Sam Walton was broke at 44. The Scrub Daddy guy got laughed out of rooms. "
            "Every fortune has a moment where it almost didn't happen — we find it.\n\n"
            "New stories daily.\n\n"
            "Narration is AI-generated. Every script and visual is original to this channel."
        ),
    },
    "channel_b": {
        "display": "Brain Glitch",
        "wordmark": ("BRAIN", "GLITCH", ""),
        "mark": "glitch",
        "handle": "@TheBrainGlitch",
        "tagline": "Your brain is lying to you.",
        "cadence": "ONE GLITCH A DAY",
        "description": (
            "Your brain runs on outdated software — and the bugs are fascinating.\n\n"
            "30-second stories about the glitches in human wiring: why you remember "
            "things that never happened, why the second-cheapest wine sells best, why "
            "willpower loses to a 20-second delay.\n\n"
            "One glitch a day.\n\n"
            "Narration is AI-generated. Every script and visual is original to this channel."
        ),
    },
}

AVATAR = 800          # displayed round; keep the mark inside the inner ~70%
BANNER_W, BANNER_H = 2560, 1440
SAFE_W, SAFE_H = 1546, 423   # the area visible on every device — all text lives here
WATERMARK = 150


def brand_for(channel_name: str) -> dict:
    if channel_name in BRANDS:
        return BRANDS[channel_name]
    title = channel_name.replace("_", " ").title()
    return {"display": title, "wordmark": (title.upper(), "", ""), "handle": f"@{channel_name}",
            "tagline": "", "cadence": "", "description": ""}


# ------------------------------------------------------------------ drawing
def _starfield(w: int, h: int, theme: dict, seed: int, star_scale: float = 1.0) -> Image.Image:
    c = [_rgb(x) for x in theme["colors"]]
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        col = _mix(c[0], c[1], t * 2) if t < 0.5 else _mix(c[1], c[2], (t - 0.5) * 2)
        d.line([(0, y), (w, y)], fill=col)
    rng = random.Random(seed)
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    accent = _rgb(theme["accent"])
    n_stars = int((w * h) / 24000 * star_scale)
    for _ in range(n_stars):
        x, y = rng.randint(0, w), rng.randint(0, h)
        r = rng.choice([1, 1, 1, 2, 2, 3])
        col = accent if rng.random() < 0.16 else (255, 255, 255)
        od.ellipse([x - r, y - r, x + r, y + r], fill=(*col, rng.randint(36, 150)))
    for _ in range(max(2, n_stars // 40)):
        x, y = rng.randint(40, w - 40), rng.randint(40, h - 40)
        s = rng.randint(int(8 * star_scale), int(16 * star_scale))
        col = accent if rng.random() < 0.4 else (255, 255, 255)
        od.line([(x - s, y), (x + s, y)], fill=(*col, 90), width=2)
        od.line([(x, y - s), (x, y + s)], fill=(*col, 90), width=2)
    return Image.alpha_composite(im.convert("RGBA"), overlay)


def logomark(size: int, theme: dict, style: str = "trajectory") -> Image.Image:
    """Channel mark on a transparent canvas. Styles:
    trajectory — ascending line breaking out of a ring (Broke to Billions)
    glitch     — a ring whose middle slice is displaced (Brain Glitch)
    """
    S = size * 4  # draw 4x, downscale for clean edges
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    accent = _rgb(theme["accent"])
    cx = cy = S // 2
    r = int(S * 0.36)
    ring_w = max(3, int(S * 0.055))

    if style == "glitch":
        # full ring, then displace the middle horizontal slice — the glitch
        ring = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        rd = ImageDraw.Draw(ring)
        rd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(*accent, 255), width=ring_w)
        band = (0, int(S * 0.44), S, int(S * 0.60))
        slice_im = ring.crop(band)
        rd.rectangle(band, fill=(0, 0, 0, 0))
        im = Image.alpha_composite(im, ring)
        im.paste(slice_im, (int(S * 0.10), band[1]), slice_im)
        d = ImageDraw.Draw(im)
        # a white synapse dot inside, knocked slightly off-center
        d.ellipse([cx - S * 0.05 + S * 0.06, cy - S * 0.05, cx + S * 0.05 + S * 0.06, cy + S * 0.05],
                  fill=(255, 255, 255, 255))
        return im.resize((size, size), Image.LANCZOS)

    # trajectory (default): ring with a gap at the upper-right where the line escapes
    d.arc([cx - r, cy - r, cx + r, cy + r], start=337, end=293,
          fill=(*accent, 255), width=ring_w)
    pts = [(S * 0.30, S * 0.68), (S * 0.45, S * 0.55), (S * 0.53, S * 0.61),
           (S * 0.72, S * 0.40), (S * 0.88, S * 0.22)]
    for width, alpha in ((int(S * 0.10), 40), (int(S * 0.05), 255)):
        d.line(pts, fill=(255, 255, 255, alpha), width=width, joint="curve")
    ax, ay = pts[-1]
    ah = S * 0.085
    d.polygon([(ax - ah * 0.2, ay - ah), (ax + ah, ay - ah * 0.15), (ax - ah * 0.9, ay + ah * 0.55)],
              fill=(*accent, 255))
    sx, sy = pts[0]
    d.ellipse([sx - S * 0.025, sy - S * 0.025, sx + S * 0.025, sy + S * 0.025],
              fill=(*accent, 255))
    return im.resize((size, size), Image.LANCZOS)


def _wordmark(d: ImageDraw.ImageDraw, parts: tuple, x: int, y: int, size: int,
              accent: tuple, max_width: int) -> tuple[int, int]:
    """Two-tone wordmark 'WHITE accent WHITE' on one line, auto-fit. Returns (w,h)."""
    while size > 40:
        f = _font(size)
        widths = [d.textlength(p, font=f) if p else 0 for p in parts]
        gap = size * 0.28
        total = sum(widths) + gap * (sum(1 for p in parts if p) - 1)
        if total <= max_width:
            break
        size = int(size * 0.92)
    cx = x
    colors = [(255, 255, 255), accent, (255, 255, 255)]
    for part, wpx, col in zip(parts, widths, colors):
        if not part:
            continue
        d.text((cx, y), part, font=f, fill=col, anchor="ls")
        cx += wpx + gap
    return int(total), size


def make_avatar(channel_name: str, theme: dict, out: Path, seed: int = 11) -> Path:
    style = brand_for(channel_name).get("mark", "trajectory")
    im = _starfield(AVATAR, AVATAR, theme, seed, star_scale=0.8)
    # subtle center glow so the mark pops when cropped round
    glow = Image.new("RGBA", (AVATAR, AVATAR), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    accent = _rgb(theme["accent"])
    gd.ellipse([AVATAR * 0.18, AVATAR * 0.18, AVATAR * 0.82, AVATAR * 0.82],
               fill=(*accent, 26))
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    im = Image.alpha_composite(im, glow)
    mark = logomark(int(AVATAR * 0.62), theme, style)
    im.paste(mark, ((AVATAR - mark.width) // 2, (AVATAR - mark.height) // 2), mark)
    im.convert("RGB").save(out, "PNG")
    return out


def make_banner(channel_name: str, theme: dict, out: Path, seed: int = 23) -> Path:
    brand = brand_for(channel_name)
    im = _starfield(BANNER_W, BANNER_H, theme, seed, star_scale=1.2)
    accent = _rgb(theme["accent"])
    # giant faint trajectory across the whole banner — drawn on its own layer at
    # a fixed low alpha (drawing repeatedly on the base accumulates to opaque)
    traj = Image.new("RGBA", (BANNER_W, BANNER_H), (0, 0, 0, 0))
    td = ImageDraw.Draw(traj)
    pts = [(0, 1250), (500, 1090), (820, 1160), (1400, 900), (1980, 640), (2560, 410)]
    td.line(pts, fill=(*accent, 255), width=58, joint="curve")
    alpha = traj.getchannel("A").point(lambda a: int(a * 0.10))
    traj.putalpha(alpha)
    im = Image.alpha_composite(im, traj)

    # safe area: everything readable lives inside this centered box
    sx0 = (BANNER_W - SAFE_W) // 2
    sy0 = (BANNER_H - SAFE_H) // 2
    mark = logomark(300, theme, brand.get("mark", "trajectory"))
    my = sy0 + (SAFE_H - mark.height) // 2 - 10
    im.paste(mark, (sx0 + 10, my), mark)
    d = ImageDraw.Draw(im, "RGBA")

    tx = sx0 + 350
    baseline = sy0 + 185
    _wordmark(d, brand["wordmark"], tx, baseline, 148, accent, max_width=SAFE_W - 370)
    if brand["tagline"]:
        d.text((tx + 4, baseline + 82), brand["tagline"], font=_font(54),
               fill=(230, 230, 230), anchor="ls")
    if brand["cadence"]:
        pill_f = _font(36)
        pw = d.textlength(brand["cadence"], font=pill_f)
        py = baseline + 128
        d.rounded_rectangle([tx + 4, py, tx + 4 + pw + 56, py + 62], radius=31,
                            outline=(*accent, 220), width=3)
        d.text((tx + 32, py + 31), brand["cadence"], font=pill_f,
               fill=(*accent, 255), anchor="lm")
    im.convert("RGB").save(out, "PNG")
    return out


def make_watermark(channel_name: str, theme: dict, out: Path) -> Path:
    mark = logomark(WATERMARK, theme, brand_for(channel_name).get("mark", "trajectory"))
    faded = mark.copy()
    alpha = faded.getchannel("A").point(lambda a: int(a * 0.75))
    faded.putalpha(alpha)
    faded.save(out, "PNG")
    return out


def make_about(channel_name: str, out: Path) -> Path:
    b = brand_for(channel_name)
    out.write_text(
        f"CHANNEL NAME:\n{b['display']}\n\n"
        f"HANDLE (verify availability in the YouTube app; alternates in BRAND.md):\n{b['handle']}\n\n"
        f"TAGLINE:\n{b['tagline']}\n\n"
        f"DESCRIPTION (paste into channel About):\n{b['description']}\n\n"
        "UPLOAD DEFAULTS (Studio -> Settings -> Upload defaults):\n"
        "- Category: Education\n- Made for kids: No\n- Altered content: Yes (synthetic narration)\n"
        "- License: Standard\n\n"
        "FILES:\n- avatar.png    800x800 (upload as profile picture)\n"
        "- banner.png    2560x1440 (all text sits in the universal safe area)\n"
        "- watermark.png 150x150 (Studio -> Customization -> Branding -> video watermark)\n")
    return out


def write_all(cfg, channel) -> dict[str, Path]:
    theme = visuals.theme_for(channel.theme)
    outdir = cfg.data_dir / "brand" / channel.name
    outdir.mkdir(parents=True, exist_ok=True)
    return {
        "avatar": make_avatar(channel.name, theme, outdir / "avatar.png"),
        "banner": make_banner(channel.name, theme, outdir / "banner.png"),
        "watermark": make_watermark(channel.name, theme, outdir / "watermark.png"),
        "about": make_about(channel.name, outdir / "ABOUT.txt"),
    }
