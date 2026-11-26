"""A scripted Strands model for tests. It makes no network call and needs no credentials."""
import json

from strands.models.model import Model


class ScriptedModel(Model):
    """Answers each model call with the next turn of `turns`, whatever the conversation says.

    A turn is {"tools": [{"name", "input", "id"?}], "text"?}: tool uses to emit (ids default to fake-<n>), then
    optional text. A turn with tools stops with tool_use, else end_turn. After the last turn every call answers
    {"text": "done"}.
    """

    def __init__(self, turns):
        self.turns = list(turns)
        self.config = {"model_id": "scripted"}
        self.used = 0

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
        for t in turn.get("tools", []):
            self.used += 1
            tid = t.get("id", "fake-%d" % self.used)
            yield {"contentBlockStart": {"start": {"toolUse": {"toolUseId": tid, "name": t["name"]}}}}
            yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(t.get("input", {}))}}}}
            yield {"contentBlockStop": {}}
        if "text" in turn:
            yield {"contentBlockDelta": {"delta": {"text": turn["text"]}}}
            yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": "tool_use" if turn.get("tools") else "end_turn"}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2},
                            "metrics": {"latencyMs": 0}}}
