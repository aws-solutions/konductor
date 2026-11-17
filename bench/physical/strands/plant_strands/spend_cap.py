# SPDX-License-Identifier: Apache-2.0
"""The pinned Bedrock models, their token prices, and a hard spend cap for one Strands trial.

Before each model call the cap reserves the most that call could cost: every byte of the request counted as one input
token (a BPE token is never shorter than one byte) plus a fixed overhead, and the full `maxTokens` of output. The call
starts only when what was spent so far plus that reserve stays within the cap, so the trial never passes it. After the
call the reserve is replaced by the call's own reported usage; a call that reported none is charged the whole reserve.
"""
import json
import os

from strands.models.model import Model

PINS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bedrock_models.json")
# Chat template and wrapper tokens a request may add beyond its own bytes.
OVERHEAD_TOKENS = 2000


def load_pins(path=PINS_FILE):
    """The pin file: `{region, pricesSource, models: {<model id>: {inputUsdPerMTok, outputUsdPerMTok, maxTokens}}}`."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def cost_usd(pin, input_tokens, output_tokens):
    """List-price USD of `input_tokens` and `output_tokens` on the model `pin` describes."""
    return (input_tokens * pin["inputUsdPerMTok"] + output_tokens * pin["outputUsdPerMTok"]) / 1e6


class SpendCapReached(Exception):
    """The next model call could pass the trial's spend cap, so it was not made."""


def spend_cap_of(error):
    """The SpendCapReached behind `error` (Strands wraps model errors in EventLoopException), or None."""
    seen = set()
    while error is not None and id(error) not in seen:
        if isinstance(error, SpendCapReached):
            return error
        seen.add(id(error))
        error = error.__cause__ or error.__context__
    return None


class CappedModel(Model):
    """Wraps `inner` (a Strands Model) so the calls of one trial never cost more than `cap_usd` at `pin`'s prices.

    Writes a `spend` trace line before each call (spent so far and the reserve) and a `spend_cap` line when it refuses
    one. `usage()` gives the totals for the trace's `usage` line.
    """

    def __init__(self, inner, pin, cap_usd, trace):
        self.inner = inner
        self.pin = pin
        self.cap_usd = cap_usd
        self.trace = trace
        self.spent_usd = 0.0
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def update_config(self, **model_config):
        return self.inner.update_config(**model_config)

    def get_config(self):
        return self.inner.get_config()

    def structured_output(self, *args, **kwargs):
        raise NotImplementedError("structured output is not metered, so it is not offered under a spend cap")

    def reserve_usd(self, args, kwargs):
        """The most one call with these arguments can cost."""
        request_bytes = len(json.dumps([args, kwargs], default=str, ensure_ascii=False).encode("utf-8"))
        return cost_usd(self.pin, request_bytes + OVERHEAD_TOKENS, self.pin["maxTokens"])

    async def stream(self, *args, **kwargs):
        reserve = self.reserve_usd(args, kwargs)
        if self.spent_usd + reserve > self.cap_usd:
            self.trace.write("spend_cap", capUsd=self.cap_usd, spentUsd=self.spent_usd, nextCallReserveUsd=reserve)
            raise SpendCapReached("spend cap $%.4f: spent $%.4f, the next call could cost up to $%.4f, so it was not made" % (self.cap_usd, self.spent_usd, reserve))
        self.trace.write("spend", call=self.calls + 1, spentUsd=self.spent_usd, reservedUsd=self.spent_usd + reserve)
        usage = None
        try:
            async for event in self.inner.stream(*args, **kwargs):
                usage = event.get("metadata", {}).get("usage", usage)
                yield event
        finally:
            self.calls += 1
            if usage is None:
                self.spent_usd += reserve
            else:
                self.input_tokens += usage.get("inputTokens", 0)
                self.output_tokens += usage.get("outputTokens", 0)
                self.spent_usd += cost_usd(self.pin, usage.get("inputTokens", 0), usage.get("outputTokens", 0))

    def usage(self):
        """Fields of the trace's `usage` line."""
        return {"inputTokens": self.input_tokens, "outputTokens": self.output_tokens, "modelCalls": self.calls, "costUsd": self.spent_usd, "capUsd": self.cap_usd}
