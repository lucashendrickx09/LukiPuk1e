"""Phase 3 — Claude picks the clips (the brain).

Sends each video's transcript to Claude and gets back STRICT JSON candidate
clips, each scored for hook strength. Candidates at/above the configured
`hook_score` threshold proceed; the rest are logged as rejected with reasons.

Design notes:
- The LLM call sits behind a small :class:`LLMClient` protocol so the whole
  pipeline is unit-testable offline with a fake — no network, no API key.
- Output is parsed *defensively* (strip code fences, slice to the JSON array,
  validate every field) with one automatic retry on malformed output, per spec.
- Cut points are snapped to whole-word boundaries from the transcript so we
  never cut mid-word, and length is clamped to the configured min/max.

Hard rules:
- Rule 3 (idempotency): a video already `analyzed` is skipped unless --force.
- Rule 4 (fail loud, resumable): a per-video failure is recorded as
  status=error; the run continues.
- Rule 5 (free/self-hosted by default): the Anthropic API is the one paid
  step and must be explicitly opted into via `paid_apis.use_anthropic_api`.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from .config import Config
from . import ledger
from .transcribe import Transcript

log = logging.getLogger("clipper.analyze")

REQUIRED_FIELDS = ("start", "end", "title", "caption", "hashtags", "hook_score", "reason")

SYSTEM_PROMPT = """\
You are a short-form video editor who finds the most clippable moments in a \
talking-head / podcast transcript and returns them as STRICT JSON.

You will be given a transcript as timestamped segments: each line is
`[start - end] text` with times in seconds.

Pick the BEST self-contained moments to cut into vertical shorts. For each clip optimize for:
- A strong HOOK in the first 1.5 seconds — a question, a bold claim, or a surprising line.
- A self-contained arc: setup -> payoff INSIDE the clip, with no missing context.
- An emotional or informational peak (funny, contrarian, "wait what", an actionable insight).
- Clean entry and exit on sentence boundaries — start and end on natural breaks, never mid-thought.
- Length between {min_s} and {max_s} seconds (inclusive).
- Platform-native phrasing in the title and caption; 3-6 relevant hashtags, no spam walls.

Return AT MOST {max_n} clips, best first. Score each clip's hook 1-10 (10 = irresistible).

OUTPUT FORMAT — this is critical:
- Output ONLY a single JSON array. No prose, no markdown, no code fences, no trailing commentary.
- Each element MUST be an object with EXACTLY these keys:
  {{"start": float, "end": float, "title": str, "caption": str, \
"hashtags": [str], "hook_score": int, "reason": str}}
- "start"/"end" are seconds into the video and must lie within the transcript's time range.
- If there are no good clips, output [].
"""

RETRY_SUFFIX = (
    "\n\nYour previous response was not valid JSON. Output ONLY the JSON array "
    "described above — no prose, no code fences."
)


# ===========================================================================
# Model + report types
# ===========================================================================
@dataclass
class ClipCandidate:
    start: float
    end: float
    title: str
    caption: str
    hashtags: list[str]
    hook_score: int
    reason: str


@dataclass
class AnalyzeReport:
    videos_seen: int = 0
    analyzed: int = 0
    skipped: int = 0
    candidates: int = 0      # passed threshold
    rejected: int = 0        # below threshold
    errors: int = 0
    notes: list[str] = field(default_factory=list)

    def line(self) -> str:
        return (f"videos={self.videos_seen} analyzed={self.analyzed} "
                f"skipped={self.skipped} candidates={self.candidates} "
                f"rejected={self.rejected} errors={self.errors}")


# ===========================================================================
# LLM client (injectable; real impl uses the Anthropic SDK)
# ===========================================================================
class LLMClient(Protocol):
    def complete(self, system: str, user: str) -> str:
        ...


class AnthropicClient:
    """Real client. Uses the official `anthropic` SDK.

    Note: no `temperature`/`top_p`/`budget_tokens` — those are rejected on
    current Opus models. Thinking/effort are opt-in via config for models that
    support them; omitted by default so any configured model works.
    """

    def __init__(self, model: str, max_tokens: int, api_key: str | None,
                 thinking: str | None = None, effort: str | None = None):
        self.model = model
        self.max_tokens = max_tokens
        self.thinking = thinking
        self.effort = effort
        self._api_key = api_key
        self._client = None

    def _load(self):
        if self._client is None:
            try:
                from anthropic import Anthropic
            except ImportError as exc:
                raise RuntimeError(
                    "anthropic SDK not installed: python3 -m pip install anthropic"
                ) from exc
            # api_key=None lets the SDK fall back to ANTHROPIC_API_KEY in env.
            self._client = Anthropic(api_key=self._api_key) if self._api_key else Anthropic()
        return self._client

    def complete(self, system: str, user: str) -> str:
        client = self._load()
        kwargs: dict = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        if self.thinking:
            kwargs["thinking"] = {"type": self.thinking}
        if self.effort:
            kwargs["output_config"] = {"effort": self.effort}
        msg = client.messages.create(**kwargs)
        return "".join(
            getattr(b, "text", "") for b in msg.content if getattr(b, "type", None) == "text"
        )


def make_client(cfg: Config) -> AnthropicClient:
    if not cfg.get("paid_apis", "use_anthropic_api", default=False):
        raise RuntimeError(
            "Phase 3 needs the Anthropic API. Set paid_apis.use_anthropic_api: true "
            "in config.yaml and put ANTHROPIC_API_KEY in .env."
        )
    api_key = Config.secret("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set (.env).")
    return AnthropicClient(
        model=cfg.claude_model,
        max_tokens=int(cfg.get("claude", "max_tokens", default=16000)),
        api_key=api_key,
        thinking=cfg.get("claude", "thinking", default=None),
        effort=cfg.get("claude", "effort", default=None),
    )


# ===========================================================================
# Defensive JSON parsing
# ===========================================================================
_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def extract_json_array(text: str) -> str:
    """Pull a JSON array out of a model response that may be wrapped in prose
    or code fences."""
    m = _FENCE.search(text)
    if m:
        text = m.group(1)
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise ValueError("no JSON array found in model output")
    return text[start:end + 1]


def parse_candidates(text: str) -> list[ClipCandidate]:
    raw = json.loads(extract_json_array(text))
    if not isinstance(raw, list):
        raise ValueError("top-level JSON is not an array")
    out: list[ClipCandidate] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        if any(k not in item for k in REQUIRED_FIELDS):
            continue
        try:
            tags = item["hashtags"]
            tags = [str(t) for t in tags] if isinstance(tags, list) else []
            out.append(ClipCandidate(
                start=float(item["start"]),
                end=float(item["end"]),
                title=str(item["title"]),
                caption=str(item["caption"]),
                hashtags=tags,
                hook_score=int(item["hook_score"]),
                reason=str(item["reason"]),
            ))
        except (TypeError, ValueError):
            continue  # skip a malformed element rather than failing the batch
    return out


# ===========================================================================
# Cut-point snapping + length enforcement
# ===========================================================================
def _nearest_word_start(words, t: float) -> float:
    return min((w.start for w in words), key=lambda s: abs(s - t), default=t)


def _nearest_word_end(words, t: float) -> float:
    return min((w.end for w in words), key=lambda e: abs(e - t), default=t)


def snap_and_clamp(c: ClipCandidate, tr: Transcript, min_s: float, max_s: float,
                   pad: float) -> tuple[float, float] | None:
    """Snap to word boundaries, apply padding, clamp to [min_s, max_s] and the
    video duration. Returns (start, end) or None if it can't be made valid."""
    start, end = float(c.start), float(c.end)
    if tr.words:
        start = _nearest_word_start(tr.words, start)
        end = _nearest_word_end(tr.words, end)
    start = max(0.0, start - pad)
    dur = tr.duration_sec or (tr.words[-1].end if tr.words else end)
    end = min(end + pad, dur) if dur else end + pad
    if end <= start:
        return None
    length = end - start
    if length < min_s:
        end = min(start + min_s, dur) if dur else start + min_s
    elif length > max_s:
        end = start + max_s
    if end - start < max(1.0, min_s * 0.5):
        return None
    return round(start, 3), round(end, 3)


# ===========================================================================
# Transcript -> prompt, with chunking
# ===========================================================================
def _segments_text(tr: Transcript) -> str:
    return "\n".join(f"[{s.start:.2f} - {s.end:.2f}] {s.text}" for s in tr.segments)


def _chunks(tr: Transcript, max_chars: int) -> list[str]:
    """Split the segment listing into chunks under `max_chars`, with a couple
    of segments of overlap so clips spanning a boundary aren't lost."""
    lines = [f"[{s.start:.2f} - {s.end:.2f}] {s.text}" for s in tr.segments]
    full = "\n".join(lines)
    if len(full) <= max_chars or len(lines) <= 1:
        return [full]
    chunks: list[str] = []
    cur: list[str] = []
    size = 0
    for i, ln in enumerate(lines):
        cur.append(ln)
        size += len(ln) + 1
        if size >= max_chars:
            chunks.append("\n".join(cur))
            cur = lines[max(0, i - 1):i + 1]  # ~2-line overlap
            size = sum(len(x) + 1 for x in cur)
    if cur:
        chunks.append("\n".join(cur))
    return chunks


def _dedupe(cands: list[ClipCandidate], tol: float = 2.0) -> list[ClipCandidate]:
    """Drop near-duplicate clips (overlapping start within `tol`s), keeping the
    higher hook_score."""
    kept: list[ClipCandidate] = []
    for c in sorted(cands, key=lambda x: x.hook_score, reverse=True):
        if any(abs(c.start - k.start) < tol and abs(c.end - k.end) < tol for k in kept):
            continue
        kept.append(c)
    return sorted(kept, key=lambda x: x.start)


def select_candidates(tr: Transcript, client: LLMClient, cfg: Config) -> list[ClipCandidate]:
    """Run the model over the transcript (chunked if long) and return parsed,
    deduped candidates."""
    min_s = float(cfg.get("clip", "min_seconds", default=20))
    max_s = float(cfg.get("clip", "max_seconds", default=60))
    max_n = int(cfg.get("claude", "max_candidates_per_video", default=12))
    max_chars = int(cfg.get("claude", "max_transcript_chars", default=60000))
    system = SYSTEM_PROMPT.format(min_s=int(min_s), max_s=int(max_s), max_n=max_n)

    all_c: list[ClipCandidate] = []
    for chunk in _chunks(tr, max_chars):
        user = "Transcript:\n" + chunk
        text = client.complete(system, user)
        try:
            all_c.extend(parse_candidates(text))
        except (ValueError, json.JSONDecodeError):
            # one retry with a corrective nudge (Rule: parse defensively)
            text = client.complete(system, user + RETRY_SUFFIX)
            all_c.extend(parse_candidates(text))  # may raise -> caller records error
    return _dedupe(all_c)


# ===========================================================================
# Orchestration
# ===========================================================================
def _load_transcript(video_row, cfg: Config) -> Transcript:
    path = video_row["transcript_path"]
    if not path or not Path(path).exists():
        raise RuntimeError(f"transcript file missing ({path}) — re-run transcribe.")
    return Transcript.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


def run_analyze(
    cfg: Config,
    client: LLMClient | None = None,
    *,
    only_video: str | None = None,
    force: bool = False,
    dry_run: bool = False,
) -> AnalyzeReport:
    ledger.init_db(cfg.ledger_db)
    cfg.ensure_dirs()
    threshold = cfg.hook_score_threshold
    min_s = float(cfg.get("clip", "min_seconds", default=20))
    max_s = float(cfg.get("clip", "max_seconds", default=60))
    pad = float(cfg.get("clip", "padding_seconds", default=0.3))
    report = AnalyzeReport()

    with ledger.session(cfg.ledger_db) as conn:
        if only_video:
            row = ledger.get_video(conn, only_video)
            videos = [row] if row else []
        else:
            videos = ledger.list_videos(conn, status="transcribed")
            if force:
                videos += ledger.list_videos(conn, status="analyzed")

        # Only construct the (paid) client once we know there's work to do, so
        # the command no-ops cleanly on an empty queue instead of erroring.
        if videos and client is None:
            client = make_client(cfg)

        for v in videos:
            report.videos_seen += 1
            yt = v["youtube_id"]
            if not force and v["status"] == "analyzed":
                report.skipped += 1
                continue

            try:
                tr = _load_transcript(v, cfg)
                cands = select_candidates(tr, client, cfg)
            except Exception as exc:  # noqa: BLE001 — fail loud, keep going
                report.errors += 1
                ledger.set_video_status(conn, yt, "error", error=str(exc))
                msg = f"analyze failed for {yt}: {exc}"
                log.error(msg)
                report.notes.append(msg)
                continue

            if force and not dry_run:
                ledger.delete_unrendered_clips(conn, v["id"])

            for c in cands:
                snapped = snap_and_clamp(c, tr, min_s, max_s, pad)
                if snapped is None:
                    report.rejected += 1
                    if not dry_run:
                        ledger.add_clip(
                            conn, v["id"], start_sec=c.start, end_sec=c.end,
                            title=c.title, caption=c.caption,
                            hashtags_json=json.dumps(c.hashtags), hook_score=c.hook_score,
                            reason=c.reason, status="rejected",
                            rejected_reason="could not snap to a valid in-bounds segment",
                        )
                    continue
                start, end = snapped
                passes = c.hook_score >= threshold
                if passes:
                    report.candidates += 1
                    status, rej = "candidate", None
                else:
                    report.rejected += 1
                    status = "rejected"
                    rej = f"hook_score {c.hook_score} < threshold {threshold}"
                if not dry_run:
                    ledger.add_clip(
                        conn, v["id"], start_sec=start, end_sec=end, title=c.title,
                        caption=c.caption, hashtags_json=json.dumps(c.hashtags),
                        hook_score=c.hook_score, reason=c.reason, status=status,
                        rejected_reason=rej,
                    )
                log.info("%s [%s] %.1f-%.1fs hook=%d  %s",
                         yt, status, start, end, c.hook_score, c.title)

            if not dry_run:
                ledger.set_video_status(conn, yt, "analyzed")
            report.analyzed += 1

    return report
