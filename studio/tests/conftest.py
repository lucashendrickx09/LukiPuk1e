"""Shared fixtures: offline config, fresh ledger, fake Claude client, mock TTS."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import ChannelConfig, Config  # noqa: E402
from app.ledger import Ledger  # noqa: E402

GOOD_SCRIPT = {
    "hook": "Banks legally take 400 dollars from you every year",
    "beats": [
        "It's not fees you can see, it's the interest you never receive.",
        "The average checking account pays point zero one percent.",
        "High yield accounts pay four percent, insured by the same government.",
        "Moving your money takes eleven minutes, once.",
    ],
    "payoff": "Same money, same protection, four hundred dollars a year more, just a different login.",
    "loop_line": "So which bank is taking your 400 dollars?",
    "title": "Banks quietly take $400 from you every year",
    "description": "The checking account math nobody shows you.",
    "tags": ["personal finance", "banking", "savings"],
    "hook_type": "stat_shock",
    "format": "explainer",
    "pin_comment": "What does your checking account actually pay? Check and reply with the number.",
    "scenes": [
        {"kind": "ambient", "headline": "", "sub": "", "value": "", "label": "", "points": []},
        {"kind": "big_stat", "headline": "", "sub": "", "value": "0.01%",
         "label": "average checking interest", "points": []},
        {"kind": "big_stat", "headline": "", "sub": "", "value": "4.00%",
         "label": "high-yield, same insurance", "points": []},
        {"kind": "chart_up", "headline": "Your $10k over 10 years", "sub": "",
         "value": "", "label": "4% vs 0.01%", "points": [10, 10.4, 10.8, 11.7, 13.1, 14.8]},
        {"kind": "list_reveal", "headline": "The 11 minutes", "sub": "open account;link bank;move money",
         "value": "", "label": "", "points": []},
        {"kind": "big_stat", "headline": "", "sub": "", "value": "$400/yr",
         "label": "for a different login", "points": []},
    ],
}


class FakeMessage:
    def __init__(self, text="", parsed=None, stop_reason="end_turn"):
        self.content = [SimpleNamespace(type="text", text=text)]
        self.parsed_output = parsed
        self.stop_reason = stop_reason


class FakeStream:
    def __init__(self, message):
        self._message = message

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self._message


class FakeClaude:
    """Stands in for anthropic.Anthropic: .messages.create / .messages.stream."""

    def __init__(self, script=None, research_items=None):
        self.script = script or GOOD_SCRIPT
        self.research_items = research_items or [
            {"topic": f"test topic {i} about money habit {i}", "angle": "a fresh take",
             "keywords": [f"money{i}", "habit", "bank"], "trend": 0.5 + i * 0.05,
             "evergreen": False, "why_now": "test"} for i in range(6)
        ]
        self.calls = []
        outer = self

        class Messages:
            def create(self, **kwargs):
                outer.calls.append(("create", kwargs))
                return FakeMessage(text=json.dumps(outer.script), parsed=dict(outer.script))

            def stream(self, **kwargs):
                outer.calls.append(("stream", kwargs))
                return FakeStream(FakeMessage(text=json.dumps(outer.research_items)))

        self.messages = Messages()


@pytest.fixture
def channel():
    return ChannelConfig(name="test_channel", niche="finance", theme="midnight",
                         voice="af_heart", voice_rate=1.0,
                         slots=["12:30", "19:30"], timezone="America/New_York",
                         seed_topics=["evergreen seed topic about compounding"])


@pytest.fixture
def cfg(tmp_path, channel):
    data = tmp_path / "data"
    data.mkdir()
    return Config(root=tmp_path, data_dir=data, channels=[channel],
                  tts_engine="mock", review_required=True, publish_mode="export")


@pytest.fixture
def ledger(cfg):
    led = Ledger(cfg.ledger_path)
    yield led
    led.close()


@pytest.fixture
def fake_claude():
    return FakeClaude()
