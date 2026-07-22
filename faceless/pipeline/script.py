"""Stage: script -> work/<id>/script.json

Pops the next unused script from the queue (scripts.json, mirrored into
state.db), marks it used, mints a video id, and writes the script into the
work dir. The narration text spoken by TTS is the concatenation of the scenes'
text, and `build_narration()` is the single source of truth for it (imported by
tts.py and align.py).

Run standalone:  python -m pipeline.script          # start the next video
                 python -m pipeline.script --peek    # show what's next
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Optional

from .config import Config, load_config
from .paths import VideoPaths
from .state import State, script_key


def build_narration(script: dict) -> str:
    """The exact text TTS speaks: scene texts joined, each a sentence."""
    parts = []
    for scene in script.get("scenes", []):
        t = (scene.get("text") or "").strip()
        if not t:
            continue
        if t[-1] not in ".!?…":
            t += "."
        parts.append(t)
    return " ".join(parts)


def slugify(text: str, maxlen: int = 40) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return (slug[:maxlen].rstrip("-")) or "video"


def make_video_id(state: State, title: str) -> str:
    return f"{state.video_count() + 1:04d}_{slugify(title)}"


def load_scripts_file(cfg: Config) -> list[dict]:
    path = cfg.resolve("paths.scripts")
    if not Path(path).exists():
        raise FileNotFoundError(f"scripts file not found: {path}")
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict) and "scripts" in data:
        data = data["scripts"]
    if not isinstance(data, list):
        raise ValueError("scripts.json must be a list (or {\"scripts\": [...]})")
    return data


def write_script_json(vp: VideoPaths, script: dict) -> Path:
    vp.ensure()
    vp.script_json.write_text(json.dumps(script, indent=2, ensure_ascii=False))
    return vp.script_json


def pop_and_start(
    cfg: Config, state: State
) -> Optional[tuple[str, dict]]:
    """Sync scripts.json, pop the next unused script, create the video.

    Returns (video_id, script) or None if the queue is empty.
    """
    state.sync_scripts(load_scripts_file(cfg))
    row = state.peek_next_script()
    if row is None:
        return None
    script = json.loads(row["json"])
    key = row["key"]
    video_id = make_video_id(state, script.get("title", ""))

    state.create_video(video_id, key, script.get("title", ""))
    state.claim_script(key, video_id)

    vp = VideoPaths(cfg.resolve("paths.work"), video_id)
    write_script_json(vp, script)
    state.set_stage(video_id, "script", "done", str(vp.script_json))
    print(f"[script] started {video_id}: {script.get('title', '')!r}")
    return video_id, script


def ensure_for_video(
    video_id: str, cfg: Config, state: State
) -> dict:
    """Resume helper: guarantee work/<id>/script.json exists, return script."""
    vp = VideoPaths(cfg.resolve("paths.work"), video_id)
    if vp.script_json.exists():
        return json.loads(vp.script_json.read_text())
    script = state.script_for_video(video_id)
    if script is None:
        raise RuntimeError(f"no script recorded for video {video_id}")
    write_script_json(vp, script)
    return script


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description="Start the next video's script.")
    ap.add_argument("--peek", action="store_true", help="show next, don't claim")
    ap.add_argument("--config", default=None)
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    with State(cfg.resolve("paths.state_db")) as state:
        if args.peek:
            state.sync_scripts(load_scripts_file(cfg))
            row = state.peek_next_script()
            print("next:", row["title"] if row else "(queue empty)")
            return
        result = pop_and_start(cfg, state)
        if result is None:
            print("[script] queue empty — nothing to do")
        else:
            print(result[0])


if __name__ == "__main__":
    main()
