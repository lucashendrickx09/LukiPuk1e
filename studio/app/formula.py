"""The dynamic selection formula. Derived from RESEARCH.md §3 — every constant
here traces to a platform mechanic or a reference-video lesson.

Stage 1 (idea):   S1 = w_t*trend + w_m*rpm + w_n*novelty + w_p*prior
Stage 2 (script): S2 = w_i*S1 + w_h*hook + w_r*retention
Learning:         prior <- (1-ALPHA)*prior + ALPHA*performance   (per hook_type/format/length key)
Selection:        epsilon-greedy over scored ideas (explore 20% by default).
"""

from __future__ import annotations

import math
import random
import re

ALPHA = 0.3          # EMA learning rate for priors
MIN_SAMPLE_VIEWS = 25  # ignore posts with fewer views than the seed audience floor

# Openers that scream "skippable" — every hook-craft reference bans these.
BANNED_OPENERS = (
    "in this video", "in today's video", "welcome back", "hey guys", "hi everyone",
    "today we're", "today i'm", "so basically", "have you ever wondered",
    "did you know that you can", "let's dive in", "without further ado",
)
# Phrases that mark low-effort AI slop anywhere in a script.
BANNED_PHRASES = (
    "like and subscribe", "smash that", "don't forget to", "comment below",
    "game-changer", "in conclusion", "at the end of the day", "unlock the power",
    "dive deep", "let that sink in", "stay tuned",
)
CURIOSITY_MARKERS = (
    "secret", "nobody", "no one", "never", "why", "how", "mistake", "wrong",
    "truth", "hidden", "before", "until", "actually", "real reason", "stop",
    "warning", "trap", "rule", "hack", "myth",
)

WORDS_PER_SECOND = 2.6  # ~156 wpm conversational VO pace


# ---------------------------------------------------------------- components
def hook_score(hook: str) -> float:
    """0..1 heuristic for hook strength (concrete, short, curiosity gap, clean opener)."""
    text = hook.strip()
    if not text:
        return 0.0
    words = text.split()
    low = text.lower()
    score = 0.5
    # brevity: <= 12 words is the craft standard; punish beyond hard
    if len(words) <= 12:
        score += 0.15
    else:
        score -= 0.06 * (len(words) - 12)
    # specificity: a number or $ amount or year
    if re.search(r"\d", text):
        score += 0.15
    # curiosity gap marker
    if any(m in low for m in CURIOSITY_MARKERS):
        score += 0.15
    # second person = direct address
    if re.search(r"\byou(r)?\b", low):
        score += 0.05
    # banned openers nuke it
    if any(low.startswith(b) or f" {b}" in low[:40] for b in BANNED_OPENERS):
        score -= 0.4
    return max(0.0, min(1.0, score))


def retention_score(est_seconds: float, n_beats: int, has_payoff: bool, has_loop: bool) -> float:
    """0..1 prediction proxy for retention, from structure alone.

    Length curve: platform retention gates favor 20-32s (65% gate under 30s).
    Beat density: a new idea every 3-5s of speech.
    """
    # length component (piecewise triangle peaking across 20..32s)
    s = est_seconds
    if s <= 10 or s >= 55:
        length = 0.0
    elif 20 <= s <= 32:
        length = 1.0
    elif s < 20:
        length = (s - 10) / 10          # 10s..20s ramps 0..1
    else:
        length = max(0.0, 1.0 - (s - 32) / 23)  # 32s..55s decays 1..0
    # beat density component
    if n_beats <= 0:
        density = 0.0
    else:
        sec_per_beat = s / max(1, n_beats + 2)  # +2 for hook & payoff
        density = 1.0 if 2.5 <= sec_per_beat <= 5.5 else max(0.0, 1.0 - abs(sec_per_beat - 4.0) / 6.0)
    structure = (0.5 if has_payoff else 0.0) + (0.5 if has_loop else 0.0)
    return max(0.0, min(1.0, 0.45 * length + 0.30 * density + 0.25 * structure))


def _keyword_set(keywords: list[str] | str) -> set[str]:
    if isinstance(keywords, str):
        keywords = re.findall(r"[a-z0-9]+", keywords.lower())
    return {k.lower() for k in keywords if len(k) > 2}


def novelty_score(keywords: list[str] | str, recent: list[tuple[str, list[str]]]) -> float:
    """1 - max Jaccard similarity vs recent uploads' topics. 1.0 = fully fresh."""
    ks = _keyword_set(keywords)
    if not ks or not recent:
        return 1.0
    worst = 0.0
    for topic, kws in recent:
        other = _keyword_set(kws) | _keyword_set(topic)
        if not other:
            continue
        j = len(ks & other) / len(ks | other)
        worst = max(worst, j)
    return max(0.0, 1.0 - worst)


# ---------------------------------------------------------------- scoring
def score_idea(components: dict, weights: dict) -> float:
    """S1 over components {trend, rpm, novelty, prior} with configured weights."""
    total_w = sum(weights.values()) or 1.0
    return sum(weights[k] * float(components.get(k, 0.0)) for k in weights) / total_w


def score_script(idea_score: float, hook_s: float, retention_s: float, weights: dict) -> float:
    """S2 combining stage-1 score with script-level hook & retention scores."""
    total_w = sum(weights.values()) or 1.0
    return (weights.get("idea", 0.45) * idea_score
            + weights.get("hook", 0.30) * hook_s
            + weights.get("retention", 0.25) * retention_s) / total_w


# ---------------------------------------------------------------- learning
def length_bucket(seconds: float) -> str:
    if seconds < 25:
        return "short"
    if seconds < 40:
        return "mid"
    return "long"


def prior_key(hook_type: str, fmt: str, seconds: float) -> str:
    return f"prior:hook={hook_type or 'any'}|format={fmt or 'any'}|len={length_bucket(seconds)}"


def performance_index(views: int, avg_view_pct: float, likes: int, comments: int) -> float:
    """0..1 performance of a published short. Retention dominates (the algorithm's gate)."""
    retention = min(1.0, max(0.0, avg_view_pct / 100.0))
    reach = min(1.0, math.log10(max(views, 0) + 1) / 6.0)   # 1.0 at 1M views
    eng = min(1.0, ((likes + 2 * comments) / views * 20.0)) if views > 0 else 0.0
    return 0.6 * retention + 0.3 * reach + 0.1 * eng


def update_priors(ledger, channel: str) -> dict[str, float]:
    """EMA-update learned priors from the latest metrics. Returns updated keys."""
    updated: dict[str, float] = {}
    for row in ledger.performance_rows(channel):
        if (row["views"] or 0) < MIN_SAMPLE_VIEWS:
            continue
        p = performance_index(row["views"], row["avg_view_pct"] or 0.0,
                              row["likes"] or 0, row["comments"] or 0)
        for key in (prior_key(row["hook_type"], row["format"], row["est_seconds"]),
                    f"prior:hook={row['hook_type'] or 'any'}",
                    f"prior:format={row['format'] or 'any'}"):
            old = ledger.get_weight(channel, key, 0.5)
            new = (1 - ALPHA) * old + ALPHA * p
            ledger.set_weight(channel, key, new)
            updated[key] = new
    return updated


def prior_for(ledger, channel: str, hook_type: str = "", fmt: str = "", seconds: float = 28.0) -> float:
    """Look up the most specific learned prior available (falls back to 0.5)."""
    for key in (prior_key(hook_type, fmt, seconds),
                f"prior:hook={hook_type or 'any'}",
                f"prior:format={fmt or 'any'}"):
        row_val = ledger.get_weight(channel, key, -1.0)
        if row_val >= 0:
            return row_val
    return 0.5


# ---------------------------------------------------------------- selection
def pick(scored: list[tuple[float, object]], k: int, epsilon: float = 0.2,
         rng: random.Random | None = None) -> list[object]:
    """Epsilon-greedy: (1-eps) share from the top, eps share randomly from the rest.

    `scored` is a list of (score, item), any order. Returns up to k items.
    """
    rng = rng or random.Random()
    ranked = sorted(scored, key=lambda t: t[0], reverse=True)
    if k >= len(ranked):
        return [item for _, item in ranked]
    n_explore = sum(1 for _ in range(k) if rng.random() < epsilon)
    n_exploit = k - n_explore
    chosen = [item for _, item in ranked[:n_exploit]]
    rest = [item for _, item in ranked[n_exploit:]]
    rng.shuffle(rest)
    chosen.extend(rest[:n_explore])
    return chosen
