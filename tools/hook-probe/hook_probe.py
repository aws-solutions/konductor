#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Logging hook for recording what a runtime sends to its hooks.

Usage: hook_probe.py <mode> <event-label>

Appends one JSON line per call to the file named by HOOK_PROBE_LOG:
{"seq", "label", "mode", "env_keys", "payload"}. seq comes from a counter
file next to the log, taken under a lock, so event order does not depend
on clocks.

Modes apply only when <event-label> is a pre-tool event (PreToolUse or
preToolUse). Every other event is logged and exits 0.
  log    exit 0, no output
  exit1  message on stderr, exit 1
  exit2  message on stderr, exit 2
  deny   Claude Code style JSON deny on stdout, exit 0
"""

import fcntl
import json
import os
import sys

MODES = ("log", "exit1", "exit2", "deny")
BLOCK_MESSAGE = "hook-probe: blocked (exit {code})"
DENY_OUTPUT = {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "hook-probe deny",
    }
}
ENV_PREFIXES = ("CLAUDE_", "KIRO_")


def parse_payload(raw):
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"_unparsed": raw}


def next_seq(log_path):
    with open(log_path + ".seq", "a+") as counter:
        fcntl.flock(counter, fcntl.LOCK_EX)
        counter.seek(0)
        text = counter.read().strip()
        seq = int(text) + 1 if text else 1
        counter.seek(0)
        counter.truncate()
        counter.write(str(seq))
        return seq


def append_record(log_path, record):
    with open(log_path, "a") as log:
        fcntl.flock(log, fcntl.LOCK_EX)
        log.write(json.dumps(record, sort_keys=True) + "\n")


def is_pre_tool(label):
    return label.lower() == "pretooluse"


def respond(mode):
    """Emit the mode's output and return the exit code."""
    if mode == "exit1":
        print(BLOCK_MESSAGE.format(code=1), file=sys.stderr)
        return 1
    if mode == "exit2":
        print(BLOCK_MESSAGE.format(code=2), file=sys.stderr)
        return 2
    if mode == "deny":
        print(json.dumps(DENY_OUTPUT))
    return 0


def main(argv):
    if len(argv) != 3 or argv[1] not in MODES:
        print(f"usage: hook_probe.py <{'|'.join(MODES)}> <event-label>", file=sys.stderr)
        return 64
    mode, label = argv[1], argv[2]
    payload = parse_payload(sys.stdin.read())
    log_path = os.environ.get("HOOK_PROBE_LOG")
    if log_path:
        append_record(
            log_path,
            {
                "seq": next_seq(log_path),
                "label": label,
                "mode": mode,
                "env_keys": sorted(k for k in os.environ if k.startswith(ENV_PREFIXES)),
                "payload": payload,
            },
        )
    return respond(mode) if is_pre_tool(label) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
