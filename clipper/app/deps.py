"""External binary verification (Hard Rule 5: free/self-hostable by default).

On startup we confirm the tools the pipeline shells out to are present and
print a clear, copy-pasteable setup checklist for anything missing. We do NOT
auto-install anything.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass

from .config import Config


@dataclass
class BinCheck:
    name: str
    found: bool
    path: str | None
    version: str | None
    needed_for: str
    install_ubuntu: str
    install_macos: str
    required: bool = True


def _version(cmd: list[str]) -> str | None:
    try:
        out = subprocess.run(
            cmd, capture_output=True, text=True, timeout=10
        )
        line = (out.stdout or out.stderr).strip().splitlines()
        return line[0] if line else None
    except Exception:
        return None


def _check(
    name: str,
    needed_for: str,
    install_ubuntu: str,
    install_macos: str,
    version_cmd: list[str] | None = None,
    required: bool = True,
) -> BinCheck:
    path = shutil.which(name)
    version = _version(version_cmd or [name, "--version"]) if path else None
    return BinCheck(
        name=name,
        found=path is not None,
        path=path,
        version=version,
        needed_for=needed_for,
        install_ubuntu=install_ubuntu,
        install_macos=install_macos,
        required=required,
    )


def check_binaries(cfg: Config | None = None) -> list[BinCheck]:
    """Return the status of every external binary the pipeline relies on."""
    checks: list[BinCheck] = [
        _check(
            "ffmpeg",
            needed_for="Phase 4 — cut/reframe/caption/encode",
            install_ubuntu="sudo apt-get install -y ffmpeg",
            install_macos="brew install ffmpeg",
        ),
        _check(
            "ffprobe",
            needed_for="Phase 1/4 — media probing",
            install_ubuntu="sudo apt-get install -y ffmpeg",
            install_macos="brew install ffmpeg",
        ),
        _check(
            "yt-dlp",
            needed_for="Phase 1 — download videos / poll channels",
            install_ubuntu="python3 -m pip install -U yt-dlp",
            install_macos="brew install yt-dlp  # or: pip install -U yt-dlp",
        ),
    ]

    # whisper.cpp binary name is configurable (whisper-cli / main / whisper).
    engine = (cfg.get("transcription", "engine", default="whisper.cpp") if cfg else "whisper.cpp")
    if engine == "whisper.cpp":
        wbin = cfg.get("transcription", "whisper_cpp_bin", default="whisper-cli") if cfg else "whisper-cli"
        checks.append(
            _check(
                wbin,
                needed_for="Phase 2 — transcription (word-level timestamps)",
                install_ubuntu=(
                    "git clone https://github.com/ggerganov/whisper.cpp && "
                    "cd whisper.cpp && cmake -B build && cmake --build build -j && "
                    "sh ./models/download-ggml-model.sh base.en"
                ),
                install_macos=(
                    "git clone https://github.com/ggerganov/whisper.cpp && "
                    "cd whisper.cpp && cmake -B build && cmake --build build -j && "
                    "sh ./models/download-ggml-model.sh base.en"
                ),
                version_cmd=[wbin, "--help"],
            )
        )
    else:  # faster-whisper is a python package, not a binary.
        checks.append(
            BinCheck(
                name="faster-whisper (python)",
                found=_module_present("faster_whisper"),
                path=None,
                version=None,
                needed_for="Phase 2 — transcription fallback",
                install_ubuntu="python3 -m pip install faster-whisper",
                install_macos="python3 -m pip install faster-whisper",
            )
        )

    return checks


def _module_present(mod: str) -> bool:
    import importlib.util

    return importlib.util.find_spec(mod) is not None


def all_required_present(checks: list[BinCheck]) -> bool:
    return all(c.found for c in checks if c.required)
