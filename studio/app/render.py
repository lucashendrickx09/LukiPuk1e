"""Final assembly: voice + procedural background + karaoke captions -> 1080x1920 mp4."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from . import captions, visuals
from .voice import Word

LEAD_IN = 0.20   # silence before the first word (frame 1 must already show the hook text soon)
TAIL = 0.60      # hold after the last word so the loop line lands
ZOOM_RATE = 0.0007  # zoom speed per frame (~1.08x over 4s) — subtle constant motion


def ffprobe_duration(path: str | Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, check=True)
    return float(json.loads(out.stdout)["format"]["duration"])


def build_command(voice_wav: Path, ass_path: Path, out_mp4: Path, theme: dict,
                  duration: float, seed: int) -> list[str]:
    """Pure function -> ffmpeg argv (unit-testable without running ffmpeg)."""
    vf = visuals.video_filters(theme, duration, str(ass_path))
    return [
        "ffmpeg", "-y", "-loglevel", "error",
        *visuals.background_input(theme, duration, seed),
        "-i", str(voice_wav),
        "-filter_complex",
        f"[0:v]{vf}[v];[1:a]adelay={int(LEAD_IN*1000)}|{int(LEAD_IN*1000)},apad,"
        f"loudnorm=I=-14:TP=-1.5:LRA=11[a]",
        "-map", "[v]", "-map", "[a]",
        "-t", f"{duration:.3f}",
        "-r", str(visuals.FPS),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
        "-movflags", "+faststart",
        str(out_mp4),
    ]


def build_story_command(scene_durs: list[tuple[Path, float]], voice_wav: Path,
                        ass_path: Path, out_mp4: Path, theme: dict,
                        total_duration: float,
                        emoji_overlays: list[tuple[Path, float, float]] | None = None,
                        sfx_events: list[tuple[Path, float, float]] | None = None) -> list[str]:
    """ffmpeg argv for the story path: one looped input per scene PNG, per-scene
    zoompan with a punch-in settle on every cut (impact) then slow drift, hard
    cuts via concat, animated emoji pops, then the shared grade
    (grain/vignette/progress bar/captions).

    emoji_overlays: (png, t_start, t_end) — each pops in at t_start (drop + bob)
    near the bottom third and disappears at t_end.
    """
    inputs: list[str] = []
    chains: list[str] = []
    n = len(scene_durs)
    for i, spec in enumerate(scene_durs):
        png, dur = spec[0], spec[1]
        motion = spec[2] if len(spec) > 2 else "punch"
        flash = spec[3] if len(spec) > 3 else False
        inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", str(png)]
        frames = max(2, int(dur * visuals.FPS))
        if motion == "pan":
            # documentary pan across the photo at a fixed zoom; direction alternates
            z = "1.08"
            prog = f"(on/{frames})" if i % 2 == 0 else f"(1-on/{frames})"
            x = f"(iw-iw/zoom)*{prog}"
            y = "ih/2-(ih/zoom/2)"
        else:
            # every cut lands zoomed 1.14 and snaps to 1.02 in 6 frames (the
            # punch), then drifts — in or out — so nothing ever sits still
            drift_in = f"min(1.02+{ZOOM_RATE}*(on-6)\\,1.13)"
            drift_out = f"max(1.02-{ZOOM_RATE}*(on-6)\\,1.0)"
            z = f"if(lte(on\\,6)\\,1.14-0.02*on\\,{drift_in if i % 2 == 0 else drift_out})"
            x = "iw/2-(iw/zoom/2)"
            y = "ih/2-(ih/zoom/2)"
        chain = (f"[{i}:v]fps={visuals.FPS},zoompan=z='{z}':x='{x}':y='{y}'"
                 f":d=1:s={visuals.W}x{visuals.H}:fps={visuals.FPS},setsar=1")
        if flash:
            chain += ",fade=t=in:st=0:d=0.07:c=white"  # impact flash on beat changes
        chains.append(chain + f"[s{i}]")
    concat = "".join(f"[s{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[bg0]"
    chains.append(concat)

    # emoji pops: drop into place with an exponential settle + a gentle bob
    prev = "bg0"
    emoji_overlays = emoji_overlays or []
    for j, (png, t0, t1) in enumerate(emoji_overlays):
        idx = n + 1 + j  # scene inputs, then voice, then emojis
        chains.append(f"[{idx}:v]format=rgba[em{j}]")
        # settles at y=1080: below the caption band, clear of the photo text
        # block whose headline starts ~y=1272 (every scene carries a photo now)
        y = (f"1080+8*sin(3*(t-{t0:.3f}))-90*exp(-9*(t-{t0:.3f}))")
        chains.append(f"[{prev}][em{j}]overlay=x='(W-w)/2':y='{y}'"
                      f":enable='between(t,{t0:.3f},{t1:.3f})'[bg{j + 1}]")
        prev = f"bg{j + 1}"

    vf = visuals.video_filters(theme, total_duration, str(ass_path))
    sfx_events = sfx_events or []
    audio_chains = [f"[{n}:a]adelay={int(LEAD_IN*1000)}|{int(LEAD_IN*1000)},apad[vo]"]
    mix_labels = ["[vo]"]
    for k, (wav, at, gain) in enumerate(sfx_events):
        idx = n + 1 + len(emoji_overlays) + k  # scenes, voice, emojis, then sfx
        ms = int(at * 1000)
        audio_chains.append(f"[{idx}:a]adelay={ms}|{ms},volume={gain:.2f}[fx{k}]")
        mix_labels.append(f"[fx{k}]")
    if sfx_events:
        audio_chains.append("".join(mix_labels)
                            + f"amix=inputs={len(mix_labels)}:normalize=0,"
                            f"loudnorm=I=-14:TP=-1.5:LRA=11[a]")
    else:
        audio_chains = [f"[{n}:a]adelay={int(LEAD_IN*1000)}|{int(LEAD_IN*1000)},apad,"
                        f"loudnorm=I=-14:TP=-1.5:LRA=11[a]"]
    filter_complex = ";".join(chains + [f"[{prev}]{vf}[v]"] + audio_chains)

    emoji_inputs: list[str] = []
    for png, t0, t1 in emoji_overlays:
        emoji_inputs += ["-loop", "1", "-t", f"{total_duration:.3f}", "-i", str(png)]
    sfx_inputs: list[str] = []
    for wav, at, gain in sfx_events:
        sfx_inputs += ["-i", str(wav)]
    return [
        "ffmpeg", "-y", "-loglevel", "error",
        *inputs,
        "-i", str(voice_wav),
        *emoji_inputs,
        *sfx_inputs,
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "[a]",
        "-t", f"{total_duration:.3f}",
        "-r", str(visuals.FPS),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
        "-movflags", "+faststart",
        str(out_mp4),
    ]


def render_story(voice_wav: Path, words: list[Word], scene_files: list[Path],
                 seg_ends: list[float], out_mp4: Path, *, theme: dict,
                 hook_text: str | None = None, hook_seconds: float | None = None,
                 segment_emojis: list[str] | None = None,
                 sfx_dir: Path | None = None,
                 motions: list[tuple[str, bool]] | None = None,
                 workdir: Path | None = None) -> tuple[Path, float]:
    """Render the story-scene version of a short. seg_ends are per-segment end
    times on the voice timeline (one per scene, ascending). segment_emojis (same
    length) pop in near the bottom third for the duration of their segment.
    sfx_dir enables sound effects (whoosh on cuts, pop on emoji lands)."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found — install it (brew install ffmpeg / apt install ffmpeg)")
    if len(scene_files) != len(seg_ends):
        raise ValueError(f"{len(scene_files)} scenes vs {len(seg_ends)} segment ends")
    out_mp4 = Path(out_mp4)
    workdir = Path(workdir) if workdir else out_mp4.parent
    workdir.mkdir(parents=True, exist_ok=True)

    shifted = [Word(w.text, w.start + LEAD_IN, w.end + LEAD_IN) for w in words]
    ass_path = workdir / (out_mp4.stem + ".ass")
    hook_until = (hook_seconds + LEAD_IN) if hook_seconds else None
    captions.build_ass(shifted, ass_path, accent=theme["accent"],
                       hook_text=hook_text, hook_until=hook_until)

    durs: list[float] = []
    prev = 0.0
    for i, end in enumerate(seg_ends):
        d = (end + LEAD_IN) - prev
        durs.append(max(0.5, d))
        prev = prev + max(0.5, d)
    durs[-1] += TAIL
    total = sum(durs)

    overlays: list[tuple[Path, float, float]] = []
    if segment_emojis:
        from . import scenes as scenes_mod  # PIL only needed on this path
        start = 0.0
        for i, dur in enumerate(durs):
            emoji = segment_emojis[i] if i < len(segment_emojis) else ""
            if emoji.strip():
                png = scenes_mod.emoji_png(emoji, 170, workdir / f"emoji_{i}.png")
                if png is not None:
                    overlays.append((png, start + 0.10, start + dur - 0.08))
            start += dur

    events: list[tuple[Path, float, float]] = []
    if sfx_dir is not None:
        try:
            from . import sfx as sfx_mod
            bank = sfx_mod.ensure(sfx_dir)
            cuts = []
            acc = 0.0
            for d in durs[:-1]:
                acc += d
                cuts.append(acc)
            events = sfx_mod.story_events(cuts, [t0 for _, t0, _ in overlays], bank)
        except Exception:
            events = []  # sound is enhancement, never a render blocker

    if motions and len(motions) == len(scene_files):
        scene_specs = [(f, d, m[0], m[1]) for f, d, m in zip(scene_files, durs, motions)]
    else:
        scene_specs = list(zip(scene_files, durs))
    cmd = build_story_command(scene_specs, voice_wav, ass_path,
                              out_mp4, theme, total, emoji_overlays=overlays,
                              sfx_events=events)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{proc.stderr[-2000:]}")
    if not out_mp4.exists() or out_mp4.stat().st_size < 10_000:
        raise RuntimeError("render produced no/empty output")
    return out_mp4, ffprobe_duration(out_mp4)


def render(voice_wav: Path, words: list[Word], out_mp4: Path, *, theme: dict,
           seed: int, workdir: Path | None = None,
           hook_text: str | None = None, hook_seconds: float | None = None) -> tuple[Path, float]:
    """Render the final short. Returns (path, duration_seconds).

    hook_text/hook_seconds put the hook on screen as a card from frame 0 until
    the spoken hook ends (hook_seconds, unshifted voice timeline).
    """
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found — install it (brew install ffmpeg / apt install ffmpeg)")
    out_mp4 = Path(out_mp4)
    workdir = Path(workdir) if workdir else out_mp4.parent
    workdir.mkdir(parents=True, exist_ok=True)

    shifted = [Word(w.text, w.start + LEAD_IN, w.end + LEAD_IN) for w in words]
    ass_path = workdir / (out_mp4.stem + ".ass")
    hook_until = (hook_seconds + LEAD_IN) if hook_seconds else None
    captions.build_ass(shifted, ass_path, accent=theme["accent"],
                       hook_text=hook_text, hook_until=hook_until)

    duration = (shifted[-1].end if shifted else LEAD_IN + 1.0) + TAIL
    cmd = build_command(voice_wav, ass_path, out_mp4, theme, duration, seed)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{proc.stderr[-2000:]}")
    if not out_mp4.exists() or out_mp4.stat().st_size < 10_000:
        raise RuntimeError("render produced no/empty output")
    return out_mp4, ffprobe_duration(out_mp4)
