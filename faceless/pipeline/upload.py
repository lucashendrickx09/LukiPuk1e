"""Stage: upload -> work/<id>/upload.json

Resumable upload of final.mp4 to YouTube via the Data API v3, using an OAuth
desktop client + a cached refresh token. Sets:

  * status.selfDeclaredMadeForKids = false        (per requirements)
  * status.containsSyntheticMedia  = true         (AI visuals + TTS voice)

The synthetic-media disclosure is also appended to the description as a
fallback, since the API status field is not honoured on every channel yet; if
the API rejects the field the upload is retried without it.

Prereqs (all free):
  pip install google-api-python-client google-auth-oauthlib google-auth
  A YouTube Data API v3 OAuth *desktop* client secret (client_secret.json).

Run standalone:  python -m pipeline.upload <video_id> [--force]
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Optional

from .config import Config, load_config
from .paths import VideoPaths
from .state import State

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


# --------------------------------------------------------------------------
# auth
# --------------------------------------------------------------------------
def get_credentials(cfg: Config):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    token_file = cfg.resolve("upload.token_file")
    secrets = cfg.resolve("upload.client_secrets")

    creds = None
    if token_file.exists():
        creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    else:
        if not secrets.exists():
            raise FileNotFoundError(
                f"OAuth client secrets not found: {secrets}. Create an OAuth "
                "desktop client for the YouTube Data API v3 and save it there."
            )
        flow = InstalledAppFlow.from_client_secrets_file(str(secrets), SCOPES)
        # Opens a browser locally; prints a URL if none is available.
        creds = flow.run_local_server(port=0)
    token_file.write_text(creds.to_json())
    print(f"[upload] cached refresh token -> {token_file}")
    return creds


# --------------------------------------------------------------------------
# request body
# --------------------------------------------------------------------------
def build_body(cfg: Config, script: dict, disclose: bool) -> dict:
    title = (script.get("yt_title") or script.get("title") or "")[:100]
    description = script.get("description", "") or ""
    if disclose:
        note = cfg.get("upload.synthetic_disclosure_text", "").strip()
        if note and note.lower() not in description.lower():
            description = (description + "\n\n" + note).strip()

    body = {
        "snippet": {
            "title": title,
            "description": description[:5000],
            "tags": script.get("tags", []) or [],
            "categoryId": str(cfg.get("upload.category_id", "27")),
        },
        "status": {
            "privacyStatus": cfg.get("upload.privacy", "private"),
            "selfDeclaredMadeForKids": bool(
                cfg.get("upload.self_declared_made_for_kids", False)
            ),
        },
    }
    if disclose:
        body["status"]["containsSyntheticMedia"] = True
    return body


# --------------------------------------------------------------------------
# resumable upload
# --------------------------------------------------------------------------
def _do_upload(youtube, body: dict, media_path: Path) -> dict:
    from googleapiclient.http import MediaFileUpload

    media = MediaFileUpload(
        str(media_path), chunksize=8 * 1024 * 1024, resumable=True,
        mimetype="video/*",
    )
    request = youtube.videos().insert(
        part="snippet,status", body=body, media_body=media
    )

    response = None
    retries = 0
    while response is None:
        try:
            status, response = request.next_chunk()
            if status:
                print(f"[upload] {int(status.progress() * 100)}%")
        except Exception as exc:  # transient server/network errors
            code = getattr(getattr(exc, "resp", None), "status", None)
            if code in (500, 502, 503, 504) and retries < 5:
                wait = 2 ** retries
                print(f"[upload] transient error {code}; retrying in {wait}s")
                time.sleep(wait)
                retries += 1
                continue
            raise
    return response


def upload(
    video_id: str,
    cfg: Optional[Config] = None,
    force: bool = False,
) -> Path:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError

    cfg = cfg or load_config()
    vp = VideoPaths(cfg.resolve("paths.work"), video_id).ensure()
    out = vp.upload_json

    if out.exists() and not force:
        print(f"[upload] {out} exists -> skipping")
        return out
    if not vp.final_mp4.exists():
        raise FileNotFoundError(f"missing rendered video: {vp.final_mp4}")
    if not vp.script_json.exists():
        raise FileNotFoundError(f"missing script: {vp.script_json}")

    script = json.loads(vp.script_json.read_text())
    disclose = bool(cfg.get("upload.contains_synthetic_media", True))

    creds = get_credentials(cfg)
    youtube = build("youtube", "v3", credentials=creds)

    body = build_body(cfg, script, disclose)
    print(f"[upload] uploading {vp.final_mp4.name} -> "
          f"privacy={body['status']['privacyStatus']} "
          f"madeForKids={body['status']['selfDeclaredMadeForKids']} "
          f"synthetic={disclose}")

    try:
        response = _do_upload(youtube, body, vp.final_mp4)
    except HttpError as exc:
        # If the channel/API rejects the synthetic-media field, drop it and
        # retry (the disclosure still rides along in the description).
        if disclose and "containsSyntheticMedia" in str(exc):
            print("[upload] API rejected containsSyntheticMedia; retrying "
                  "without it (disclosure remains in the description).")
            body["status"].pop("containsSyntheticMedia", None)
            response = _do_upload(youtube, body, vp.final_mp4)
        else:
            raise

    yt_id = response["id"]
    result = {
        "youtube_id": yt_id,
        "url": f"https://youtu.be/{yt_id}",
        "privacy": body["status"]["privacyStatus"],
        "made_for_kids": body["status"]["selfDeclaredMadeForKids"],
        "synthetic_media_declared": disclose,
        "pinned_comment": script.get("pinned_comment", ""),
    }
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False))

    # Record in state if a DB is reachable.
    try:
        with State(cfg.resolve("paths.state_db")) as st:
            st.set_upload(video_id, yt_id, "uploaded")
    except Exception:
        pass

    print(f"[upload] done -> {result['url']}")
    if result["pinned_comment"]:
        print("[upload] NOTE: pin this comment manually (API cannot pin):\n"
              f"        {result['pinned_comment']}")
    return out


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description="Upload the final video.")
    ap.add_argument("video_id")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--config", default=None)
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    upload(args.video_id, cfg=cfg, force=args.force)


if __name__ == "__main__":
    main()
