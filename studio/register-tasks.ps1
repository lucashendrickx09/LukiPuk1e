# Register the Shorts Studio daily automation in Windows Task Scheduler.
# This is the Windows equivalent of the cron jobs in LAUNCH.md.
# Run once, from the studio/ directory, after setup.ps1 has created .venv:
#   .\register-tasks.ps1
# Remove them later with:
#   .\register-tasks.ps1 -Remove
#
# Two tasks are created (they only fire while the PC is on/awake; a missed run
# fires when the machine next wakes, thanks to StartWhenAvailable):
#   ShortsStudio-Run      09:30 daily  -> research/script/voice/render/learn
#   ShortsStudio-Publish  13:00, 20:00 -> push approved videos into peak slots
param([switch]$Remove)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Note: if this fails with 'Access is denied', re-run in an Administrator PowerShell" -ForegroundColor Yellow
    Write-Host "      (Start menu > type 'powershell' > right-click > Run as administrator)." -ForegroundColor Yellow
}

$runName = "ShortsStudio-Run"
$pubName = "ShortsStudio-Publish"

foreach ($n in @($runName, $pubName)) {
    if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $n -Confirm:$false
        Write-Host "removed existing task: $n"
    }
}
if ($Remove) { Write-Host "Done - automation removed."; exit 0 }

$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host "!! .venv not found - run setup.ps1 (or setup.bat) first." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path "data")) { New-Item -ItemType Directory -Path "data" | Out-Null }

# run cmd.exe so we can redirect output to a rolling log the same way cron does.
# The whole command is wrapped in an OUTER pair of quotes: cmd /c strips exactly
# that outer pair, leaving the (separately quoted) exe path and log path intact -
# without the wrapper, cmd mangles paths that contain spaces.
function New-StudioAction([string]$sub) {
    $inner = "`"$venvPy`" run.py $sub >> `"$PSScriptRoot\data\run.log`" 2>&1"
    $arg = "/c `"$inner`""
    New-ScheduledTaskAction -Execute "cmd.exe" -Argument $arg -WorkingDirectory $PSScriptRoot
}

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -DontStopOnIdleEnd -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $runName -Description "Shorts Studio daily loop" `
    -Action (New-StudioAction "run") `
    -Trigger (New-ScheduledTaskTrigger -Daily -At "9:30AM") `
    -Settings $settings | Out-Null
Write-Host "registered: $runName  (daily 09:30)"

Register-ScheduledTask -TaskName $pubName -Description "Shorts Studio publish sweep" `
    -Action (New-StudioAction "publish") `
    -Trigger @(
        (New-ScheduledTaskTrigger -Daily -At "1:00PM"),
        (New-ScheduledTaskTrigger -Daily -At "8:00PM")
    ) `
    -Settings $settings | Out-Null
Write-Host "registered: $pubName  (daily 13:00 + 20:00)"

Write-Host ""
Write-Host "Automation is live. Your only daily touch is:  python run.py review"
Write-Host "Logs: data\run.log   |   Manage: Task Scheduler > Task Scheduler Library"
Write-Host "Note: the PC must be on and awake at those times (or it catches up on wake)."
