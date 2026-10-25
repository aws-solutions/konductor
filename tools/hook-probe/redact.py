#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Turn one raw hook-probe run into a redacted fixture.

Usage:
  redact.py <hooks.jsonl> <stdout-file> <out.json> --runtime R --runtime-version V
            --engine E --model M --date YYYY-MM-DD --experiment X --prompt P
            --sandbox-root DIR [--stderr FILE]

<stdout-file> is what the runtime printed on stdout: Claude Code stream-json,
Kiro CLI v3 stream-json, or Kiro CLI v2 plain text. The answer and the
"observed" block are derived from it and from the hook log.

Local values (home path, login name, host name, sandbox root) are read from
the environment at run time and replaced with placeholders. Ids are replaced
by key. Long free text is cut after redaction. If anything that looks local
survives, or the output holds an email, a URL or a cloud access key id, the
script exits 1 and writes nothing.
"""

import argparse
import getpass
import json
import os
import re
import socket
import sys

RUNTIMES = ("claude-code", "kiro-cli-v2", "kiro-cli-v3")
SENTINEL = "SENTINEL-7Q4"
BLOCK_MARKERS = ("hook-probe: blocked", "hook-probe deny")
RESPONSE_LIMIT = 200
TRUNCATED_KEYS = {"answer", "failed_tool_results", "tool_response"}
ID_KEYS = {
    "session_id": "<SESSION_ID>",
    "sessionId": "<SESSION_ID>",
    "prompt_id": "<PROMPT_ID>",
    "tool_use_id": "<TOOL_USE_ID>",
    "toolCallId": "<TOOL_USE_ID>",
    "transcript_path": "<TRANSCRIPT_PATH>",
}
UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+")
LONG_SECRET = re.compile(r"\b[A-Za-z0-9+/_=-]{40,}\b")
# Env var names the fixtures keep. Any other name becomes OTHER_ENV_KEY.
KNOWN_ENV_KEYS = frozenset({
    "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CONFIG_DIR", "CLAUDE_EFFORT", "CLAUDE_ENV_FILE",
    "CLAUDE_PID", "CLAUDE_PROJECT_DIR",
    "KIRO_CLI_ACP_CLIENT_NAME", "KIRO_CLI_IS_CHILD_PROCESS", "KIRO_CLI_PATH",
    "KIRO_CONTENT_COLLECTION_ENABLED", "KIRO_CUSTOM_USER_AGENT", "KIRO_HOME",
    "KIRO_REMOTE_SESSIONS_ENDPOINT", "KIRO_SESSION_ID",
})
OTHER_ENV_KEY = "<OTHER_ENV_KEY>"
# Model text sometimes carries em or en dashes; fixtures use plain ASCII hyphens.
DASHES = re.compile("[\u2013\u2014]")
LOCAL_PATH = re.compile(r"/(Users|home|tmp)/|/private/var/|/var/folders/")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
URL = re.compile(r"(?i)\bhttps?://\S+")
ACCESS_KEY_ID = re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")


class LeakError(Exception):
    pass


def local_values(sandbox_root):
    """(literal, placeholder) pairs, longest first so nested paths go first."""
    roots = {os.path.realpath(sandbox_root), sandbox_root.rstrip("/")}
    roots |= {r[len("/private"):] for r in roots if r.startswith("/private/")}
    pairs = []
    for root in roots:
        pairs.append((root, "<SANDBOX>"))
        pairs.append((root.replace("/", "-"), "<SANDBOX_SLUG>"))
    home = os.path.expanduser("~")
    pairs.append((os.path.realpath(home), "<HOME>"))
    pairs.append((home, "<HOME>"))
    return sorted(set(pairs), key=lambda p: -len(p[0]))


def name_patterns():
    hosts = {socket.gethostname(), socket.getfqdn(), socket.gethostname().split(".")[0]}
    names = [(h, "<HOST>") for h in hosts if h and h != "localhost"]
    names.append((getpass.getuser(), "<USER>"))
    # Longest first, so the FQDN is replaced whole before the short host name can split it.
    names.sort(key=lambda pair: -len(pair[0]))
    return [(re.compile(r"(?<![A-Za-z0-9])" + re.escape(n) + r"(?![A-Za-z0-9])", re.IGNORECASE), p)
            for n, p in names]


class Redactor:
    def __init__(self, sandbox_root):
        self.literals = local_values(sandbox_root)
        self.names = name_patterns()

    def text(self, s):
        for literal, placeholder in self.literals:
            s = s.replace(literal, placeholder)
        for pattern, placeholder in self.names:
            s = pattern.sub(placeholder, s)
        s = DASHES.sub("-", s)
        s = BEARER.sub("Bearer <TOKEN>", s)
        return LONG_SECRET.sub("<TOKEN>", s)

    def value(self, v, key=None, truncate=False):
        if key in ID_KEYS and isinstance(v, str):
            return ID_KEYS[key]
        if isinstance(v, dict):
            return {k: self.value(x, k, truncate or k in TRUNCATED_KEYS) for k, x in v.items()}
        if isinstance(v, list):
            return [self.value(x, None, truncate) for x in v]
        if isinstance(v, str):
            v = self.text(v)
            if truncate and len(v) > RESPONSE_LIMIT:
                v = v[:RESPONSE_LIMIT] + "...<truncated>"
        return v

    def leaks(self, serialized):
        found = [m.group(0) for m in LOCAL_PATH.finditer(serialized)]
        found += [literal for literal, _ in self.literals if literal in serialized]
        found += [p.pattern for p, _ in self.names if p.search(serialized)]
        found += UUID.findall(serialized)
        for pattern in (EMAIL, URL, ACCESS_KEY_ID):
            found += [m.group(0) for m in pattern.finditer(serialized)]
        return found


def stream_lines(stdout):
    return [json.loads(line) for line in stdout.splitlines() if line.strip().startswith("{")]


def answer_from_stdout(runtime, stdout):
    if runtime == "kiro-cli-v2":
        return stdout.strip()
    lines = stream_lines(stdout)
    if runtime == "claude-code":
        results = [d.get("result", "") for d in lines if d.get("type") == "result"]
        return results[-1] if results else ""
    chunks = []
    for d in lines:
        update = (d.get("data") or {}).get("update") or {}
        if update.get("sessionUpdate") == "agent_message_chunk":
            chunks.append((update.get("content") or {}).get("text", ""))
    return "".join(chunks)


def failed_tool_results(runtime, stdout):
    """What the stream reports back for each failed tool call. Kiro CLI v2 prints plain text, so none."""
    found = []
    if runtime == "claude-code":
        for d in stream_lines(stdout):
            content = (d.get("message") or {}).get("content")
            for item in content if isinstance(content, list) else []:
                if item.get("type") == "tool_result" and item.get("is_error"):
                    found.append(str(item.get("content")))
    elif runtime == "kiro-cli-v3":
        for d in stream_lines(stdout):
            update = (d.get("data") or {}).get("update") or {}
            if update.get("sessionUpdate") == "tool_call_update" and update.get("status") == "failed":
                found.append(json.dumps({"status": "failed", "content": update.get("content")}))
    return found


def is_event(label, name):
    return label.lower() == name.lower()


def observe(runtime, experiment, events, stdout, stderr, answer):
    labels = [e["label"] for e in events]
    pre = sum(is_event(x, "PreToolUse") for x in labels)
    post = sum(is_event(x, "PostToolUse") for x in labels)
    sentinel_in_answer = SENTINEL in answer
    sentinel_in_stdout = SENTINEL in stdout
    if experiment == "ordering":
        tool_call_blocked = "not-tested"
    elif sentinel_in_answer:
        tool_call_blocked = "no"
    elif not sentinel_in_stdout and post == 0 and pre > 0:
        tool_call_blocked = "yes"
    else:
        tool_call_blocked = "unclear"
    return {
        "event_order": labels,
        "pre_tool_events": pre,
        "post_tool_events": post,
        "sentinel_in_answer": sentinel_in_answer,
        "sentinel_in_stdout": sentinel_in_stdout,
        "block_message_in_stdout": any(m in stdout for m in BLOCK_MARKERS),
        "block_message_in_stderr": any(m in stderr for m in BLOCK_MARKERS),
        "block_message_in_answer": any(m in answer for m in BLOCK_MARKERS),
        "tool_call_blocked": tool_call_blocked,
        "failed_tool_results": failed_tool_results(runtime, stdout),
    }


def build_fixture(args, redactor):
    events = [json.loads(line) for line in open(args.hooks) if line.strip()]
    env_keys = set()
    for event in events:
        env_keys |= {k if k in KNOWN_ENV_KEYS else OTHER_ENV_KEY for k in event.pop("env_keys", [])}
    stdout = open(args.stdout).read()
    stderr = open(args.stderr).read() if args.stderr else ""
    answer = answer_from_stdout(args.runtime, stdout)
    fixture = {
        "runtime": args.runtime,
        "runtime_version": args.runtime_version,
        "engine": args.engine,
        "model": args.model,
        "date": args.date,
        "experiment": args.experiment,
        "prompt": args.prompt,
        "answer": answer,
        "observed": observe(args.runtime, args.experiment, events, stdout, stderr, answer),
        "hook_env_keys": sorted(env_keys),
        "events": events,
    }
    return redactor.value(fixture)


def parse_args(argv):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("hooks")
    p.add_argument("stdout")
    p.add_argument("out")
    p.add_argument("--runtime", required=True, choices=RUNTIMES)
    p.add_argument("--runtime-version", required=True)
    p.add_argument("--engine", required=True)
    p.add_argument("--model", required=True)
    p.add_argument("--date", required=True)
    p.add_argument("--experiment", required=True)
    p.add_argument("--prompt", required=True)
    p.add_argument("--sandbox-root", required=True)
    p.add_argument("--stderr")
    return p.parse_args(argv)


def main(argv):
    args = parse_args(argv)
    redactor = Redactor(args.sandbox_root)
    serialized = json.dumps(build_fixture(args, redactor), indent=2, ensure_ascii=False) + "\n"
    leaks = redactor.leaks(serialized)
    if leaks:
        print(f"redact.py: refusing to write {args.out}, unredacted values remain: {sorted(set(leaks))}",
              file=sys.stderr)
        return 1
    with open(args.out, "w") as out:
        out.write(serialized)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
