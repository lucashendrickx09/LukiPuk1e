#!/usr/bin/env python3
"""Orchestrator: build one faceless Short end to end, resumable per stage.

    python run.py                     # start & build the next queued script
    python run.py --resume            # continue the latest unfinished video
    python run.py --video-id 0003_foo # build/continue a specific video
    python run.py --from visuals      # run visuals -> assemble (-> upload)
    python run.py --only assemble     # run just one stage
    python run.py --upload            # include the upload stage this run
    python run.py --force             # ignore resume; rebuild every stage
    python run.py --force-stage assemble
    python run.py --peek / --status <id> / --list

Resume is automatic: each stage skips itself when its output already exists in
work/<video_id>/, so re-running after a crash picks up where it left off.
"""

from __future__ import annotations

import argparse
import sys
import traceback

from pipeline import script as script_stage
from pipeline.align import align
from pipeline.assemble import assemble
from pipeline.config import load_config
from pipeline.state import STAGES, State
from pipeline.tts import tts
from pipeline.upload import upload
from pipeline.visuals import visuals

# stage name -> callable(video_id, cfg, force) -> output path
STAGE_FUNCS = {
    "tts": tts,
    "align": align,
    "visuals": visuals,
    "assemble": assemble,
    "upload": upload,
}


def _select_stages(args) -> list[str]:
    stages = list(STAGES)  # script, tts, align, visuals, assemble, upload
    if args.only:
        return [args.only]
    if args.from_stage:
        i = stages.index(args.from_stage)
        return stages[i:]
    return stages


def _print_status(state: State, video_id: str) -> None:
    row = state.get_video(video_id)
    if not row:
        print(f"(no such video: {video_id})")
        return
    smap = state.stage_map(video_id)
    print(f"{video_id}  [{row['status']}]  {row['title']!r}")
    for st in STAGES:
        print(f"  {st:<9} {smap.get(st, '-')}")
    if row["youtube_id"]:
        print(f"  youtube    https://youtu.be/{row['youtube_id']}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video-id")
    ap.add_argument("--resume", action="store_true",
                    help="continue the latest unfinished video")
    ap.add_argument("--from", dest="from_stage", choices=STAGES)
    ap.add_argument("--only", choices=STAGES)
    ap.add_argument("--upload", action="store_true",
                    help="run the upload stage even if config disables it")
    ap.add_argument("--force", action="store_true",
                    help="rebuild every selected stage")
    ap.add_argument("--force-stage", action="append", default=[],
                    choices=list(STAGE_FUNCS), help="force just this stage")
    ap.add_argument("--config", default=None)
    ap.add_argument("--peek", action="store_true")
    ap.add_argument("--status", metavar="VIDEO_ID")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args(argv)

    cfg = load_config(args.config)
    state = State(cfg.resolve("paths.state_db"))

    # -- informational subcommands --------------------------------------
    if args.peek:
        script_stage.main(["--peek", *(["--config", args.config] if args.config else [])])
        return 0
    if args.status:
        _print_status(state, args.status)
        return 0
    if args.list:
        cur = state.conn.execute(
            "SELECT video_id, status, title FROM videos ORDER BY id")
        for r in cur.fetchall():
            print(f"{r['video_id']:<28} {r['status']:<12} {r['title']}")
        return 0

    # -- choose the video ------------------------------------------------
    if args.video_id:
        video_id = args.video_id
        script_stage.ensure_for_video(video_id, cfg, state)
    elif args.resume:
        row = state.latest_incomplete_video()
        if not row:
            print("no unfinished video to resume")
            return 0
        video_id = row["video_id"]
        script_stage.ensure_for_video(video_id, cfg, state)
        print(f"[run] resuming {video_id}")
    else:
        started = script_stage.pop_and_start(cfg, state)
        if started is None:
            print("queue empty — add scripts to scripts.json")
            return 0
        video_id = started[0]

    stages = _select_stages(args)
    print(f"[run] video={video_id} stages={stages}")

    # -- run the stages --------------------------------------------------
    for st in stages:
        if st == "script":
            state.set_stage(video_id, "script", "done")
            continue

        if st == "upload" and not (cfg.get("upload.enabled", False) or args.upload):
            print("[run] upload disabled (set upload.enabled or pass --upload) "
                  "-> skipping")
            continue

        force = args.force or (st in args.force_stage)
        state.set_stage(video_id, st, "running")
        try:
            out = STAGE_FUNCS[st](video_id, cfg=cfg, force=force)
            state.set_stage(video_id, st, "done", str(out))
        except Exception as exc:
            state.set_stage(video_id, st, "failed", str(exc))
            state.set_video_status(video_id, "failed")
            print(f"\n[run] stage {st!r} FAILED: {exc}\n")
            traceback.print_exc()
            return 1

    # Mark done only when a full run reached assemble (or upload).
    if "assemble" in stages or "upload" in stages:
        state.set_video_status(video_id, "done")
    print(f"\n[run] OK  {video_id}")
    _print_status(state, video_id)
    state.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
