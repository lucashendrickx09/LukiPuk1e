# Optional upgrade: the offline, local Kokoro voice (higher quality than edge-tts,
# works with no internet at render time). Costs a ~200MB CPU PyTorch download, so
# run this on a stable connection. edge-tts (installed by setup) already gives you
# a working voice, so this is purely an upgrade.
$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}
Set-Location -Path $PSScriptRoot

$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host "!! .venv not found - run setup.bat first." -ForegroundColor Red
    exit 1
}

Write-Host "==> installing Kokoro TTS + CPU PyTorch (~200MB)" -ForegroundColor Cyan
Write-Host "    Large download; a slow-moving bar is normal. If it fails, just re-run this."
# CPU-only torch (not the ~2.5GB CUDA wheel); long timeouts for shaky connections.
& $venvPy -m pip install --timeout 120 --retries 10 torch --index-url https://download.pytorch.org/whl/cpu
& $venvPy -m pip install --timeout 120 --retries 10 -r requirements-voice.txt

Write-Host ""
Write-Host "Done. 'voice: engine: auto' in config.yaml now prefers Kokoro automatically." -ForegroundColor Green
Write-Host "Re-voice existing videos with the local voice:  .venv\Scripts\python run.py revoice"
