"""Per-video working paths.

Everything a run produces lives under work/<video_id>/ so intermediates are
inspectable and each stage can resume by checking whether its output exists.

    work/<video_id>/
        script.json        (script stage)
        voice.wav          (tts stage)      24kHz mono
        align.json         (align stage)    word-level timings
        scenes/            (visuals stage)  00.png, 01.mp4, ...
        scenes.json        (visuals stage)  per-scene manifest + timings
        captions.ass       (assemble stage) generated karaoke subtitles
        filtergraph.txt    (assemble stage) the exact -filter_complex_script
        ffmpeg.log         (assemble stage) ffmpeg stderr
        final.mp4          (assemble stage) the deliverable
        upload.json        (upload stage)   {"youtube_id": ...}
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class VideoPaths:
    work_root: Path
    video_id: str

    # -- directories ------------------------------------------------------
    @property
    def dir(self) -> Path:
        return self.work_root / self.video_id

    @property
    def scenes_dir(self) -> Path:
        return self.dir / "scenes"

    # -- stage outputs ----------------------------------------------------
    @property
    def script_json(self) -> Path:
        return self.dir / "script.json"

    @property
    def voice_wav(self) -> Path:
        return self.dir / "voice.wav"

    @property
    def align_json(self) -> Path:
        return self.dir / "align.json"

    @property
    def scenes_json(self) -> Path:
        return self.dir / "scenes.json"

    @property
    def captions_ass(self) -> Path:
        return self.dir / "captions.ass"

    @property
    def filtergraph(self) -> Path:
        return self.dir / "filtergraph.txt"

    @property
    def ffmpeg_log(self) -> Path:
        return self.dir / "ffmpeg.log"

    @property
    def final_mp4(self) -> Path:
        return self.dir / "final.mp4"

    @property
    def upload_json(self) -> Path:
        return self.dir / "upload.json"

    def scene_asset(self, index: int, ext: str) -> Path:
        ext = ext.lstrip(".")
        return self.scenes_dir / f"{index:02d}.{ext}"

    # -- helpers ----------------------------------------------------------
    def ensure(self) -> "VideoPaths":
        self.dir.mkdir(parents=True, exist_ok=True)
        self.scenes_dir.mkdir(parents=True, exist_ok=True)
        return self
