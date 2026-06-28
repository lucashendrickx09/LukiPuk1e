"""Automated YouTube -> Short-Form Clipper.

Pipeline package. Modules are named/grouped by build phase so the flow is
easy to follow:

    Phase 0  config.py   -> configuration + .env loading
             ledger.py   -> SQLite ledger (sources/videos/clips/posts)
             deps.py     -> external binary verification (ffmpeg, yt-dlp, ...)

Later phases (ingest, transcribe, analyze, render, publish, approve) plug in
as additional modules without changing the Phase 0 foundation.
"""

__version__ = "0.1.0"  # Phase 0
