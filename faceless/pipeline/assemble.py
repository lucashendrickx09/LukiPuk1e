"""Stage: assemble -> work/<id>/final.mp4

Combines the intermediates from the earlier stages into the finished vertical
video with a single ffmpeg invocation:

  * scenes are shown for durations timed to the narration audio
  * still scenes (card / generated) get a smooth Ken Burns zoompan
  * video scenes (stock) are scaled/cropped/looped to fill their slot
  * ASS karaoke captions (from align.json) are burned in
  * a music bed is looped and ducked to `audio.music_db`
  * a whoosh SFX fires on every cut between scenes
  * output is 1080x1920 H.264 + AAC, +faststart

This module was built FIRST, against dummy assets, so the ffmpeg pipeline is
correct before the upstream stages exist. Its input contract:

  voice.wav      narration (any sample rate/mono)
  scenes.json    {"scenes":[{index,type,asset,start,end,duration,still,...}],
                  "total_duration": float}
  align.json     {"words":[{word,start,end}, ...]}   (optional; for captions)

Run standalone:  python -m pipeline.assemble <video_id> [--force]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Optional

from . import ffutil
from .captions import write_ass
from .config import Config, load_config
from .paths import VideoPaths

_AUDIO_EXTS = (".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".opus")


# --------------------------------------------------------------------------
# asset selection helpers
# --------------------------------------------------------------------------
def _first_media(dir_path: Path, exts=_AUDIO_EXTS) -> Optional[Path]:
    if not dir_path.is_dir():
        return None
    for p in sorted(dir_path.iterdir()):
        if p.suffix.lower() in exts:
            return p
    return None


def pick_music(cfg: Config) -> Optional[Path]:
    name = cfg.get("audio.music_file", "")
    if name:
        p = cfg.resolve("audio.music_dir") / name
        return p if p.exists() else None
    return _first_media(cfg.resolve("audio.music_dir"))


def pick_whoosh(cfg: Config) -> Optional[Path]:
    name = cfg.get("audio.whoosh_file", "")
    if name:
        p = cfg.resolve("audio.sfx_dir") / name
        return p if p.exists() else None
    return _first_media(cfg.resolve("audio.sfx_dir"))


# --------------------------------------------------------------------------
# filtergraph construction
# --------------------------------------------------------------------------
def _escape_filter_path(path: str) -> str:
    """Escape a path for use *inside* a filter argument (e.g. ass=...)."""
    return path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def _zoom_expr(direction: str, frames: int, zoom_max: float) -> str:
    """Linear zoom over `frames` output frames, using zoompan's `on`."""
    denom = max(1, frames - 1)
    if direction == "out":
        return f"'{zoom_max}-({zoom_max}-1)*on/{denom}'"
    # default / "in"
    return f"'1+({zoom_max}-1)*on/{denom}'"


def _scene_direction(cfg: Config, index: int) -> str:
    d = cfg.get("kenburns.direction", "alternate")
    if d == "alternate":
        return "in" if index % 2 == 0 else "out"
    return d


def build_filtergraph(
    cfg: Config,
    scenes: list[dict],
    total: float,
    ass_path: Optional[Path],
    music: Optional[Path],
    whoosh: Optional[Path],
) -> tuple[list[str], str, list[str]]:
    """Return (ffmpeg_input_args, filter_complex_text, map_args)."""
    W = int(cfg["video.width"])
    H = int(cfg["video.height"])
    fps = int(cfg["video.fps"])
    pix = cfg.get("video.pixel_format", "yuv420p")
    kb_on = bool(cfg.get("kenburns.enabled", True))
    sf = float(cfg.get("kenburns.scale_factor", 2.0))
    zoom_max = float(cfg.get("kenburns.zoom_max", 1.15))
    CW, CH = int(W * sf), int(H * sf)

    inputs: list[str] = []          # ffmpeg -i argument groups
    chains: list[str] = []          # filter_complex chains
    video_labels: list[str] = []

    # Input 0 is always voice.wav (added by the caller); scene/music/whoosh
    # inputs are numbered from 1 upward as we append them.
    next_idx = 1

    # ---- video: one input + one chain per scene ----
    for scene in scenes:
        idx = next_idx
        next_idx += 1
        asset = str(scene["asset"])
        dur = float(scene.get("duration", scene["end"] - scene["start"]))
        frames = max(1, round(dur * fps))
        still = bool(scene.get("still", scene.get("type") in ("card", "generated")))
        label = f"v{len(video_labels)}"

        if still and kb_on:
            # Single frame in; zoompan generates the whole clip.
            inputs += ["-i", asset]
            zexpr = _zoom_expr(_scene_direction(cfg, len(video_labels)),
                               frames, zoom_max)
            chains.append(
                f"[{idx}:v]"
                f"scale={CW}:{CH}:force_original_aspect_ratio=increase,"
                f"crop={CW}:{CH},"
                f"zoompan=z={zexpr}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                f"d={frames}:s={W}x{H}:fps={fps},"
                f"trim=duration={dur:.3f},setpts=PTS-STARTPTS,"
                f"fps={fps},format={pix},setsar=1[{label}]"
            )
        elif still:
            # Ken Burns disabled: hold the still for the scene duration.
            inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", asset]
            chains.append(
                f"[{idx}:v]"
                f"scale={W}:{H}:force_original_aspect_ratio=increase,"
                f"crop={W}:{H},"
                f"trim=duration={dur:.3f},setpts=PTS-STARTPTS,"
                f"fps={fps},format={pix},setsar=1[{label}]"
            )
        else:
            # Video (stock): loop to guarantee length, scale/crop, trim.
            inputs += ["-stream_loop", "-1", "-i", asset]
            chains.append(
                f"[{idx}:v]"
                f"scale={W}:{H}:force_original_aspect_ratio=increase,"
                f"crop={W}:{H},"
                f"trim=duration={dur:.3f},setpts=PTS-STARTPTS,"
                f"fps={fps},format={pix},setsar=1[{label}]"
            )
        video_labels.append(label)

    # ---- concat all scene clips ----
    concat_in = "".join(f"[{l}]" for l in video_labels)
    n = len(video_labels)
    chains.append(f"{concat_in}concat=n={n}:v=1:a=0[vcat]")

    # ---- burn captions ----
    # Reference the caption file by basename; ffmpeg runs with cwd=video dir
    # so libass finds it without needing an absolute (Windows-escaped) path.
    if ass_path is not None:
        esc = _escape_filter_path(ass_path.name)
        chains.append(f"[vcat]ass=filename='{esc}'[vout]")
    else:
        chains.append("[vcat]null[vout]")

    # ---- audio: voice is always input 0 ----
    voice_idx = 0
    out_sr = int(cfg.get("audio.out_sample_rate", 48000))

    music_idx = None
    if music is not None:
        music_idx = next_idx
        next_idx += 1
        inputs += ["-stream_loop", "-1", "-i", str(music)]

    whoosh_idx = None
    cuts = [float(s["start"]) for s in scenes[1:]]  # interior cuts
    if whoosh is not None and cuts:
        whoosh_idx = next_idx
        next_idx += 1
        inputs += ["-i", str(whoosh)]

    audio_labels: list[str] = []

    # narration
    chains.append(f"[{voice_idx}:a]aresample={out_sr},apad[narr]")
    audio_labels.append("narr")

    # music bed
    if music_idx is not None:
        music_db = float(cfg.get("audio.music_db", -20.0))
        fade = float(cfg.get("audio.music_fade", 1.0))
        fade_out_start = max(0.0, total - fade)
        chains.append(
            f"[{music_idx}:a]aresample={out_sr},"
            f"atrim=0:{total:.3f},asetpts=N/SR/TB,"
            f"volume={music_db}dB,"
            f"afade=t=in:st=0:d={fade:.3f},"
            f"afade=t=out:st={fade_out_start:.3f}:d={fade:.3f}[music]"
        )
        audio_labels.append("music")

    # whoosh on each cut
    if whoosh_idx is not None:
        k = len(cuts)
        whoosh_db = float(cfg.get("audio.whoosh_db", -8.0))
        splits = "".join(f"[w{i}]" for i in range(k))
        chains.append(f"[{whoosh_idx}:a]aresample={out_sr},asplit={k}{splits}")
        for i, t in enumerate(cuts):
            ms = int(round(t * 1000))
            chains.append(
                f"[w{i}]adelay={ms}:all=1,volume={whoosh_db}dB[wd{i}]"
            )
            audio_labels.append(f"wd{i}")

    # mix everything (or pass narration straight through)
    if len(audio_labels) == 1:
        chains.append(f"[narr]atrim=0:{total:.3f},aresample={out_sr}[aout]")
    else:
        mix_in = "".join(f"[{l}]" for l in audio_labels)
        chains.append(
            f"{mix_in}amix=inputs={len(audio_labels)}:normalize=0:"
            f"duration=first:dropout_transition=0,"
            f"atrim=0:{total:.3f},aresample={out_sr}[aout]"
        )

    filter_text = ";\n".join(chains)
    maps = ["-map", "[vout]", "-map", "[aout]"]
    return inputs, filter_text, maps


def _encoder_args(cfg: Config) -> list[str]:
    enc = cfg.get("video.encoder", "libx264")
    pix = cfg.get("video.pixel_format", "yuv420p")
    if enc == "h264_nvenc":
        return [
            "-c:v", "h264_nvenc",
            "-preset", str(cfg.get("video.preset", "p5")),
            "-rc", "vbr", "-cq", str(cfg.get("video.nvenc_cq", 21)),
            "-b:v", "0", "-profile:v", "high", "-pix_fmt", pix,
        ]
    return [
        "-c:v", "libx264",
        "-preset", str(cfg.get("video.preset", "medium")),
        "-crf", str(cfg.get("video.crf", 19)),
        "-profile:v", "high", "-pix_fmt", pix,
    ]


# --------------------------------------------------------------------------
# stage entry point
# --------------------------------------------------------------------------
def assemble(
    video_id: str,
    cfg: Optional[Config] = None,
    force: bool = False,
) -> Path:
    cfg = cfg or load_config()
    ffutil.require_binaries()
    vp = VideoPaths(cfg.resolve("paths.work"), video_id)
    out = vp.final_mp4

    if out.exists() and not force:
        print(f"[assemble] {out} exists -> skipping (use --force to rebuild)")
        return out

    if not vp.voice_wav.exists():
        raise FileNotFoundError(f"missing narration: {vp.voice_wav}")
    if not vp.scenes_json.exists():
        raise FileNotFoundError(f"missing scenes manifest: {vp.scenes_json}")

    manifest = json.loads(vp.scenes_json.read_text())
    scenes = manifest["scenes"]
    if not scenes:
        raise ValueError("scenes.json has no scenes")

    # Resolve scene asset paths relative to the video dir.
    for s in scenes:
        ap = Path(s["asset"])
        s["asset"] = str(ap if ap.is_absolute() else (vp.dir / ap))

    total = float(manifest.get("total_duration",
                              sum(float(s.get("duration", s["end"] - s["start"]))
                                  for s in scenes)))

    # captions (optional)
    ass_path: Optional[Path] = None
    if cfg.get("captions.enabled", True) and vp.align_json.exists():
        align = json.loads(vp.align_json.read_text())
        words = align.get("words", [])
        if words:
            ass_path = write_ass(
                vp.captions_ass, words, cfg.as_dict()["captions"],
                int(cfg["video.width"]), int(cfg["video.height"]),
            )
            print(f"[assemble] wrote captions -> {ass_path}")

    music = pick_music(cfg)
    whoosh = pick_whoosh(cfg)
    print(f"[assemble] scenes={len(scenes)} total={total:.2f}s "
          f"music={'yes' if music else 'no'} "
          f"whoosh={'yes' if whoosh else 'no'} "
          f"captions={'yes' if ass_path else 'no'}")

    inputs, filter_text, maps = build_filtergraph(
        cfg, scenes, total, ass_path, music, whoosh
    )

    # Write the filtergraph to a file and feed it via -filter_complex_script:
    # avoids gigantic, fragile command lines and shell escaping.
    vp.filtergraph.write_text(filter_text, encoding="utf-8")

    argv = [ffutil.FFMPEG, "-y", "-hide_banner"]
    argv += ["-i", str(vp.voice_wav)]         # input 0 = narration
    argv += inputs                            # scenes, music, whoosh
    argv += ["-filter_complex_script", str(vp.filtergraph)]
    argv += maps
    argv += _encoder_args(cfg)
    argv += [
        "-c:a", "aac",
        "-b:a", str(cfg.get("audio.out_bitrate", "192k")),
        "-ar", str(cfg.get("audio.out_sample_rate", 48000)),
        "-r", str(cfg["video.fps"]),
        "-movflags", "+faststart",
        str(out),
    ]

    print(f"[assemble] filtergraph -> {vp.filtergraph}")
    # cwd = video dir so the ass filter resolves captions.ass by basename.
    ffutil.run(argv, log_path=vp.ffmpeg_log, cwd=str(vp.dir))

    w, h = ffutil.video_dimensions(out)
    print(f"[assemble] done -> {out}  ({w}x{h}, {ffutil.duration(out):.2f}s)")
    return out


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description="Assemble the final video.")
    ap.add_argument("video_id")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--config", default=None)
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    assemble(args.video_id, cfg=cfg, force=args.force)


if __name__ == "__main__":
    main()
