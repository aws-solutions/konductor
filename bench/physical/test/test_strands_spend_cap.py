# SPDX-License-Identifier: Apache-2.0
"""The Strands launcher's Bedrock switch and hard spend cap (physical/strands). No model call is made: the capped model
wraps a scripted one. Needs strands-agents; skipped without it."""
import asyncio
import io
import json
import os
import sys
import unittest
from unittest import mock

import _paths

sys.path.insert(0, os.path.join(_paths.PHYSICAL, "strands"))
try:
    # `physical/` is on sys.path, so a bare `import strands` finds the forwarder's own folder; ask for the SDK module.
    import strands.models.model  # noqa: F401
    HAVE_STRANDS = True
except ImportError:
    HAVE_STRANDS = False

if HAVE_STRANDS:
    import launch  # noqa: E402
    from plant_strands.fake_model import ScriptedModel  # noqa: E402
    from plant_strands.spend_cap import CappedModel, load_pins, spend_cap_of  # noqa: E402
    from plant_strands.trace import Trace  # noqa: E402

# $1 per million tokens both ways, 10 output tokens at most: easy sums.
PIN = {"inputUsdPerMTok": 1.0, "outputUsdPerMTok": 1.0, "maxTokens": 10}
MESSAGES = [{"role": "user", "content": [{"text": "hi"}]}]


class BigUsageModel(ScriptedModel if HAVE_STRANDS else object):
    """A scripted model that reports 1000 input and 1000 output tokens per call."""

    async def stream(self, *args, **kwargs):
        async for event in super().stream(*args, **kwargs):
            if "metadata" in event:
                event = {"metadata": {"usage": {"inputTokens": 1000, "outputTokens": 1000, "totalTokens": 2000}, "metrics": {"latencyMs": 0}}}
            yield event


async def drain(model):
    return [e async for e in model.stream(MESSAGES)]


def lines(out):
    return [json.loads(l) for l in out.getvalue().splitlines()]


@unittest.skipUnless(HAVE_STRANDS, "strands-agents is not installed")
class SpendCapTest(unittest.TestCase):
    def test_calls_stop_before_the_one_that_could_pass_the_cap_and_spend_never_passes_it(self):
        out = io.StringIO()
        inner = BigUsageModel([])
        model = CappedModel(inner, PIN, 0.005, Trace(out))
        reserve = model.reserve_usd((MESSAGES,), {})
        self.assertGreater(reserve, 0.002)
        made = 0
        with self.assertRaises(Exception) as caught:
            for _ in range(10):
                asyncio.run(drain(model))
                made += 1
        self.assertIsNotNone(spend_cap_of(caught.exception))
        self.assertEqual(made, 2)
        self.assertAlmostEqual(model.spent_usd, 0.004)
        self.assertLessEqual(model.spent_usd, model.cap_usd)
        kinds = [l["type"] for l in lines(out)]
        self.assertEqual(kinds, ["spend", "spend", "spend_cap"])
        self.assertEqual(model.usage(), {"inputTokens": 2000, "outputTokens": 2000, "modelCalls": 2, "costUsd": model.spent_usd, "capUsd": 0.005})

    def test_a_cap_below_one_call_reserve_makes_no_call(self):
        inner = ScriptedModel([{"text": "never"}])
        model = CappedModel(inner, PIN, 0.0001, Trace(io.StringIO()))
        with self.assertRaises(Exception):
            asyncio.run(drain(model))
        self.assertEqual(inner.turns, [{"text": "never"}], "the inner model was never called")
        self.assertEqual(model.calls, 0)

    def test_a_call_that_reports_no_usage_is_charged_its_whole_reserve(self):
        class Silent(ScriptedModel):
            async def stream(self, *args, **kwargs):
                async for event in super().stream(*args, **kwargs):
                    if "metadata" not in event:
                        yield event
        model = CappedModel(Silent([]), PIN, 1.0, Trace(io.StringIO()))
        reserve = model.reserve_usd((MESSAGES,), {})
        asyncio.run(drain(model))
        self.assertAlmostEqual(model.spent_usd, reserve)

    def test_the_cap_error_is_found_behind_the_agent_s_own_wrapping(self):
        from strands import Agent
        agent = Agent(model=CappedModel(ScriptedModel([]), PIN, 0.0001, Trace(io.StringIO())), callback_handler=None)
        with self.assertRaises(Exception) as caught:
            agent("hi")
        self.assertIsNotNone(spend_cap_of(caught.exception))


@unittest.skipUnless(HAVE_STRANDS, "strands-agents is not installed")
class ModelSwitchTest(unittest.TestCase):
    def test_the_pin_file_names_one_model_with_prices_in_us_east_1(self):
        pins = load_pins()
        self.assertEqual(pins["region"], "us-east-1")
        self.assertEqual(list(pins["models"]), ["qwen.qwen3-coder-next"])
        self.assertEqual(pins["models"]["qwen.qwen3-coder-next"], {"inputUsdPerMTok": 0.5, "outputUsdPerMTok": 1.2, "maxTokens": 4096})

    # Building the Bedrock client reads the boto profile; a host that names a profile it lacks must not fail the test (no call is made).
    @mock.patch.dict(os.environ, {"AWS_CONFIG_FILE": os.devnull, "AWS_SHARED_CREDENTIALS_FILE": os.devnull})
    def test_a_pinned_bedrock_model_is_capped_in_its_region(self):
        for name in ("AWS_PROFILE", "AWS_DEFAULT_PROFILE"):
            os.environ.pop(name, None)
        trace = Trace(io.StringIO())
        model, capped = launch.model_of("bedrock:qwen.qwen3-coder-next", 5.0, trace)
        self.assertIs(model, capped)
        self.assertEqual(capped.cap_usd, 5.0)
        self.assertEqual(capped.inner.config["model_id"], "qwen.qwen3-coder-next")
        self.assertEqual(capped.inner.config["max_tokens"], 4096)
        self.assertEqual(capped.inner.client.meta.region_name, "us-east-1")

    def test_an_unpinned_model_or_a_missing_cap_is_refused(self):
        trace = Trace(io.StringIO())
        for spec, cap, pattern in [
            ("bedrock:us.anthropic.claude-sonnet-5-5", 5.0, "not pinned"),
            ("bedrock:qwen.qwen3-coder-next", None, "needs --max-usd"),
            ("bedrock:qwen.qwen3-coder-next", 0, "needs --max-usd"),
            ("openai:gpt", 5.0, "use fake:"),
        ]:
            with self.assertRaises(launch.Refused) as caught:
                launch.model_of(spec, cap, trace)
            self.assertEqual(caught.exception.code, launch.EXIT_USAGE)
            self.assertIn(pattern, str(caught.exception))


if __name__ == "__main__":
    unittest.main()
