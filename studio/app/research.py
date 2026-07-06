"""Grounded market research: Claude + server-side web search -> scored topic candidates.

This is what makes the formula's `trend` component real instead of guessed —
every research run pulls what is moving in the niche *right now*.
"""

from __future__ import annotations

import json
import re

RESEARCH_PROMPT = """You are the research desk for a YouTube Shorts channel.

Channel niche: {niche}
Channel persona: {persona}
Primary audience: {audience} (this matters for ad RPM — prefer topics that interest that geo)

Use web search to find what is trending / newsworthy / rising in this niche RIGHT NOW,
plus evergreen angles with proven pull. Then output topic candidates for 20-35 second
Shorts. Each candidate must be a single, concrete, surprising claim or question —
not a broad theme. It must be answerable/payable-off within 30 seconds.

Rules:
- ORIGINAL angles only. Nothing that reads like a template or a repost.
- Prefer topics with a number, a named entity, or a testable claim in them.
- trend = how fast this topic is rising right now (1.0 = spiking today, 0.3 = evergreen).

Output ONLY a JSON array (no prose before or after), 10 items, each:
{{"topic": "...", "angle": "one-line specific take", "keywords": ["k1","k2","k3"],
  "trend": 0.0-1.0, "evergreen": true/false, "why_now": "one line"}}"""


def _extract_json_array(text: str) -> list[dict]:
    """Pull the first JSON array out of a model response, tolerating fences/prose."""
    m = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.S)
    raw = m.group(1) if m else None
    if raw is None:
        start = text.find("[")
        end = text.rfind("]")
        if start == -1 or end <= start:
            raise ValueError(f"no JSON array in response: {text[:200]!r}")
        raw = text[start:end + 1]
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("expected a JSON array")
    return data


def make_client(cfg):
    """Anthropic client (lazy import so tests never need the SDK/network)."""
    import anthropic
    return anthropic.Anthropic(api_key=cfg.anthropic_api_key or None)


def run_research(cfg, channel, client=None, use_web_search: bool = True) -> list[dict]:
    """Returns a list of candidate dicts: topic, angle, keywords, trend, evergreen, why_now."""
    client = client or make_client(cfg)
    prompt = RESEARCH_PROMPT.format(niche=channel.niche, persona=channel.persona or "clear, confident explainer",
                                    audience=channel.audience)
    kwargs = dict(
        model=cfg.model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        messages=[{"role": "user", "content": prompt}],
    )
    if use_web_search:
        kwargs["tools"] = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 6}]

    with client.messages.stream(**kwargs) as stream:
        message = stream.get_final_message()
    if getattr(message, "stop_reason", None) == "refusal":
        raise RuntimeError("research request was refused; try again or adjust the niche prompt")

    text = "".join(block.text for block in message.content if getattr(block, "type", "") == "text")
    candidates = _extract_json_array(text)

    cleaned = []
    for c in candidates:
        topic = str(c.get("topic", "")).strip()
        if not topic:
            continue
        cleaned.append({
            "topic": topic,
            "angle": str(c.get("angle", "")).strip(),
            "keywords": [str(k) for k in c.get("keywords", [])][:8],
            "trend": max(0.0, min(1.0, float(c.get("trend", 0.5)))),
            "evergreen": bool(c.get("evergreen", False)),
            "why_now": str(c.get("why_now", "")).strip(),
        })
    return cleaned
