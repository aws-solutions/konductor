# SPDX-License-Identifier: Apache-2.0
"""A scripted Strands model for controls and tests. It makes no network call and needs no credentials."""
import json

from strands.models.model import Model


class ScriptedModel(Model):
    """Answers each model call with the next turn of `turns`, whatever the conversation says.

    A turn is `{"tools": [{"name", "input", "id"?}]}` (the tool uses to emit, ids default to `fake-<n>`) or
    `{"text"}`. A turn with tools stops with `tool_use`, else with `end_turn`. Give a turn tools or text, not both:
    the plant runner counts a mixed turn as a stream mismatch and the trial ends `error` (D-264). After the last turn every call
    answers `{"text": "done"}`. Each call reports one input and one output token, so usage is never empty.
    """

    def __init__(self, turns):
        self.turns = list(turns)
        self.config = {"model_id": "fake"}
        self.used = 0

    @classmethod
    def from_file(cls, path):
        """A ScriptedModel from the JSON file at `path`, which holds `{"turns": [...]}`."""
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f)["turns"])

    def update_config(self, **model_config):
        self.config.update(model_config)

    def get_config(self):
        return self.config

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError("the scripted model has no structured output")
        yield  # pragma: no cover

    async def stream(self, *args, **kwargs):
        """Yields the next turn as Strands stream events."""
        turn = self.turns.pop(0) if self.turns else {"text": "done"}
        yield {"messageStart": {"role": "assistant"}}
        for tool in turn.get("tools", []):
            self.used += 1
            yield {"contentBlockStart": {"start": {"toolUse": {"toolUseId": tool.get("id", "fake-%d" % self.used), "name": tool["name"]}}}}
            yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(tool.get("input", {}))}}}}
            yield {"contentBlockStop": {}}
        if "text" in turn:
            yield {"contentBlockDelta": {"delta": {"text": turn["text"]}}}
            yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": "tool_use" if turn.get("tools") else "end_turn"}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2}, "metrics": {"latencyMs": 0}}}
