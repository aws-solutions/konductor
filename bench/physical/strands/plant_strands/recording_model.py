# SPDX-License-Identifier: Apache-2.0
"""A model wrapper that records every tool use the model emits, before any hook or middleware can touch it.

Strands passes the tool-use dict from the conversation to BeforeToolCallEvent hooks, so a hook that edits it in place
also edits the stored message (checked on strands-agents 1.65.0). The message history is therefore not a record of
what the model asked for. This wrapper is: it sits between the model and the agent and copies each tool use as the
model streams it.
"""
import json

from strands.models.model import Model


class RecordingModel(Model):
    """Wraps `inner` (any Strands Model) and writes one `model_tool_use` line to `trace` per tool use it streams.

    The stream passes through unchanged. A tool use whose input is not valid JSON is logged with `input` null and
    the raw text in `inputText`; Strands then fails that call on its own.
    """

    def __init__(self, inner, trace):
        self.inner = inner
        self.trace = trace

    def __getattr__(self, name):
        # Attributes the agent reads from its model (for example `stateful`) come from the wrapped model.
        return getattr(self.inner, name)

    def update_config(self, **model_config):
        return self.inner.update_config(**model_config)

    def get_config(self):
        return self.inner.get_config()

    def structured_output(self, *args, **kwargs):
        return self.inner.structured_output(*args, **kwargs)

    async def stream(self, *args, **kwargs):
        """Yields the inner model's events, noting each tool use's id, name and assembled input."""
        current = None
        async for event in self.inner.stream(*args, **kwargs):
            start = event.get("contentBlockStart", {}).get("start", {}).get("toolUse")
            delta = event.get("contentBlockDelta", {}).get("delta", {}).get("toolUse")
            if start is not None:
                current = {"toolUseId": start["toolUseId"], "name": start["name"], "text": ""}
            elif delta is not None and current is not None:
                current["text"] += delta.get("input", "")
            elif "contentBlockStop" in event and current is not None:
                self._note(current)
                current = None
            yield event

    def _note(self, use):
        try:
            self.trace.write("model_tool_use", toolUseId=use["toolUseId"], name=use["name"], input=json.loads(use["text"] or "{}"))
        except ValueError:
            self.trace.write("model_tool_use", toolUseId=use["toolUseId"], name=use["name"], input=None, inputText=use["text"])
