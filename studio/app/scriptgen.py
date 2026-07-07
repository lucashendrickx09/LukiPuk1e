"""Script generation with the enforced HOOK -> BEATS -> PAYOFF -> LOOP contract,
plus the validator that gates what gets rendered (a weak upload hurts the channel,
so the gate is allowed to output nothing).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict

from . import formula

HOOK_TYPES = ("question", "bold_claim", "pattern_interrupt", "negative_warning",
              "curiosity_gap", "challenge", "stat_shock")
FORMATS = ("listicle", "story", "explainer", "myth_bust", "how_to", "comparison")
SCENE_KINDS = ("ambient", "title_card", "big_stat", "chart_up", "timeline",
               "quote", "list_reveal", "figure")

SCENE_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": list(SCENE_KINDS)},
        "headline": {"type": "string", "description": "primary text (short); empty string if unused"},
        "sub": {"type": "string", "description": "secondary text; for timeline/list_reveal: items separated by ';' (timeline items as 'YEAR label')"},
        "value": {"type": "string", "description": "the big number/amount, e.g. '$5.9B' (big_stat/figure); empty if unused"},
        "label": {"type": "string", "description": "small caption under the value/chart; empty if unused"},
        "points": {"type": "array", "items": {"type": "number"},
                   "description": "chart_up y-values, 4-8 rising numbers; empty list if unused"},
        "emoji": {"type": "string",
                  "description": "1-2 emoji that visualize this segment — they pop on screen while it's spoken (e.g. '💰', '📈🔥', '🤯'). Empty string only if nothing fits."},
    },
    "required": ["kind", "headline", "sub", "value", "label", "points", "emoji"],
    "additionalProperties": False,
}

SCRIPT_SCHEMA = {
    "type": "object",
    "properties": {
        "hook": {"type": "string", "description": "First line spoken+shown. <=12 words. A concrete promise with a gap."},
        "beats": {"type": "array", "items": {"type": "string"},
                  "description": "3-6 escalating beats, one idea each, <=22 words each."},
        "payoff": {"type": "string", "description": "The promise paid off, concretely. <=28 words."},
        "loop_line": {"type": "string", "description": "Final line (<=12 words) that reads as a re-entry into the hook."},
        "title": {"type": "string", "description": "YouTube title, <=70 chars, keyword first, curiosity second."},
        "description": {"type": "string", "description": "1-2 sentence description."},
        "tags": {"type": "array", "items": {"type": "string"}},
        "hook_type": {"type": "string", "enum": list(HOOK_TYPES)},
        "format": {"type": "string", "enum": list(FORMATS)},
        "pin_comment": {"type": "string",
                        "description": "A question (<=120 chars) the channel posts as its own first comment to spark replies. Must invite a specific, easy-to-give answer."},
        "scenes": {"type": "array", "items": SCENE_SCHEMA,
                   "description": "Storyboard: exactly one scene per segment, in order: hook, each beat, payoff. Scene 1 (hook) should be 'ambient' or 'big_stat' — the hook text is already on screen."},
    },
    "required": ["hook", "beats", "payoff", "loop_line", "title", "description", "tags", "hook_type", "format", "pin_comment", "scenes"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You write scripts for 20-35 second YouTube Shorts that people watch to the end.

Persona: {persona}
Niche: {niche}. Audience: {audience}.

Non-negotiable structure (the retention contract):
1. HOOK (<=12 words): a concrete promise with a curiosity gap. A number or named
   entity beats an adjective. Never open with greetings or "in this video".
2. BEATS (3-6): one idea each, <=22 words each, strictly escalating — each beat
   must raise the stakes or sharpen the claim. No filler, no throat-clearing.
3. PAYOFF (<=28 words): pay the promise concretely. The viewer must feel they got
   the thing the hook offered.
4. LOOP LINE (<=12 words): a closing line that reads naturally as a re-entry into
   the hook, so the video loops.

Style: spoken language, short sentences, second person, specific numbers, zero
cliches. Total spoken length must land between 60 and 95 words (that is 23-36
seconds at speaking pace). This script must contain a genuinely original insight
or framing — not a rewording of what every channel in the niche already says.

Also write pin_comment: one question (<=120 chars) the channel will post as its
own first comment. It must invite a specific, easy answer (a number, a choice,
a personal case) — comments are an algorithm signal, so make replying effortless.

Also storyboard the video in scenes: exactly one scene per segment, in order —
hook, each beat, payoff. Scenes are simple animated infographics; pick the kind
that best VISUALIZES the segment being spoken over it:
- ambient: decorated background only (good for the hook — its text is on screen)
- big_stat: one huge number/amount (value) + small label
- chart_up: a rising line chart (points = 4-8 numbers, e.g. net worth by year)
- timeline: 2-4 milestones, sub = "1962 First store;1970 IPO;1985 Richest man"
- quote: a short quote (headline) + who said it (label)
- list_reveal: 2-4 punchy items, sub = "item one;item two;item three"
- figure: a stylized person card — headline = name, value = their number
  (e.g. '$5.9B'), label = who/when
Numbers in scenes must match numbers spoken in the segment. Give almost every
scene an emoji — it pops on screen while the segment is spoken and is part of
the channel's eye-catching style. Pick emoji that amplify the emotion of the
beat (money, shock, growth, fire), not decoration for its own sake."""

USER_PROMPT = """Topic: {topic}
Angle: {angle}
{extra}
Write the script now."""


@dataclass
class Script:
    hook: str
    beats: list[str]
    payoff: str
    loop_line: str
    title: str
    description: str
    tags: list[str] = field(default_factory=list)
    hook_type: str = "curiosity_gap"
    format: str = "explainer"
    pin_comment: str = ""
    scenes: list[dict] = field(default_factory=list)

    def spoken_text(self) -> str:
        parts = [self.hook, *self.beats, self.payoff, self.loop_line]
        return " ".join(p.strip().rstrip(".") + "." for p in parts if p.strip())

    def word_count(self) -> int:
        return len(self.spoken_text().split())

    def est_seconds(self) -> float:
        # words at VO pace + a short breath between segments
        n_segments = 2 + len(self.beats) + 1
        return self.word_count() / formula.WORDS_PER_SECOND + 0.30 * n_segments

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Script":
        known = {f: d[f] for f in cls.__dataclass_fields__ if f in d}
        return cls(**known)


def validate(script: Script, target_seconds=(18, 40)) -> list[str]:
    """Returns a list of problems; empty list = pass."""
    issues = []
    low_all = script.spoken_text().lower()
    if len(script.hook.split()) > 12:
        issues.append(f"hook is {len(script.hook.split())} words (max 12)")
    if not (3 <= len(script.beats) <= 6):
        issues.append(f"{len(script.beats)} beats (need 3-6)")
    for i, b in enumerate(script.beats):
        if len(b.split()) > 22:
            issues.append(f"beat {i+1} is {len(b.split())} words (max 22)")
    if not script.payoff.strip():
        issues.append("missing payoff")
    if not script.loop_line.strip():
        issues.append("missing loop line")
    est = script.est_seconds()
    if not (target_seconds[0] <= est <= target_seconds[1]):
        issues.append(f"estimated {est:.1f}s (target {target_seconds[0]}-{target_seconds[1]}s)")
    for phrase in formula.BANNED_OPENERS:
        if script.hook.lower().startswith(phrase):
            issues.append(f"banned opener: {phrase!r}")
    for phrase in formula.BANNED_PHRASES:
        if phrase in low_all:
            issues.append(f"banned phrase: {phrase!r}")
    if script.hook_type not in HOOK_TYPES:
        issues.append(f"unknown hook_type {script.hook_type!r}")
    if script.format not in FORMATS:
        issues.append(f"unknown format {script.format!r}")
    # loop must share at least one significant word with the hook
    hook_words = {w for w in re.findall(r"[a-z0-9']+", script.hook.lower()) if len(w) > 3}
    loop_words = {w for w in re.findall(r"[a-z0-9']+", script.loop_line.lower()) if len(w) > 3}
    if hook_words and loop_words and not (hook_words & loop_words):
        issues.append("loop line shares no significant word with the hook (won't read as a loop)")
    if len(script.title) > 100:
        issues.append("title over 100 chars")
    if len(script.pin_comment) > 150:
        issues.append("pin_comment over 150 chars")
    return issues


def write_script(cfg, channel, idea: dict, client=None, feedback: str = "") -> Script:
    """One Claude call -> validated-shape Script (semantic validation is the caller's job)."""
    if client is None:
        from .research import make_client
        client = make_client(cfg)
    extra = f"Fix these problems from the previous attempt: {feedback}" if feedback else ""
    response = client.messages.create(
        model=cfg.model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT.format(persona=channel.persona or "clear, confident explainer",
                                    niche=channel.niche, audience=channel.audience),
        messages=[{"role": "user", "content": USER_PROMPT.format(
            topic=idea["topic"], angle=idea.get("angle", ""), extra=extra)}],
        output_config={"format": {"type": "json_schema", "schema": SCRIPT_SCHEMA}},
    )
    if getattr(response, "stop_reason", None) == "refusal":
        raise RuntimeError("script request was refused")
    parsed = getattr(response, "parsed_output", None)
    if parsed is None:
        text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
        parsed = json.loads(text)
    return Script.from_dict(parsed if isinstance(parsed, dict) else dict(parsed))


def script_with_retry(cfg, channel, idea: dict, client=None) -> tuple[Script | None, list[str]]:
    """Write, validate, retry once with feedback. Returns (script|None, issues_of_last_try)."""
    script = write_script(cfg, channel, idea, client=client)
    issues = validate(script, cfg.target_seconds)
    if not issues:
        return script, []
    script2 = write_script(cfg, channel, idea, client=client, feedback="; ".join(issues))
    issues2 = validate(script2, cfg.target_seconds)
    if not issues2:
        return script2, []
    return None, issues2
