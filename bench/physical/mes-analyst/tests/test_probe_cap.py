"""The $5 probe ceiling holds: the capped wrapper refuses a call that could pass it, with no real model call made."""
import asyncio
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
BENCH_STRANDS = os.path.join(HERE, "..", "..", "strands")

PROBE_CAP_USD = 5.0


class _NoCallInner:
    """Stands in for the real model. It records every call; a call here means the guard let one through."""

    def __init__(self):
        self.calls = 0

    def stream(self, *args, **kwargs):
        self.calls += 1

        async def gen():
            # Reports no usage, so the guard charges each call its full worst-case reserve.
            yield {"no": "usage"}
        return gen()


class _Trace:
    def __init__(self):
        self.lines = []

    def write(self, event, **fields):
        self.lines.append((event, fields))


class ProbeCapTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, os.path.abspath(BENCH_STRANDS))
        try:
            from plant_strands import spend_cap
        except ImportError as e:  # strands-agents not installed in this interpreter
            raise unittest.SkipTest("plant_strands not importable: %s" % e)
        cls.spend_cap = spend_cap
        cls.pin = spend_cap.load_pins()["models"]["anthropic.claude-sonnet-5-5"]

    def test_a_call_that_could_pass_five_dollars_is_refused_before_any_model_call(self):
        inner = _NoCallInner()
        trace = _Trace()
        capped = self.spend_cap.CappedModel(inner, self.pin, PROBE_CAP_USD, trace)
        # A request whose worst case is the full 128k output: well over a few calls at $5.
        big_args = ("x" * 4000,)

        async def run():
            gen = capped.stream(*big_args)
            async for _ in gen:
                pass

        refused = 0
        for _ in range(10):
            try:
                asyncio.run(run())
            except self.spend_cap.SpendCapReached:
                refused += 1
                break
        self.assertEqual(refused, 1, "the guard must refuse the call that would pass $5")
        self.assertLessEqual(capped.spent_usd, PROBE_CAP_USD, "total spend passed the $5 ceiling")
        self.assertGreater(capped.calls, 0, "some calls should be allowed under the ceiling")
        self.assertTrue(any(e == "spend_cap" for e, _ in trace.lines), "no spend_cap trace line was written")


if __name__ == "__main__":
    unittest.main()
