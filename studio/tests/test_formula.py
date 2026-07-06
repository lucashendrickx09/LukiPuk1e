import random

from app import formula


def test_hook_score_prefers_short_concrete_curiosity():
    strong = formula.hook_score("Banks legally take 400 dollars from you every year")
    weak = formula.hook_score("In today's video I am going to talk about some interesting banking things you should know")
    assert strong > 0.7
    assert weak < 0.3
    assert strong > weak


def test_hook_score_bounds():
    assert 0.0 <= formula.hook_score("") <= 1.0
    assert 0.0 <= formula.hook_score("word " * 50) <= 1.0


def test_retention_curve_peaks_in_sweet_spot():
    sweet = formula.retention_score(26, 4, True, True)
    too_short = formula.retention_score(8, 4, True, True)
    too_long = formula.retention_score(58, 4, True, True)
    assert sweet > 0.85
    assert too_short < sweet
    assert too_long < sweet


def test_retention_structure_matters():
    with_all = formula.retention_score(26, 4, True, True)
    no_loop = formula.retention_score(26, 4, True, False)
    assert with_all > no_loop


def test_novelty_penalizes_similar_topics():
    recent = [("the 50 30 20 budget rule", ["budget", "rule", "money"])]
    fresh = formula.novelty_score(["quantum", "computing", "chips"], recent)
    stale = formula.novelty_score(["budget", "rule", "money"], recent)
    assert fresh > 0.9
    assert stale < 0.5


def test_score_idea_weighted():
    w = {"trend": 0.30, "rpm": 0.25, "novelty": 0.20, "prior": 0.25}
    hi = formula.score_idea({"trend": 1, "rpm": 1, "novelty": 1, "prior": 1}, w)
    lo = formula.score_idea({"trend": 0, "rpm": 0, "novelty": 0, "prior": 0}, w)
    assert abs(hi - 1.0) < 1e-9 and abs(lo) < 1e-9


def test_pick_epsilon_zero_is_pure_exploit():
    scored = [(i / 10, f"item{i}") for i in range(10)]
    top = formula.pick(scored, 3, epsilon=0.0, rng=random.Random(1))
    assert top == ["item9", "item8", "item7"]


def test_pick_explores_with_epsilon_one():
    scored = [(i / 10, f"item{i}") for i in range(10)]
    got = formula.pick(scored, 3, epsilon=1.0, rng=random.Random(7))
    assert len(got) == 3 and len(set(got)) == 3


def test_performance_index_retention_dominates():
    high_ret = formula.performance_index(views=1000, avg_view_pct=95, likes=10, comments=2)
    low_ret = formula.performance_index(views=1000, avg_view_pct=30, likes=10, comments=2)
    assert high_ret - low_ret > 0.3


def test_update_priors_moves_toward_performance(ledger, channel):
    # seed one published post with strong metrics
    idea_id = ledger.add_idea(channel.name, "prior test topic", trend=0.5, rpm=0.9)
    vid = ledger.add_video(idea_id, channel.name, {"t": 1}, hook_type="question",
                           fmt="listicle", est_seconds=24, score=0.7)
    ledger.set_video(vid, status="published")
    post = ledger.add_post(vid, channel.name, "t", "2026-07-01T12:30:00Z")
    ledger.set_post(post, status="uploaded")
    ledger.record_metrics(post, views=5000, likes=200, comments=30,
                          avg_view_pct=88.0, avg_view_seconds=21.0)

    before = formula.prior_for(ledger, channel.name, "question", "listicle", 24)
    updated = formula.update_priors(ledger, channel.name)
    after = formula.prior_for(ledger, channel.name, "question", "listicle", 24)

    assert updated, "expected at least one prior update"
    assert after > before  # strong performance pulls the prior up


def test_update_priors_ignores_sub_seed_views(ledger, channel):
    idea_id = ledger.add_idea(channel.name, "tiny views topic")
    vid = ledger.add_video(idea_id, channel.name, {}, hook_type="question",
                           fmt="story", est_seconds=24, score=0.7)
    post = ledger.add_post(vid, channel.name, "t", "2026-07-01T12:30:00Z")
    ledger.set_post(post, status="uploaded")
    ledger.record_metrics(post, views=5, likes=1, comments=0, avg_view_pct=99.0, avg_view_seconds=23)
    assert formula.update_priors(ledger, channel.name) == {}
