# SPDX-License-Identifier: Apache-2.0
"""Runs a Kiro Crew workflow script against a stub ctx: no agent, model, AWS or network call.

usage: python3 workflow-stub.py <workflow.py> '<json spec>'
spec: {"args": {...}, "now": "<ISO time>", "replies": {"<label prefix>": reply or [replies]}}
Each ctx.agent call is answered by the reply of the longest label prefix that matches; a list is used in order and
its last reply repeats. A call with no matching reply raises, so a test names every call it expects.
Prints one JSON object: {"result", "calls": [{"label", "phase", "prompt", "schema"}], "logs", "phases", "raised"}.

With "call": {"name": "<function>", "args": [...]} in the spec, nothing runs as a workflow: the named function of the
script is called with the args and the output is {"value": <its return value>}.

The script runs with only the builtins the Kiro Crew sandbox gives a workflow, so a name the sandbox does not have
fails here as it would there.
"""
import asyncio
import builtins
import json
import sys

SAFE_BUILTINS = [
    "abs", "all", "any", "bool", "dict", "enumerate", "filter", "float", "frozenset", "int", "isinstance",
    "issubclass", "len", "list", "map", "max", "min", "range", "repr", "reversed", "round", "set", "sorted", "str",
    "sum", "tuple", "zip", "Exception", "BaseException", "ValueError", "TypeError", "KeyError", "IndexError",
    "RuntimeError", "StopIteration", "StopAsyncIteration", "ArithmeticError", "ZeroDivisionError", "AttributeError",
    "LookupError", "AssertionError", "NotImplementedError", "OverflowError", "RecursionError", "TimeoutError",
]


class StubCtx:
    def __init__(self, args, now, replies):
        self.args = args
        self.now = now
        self.replies = replies
        self.used = {}
        self.calls = []
        self.logs = []
        self.phases = []

    def phase(self, title):
        self.phases.append(title)

    def log(self, message):
        self.logs.append(message)

    async def agent(self, prompt, schema=None, label="", phase=""):
        self.calls.append({"label": label, "phase": phase, "prompt": prompt, "schema": schema})
        matches = [prefix for prefix in self.replies if label.startswith(prefix)]
        if not matches:
            raise RuntimeError("no stub reply for label " + label)
        prefix = max(matches, key=len)
        reply = self.replies[prefix]
        if isinstance(reply, list):
            index = self.used.get(prefix, 0)
            self.used[prefix] = index + 1
            reply = reply[min(index, len(reply) - 1)]
        return reply


def main():
    path = sys.argv[1]
    spec = json.loads(sys.argv[2])
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    namespace = {"__builtins__": {name: getattr(builtins, name) for name in SAFE_BUILTINS}}
    exec(compile(source, path, "exec"), namespace)
    if "call" in spec:
        call = spec["call"]
        print(json.dumps({"value": namespace[call["name"]](*call.get("args", []))}))
        return
    ctx = StubCtx(spec.get("args", {}), spec.get("now", "2026-11-12T18:15:00.000000+00:00"), spec.get("replies", {}))
    result, raised = None, ""
    try:
        result = asyncio.run(namespace["workflow"](ctx))
    except Exception as error:  # the test reads the text
        raised = "%s: %s" % (error.__class__.__name__, error)
    print(json.dumps({"result": result, "calls": ctx.calls, "logs": ctx.logs, "phases": ctx.phases, "raised": raised}))


main()
