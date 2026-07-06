"""End-to-end orchestration: one call runs research -> select -> script -> produce
for a channel; the daily loop does that for every channel plus publish + learn.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

from . import formula, ideate, publish, review, scriptgen, voice as voice_mod, render as render_mod, visuals


def _slug(text: str, maxlen: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:maxlen] or "video"


def produce_video(cfg, channel, ledger, idea: dict, client=None, engine=None) -> int | None:
    """idea -> script (validated+scored) -> voice -> render -> review queue.

    Returns the video id, or None if the idea couldn't clear the quality gate.
    """
    script, issues = scriptgen.script_with_retry(cfg, channel, idea, client=client)
    if script is None:
        ledger.set_idea_status(idea["id"], "discarded")
        ledger.log("script_discarded", f"idea {idea['id']}: {'; '.join(issues)}")
        return None

    # Stage-2 score + threshold gate
    idea_score = idea.get("score", 0.5)
    hook_s = formula.hook_score(script.hook)
    retention_s = formula.retention_score(script.est_seconds(), len(script.beats), True, True)
    s2 = formula.score_script(idea_score, hook_s, retention_s, cfg.weights_stage2)
    if s2 < cfg.script_threshold:
        ledger.set_idea_status(idea["id"], "discarded")
        ledger.log("score_discarded", f"idea {idea['id']}: S2={s2:.2f} < {cfg.script_threshold}")
        return None

    video_id = ledger.add_video(idea["id"], channel.name, script.to_dict(),
                                hook_type=script.hook_type, fmt=script.format,
                                est_seconds=script.est_seconds(), score=s2)
    ledger.set_idea_status(idea["id"], "scripted")

    workdir = cfg.data_dir / "build" / f"{channel.name}_{video_id}_{_slug(script.title)}"
    workdir.mkdir(parents=True, exist_ok=True)

    engine = engine or voice_mod.pick_engine(cfg.tts_engine)
    wav = workdir / "voice.wav"
    words, _dur = engine.synth(script.spoken_text(), channel.voice, wav)
    wav, words = voice_mod.apply_rate(wav, words, channel.voice_rate)

    out_mp4 = cfg.data_dir / "renders" / f"{channel.name}_{video_id}_{_slug(script.title)}.mp4"
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    theme = visuals.theme_for(channel.theme)
    seed = video_id * 7919 + int(time.time()) % 7919
    path, duration = render_mod.render(wav, words, out_mp4, theme=theme, seed=seed, workdir=workdir)

    ledger.set_video(video_id, video_path=str(path), duration=duration, status="rendered")
    ledger.log("rendered", f"video {video_id} ({duration:.1f}s) -> {path}")
    return video_id


def run_channel(cfg, channel, ledger, count: int | None = None, client=None, engine=None,
                use_web_search: bool = True) -> list[int]:
    """Produce up to `count` (default videos_per_day) new videos for one channel."""
    count = count or cfg.videos_per_day
    candidates = ledger.ideas(channel.name, status="candidate")
    if len(candidates) < count * 3:
        ideate.refresh_ideas(cfg, channel, ledger, client=client, use_web_search=use_web_search)
    ideas = ideate.select_ideas(cfg, channel, ledger, k=count * 2)  # headroom for gate discards
    made: list[int] = []
    for idea in ideas:
        if len(made) >= count:
            ledger.set_idea_status(idea["id"], "candidate")  # give it back
            continue
        vid = produce_video(cfg, channel, ledger, idea, client=client, engine=engine)
        if vid is not None:
            made.append(vid)
    return made


def run_daily(cfg, ledger, client=None, engine=None, dry_run_publish: bool = False) -> dict:
    """The whole loop for all channels. Safe to run from cron/launchd once or twice a day."""
    summary: dict = {"channels": {}}
    for channel in cfg.channels:
        made = run_channel(cfg, channel, ledger, client=client, engine=engine)
        published = []
        if not cfg.review_required:
            for vid in made:
                review.approve(ledger, vid)
        published = publish.publish_approved(cfg, ledger, channel, dry_run=dry_run_publish)
        learned = {}
        try:
            from . import analytics
            analytics.pull(cfg, ledger, channel)
            learned = analytics.learn(ledger, channel)
        except Exception as e:
            ledger.log("analytics_error", f"{channel.name}: {e}")
        summary["channels"][channel.name] = {
            "produced": made,
            "published": published,
            "weights_updated": len(learned),
            "awaiting_review": [v["id"] for v in review.queue(ledger, channel.name)],
        }
    return summary


def sample_video(cfg, ledger, channel, out: Path | None = None) -> Path:
    """Render a style-preview short with the mock voice and a canned script —
    lets you see the channel's look before spending anything."""
    script = scriptgen.Script(
        hook="This 30 second video cost exactly zero dollars to make",
        beats=[
            "The background is generated math, not stock footage.",
            "The captions time themselves to every spoken word.",
            "A formula scored this script before it was allowed to render.",
        ],
        payoff="Everything you just watched came from one command on a laptop.",
        loop_line="And the next zero dollar video starts now.",
        title="Style preview", description="Sample render.", tags=["preview"],
        hook_type="stat_shock", format="explainer",
    )
    engine = voice_mod.MockEngine()
    workdir = cfg.data_dir / "build" / f"{channel.name}_sample"
    workdir.mkdir(parents=True, exist_ok=True)
    wav = workdir / "voice.wav"
    words, _ = engine.synth(script.spoken_text(), channel.voice, wav)
    out = out or cfg.data_dir / "renders" / f"{channel.name}_sample.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    path, _ = render_mod.render(wav, words, out, theme=visuals.theme_for(channel.theme),
                                seed=42, workdir=workdir)
    return path
