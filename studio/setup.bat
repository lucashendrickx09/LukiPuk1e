@echo off
REM Friendly Windows entry point — double-click or run from a terminal.
REM Bypasses PowerShell's execution policy just for this one script.
REM   setup.bat            core + local voice
REM   setup.bat --lite     core only (skips the torch/Kokoro download)
setlocal
cd /d "%~dp0"

set LITE=
if /I "%~1"=="--lite" set LITE=-Lite
if /I "%~1"=="-lite"  set LITE=-Lite

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %LITE%
echo.
pause
