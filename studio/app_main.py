"""Desktop app entry point: launch Mission Control and open it in the browser.

This is what the bundled Windows app runs. Everything the pipeline needs
(Python, ffmpeg, the voice engine, the web UI) is packed into the app; the only
thing the user provides is their Anthropic API key, entered inside the app on
first launch. See shortsstudio.spec for the PyInstaller packaging.

Run from source the same way:  python app_main.py
"""

from __future__ import annotations

import socket
import sys
import threading
import time
import webbrowser


def _selftest() -> int:
    """Render a sample video end-to-end (no network, no API key) to prove the
    bundle is complete: scenes, fonts, emoji, captions, ffmpeg. Used by CI and
    runnable as `ShortsStudio --selftest`."""
    from app import config, ledger as ledger_mod, pipeline, runtime
    runtime.ensure_ffmpeg_on_path()
    cfg = config.load_config()
    led = ledger_mod.Ledger(cfg.ledger_path)
    try:
        out = pipeline.sample_video(cfg, led, cfg.channels[0])
    finally:
        led.close()
    ok = out.exists() and out.stat().st_size > 10_000
    print(f"SELFTEST {'OK' if ok else 'FAILED'}: {out} "
          f"({out.stat().st_size if out.exists() else 0} bytes)")
    return 0 if ok else 1


def _free_port(preferred: int = 8787) -> int:
    """First open port, preferring the familiar one; 0 lets the OS choose."""
    for p in (preferred, 8788, 8799, 0):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", p))
            return s.getsockname()[1]
        except OSError:
            continue
        finally:
            s.close()
    return preferred


def main() -> None:
    from app import config, ledger as ledger_mod, runtime, webapp

    runtime.ensure_ffmpeg_on_path()          # use the bundled ffmpeg if present
    cfg = config.load_config()
    port = _free_port()
    url = f"http://127.0.0.1:{port}"

    server = webapp.serve(cfg, lambda: ledger_mod.Ledger(cfg.ledger_path),
                          host="127.0.0.1", port=port)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    bar = "=" * 56
    print(bar)
    print("  Shorts Studio is running.")
    print(f"  Open the dashboard:  {url}")
    print("  (it should open in your browser automatically)")
    print()
    print("  Keep this window open while you work.")
    print("  Close this window to quit the app.")
    print(bar)

    try:
        webbrowser.open(url)
    except Exception:
        pass

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down…")
        server.shutdown()


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(_selftest())
    main()
