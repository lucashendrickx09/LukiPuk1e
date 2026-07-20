# One-command setup for Shorts Studio on Windows (PowerShell).
# Run from the studio/ directory:
#   .\setup.ps1            # core + local voice (recommended)
#   .\setup.ps1 -Lite      # core only (mock/edge voice; skips torch download)
#
# If PowerShell blocks the script, run it through the bundled launcher instead:
#   setup.bat
param([switch]$Lite)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> Shorts Studio setup (Windows)" -ForegroundColor Green

# --- Python ---------------------------------------------------------------
$py = $null
foreach ($cand in @("py", "python", "python3")) {
    if (Get-Command $cand -ErrorAction SilentlyContinue) { $py = $cand; break }
}
if (-not $py) {
    Write-Host "python not found — install Python 3.10+ first:" -ForegroundColor Red
    Write-Host "   winget install Python.Python.3.12"
    Write-Host "   (tick 'Add python.exe to PATH' if you use the installer), then re-run setup.bat"
    exit 1
}

# --- ffmpeg ---------------------------------------------------------------
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "!! ffmpeg not found." -ForegroundColor Yellow
    Write-Host "   Install it:  winget install Gyan.FFmpeg"
    Write-Host "   Then CLOSE and REOPEN this window (so PATH refreshes) and re-run setup.bat"
    exit 1
}

# --- virtualenv -----------------------------------------------------------
if (-not (Test-Path ".venv")) {
    Write-Host "==> creating virtualenv (.venv)"
    & $py -m venv .venv
}
$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host "!! venv python missing at $venvPy" -ForegroundColor Red
    exit 1
}

Write-Host "==> installing core dependencies"
& $venvPy -m pip install --quiet --upgrade pip
& $venvPy -m pip install --quiet -r requirements.txt

if (-not $Lite) {
    Write-Host "==> installing local voice (Kokoro TTS — first run also downloads ~330MB of model weights)"
    try {
        & $venvPy -m pip install --quiet -r requirements-voice.txt
    } catch {
        Write-Host "!! voice install failed — retry later with:  .venv\Scripts\python -m pip install -r requirements-voice.txt" -ForegroundColor Yellow
    }
}

# --- .env + secrets -------------------------------------------------------
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "==> created .env — EDIT IT and add your ANTHROPIC_API_KEY" -ForegroundColor Cyan
}
if (-not (Test-Path "secrets")) { New-Item -ItemType Directory -Path "secrets" | Out-Null }

Write-Host ""
& $venvPy run.py doctor
Write-Host ""
Write-Host "Next: read LAUNCH.md (the Windows track) — the step-by-step launch runbook."
Write-Host "Tip: activate the venv in new windows with:  .venv\Scripts\Activate.ps1"
