"""Automated YouTube -> Short-Form Clipper.

Pipeline package. Modules are named/grouped by build phase so the flow is
easy to follow:

    Phase 0  config.py   -> configuration + .env loading
             ledger.py   -> SQLite ledger (sources/videos/clips/posts)
             deps.py     -> external binary verification (ffmpeg, yt-dlp, ...)

Later phases plug in as additional modules without changing the Phase 0
foundation:

    Phase 1  ytdlp.py / ingest.py   Phase 4  render.py
    Phase 2  transcribe.py          Phase 5  publish.py
    Phase 3  analyze.py             Phase 6  approve.py
                                    Phase 7  pipeline.py (run loop)
"""

__version__ = "1.0.0"  # all phases complete
