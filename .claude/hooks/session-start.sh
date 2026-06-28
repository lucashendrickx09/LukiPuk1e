#!/bin/bash
# SessionStart hook — install the Python deps needed to run the clipper test
# suite (and the `python run.py doctor`/`run` CLI) in Claude Code on the web.
#
# The test suite is pure-stdlib unittest with fakes; the only hard import at
# module load is PyYAML (config). python-dotenv makes .env loading complete.
# Heavier deps (ffmpeg, opencv-python, faster-whisper, anthropic, yt-dlp) are
# lazily imported and only needed to actually run the media pipeline, not tests.
set -euo pipefail

# Only run in the remote (web) environment; local dev already has its deps.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "[session-start] installing clipper test dependencies…"

deps="PyYAML python-dotenv"
# Some base images mark the system Python as externally managed (PEP 668);
# fall back to --break-system-packages if a plain install is refused.
if ! python3 -m pip install --quiet --disable-pip-version-check $deps 2>/dev/null; then
  python3 -m pip install --quiet --disable-pip-version-check --break-system-packages $deps
fi

echo "[session-start] done."
