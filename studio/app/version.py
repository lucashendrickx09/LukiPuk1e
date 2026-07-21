"""Build identity + self-update helpers.

The build version is the git commit the app was built from. CI writes a VERSION
file into the bundle and stamps the same commit into the app-latest release body
(`build: <sha>`), so a running app can tell whether a newer build exists.

Running from source (no VERSION file) reports "dev" and never offers updates.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

from . import runtime

REPO = "lucashendrickx09/LukiPuk1e"
RELEASE_API = f"https://api.github.com/repos/{REPO}/releases/tags/app-latest"


def current() -> str:
    try:
        v = (runtime.resource_root() / "VERSION").read_text().strip()
        return v or "dev"
    except Exception:
        return "dev"


def _fetch_release() -> dict:
    req = urllib.request.Request(
        RELEASE_API,
        headers={"User-Agent": "ShortsStudio", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=12) as r:
        return json.loads(r.read())


def check() -> dict:
    """Compare this build against the latest release. Never raises."""
    cur = current()
    info = {"current": cur, "latest": cur, "update_available": False, "download_url": ""}
    if cur == "dev":
        return info  # source/dev build: updates don't apply
    try:
        rel = _fetch_release()
        latest = ""
        for line in (rel.get("body") or "").splitlines():
            if line.lower().startswith("build:"):
                latest = line.split(":", 1)[1].strip()
        exe = next((a["browser_download_url"] for a in rel.get("assets", [])
                    if a.get("name", "").lower().endswith(".exe")), "")
        info.update(latest=latest or cur, download_url=exe,
                    update_available=bool(latest and exe and latest != cur))
    except Exception:
        pass
    return info


def apply(download_url: str) -> None:
    """Download the new exe next to the current one, then hand off to a helper
    batch that waits for us to exit, swaps the files, and relaunches. Windows
    can't overwrite a running exe, hence the batch. Only meaningful when frozen."""
    if not runtime.is_frozen() or os.name != "nt" or not download_url:
        raise RuntimeError("updates apply only to the installed Windows app")
    exe = Path(sys.executable)
    new_exe = exe.with_name(exe.stem + "-new.exe")
    urllib.request.urlretrieve(download_url, new_exe)
    if new_exe.stat().st_size < 1_000_000:
        new_exe.unlink(missing_ok=True)
        raise RuntimeError("downloaded file looks incomplete")
    bat = exe.with_name("_update.bat")
    bat.write_text(
        "@echo off\r\n"
        "timeout /t 2 /nobreak >nul\r\n"
        ":retry\r\n"
        f'move /y "{new_exe}" "{exe}" >nul 2>&1\r\n'
        f'if exist "{new_exe}" ( timeout /t 1 /nobreak >nul & goto retry )\r\n'
        f'start "" "{exe}"\r\n'
        'del "%~f0"\r\n')
    subprocess.Popen(["cmd", "/c", str(bat)],
                     creationflags=0x00000008 | 0x00000200)  # DETACHED | NEW_GROUP
    # give the HTTP response a moment to flush, then exit so the swap can happen
    threading.Thread(target=lambda: (time.sleep(1.0), os._exit(0)), daemon=True).start()
