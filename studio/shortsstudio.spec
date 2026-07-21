# PyInstaller spec for the Shorts Studio desktop app (one-file).
# Build:  pyinstaller shortsstudio.spec --noconfirm
# CI (build-app.yml) downloads ffmpeg into ./ffmpeg first so it's bundled;
# building from source without that folder is fine (uses system ffmpeg).
import os

from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

datas = [
    ("webui", "webui"),
    ("assets", "assets"),
    ("config.yaml", "."),
]
# bundle ffmpeg/ffprobe if the build placed them here (Windows CI does)
if os.path.isdir("ffmpeg"):
    datas.append(("ffmpeg", "ffmpeg"))

hiddenimports = [
    "edge_tts", "anthropic", "yaml", "zoneinfo",
    "PIL.Image", "PIL.ImageDraw", "PIL.ImageFont", "PIL.ImageFilter", "PIL.ImageEnhance",
]
# google client libs pull a lot of submodules lazily
for pkg in ("googleapiclient", "google_auth_oauthlib", "google.auth", "google.oauth2"):
    try:
        hiddenimports += collect_submodules(pkg)
    except Exception:
        pass

a = Analysis(
    ["app_main.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["torch", "kokoro", "tkinter", "matplotlib", "numpy.f2py"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="ShortsStudio",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,               # a small window that shows status; close it to quit
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="assets/app.ico" if os.path.exists("assets/app.ico") else None,
)
