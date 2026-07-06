"""Stage-1 of the formula: turn research candidates + seed topics into scored ideas."""

from __future__ import annotations

import random

from . import formula, research


def ingest_candidates(cfg, channel, ledger, candidates: list[dict]) -> int:
    """Score and store candidates. Returns how many new ideas were added."""
    recent = ledger.recent_topics(channel.name)
    added = 0
    for c in candidates:
        components = {
            "trend": c.get("trend", 0.5),
            "rpm": channel.rpm,
            "novelty": formula.novelty_score(c.get("keywords", []) or c["topic"], recent),
            "prior": formula.prior_for(ledger, channel.name),
        }
        s1 = formula.score_idea(components, cfg.weights_stage1)
        rid = ledger.add_idea(
            channel.name, c["topic"], angle=c.get("angle", ""), keywords=c.get("keywords", []),
            trend=components["trend"], rpm=components["rpm"], novelty=components["novelty"],
            prior=components["prior"], score=s1,
            source="seed" if c.get("source") == "seed" else "research",
        )
        if rid is not None:
            added += 1
    return added


def seed_candidates(channel) -> list[dict]:
    """Evergreen idea bank from config — used when research is unavailable or thin."""
    return [{"topic": t, "angle": "", "keywords": t.split(), "trend": 0.35,
             "evergreen": True, "source": "seed"} for t in channel.seed_topics]


def refresh_ideas(cfg, channel, ledger, client=None, use_web_search: bool = True) -> int:
    """Run research + seeds -> ledger. Returns number of new ideas."""
    candidates: list[dict] = []
    try:
        candidates = research.run_research(cfg, channel, client=client, use_web_search=use_web_search)
        ledger.log("research", f"{channel.name}: {len(candidates)} candidates")
    except Exception as e:  # research is best-effort; seeds keep the pipeline alive
        ledger.log("research_error", f"{channel.name}: {e}")
    candidates.extend(seed_candidates(channel))
    return ingest_candidates(cfg, channel, ledger, candidates)


def select_ideas(cfg, channel, ledger, k: int, rng: random.Random | None = None) -> list[dict]:
    """Epsilon-greedy pick of the next k ideas to script; marks them selected."""
    rows = ledger.ideas(channel.name, status="candidate")
    scored = [(row["score"], dict(row)) for row in rows]
    chosen = formula.pick(scored, k, epsilon=cfg.epsilon, rng=rng)
    for idea in chosen:
        ledger.set_idea_status(idea["id"], "selected")
    return chosen
