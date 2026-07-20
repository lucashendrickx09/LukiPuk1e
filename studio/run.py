#!/usr/bin/env python3
"""Shorts Studio CLI — the one entrypoint for everything.

  python run.py doctor              # check tools, config, auth
  python run.py sample --channel A  # render a free style preview (no APIs needed)
  python run.py research            # refresh trend research for all channels
  python run.py produce             # research->script->voice->render (review queue)
  python run.py review              # list queue; approve/reject from here
  python run.py publish             # schedule approved videos to YouTube slots
  python run.py analyze             # pull analytics + update the formula weights
  python run.py diagnose            # Claude dissects the channel: issues + roadblocks
  python run.py run                 # the full daily loop (cron this)
  python run.py auth CHANNEL        # one-time OAuth per channel
  python run.py status              # ledger counts + upcoming posts
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys

from app import analytics, brand, config, diagnose, ideate, ledger as ledger_mod, pipeline, publish, review


def get_ctx(args):
    cfg = config.load_config(getattr(args, "config", None))
    led = ledger_mod.Ledger(cfg.ledger_path)
    return cfg, led


def channels_for(cfg, args):
    if getattr(args, "channel", None):
        return [cfg.channel(args.channel)]
    return cfg.channels


def cmd_doctor(args):
    cfg, led = get_ctx(args)
    ok = True

    def check(name, passed, hint=""):
        nonlocal ok
        mark = "ok " if passed else "FAIL"
        print(f"[{mark}] {name}" + (f" — {hint}" if hint and not passed else ""))
        ok = ok and passed

    check("ffmpeg", shutil.which("ffmpeg") is not None, "install ffmpeg (apt/brew install ffmpeg)")
    check("ffprobe", shutil.which("ffprobe") is not None, "comes with ffmpeg")
    check("config.yaml channels", bool(cfg.channels), "define at least one channel in config.yaml")
    check("ANTHROPIC_API_KEY", bool(cfg.anthropic_api_key), "put it in studio/.env")
    try:
        import anthropic  # noqa
        check("anthropic sdk", True)
    except ImportError:
        check("anthropic sdk", False, "pip install -r requirements.txt")
    try:
        import PIL  # noqa
        check("pillow (scene graphics)", True)
    except ImportError:
        check("pillow (scene graphics)", False, "pip install -r requirements.txt")
    try:
        from app import scenes as _scenes
        font, _ = _scenes._emoji_font()
        check("color emoji font", font is not None,
              "Linux: apt install fonts-noto-color-emoji | macOS & Windows: built in (Segoe UI Emoji) — videos render without emoji until then")
        if font is None:
            ok = True  # emoji degrade gracefully; warn, don't fail
    except Exception:
        pass
    try:
        import kokoro  # noqa
        check("kokoro tts (local, best)", True)
    except ImportError:
        try:
            import edge_tts  # noqa
            check("kokoro tts (local, best)", False, "using edge-tts fallback; pip install -r requirements-voice.txt for local voice")
            ok = True
        except ImportError:
            check("any tts engine", False, "pip install -r requirements-voice.txt (kokoro) or pip install edge-tts")
    for ch in cfg.channels:
        from pathlib import Path
        tok = Path(ch.token_file or f"secrets/{ch.name}_token.json")
        check(f"channel {ch.name} youtube auth", tok.exists(),
              f"python run.py auth {ch.name} (needs client_secret_file; see README)")
    print()
    print("Ledger:", dict(led.counts()))
    if not ok:
        print("\nSome checks failed — the pipeline degrades gracefully (export mode, "
              "mock voice) but fix the above for full automation.")
    return 0 if ok else 1


def cmd_sample(args):
    cfg, led = get_ctx(args)
    for ch in channels_for(cfg, args):
        path = pipeline.sample_video(cfg, led, ch)
        print(f"{ch.name}: {path}")
    return 0


def cmd_research(args):
    cfg, led = get_ctx(args)
    for ch in channels_for(cfg, args):
        n = ideate.refresh_ideas(cfg, ch, led)
        print(f"{ch.name}: +{n} new ideas")
        for row in led.ideas(ch.name, status="candidate", limit=10):
            print(f"   [{row['score']:.2f}] {row['topic']}")
    return 0


def cmd_produce(args):
    cfg, led = get_ctx(args)
    for ch in channels_for(cfg, args):
        made = pipeline.run_channel(cfg, ch, led, count=args.count)
        print(f"{ch.name}: produced {len(made)} video(s): {made}")
    q = review.queue(led)
    if q:
        print(f"\n{len(q)} video(s) awaiting review — python run.py review")
    return 0


def cmd_revoice(args):
    cfg, led = get_ctx(args)
    engine = None
    if args.engine:
        from app import voice as voice_mod
        engine = voice_mod.pick_engine(args.engine)
    for ch in channels_for(cfg, args):
        if args.video:
            path, dur = pipeline.revoice_video(cfg, ch, led, args.video, engine=engine)
            print(f"{ch.name}: video {args.video} re-rendered ({dur:.1f}s) -> {path}")
            break
        done = pipeline.revoice_all(cfg, ch, led, engine=engine)
        print(f"{ch.name}: re-voiced {len(done)} video(s): {done}")
    return 0


def cmd_review(args):
    cfg, led = get_ctx(args)
    if args.action == "list" or args.action is None:
        rows = review.queue(led)
        if not rows:
            print("review queue is empty")
        for r in rows:
            print(f"#{r['id']} [{r['channel']}] {r['score']:.2f} {r['duration']:.0f}s — {r['title']}\n"
                  f"     hook: {r['hook']}\n     file: {r['path']}")
        return 0
    if args.action == "approve":
        review.approve(led, args.id)
        print(f"approved #{args.id}")
    elif args.action == "reject":
        review.reject(led, args.id, args.reason or "")
        print(f"rejected #{args.id}")
    return 0


def cmd_publish(args):
    cfg, led = get_ctx(args)
    for ch in channels_for(cfg, args):
        results = publish.publish_approved(cfg, led, ch, dry_run=args.dry_run)
        for r in results:
            print(f"{ch.name}: {r}")
        if not results:
            print(f"{ch.name}: nothing approved to publish")
        if not args.dry_run:
            try:
                for r in publish.sweep_live(cfg, led, ch):
                    print(f"{ch.name}: went live {r}")
            except Exception as e:
                print(f"{ch.name}: live sweep skipped ({e})")
    return 0


def cmd_analyze(args):
    cfg, led = get_ctx(args)
    for ch in channels_for(cfg, args):
        try:
            n = analytics.pull(cfg, led, ch)
            print(f"{ch.name}: metrics updated for {n} post(s)")
        except Exception as e:
            print(f"{ch.name}: analytics pull skipped ({e})")
        updated = analytics.learn(led, ch)
        print(f"{ch.name}: {len(updated)} formula prior(s) updated")
        for row in analytics.report(led, ch)[:10]:
            print(f"   {row}")
    return 0


def cmd_brand(args):
    cfg, _ = get_ctx(args)
    for ch in channels_for(cfg, args):
        paths = brand.write_all(cfg, ch)
        print(f"{ch.name}:")
        for kind, p in paths.items():
            print(f"   {kind}: {p}")
    return 0


def cmd_diagnose(args):
    cfg, led = get_ctx(args)
    for ch in channels_for(cfg, args):
        try:
            analytics.pull(cfg, led, ch)
        except Exception:
            pass  # diagnosis still runs from whatever the ledger has
        text, path = diagnose.run_diagnosis(cfg, led, ch)
        print(text)
        if path:
            print(f"\n[saved to {path}]")
    return 0


def cmd_run(args):
    cfg, led = get_ctx(args)
    summary = pipeline.run_daily(cfg, led, dry_run_publish=args.dry_run)
    print(json.dumps(summary, indent=2, default=str))
    return 0


def cmd_auth(args):
    cfg, _ = get_ctx(args)
    ch = cfg.channel(args.channel)
    path = publish.auth_channel(ch)
    print(f"authorized {ch.name}; token saved to {path}")
    return 0


def cmd_web(args):
    from app import webapp
    cfg = config.load_config(getattr(args, "config", None))
    webapp.serve_forever(cfg, lambda: ledger_mod.Ledger(cfg.ledger_path),
                         host=args.host, port=args.port)
    return 0


def cmd_status(args):
    cfg, led = get_ctx(args)
    print("ledger:", dict(led.counts()))
    for ch in cfg.channels:
        upcoming = [p for p in led.posts(ch.name) if p["status"] in ("scheduled", "uploaded", "exported")]
        print(f"{ch.name}: {len(led.ideas(ch.name, status='candidate'))} candidate ideas, "
              f"{len(review.queue(led, ch.name))} awaiting review, {len(upcoming)} scheduled")
        for p in upcoming[:5]:
            print(f"   {p['publish_at']}  {p['title']}  [{p['status']}]")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", help="path to config.yaml", default=None)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("doctor").set_defaults(fn=cmd_doctor)

    sp = sub.add_parser("sample"); sp.add_argument("--channel"); sp.set_defaults(fn=cmd_sample)
    sp = sub.add_parser("research"); sp.add_argument("--channel"); sp.set_defaults(fn=cmd_research)

    sp = sub.add_parser("produce")
    sp.add_argument("--channel"); sp.add_argument("--count", type=int, default=None)
    sp.set_defaults(fn=cmd_produce)

    sp = sub.add_parser("revoice")
    sp.add_argument("--channel"); sp.add_argument("--video", type=int, default=None)
    sp.add_argument("--engine", choices=["kokoro", "edge", "mock"], default=None)
    sp.set_defaults(fn=cmd_revoice)

    sp = sub.add_parser("review")
    sp.add_argument("action", nargs="?", choices=["list", "approve", "reject"], default="list")
    sp.add_argument("id", nargs="?", type=int)
    sp.add_argument("--reason", default="")
    sp.set_defaults(fn=cmd_review)

    sp = sub.add_parser("publish")
    sp.add_argument("--channel"); sp.add_argument("--dry-run", action="store_true")
    sp.set_defaults(fn=cmd_publish)

    sp = sub.add_parser("analyze"); sp.add_argument("--channel"); sp.set_defaults(fn=cmd_analyze)

    sp = sub.add_parser("diagnose"); sp.add_argument("--channel"); sp.set_defaults(fn=cmd_diagnose)

    sp = sub.add_parser("brand"); sp.add_argument("--channel"); sp.set_defaults(fn=cmd_brand)

    sp = sub.add_parser("web")
    sp.add_argument("--port", type=int, default=8787); sp.add_argument("--host", default="0.0.0.0")
    sp.set_defaults(fn=cmd_web)

    sp = sub.add_parser("run"); sp.add_argument("--dry-run", action="store_true"); sp.set_defaults(fn=cmd_run)

    sp = sub.add_parser("auth"); sp.add_argument("channel"); sp.set_defaults(fn=cmd_auth)

    sub.add_parser("status").set_defaults(fn=cmd_status)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
