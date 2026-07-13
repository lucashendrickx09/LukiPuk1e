"""Real archival images for scenes — Wikimedia Commons, license-filtered, auto-credited.

Why Commons: it's where the public-domain and Creative-Commons photos of notable
people, companies, and places live — the same source every story channel that
survives monetization review uses. Only PD/CC0/CC-BY/CC-BY-SA files are accepted
(never NC/ND); every used image's credit is appended to the video description
automatically.

Everything degrades gracefully: no network / no acceptable result -> the scene
renders in the drawn Starfield Noir style instead. Downloads are cached in
data/images/ keyed by query, so re-renders are offline-safe.
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://commons.wikimedia.org/w/api.php"
UA = "ShortsStudio/1.0 (channel production tool; respects WMF UA policy)"

_OK = ("public domain", "pd-", "pd ", "cc0", "cc-by", "cc by", "attribution")
_BAD = ("nc", "nd", "no derivative", "non-commercial", "noncommercial")

MIN_WIDTH = 500


def _license_ok(short_name: str) -> bool:
    low = (short_name or "").lower()
    if not low:
        return False
    if any(b in low for b in _BAD):
        return False
    return any(k in low for k in _OK)


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _http_json(params: dict) -> dict:
    query = urllib.parse.urlencode({**params, "format": "json"})
    req = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def search(query: str, limit: int = 8) -> list[dict]:
    """License-filtered Commons image candidates for a query, best-first."""
    data = _http_json({
        "action": "query", "generator": "search",
        "gsrsearch": query, "gsrnamespace": 6, "gsrlimit": limit,
        "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": 1200,
    })
    out = []
    pages = (data.get("query") or {}).get("pages") or {}
    for page in sorted(pages.values(), key=lambda p: p.get("index", 99)):
        infos = page.get("imageinfo") or []
        if not infos:
            continue
        info = infos[0]
        meta = info.get("extmetadata") or {}
        license_name = _strip_html((meta.get("LicenseShortName") or {}).get("value", ""))
        if not _license_ok(license_name):
            continue
        if (info.get("width") or 0) < MIN_WIDTH:
            continue
        url = info.get("thumburl") or info.get("url")
        if not url or not url.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        artist = _strip_html((meta.get("Artist") or {}).get("value", ""))[:80]
        out.append({
            "url": url,
            "title": page.get("title", ""),
            "license": license_name,
            "artist": artist,
            "credit": f"{artist or 'Wikimedia Commons'} ({license_name})",
        })
    return out


def _cache_key(query: str) -> str:
    return hashlib.sha1(query.strip().lower().encode()).hexdigest()[:16]


def ensure(cache_dir: str | Path, query: str) -> tuple[Path | None, str | None]:
    """Cached fetch of the best acceptable image for a query.
    Returns (path, credit) or (None, None) — never raises."""
    query = (query or "").strip()
    if not query:
        return None, None
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = _cache_key(query)
    meta_file = cache_dir / f"{key}.json"
    if meta_file.exists():
        meta = json.loads(meta_file.read_text())
        if meta.get("miss"):
            return None, None
        img = cache_dir / meta["file"]
        if img.exists():
            return img, meta["credit"]
    try:
        candidates = search(query)
        for cand in candidates:
            ext = ".png" if cand["url"].lower().endswith(".png") else ".jpg"
            img = cache_dir / f"{key}{ext}"
            req = urllib.request.Request(cand["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            if len(data) < 8_000:
                continue
            img.write_bytes(data)
            meta_file.write_text(json.dumps({"file": img.name, "credit": cand["credit"],
                                             "title": cand["title"], "query": query}))
            return img, cand["credit"]
        meta_file.write_text(json.dumps({"miss": True, "file": "", "credit": "", "query": query}))
    except Exception:
        pass  # offline / API hiccup: drawn style takes over
    return None, None


def resolve_for_script(cfg, script) -> dict[int, str]:
    """Fetch images for every scene with an image_query. Returns {scene_index: path}
    and records the credits on the script (they end up in the video description)."""
    paths: dict[int, str] = {}
    credits = list(getattr(script, "image_credits", []) or [])
    for i, scene in enumerate(script.scenes or []):
        if not isinstance(scene, dict):
            continue
        query = (scene.get("image_query") or "").strip()
        if not query or i == 0:  # the hook scene stays ambient
            continue
        path, credit = ensure(cfg.data_dir / "images", query)
        if path:
            paths[i] = str(path)
            if credit and credit not in credits:
                credits.append(credit)
    script.image_credits = credits
    return paths
