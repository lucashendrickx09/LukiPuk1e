# One-command setup for Shorts Studio on Windows (PowerShell).
# Run from the studio/ directory:
#   .\setup.ps1            # core + local voice (recommended)
#   .\setup.ps1 -Lite      # core only (mock/edge voice; skips torch download)
#
# If PowerShell blocks the script, run it through the bundled launcher instead:
#   setup.bat
param([switch]$Lite)

$ErrorActionPreference = "Stop"
# On PowerShell 7.4+ a non-zero exit from a native command (e.g. `run.py doctor`,
# which exits 1 until YouTube auth is set up) would otherwise abort the script.
# We handle those exits explicitly, so opt out of that behavior where it exists.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}
Set-Location -Path $PSScriptRoot

# Refresh PATH from the registry so tools you just installed via winget in THIS
# same window (python/ffmpeg/git) are found without reopening the terminal.
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

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

Write-Host "==> installing core dependencies (progress shows below)"
& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install -r requirements.txt

if (-not $Lite) {
    Write-Host "==> installing local voice (Kokoro TTS)" -ForegroundColor Cyan
    Write-Host "    This downloads PyTorch. We install the CPU build (~200MB) on purpose —"
    Write-Host "    the default Windows wheel is the ~2.5GB CUDA build we don't need."
    Write-Host "    A few minutes with a slow-moving bar is normal. Let it run."
    try {
        # CPU-only torch first, so kokoro's torch dependency is already satisfied and
        # pip never pulls the giant CUDA wheel. We render/voice on CPU either way.
        & $venvPy -m pip install torch --index-url https://download.pytorch.org/whl/cpu
        & $venvPy -m pip install -r requirements-voice.txt
    } catch {
        Write-Host "!! voice install failed — retry later with:  .venv\Scripts\python -m pip install -r requirements-voice.txt" -ForegroundColor Yellow
    }
}

# --- .env + API key (no Notepad needed) -----------------------------------
$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Copy-Item ".env.example" $envPath
    Write-Host "==> created .env"
}
# does .env already hold a real key, or just the placeholder?
$keyLine = (Get-Content $envPath | Where-Object { $_ -match '^\s*ANTHROPIC_API_KEY\s*=' } | Select-Object -First 1)
$keyVal = if ($keyLine) { ($keyLine -replace '^\s*ANTHROPIC_API_KEY\s*=\s*', '').Trim() } else { "" }
if ((-not $keyVal) -or ($keyVal -eq 'sk-ant-...')) {
    Write-Host ""
    Write-Host "Paste your Anthropic API key (input is hidden). Get one at console.anthropic.com > API keys." -ForegroundColor Cyan
    Write-Host "You can press Enter to skip and add it to .env later." -ForegroundColor DarkGray
    $secure = Read-Host "ANTHROPIC_API_KEY" -AsSecureString
    $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
    if ($key) {
        $content = Get-Content $envPath
        if ($content -match '^\s*ANTHROPIC_API_KEY\s*=') {
            $content = $content -replace '^\s*ANTHROPIC_API_KEY\s*=.*', "ANTHROPIC_API_KEY=$key"
        } else {
            $content += "ANTHROPIC_API_KEY=$key"
        }
        Set-Content -Path $envPath -Value $content -Encoding ascii  # no BOM; key is ASCII
        Write-Host "==> saved your key to .env (this file is gitignored — it never gets committed)" -ForegroundColor Green
    } else {
        Write-Host "==> no key entered — edit .env and set ANTHROPIC_API_KEY before running research/produce" -ForegroundColor Yellow
    }
}
if (-not (Test-Path "secrets")) { New-Item -ItemType Directory -Path "secrets" | Out-Null }

Write-Host ""
& $venvPy run.py doctor
Write-Host ""

# --- offer a first render -------------------------------------------------
$ans = Read-Host "Render a free style-preview video now? (y/N)"
if ($ans -match '^(y|yes)$') {
    & $venvPy run.py sample
    Write-Host "Done — open the studio\data\renders\ folder to watch it." -ForegroundColor Green
}

Write-Host ""
Write-Host "Next: read LAUNCH.md (the Windows track) — the step-by-step launch runbook."
Write-Host "Tip: activate the venv in new windows with:  .venv\Scripts\Activate.ps1"
