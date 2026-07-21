@echo off
REM Optional: install the offline Kokoro voice (higher quality, needs ~200MB PyTorch).
REM Double-click, or run from a terminal. edge-tts from setup already works without this.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-local-voice.ps1"
echo.
pause
