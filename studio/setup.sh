#!/usr/bin/env bash
# One-command setup for Shorts Studio. Run from the studio/ directory:
#   bash setup.sh          # core + local voice (recommended)
#   bash setup.sh --lite   # core only (mock/edge voice; skips torch download)
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Shorts Studio setup"

if ! command -v python3 >/dev/null; then
  echo "python3 not found — install Python 3.10+ first"; exit 1
fi
if ! command -v ffmpeg >/dev/null; then
  echo "!! ffmpeg not found."
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "   Install it:  brew install ffmpeg     (https://brew.sh if you don't have brew)"
  else
    echo "   Install it:  sudo apt install ffmpeg fonts-noto-color-emoji"
  fi
  echo "   Then re-run: bash setup.sh"
  exit 1
fi

if [[ ! -d .venv ]]; then
  echo "==> creating virtualenv (.venv)"
  python3 -m venv .venv
fi
source .venv/bin/activate

echo "==> installing core dependencies"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

if [[ "${1:-}" != "--lite" ]]; then
  echo "==> installing local voice (Kokoro TTS — first run also downloads ~330MB of model weights)"
  pip install --quiet -r requirements-voice.txt || {
    echo "!! voice install failed — you can retry later with: pip install -r requirements-voice.txt"
  }
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "==> created .env — EDIT IT and add your ANTHROPIC_API_KEY"
fi
mkdir -p secrets

echo
python run.py doctor || true
echo
echo "Next: read LAUNCH.md — it is the step-by-step launch runbook."
