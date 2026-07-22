"""Faceless YouTube Shorts pipeline.

Stages, in order (see run.py):

    script  -> pop next unused script from scripts.json / state.db
    tts     -> Kokoro-82M narration -> voice.wav (24kHz mono)
    align   -> faster-whisper large-v3 -> word-level timings (align.json)
    visuals -> per scene: card | stock | generated -> scenes/ + scenes.json
    assemble-> ffmpeg: timed scenes, Ken Burns, ASS karaoke, music, SFX -> mp4
    upload  -> YouTube Data API v3 resumable upload

Every stage writes into work/<video_id>/ so intermediates are inspectable,
and every stage is skipped when its primary output already exists.
"""

__all__ = [
    "config",
    "paths",
    "state",
]
