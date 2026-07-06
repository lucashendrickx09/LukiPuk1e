from app import scriptgen
from tests.conftest import GOOD_SCRIPT, FakeClaude


def make_script(**overrides):
    d = dict(GOOD_SCRIPT)
    d.update(overrides)
    return scriptgen.Script.from_dict(d)


def test_good_script_validates_clean():
    s = make_script()
    assert scriptgen.validate(s) == []


def test_est_duration_in_band():
    s = make_script()
    assert 18 <= s.est_seconds() <= 40


def test_validator_catches_long_hook():
    s = make_script(hook="this is a very long hook that just keeps going and going and clearly exceeds the twelve word limit")
    assert any("hook is" in i for i in scriptgen.validate(s))


def test_validator_catches_banned_opener():
    s = make_script(hook="In today's video banks take 400 dollars")
    assert any("banned opener" in i for i in scriptgen.validate(s))


def test_validator_catches_banned_phrase():
    s = make_script(payoff="This is a game-changer for your money, same login different bank, 400 dollars.")
    assert any("banned phrase" in i for i in scriptgen.validate(s))


def test_validator_catches_missing_loop_connection():
    s = make_script(loop_line="Completely unrelated closing sentence here today")
    assert any("loop line" in i for i in scriptgen.validate(s))


def test_validator_catches_bad_beat_count():
    s = make_script(beats=["only one beat"])
    assert any("beats" in i for i in scriptgen.validate(s))


def test_write_script_via_fake_client(cfg, channel):
    fake = FakeClaude()
    idea = {"id": 1, "topic": "bank interest", "angle": "hidden cost"}
    script = scriptgen.write_script(cfg, channel, idea, client=fake)
    assert script.hook == GOOD_SCRIPT["hook"]
    assert scriptgen.validate(script, cfg.target_seconds) == []
    # structured output was requested
    assert "output_config" in fake.calls[0][1]


def test_script_with_retry_gives_feedback(cfg, channel):
    bad = dict(GOOD_SCRIPT, hook="In today's video " + "word " * 15)
    fake = FakeClaude(script=bad)
    script, issues = scriptgen.script_with_retry(cfg, channel, {"id": 1, "topic": "x", "angle": ""}, client=fake)
    assert script is None and issues
    assert len(fake.calls) == 2  # retried once with feedback
    assert "Fix these problems" in fake.calls[1][1]["messages"][0]["content"]
