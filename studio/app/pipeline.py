"""End-to-end orchestration: one call runs research -> select -> script -> produce
for a channel; the daily loop does that for every channel plus publish + learn.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

from . import (formula, ideate, images, publish, review, scenes as scenes_mod,
               scriptgen, voice as voice_mod, render as render_mod, visuals)


def _slug(text: str, maxlen: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:maxlen] or "video"


def _hook_end(script, words) -> float:
    """When the spoken hook ends (voice timeline) — the hook card holds until then.

    TTS tokens don't map 1:1 to script words (punctuation, contractions), so this
    is an approximation, clamped to a sane card duration.
    """
    if not words:
        return 2.5
    idx = min(len(script.hook.split()), len(words)) - 1
    return min(max(words[idx].end, 1.5), 4.0)


def _segment_ends(script, words) -> list[float]:
    """End time (voice timeline) of each visual segment: hook, each beat, payoff+loop.
    Approximate word-count mapping into the TTS token timeline, kept ascending."""
    counts = ([len(script.hook.split())]
              + [len(b.split()) for b in script.beats]
              + [len((script.payoff + " " + script.loop_line).split())])
    ends: list[float] = []
    cum = 0
    for c in counts:
        cum += c
        if words:
            t = words[min(cum, len(words)) - 1].end
        else:
            t = (len(ends) + 1) * 3.0
        if ends and t <= ends[-1] + 0.5:
            t = ends[-1] + 0.5
        ends.append(t)
    if words:
        ends[-1] = max(ends[-1], words[-1].end)
    return ends


def _aligned_scenes(script) -> list[dict]:
    """One scene per segment (hook + beats + payoff): pad with ambient, drop extras."""
    need = 2 + len(script.beats)
    empty = {"kind": "ambient", "headline": "", "sub": "", "value": "", "label": "",
             "points": [], "emoji": "", "image_query": ""}
    out = [dict(empty, **s) for s in (script.scenes or [])[:need] if isinstance(s, dict)]
    while len(out) < need:
        out.append(dict(empty))
    # the hook card owns the top of the screen while scene 1 plays — any scene
    # kind that puts content up there would collide, so the opener is always ambient
    out[0]["kind"] = "ambient"
    out[0]["image_query"] = ""
    return out


MIN_SUBCUT_SECONDS = 0.9  # a photo cut shorter than this reads as a glitch


def _expand_photo_cuts(scene_list, seg_ends, photo_map):
    """Photos tell the story: a scene with N photos becomes N visual cuts inside
    its segment. Returns (render_specs, expanded_ends, expanded_emojis) where
    each spec is (scene, image_path|None). The emoji pops once per scene."""
    specs, ends, emojis = [], [], []
    prev = 0.0
    for i, sc in enumerate(scene_list):
        seg_end = seg_ends[i]
        seg_dur = max(0.01, seg_end - prev)
        imgs = photo_map.get(i) or []
        n = min(len(imgs), max(1, int(seg_dur / MIN_SUBCUT_SECONDS))) if imgs else 1
        for k in range(n):
            specs.append((sc, imgs[k] if imgs else None))
            ends.append(prev + seg_dur * (k + 1) / n)
            emojis.append(sc.get("emoji", "") if k == 0 else "")
        prev = seg_end
    ends[-1] = seg_ends[-1]
    return specs, ends, emojis


def _render_final(cfg, channel, script, wav, words, out_mp4, workdir, seed, log=None):
    """Scenes style with graceful fallback to the plain gradient renderer."""
    theme = visuals.theme_for(channel.theme)
    hook_kwargs = dict(hook_text=script.hook, hook_seconds=_hook_end(script, words))
    if channel.visual_style == "scenes":
        try:
            scene_list = _aligned_scenes(script)
            script.scenes = scene_list  # aligned view, so image indices match
            photo_map = images.resolve_for_script(cfg, script)  # never raises
            seg_ends = _segment_ends(script, words)
            specs, ends, emojis = _expand_photo_cuts(scene_list, seg_ends, photo_map)
            pngs = []
            for i, (sc, img) in enumerate(specs):
                pngs.append(scenes_mod.render_scene(sc, theme, seed + i, workdir / f"scene_{i}.png",
                                                    image_path=img))
            return render_mod.render_story(wav, words, pngs, ends, out_mp4,
                                           theme=theme, workdir=workdir,
                                           segment_emojis=emojis,
                                           sfx_dir=(cfg.data_dir / "sfx") if cfg.sfx else None,
                                           **hook_kwargs)
        except Exception as e:
            if log:
                log("scenes_fallback", f"{out_mp4.name}: {e}")
    return render_mod.render(wav, words, out_mp4, theme=theme, seed=seed,
                             workdir=workdir, **hook_kwargs)


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
    seed = video_id * 7919 + int(time.time()) % 7919
    path, duration = _render_final(cfg, channel, script, wav, words, out_mp4,
                                   workdir, seed, log=ledger.log)

    ledger.set_video(video_id, video_path=str(path), duration=duration, status="rendered",
                     script=json.dumps(script.to_dict()))  # persists image credits
    ledger.log("rendered", f"video {video_id} ({duration:.1f}s) -> {path}")
    return video_id


def revoice_video(cfg, channel, ledger, video_id: int, engine=None) -> tuple[str, float]:
    """Re-synthesize voice and re-render an existing video from its stored script.

    Why this exists: scripts can be produced anywhere (e.g. a remote session with
    only the mock voice available); the mechanical voice+render pass then reruns
    on a machine with Kokoro in one command. Also handy after changing voices or
    themes. Status is preserved (rendered stays rendered, approved stays approved).
    """
    row = ledger.video(video_id)
    if row is None:
        raise KeyError(f"no video {video_id}")
    if row["status"] == "published":
        raise ValueError(f"video {video_id} is already published")
    script = scriptgen.Script.from_dict(json.loads(row["script"]))

    workdir = cfg.data_dir / "build" / f"{channel.name}_{video_id}_{_slug(script.title)}"
    workdir.mkdir(parents=True, exist_ok=True)
    engine = engine or voice_mod.pick_engine(cfg.tts_engine)
    wav = workdir / "voice.wav"
    words, _ = engine.synth(script.spoken_text(), channel.voice, wav)
    wav, words = voice_mod.apply_rate(wav, words, channel.voice_rate)

    out_mp4 = cfg.data_dir / "renders" / f"{channel.name}_{video_id}_{_slug(script.title)}.mp4"
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    seed = video_id * 7919 + 17
    path, duration = _render_final(cfg, channel, script, wav, words, out_mp4,
                                   workdir, seed, log=ledger.log)
    ledger.set_video(video_id, video_path=str(path), duration=duration,
                     script=json.dumps(script.to_dict()))  # persists image credits
    ledger.log("revoiced", f"video {video_id} ({duration:.1f}s, engine={getattr(engine, 'name', '?')})")
    return str(path), duration


def revoice_all(cfg, channel, ledger, engine=None) -> list[int]:
    """Re-voice+render every unpublished produced video on a channel."""
    done = []
    engine = engine or voice_mod.pick_engine(cfg.tts_engine)
    for status in ("rendered", "approved"):
        for row in ledger.videos(channel.name, status=status):
            revoice_video(cfg, channel, ledger, row["id"], engine=engine)
            done.append(row["id"])
    return done


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
        elif cfg.review_auto_above is not None:
            # autopilot with a floor: high-scoring videos flow straight through,
            # everything else still waits for a human
            for vid in made:
                row = ledger.video(vid)
                if row and row["status"] == "rendered" and row["score"] >= cfg.review_auto_above:
                    review.approve(ledger, vid)
                    ledger.log("auto_approved", f"video {vid} (score {row['score']:.2f})")
        published = publish.publish_approved(cfg, ledger, channel, dry_run=dry_run_publish)
        went_live = []
        try:
            went_live = publish.sweep_live(cfg, ledger, channel)
        except Exception as e:
            ledger.log("sweep_error", f"{channel.name}: {e}")
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
            "went_live": went_live,
            "weights_updated": len(learned),
            "awaiting_review": [v["id"] for v in review.queue(ledger, channel.name)],
        }
    return summary


def sample_video(cfg, ledger, channel, out: Path | None = None) -> Path:
    """Render a style-preview short with the mock voice and a canned script —
    lets you see the channel's look before spending anything."""
    script = scriptgen.Script(
        hook="Sam Walton was broke at 44 and worth billions at 67",
        beats=[
            "In 1962 he opened one discount store in Rogers, Arkansas.",
            "His trick: sell cheaper than anyone and make it up on volume.",
            "By 1985 Forbes named him the richest man in America.",
        ],
        payoff="One store became eleven thousand, all from refusing to raise prices.",
        loop_line="And at 44, everyone thought Sam was finished.",
        title="Broke at 44, richest man in America by 67",
        description="The Sam Walton playbook.", tags=["business", "money", "story"],
        hook_type="stat_shock", format="story",
        pin_comment="Would you bet everything on one store at 44?",
        scenes=[
            {"kind": "ambient", "headline": "", "sub": "", "value": "", "label": "",
             "points": [], "emoji": "🤯"},
            {"kind": "timeline", "headline": "", "sub": "1945 Ben Franklin store;1962 Walmart #1;1970 IPO",
             "value": "", "label": "", "points": [], "emoji": "🏪"},
            {"kind": "big_stat", "headline": "", "sub": "", "value": "-3%",
             "label": "priced below every competitor", "points": [], "emoji": "🏷️"},
            {"kind": "chart_up", "headline": "Walmart stores", "sub": "",
             "value": "", "label": "1962 to 1985", "points": [1, 24, 125, 276, 640, 882],
             "emoji": "📈"},
            {"kind": "figure", "headline": "Sam Walton", "sub": "", "value": "$2.8B",
             "label": "net worth, 1985", "points": [], "emoji": "👑💰"},
        ],
    )
    engine = voice_mod.MockEngine()
    workdir = cfg.data_dir / "build" / f"{channel.name}_sample"
    workdir.mkdir(parents=True, exist_ok=True)
    wav = workdir / "voice.wav"
    words, _ = engine.synth(script.spoken_text(), channel.voice, wav)
    out = out or cfg.data_dir / "renders" / f"{channel.name}_sample.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    path, _ = _render_final(cfg, channel, script, wav, words, out, workdir, seed=42)
    return path
