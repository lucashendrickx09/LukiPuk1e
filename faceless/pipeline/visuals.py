"""Stage: visuals -> work/<id>/scenes/ + work/<id>/scenes.json

For each scene in the script, produce one visual asset according to its
`type`:

    card       Playwright renders assets/templates/card.html -> PNG (a still)
    stock      Pexels portrait clip is downloaded              -> MP4 (video)
    generated  Flux Schnell generates an image on the GPU      -> PNG (a still)

Scene time ranges come from timing.assign_scene_times() using align.json, so
each asset knows exactly how long it must be on screen. The heavy imports
(Playwright, torch/diffusers, requests) are done lazily so the rest of the
pipeline never depends on them.

Resume: an individual scene asset that already exists is not re-rendered, and
the whole stage is skipped if scenes.json and every asset it lists exist.

Run standalone:  python -m pipeline.visuals <video_id> [--force]
"""

from __future__ import annotations

import argparse
import html
import json
import os
from pathlib import Path
from typing import Optional

from . import ffutil
from .config import Config, load_config
from .paths import VideoPaths
from .timing import assign_scene_times

# Accent colours cycled across cards/fallbacks for visual variety.
_ACCENTS = ["#38bdf8", "#f472b6", "#facc15", "#34d399", "#a78bfa", "#fb923c"]


# --------------------------------------------------------------------------
# card (Playwright HTML -> PNG)
# --------------------------------------------------------------------------
def _card_font_size(text: str) -> int:
    """Shrink the card font as the text gets longer so it always fits the
    top region without spilling into the caption band."""
    n = len(text or "")
    for limit, size in ((24, 122), (40, 104), (64, 88), (90, 74), (130, 62)):
        if n <= limit:
            return size
    return 52


def render_card(
    text: str, emoji: str, out_path: Path, cfg: Config, accent: str
) -> None:
    from playwright.sync_api import sync_playwright  # lazy

    W, H = int(cfg["video.width"]), int(cfg["video.height"])
    scale = int(cfg.get("visuals.card.scale", 2))
    template_path = cfg.resolve("visuals.card.template")
    tpl = Path(template_path).read_text(encoding="utf-8")
    doc = (tpl.replace("{{TEXT}}", html.escape(text or ""))
              .replace("{{EMOJI}}", html.escape(emoji or ""))
              .replace("{{ACCENT}}", accent)
              .replace("{{FONTSIZE}}", str(_card_font_size(text))))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Normally Playwright finds the browser it installed. Set
    # PLAYWRIGHT_CHROMIUM_EXECUTABLE to point at a specific Chromium build
    # (e.g. a pre-provisioned one whose version differs from the pip package).
    exe = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE") or None
    with sync_playwright() as p:
        # --no-sandbox: required when Chromium runs as root / in containers.
        browser = p.chromium.launch(args=["--no-sandbox"], executable_path=exe)
        page = browser.new_page(
            viewport={"width": W, "height": H}, device_scale_factor=scale
        )
        page.set_content(doc, wait_until="networkidle")
        page.screenshot(path=str(out_path), full_page=False)
        browser.close()


# --------------------------------------------------------------------------
# stock (Pexels portrait video)
# --------------------------------------------------------------------------
def fetch_stock(query: str, out_path: Path, cfg: Config) -> bool:
    """Download a portrait Pexels clip for `query`. Returns True on success.

    Requires env PEXELS_API_KEY. Pexels' API is free (no paid API is used).
    """
    import requests  # lazy

    api_key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not api_key:
        print("[visuals] PEXELS_API_KEY not set -> cannot fetch stock")
        return False

    per_page = int(cfg.get("visuals.stock.per_page", 15))
    orientation = cfg.get("visuals.stock.orientation", "portrait")
    resp = requests.get(
        "https://api.pexels.com/videos/search",
        headers={"Authorization": api_key},
        params={"query": query, "orientation": orientation,
                "per_page": per_page, "size": "medium"},
        timeout=30,
    )
    resp.raise_for_status()
    videos = resp.json().get("videos", [])
    if not videos:
        print(f"[visuals] no Pexels results for {query!r}")
        return False

    target_h = int(cfg["video.height"])

    def best_file(video: dict) -> Optional[dict]:
        portrait = [f for f in video.get("video_files", [])
                    if f.get("height") and f.get("width")
                    and f["height"] >= f["width"] and f.get("link")]
        if not portrait:
            return None
        # Prefer the smallest file whose height still covers the target,
        # else the tallest available.
        covering = [f for f in portrait if f["height"] >= target_h]
        pool = covering or portrait
        return min(pool, key=lambda f: abs(f["height"] - target_h))

    for video in videos:
        chosen = best_file(video)
        if not chosen:
            continue
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with requests.get(chosen["link"], stream=True, timeout=120) as dl:
            dl.raise_for_status()
            with open(out_path, "wb") as fh:
                for chunk in dl.iter_content(1 << 16):
                    fh.write(chunk)
        if out_path.exists() and out_path.stat().st_size > 0:
            print(f"[visuals] stock {query!r} -> {out_path.name} "
                  f"({chosen['width']}x{chosen['height']})")
            return True
    return False


# --------------------------------------------------------------------------
# generated (Flux Schnell on the GPU)
# --------------------------------------------------------------------------
def _snap16(x: int) -> int:
    return max(16, int(round(x / 16)) * 16)


def generate_image(prompt: str, out_path: Path, cfg: Config) -> bool:
    """Generate a still with Flux Schnell. Returns True on success."""
    try:
        import torch  # lazy
        from diffusers import FluxPipeline  # lazy
    except Exception as exc:  # pragma: no cover - depends on GPU box
        print(f"[visuals] diffusers/torch unavailable: {exc}")
        return False

    gcfg = cfg.as_dict()["visuals"]["generated"]
    # Flux needs dimensions that are multiples of 16.
    w = _snap16(int(gcfg.get("width", 720)))
    h = _snap16(int(gcfg.get("height", 1280)))

    try:
        pipe = FluxPipeline.from_pretrained(
            gcfg["model"], torch_dtype=torch.bfloat16
        )
        if gcfg.get("enable_cpu_offload", True):
            pipe.enable_model_cpu_offload()   # fits 12GB VRAM comfortably
        else:
            pipe.to("cuda")
        if gcfg.get("vae_slicing", True):
            pipe.vae.enable_slicing()

        image = pipe(
            prompt,
            num_inference_steps=int(gcfg.get("steps", 4)),
            guidance_scale=float(gcfg.get("guidance", 0.0)),
            height=h, width=w,
            max_sequence_length=256,
        ).images[0]
        out_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(out_path)
        print(f"[visuals] generated {w}x{h} -> {out_path.name}")
        return True
    except Exception as exc:  # pragma: no cover
        print(f"[visuals] Flux generation failed: {exc}")
        return False


# --------------------------------------------------------------------------
# stage entry point
# --------------------------------------------------------------------------
def _all_assets_present(manifest: dict, vp: VideoPaths) -> bool:
    for s in manifest.get("scenes", []):
        ap = Path(s["asset"])
        if not (ap if ap.is_absolute() else (vp.dir / ap)).exists():
            return False
    return bool(manifest.get("scenes"))


def visuals(
    video_id: str,
    cfg: Optional[Config] = None,
    force: bool = False,
) -> Path:
    cfg = cfg or load_config()
    vp = VideoPaths(cfg.resolve("paths.work"), video_id).ensure()

    if vp.scenes_json.exists() and not force:
        manifest = json.loads(vp.scenes_json.read_text())
        if _all_assets_present(manifest, vp):
            print(f"[visuals] {vp.scenes_json} + assets exist -> skipping")
            return vp.scenes_json

    if not vp.script_json.exists():
        raise FileNotFoundError(f"missing script: {vp.script_json}")
    script = json.loads(vp.script_json.read_text())
    scenes = script.get("scenes", [])
    if not scenes:
        raise ValueError("script has no scenes")

    # Timings from alignment (fall back to even split if align.json missing).
    words: list[dict] = []
    if vp.align_json.exists():
        words = json.loads(vp.align_json.read_text()).get("words", [])
    audio_dur = ffutil.duration(vp.voice_wav) if vp.voice_wav.exists() else \
        float(len(scenes) * 4)
    times = assign_scene_times(scenes, words, audio_dur)

    fallback = bool(cfg.get("visuals.fallback_to_card", True))
    out_scenes = []
    for i, (scene, t) in enumerate(zip(scenes, times)):
        stype = scene.get("type", "card")
        text = scene.get("text", "")
        emoji = scene.get("emoji", "")
        qp = scene.get("query_or_prompt", text)
        # Cards show a short headline if provided, else the scene text.
        card_text = scene.get("headline") or text
        accent = _ACCENTS[i % len(_ACCENTS)]

        png = vp.scene_asset(i, "png")
        mp4 = vp.scene_asset(i, "mp4")

        # Per-scene resume.
        existing = png if png.exists() else (mp4 if mp4.exists() else None)
        if existing is not None and not force:
            still = existing.suffix == ".png"
            print(f"[visuals] scene {i} asset exists -> {existing.name}")
            rendered, asset, is_still = stype, existing, still
        else:
            rendered, asset, is_still = _render_scene(
                i, stype, card_text, emoji, qp, accent, png, mp4, cfg, fallback
            )

        out_scenes.append({
            "index": i,
            "type": stype,
            "rendered": rendered,
            "asset": str(asset.relative_to(vp.dir)),
            "still": is_still,
            "start": t["start"], "end": t["end"], "duration": t["duration"],
            "text": text, "emoji": emoji, "query_or_prompt": qp,
        })

    manifest = {
        "video_id": video_id,
        "scenes": out_scenes,
        "total_duration": round(audio_dur, 3),
    }
    vp.scenes_json.write_text(json.dumps(manifest, indent=2))
    print(f"[visuals] wrote {vp.scenes_json} ({len(out_scenes)} scenes)")
    return vp.scenes_json


def _render_scene(
    i, stype, card_text, emoji, qp, accent, png, mp4, cfg, fallback
) -> tuple[str, Path, bool]:
    """Produce one scene asset, falling back to a card on failure."""
    if stype == "stock":
        if fetch_stock(qp, mp4, cfg):
            return "stock", mp4, False
        if not fallback:
            raise RuntimeError(f"stock fetch failed for scene {i}")
        print(f"[visuals] scene {i}: falling back to card")
        render_card(card_text, emoji, png, cfg, accent)
        return "card", png, True

    if stype == "generated":
        if generate_image(qp, png, cfg):
            return "generated", png, True
        if not fallback:
            raise RuntimeError(f"generation failed for scene {i}")
        print(f"[visuals] scene {i}: falling back to card")
        render_card(card_text, emoji, png, cfg, accent)
        return "card", png, True

    # default: card
    render_card(card_text, emoji, png, cfg, accent)
    return "card", png, True


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description="Render per-scene visuals.")
    ap.add_argument("video_id")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--config", default=None)
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    visuals(args.video_id, cfg=cfg, force=args.force)


if __name__ == "__main__":
    main()
