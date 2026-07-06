"""Publishing: YouTube Data API upload (2 channels, quota-aware, scheduled slots)
plus an export mode that produces a ready-to-post pack for manual upload.

Platform reality baked in (see RESEARCH.md §2):
- videos.insert = 1600 quota units; default 10k/day per GCP project (~6 uploads).
  Give each channel its own GCP project: config `client_secret_file` per channel.
- Unverified API projects get uploads LOCKED PRIVATE. We upload private+scheduled
  anyway; until your project passes the free API audit, flip visibility in Studio
  (seconds from a phone) or use publish_mode: export.
"""

from __future__ import annotations

import datetime as dt
import json
import shutil
import zoneinfo
from pathlib import Path

from . import metadata
from .scriptgen import Script

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.force-ssl",  # posting the engagement comment
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]


# ---------------------------------------------------------------- scheduling
def next_slot(channel, taken: set[str], now: dt.datetime | None = None,
              min_lead_minutes: int = 45) -> str:
    """Next free posting slot (channel-local times) as an ISO8601 UTC string.

    Slots come from channel.slots (viewer-local peak windows). Already-taken
    slots (scheduled/uploaded posts) are skipped, so two videos never collide.
    """
    tz = zoneinfo.ZoneInfo(channel.timezone)
    now = now or dt.datetime.now(dt.timezone.utc)
    earliest = now + dt.timedelta(minutes=min_lead_minutes)
    for day_offset in range(0, 14):
        day = (now.astimezone(tz) + dt.timedelta(days=day_offset)).date()
        for hhmm in sorted(channel.slots):
            h, m = (int(x) for x in hhmm.split(":"))
            local = dt.datetime(day.year, day.month, day.day, h, m, tzinfo=tz)
            utc = local.astimezone(dt.timezone.utc)
            iso = utc.strftime("%Y-%m-%dT%H:%M:%SZ")
            if utc >= earliest and iso not in taken:
                return iso
    raise RuntimeError("no free slot in the next 14 days — increase slots or reduce cadence")


# ---------------------------------------------------------------- google auth
def auth_channel(channel):
    """Interactive OAuth for one channel; run once per channel via `run.py auth`."""
    from google_auth_oauthlib.flow import InstalledAppFlow
    if not channel.client_secret_file:
        raise RuntimeError(f"channel {channel.name}: set client_secret_file in config.yaml")
    flow = InstalledAppFlow.from_client_secrets_file(channel.client_secret_file, SCOPES)
    creds = flow.run_local_server(port=0)
    token_path = Path(channel.token_file or f"secrets/{channel.name}_token.json")
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(creds.to_json())
    return token_path


def get_service(channel, api: str = "youtube", version: str = "v3"):
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    token_path = Path(channel.token_file or f"secrets/{channel.name}_token.json")
    if not token_path.exists():
        raise RuntimeError(f"channel {channel.name}: not authorized — run: python run.py auth {channel.name}")
    creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token_path.write_text(creds.to_json())
    return build(api, version, credentials=creds, cache_discovery=False)


# ---------------------------------------------------------------- upload / export
def upload(channel, video_path: str, script: Script, publish_at_iso: str) -> str:
    """Upload as private + scheduled publishAt. Returns the YouTube video id."""
    from googleapiclient.http import MediaFileUpload

    meta = metadata.build(script, channel)
    body = {
        "snippet": {
            "title": meta["title"],
            "description": meta["description"],
            "tags": meta["tags"],
            "categoryId": meta["categoryId"],
        },
        "status": {
            "privacyStatus": "private",
            "publishAt": publish_at_iso,
            "selfDeclaredMadeForKids": False,
            # altered/synthetic content disclosure (accepted by newer API revisions;
            # harmless if the field is dropped server-side)
            "containsSyntheticMedia": True,
        },
    }
    service = get_service(channel)
    media = MediaFileUpload(video_path, chunksize=-1, resumable=True, mimetype="video/mp4")
    request = service.videos().insert(part="snippet,status", body=body, media_body=media)
    response = None
    while response is None:
        _, response = request.next_chunk()
    return response["id"]


def export_pack(video_path: str, script: Script, channel, publish_at_iso: str, outdir: Path) -> Path:
    """Ready-to-post folder: the mp4 + everything to paste, for manual upload (~30s)."""
    outdir.mkdir(parents=True, exist_ok=True)
    stem = Path(video_path).stem
    dest = outdir / f"{channel.name}_{stem}"
    dest.mkdir(exist_ok=True)
    shutil.copy2(video_path, dest / f"{stem}.mp4")
    meta = metadata.build(script, channel)
    (dest / "metadata.txt").write_text(
        f"TITLE:\n{meta['title']}\n\nDESCRIPTION:\n{meta['description']}\n\n"
        f"TAGS:\n{', '.join(meta['tags'])}\n\nSCHEDULE (UTC): {publish_at_iso}\n"
        f"CATEGORY: {meta['categoryId']}\nMade for kids: NO\nAltered content: YES\n")
    (dest / "script.json").write_text(json.dumps(script.to_dict(), indent=2))
    return dest


def post_comment(channel, yt_video_id: str, text: str) -> str:
    """Post a comment as the channel (50 quota units). Comments can't be posted on
    private videos, so this is called by sweep_live once the video is public.
    Note: the Data API cannot PIN comments — pinning stays a one-tap action in Studio;
    the creator's own comment is prominently surfaced regardless."""
    service = get_service(channel)
    resp = service.commentThreads().insert(
        part="snippet",
        body={"snippet": {"videoId": yt_video_id,
                          "topLevelComment": {"snippet": {"textOriginal": text}}}},
    ).execute()
    return resp["id"]


def sweep_live(cfg, ledger, channel, now: dt.datetime | None = None) -> list[dict]:
    """Transition uploaded posts whose publish time has passed to 'live' and post
    the script's engagement comment exactly once (the status transition is the
    idempotency guard)."""
    now = now or dt.datetime.now(dt.timezone.utc)
    results = []
    for post in ledger.posts(channel.name, status="uploaded"):
        if not post["publish_at"]:
            continue
        when = dt.datetime.fromisoformat(post["publish_at"].replace("Z", "+00:00"))
        if when > now:
            continue
        ledger.set_post(post["id"], status="live")
        result = {"post_id": post["id"], "yt_id": post["yt_video_id"], "comment": None}
        video = ledger.video(post["video_id"])
        script = Script.from_dict(json.loads(video["script"])) if video else None
        if script and script.pin_comment and post["yt_video_id"]:
            try:
                result["comment"] = post_comment(channel, post["yt_video_id"], script.pin_comment)
                ledger.log("comment_posted", f"post {post['id']}")
            except Exception as e:  # video may still be private (pre-audit) — not fatal
                ledger.log("comment_error", f"post {post['id']}: {e}")
                result["comment_error"] = str(e)
        results.append(result)
    return results


def publish_approved(cfg, ledger, channel, dry_run: bool = False) -> list[dict]:
    """Publish every approved video on this channel into the next free slots."""
    results = []
    for row in ledger.videos(channel.name, status="approved"):
        script = Script.from_dict(json.loads(row["script"]))
        slot = next_slot(channel, ledger.taken_slots(channel.name),
                         min_lead_minutes=cfg.min_lead_minutes)
        if dry_run:
            results.append({"video_id": row["id"], "slot": slot, "mode": "dry-run"})
            continue
        post_id = ledger.add_post(row["id"], channel.name, script.title, slot)
        if post_id is None:  # already posted (idempotency)
            continue
        try:
            if cfg.publish_mode == "export":
                dest = export_pack(row["video_path"], script, channel, slot, cfg.data_dir / "outbox")
                ledger.set_post(post_id, status="exported")
                results.append({"video_id": row["id"], "slot": slot, "mode": "export", "path": str(dest)})
            else:
                yt_id = upload(channel, row["video_path"], script, slot)
                ledger.set_post(post_id, yt_video_id=yt_id, status="uploaded")
                results.append({"video_id": row["id"], "slot": slot, "mode": "api", "yt_id": yt_id})
            ledger.set_video(row["id"], status="published")
            ledger.set_idea_status(row["idea_id"], "done")
            ledger.log("published", f"video {row['id']} -> {slot}")
        except Exception as e:
            ledger.set_post(post_id, status="failed")
            ledger.log("publish_error", f"video {row['id']}: {e}")
            results.append({"video_id": row["id"], "slot": slot, "mode": "error", "error": str(e)})
    return results
