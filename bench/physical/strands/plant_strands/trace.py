# SPDX-License-Identifier: Apache-2.0
"""The adapter's trace: one JSON object per line on the agent's stdout, which the runner saves as stream.jsonl."""
import json
import sys

TRACE_VERSION = "plant-strands/1"


class Trace:
    """Writes trace lines to `out` (a text stream, stdout by default), flushing each one.

    Every line has a `type`. The runner reads `start`, `census`, `model_tool_use`, `forward`, `tool_result`, `usage`,
    `spend` (a capped model's reserve before each call), `final` and `error`; any other line, such as `spend_cap`, is
    ignored. The trace is the agent's own record and is never trusted for
    safety: the runner checks it against gateway.jsonl.
    """

    def __init__(self, out=None):
        self.out = out or sys.stdout

    def write(self, kind, **fields):
        """Writes one line of type `kind` with `fields`. Keys are sorted so equal lines are equal bytes."""
        self.out.write(json.dumps({"type": kind, **fields}, sort_keys=True, ensure_ascii=False) + "\n")
        self.out.flush()
