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
OPENVERSE = "https://api.openverse.org/v1/images/"
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


def search_openverse(query: str, limit: int = 8) -> list[dict]:
    """Second source: Openverse (CC-licensed images across the open web).
    Only commercial-use licenses are requested; NC/ND never appear."""
    params = urllib.parse.urlencode({
        "q": query, "license": "cc0,pdm,by,by-sa", "page_size": limit,
        "mature": "false", "fields": "url,license,creator,width",
    })
    req = urllib.request.Request(f"{OPENVERSE}?{params}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read())
    out = []
    for item in data.get("results", []):
        url = item.get("url") or ""
        if (item.get("width") or 0) < MIN_WIDTH or not url.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        lic = (item.get("license") or "").upper()
        creator = _strip_html(item.get("creator") or "")[:80]
        out.append({"url": url, "title": item.get("title", ""),
                    "license": f"CC {lic}" if lic not in ("CC0", "PDM") else lic,
                    "artist": creator,
                    "credit": f"{creator or 'Openverse'} (CC {lic})"})
    return out


def candidates_for(query: str) -> list[dict]:
    """Commons first (best for notable people/places), Openverse to fill gaps.
    Raises when every source errors — a network failure must not be mistaken for
    'no such image exists' (ensure() would cache that miss permanently)."""
    out, errors = [], []
    for source in (search, search_openverse):
        try:
            out.extend(source(query))
        except Exception as e:
            errors.append(e)
    if not out and len(errors) == 2:
        raise errors[0]
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
        candidates = candidates_for(query)
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


_QUERY_WORD = re.compile(r"[A-Za-z][A-Za-z'\-]+")


def fallback_query(scene: dict, script) -> str:
    """Best-effort search for a scene that arrived without an image_query —
    every slide must carry a real photo, so derive one from what's on the slide
    (or, for text-free scenes like the hook, from the story's title)."""
    for field in ("headline", "label", "sub"):
        words = _QUERY_WORD.findall(scene.get(field) or "")
        if any(len(w) > 3 for w in words):
            return " ".join(words[:6])
    title_words = [w for w in _QUERY_WORD.findall(getattr(script, "title", "") or "")
                   if len(w) > 3]
    return " ".join(title_words[:5])


def resolve_for_script(cfg, script) -> dict[int, list[str]]:
    """Fetch images so EVERY scene carries at least one real photo. image_query
    holds 1-3 searches separated by ';' — each becomes its own visual cut inside
    the scene's segment (or one collage when the segment is short). A scene
    without a query gets one derived from its own text; a scene whose searches
    all miss borrows the nearest scene's photo — a related image from the same
    story beats a photo-less slide. Returns {scene_index: [paths]} and records
    credits on the script (they end up in the video description)."""
    paths: dict[int, list[str]] = {}
    credits = list(getattr(script, "image_credits", []) or [])
    scene_items = [(i, s) for i, s in enumerate(script.scenes or []) if isinstance(s, dict)]
    for i, scene in scene_items:
        queries = [q.strip() for q in (scene.get("image_query") or "").split(";") if q.strip()][:3]
        if not queries:
            queries = [q for q in [fallback_query(scene, script)] if q]
        found: list[str] = []
        for query in queries:
            path, credit = ensure(cfg.data_dir / "images", query)
            if path:
                found.append(str(path))
                if credit and credit not in credits:
                    credits.append(credit)
        if found:
            paths[i] = found
    if paths:  # the borrow backstop for scenes whose searches all missed
        for i, scene in scene_items:
            if i not in paths:
                nearest = min(paths, key=lambda j: abs(j - i))
                paths[i] = [paths[nearest][0]]
    script.image_credits = credits
    return paths
