# SPDX-License-Identifier: Apache-2.0
"""Tests for tools/hook-probe/hook_probe.py and tools/hook-probe/redact.py.

Run:  python3 -m pytest -q tests/test_hook_probe.py
"""

import importlib.util
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
PROBE = REPO_ROOT / "tools" / "hook-probe" / "hook_probe.py"
REDACT = REPO_ROOT / "tools" / "hook-probe" / "redact.py"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = load_module("hook_probe", PROBE)


def run_probe(tmp_path, mode, label, payload='{"tool_name": "Read"}'):
    log = tmp_path / "hooks.jsonl"
    result = subprocess.run(
        [sys.executable, str(PROBE), mode, label],
        input=payload,
        capture_output=True,
        text=True,
        env={**os.environ, "HOOK_PROBE_LOG": str(log)},
    )
    records = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
    return result, records


@pytest.mark.parametrize(
    "mode, code, stdout_has, stderr_has",
    [
        ("log", 0, "", ""),
        ("exit1", 1, "", "hook-probe: blocked (exit 1)"),
        ("exit2", 2, "", "hook-probe: blocked (exit 2)"),
        ("deny", 0, '"permissionDecision": "deny"', ""),
    ],
)
def test_probe_mode_on_pre_tool_event(tmp_path, mode, code, stdout_has, stderr_has):
    result, records = run_probe(tmp_path, mode, "PreToolUse")
    assert result.returncode == code
    assert stdout_has in result.stdout
    assert stderr_has in result.stderr
    assert records == [
        {"seq": 1, "label": "PreToolUse", "mode": mode, "env_keys": records[0]["env_keys"],
         "payload": {"tool_name": "Read"}}
    ]


def test_probe_deny_prints_claude_code_deny_json(tmp_path):
    result, _ = run_probe(tmp_path, "deny", "PreToolUse")
    assert json.loads(result.stdout) == probe.DENY_OUTPUT


def test_probe_treats_kiro_v2_lowercase_event_as_pre_tool(tmp_path):
    result, _ = run_probe(tmp_path, "exit2", "preToolUse")
    assert result.returncode == 2


def test_probe_only_logs_non_tool_events(tmp_path):
    result, records = run_probe(tmp_path, "exit2", "Stop")
    assert (result.returncode, result.stdout, result.stderr) == (0, "", "")
    assert records[0]["label"] == "Stop"


def test_probe_seq_counts_up_across_calls(tmp_path):
    for label in ("SessionStart", "UserPromptSubmit", "Stop"):
        run_probe(tmp_path, "log", label, payload="")
    _, records = run_probe(tmp_path, "log", "Stop", payload="not json")
    assert [r["seq"] for r in records] == [1, 2, 3, 4]
    assert records[0]["payload"] is None
    assert records[-1]["payload"] == {"_unparsed": "not json"}


def test_probe_records_env_key_names_not_values(tmp_path):
    log = tmp_path / "hooks.jsonl"
    subprocess.run(
        [sys.executable, str(PROBE), "log", "Stop"],
        input="{}",
        text=True,
        env={**os.environ, "HOOK_PROBE_LOG": str(log), "KIRO_PROBE_SECRET": "value-123"},
        check=True,
    )
    text = log.read_text()
    assert "KIRO_PROBE_SECRET" in text
    assert "value-123" not in text


def test_probe_rejects_unknown_mode_with_usage_exit(tmp_path):
    result, _ = run_probe(tmp_path, "block", "PreToolUse")
    assert result.returncode == 64


FAKE_USER = "probeuser"
SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e"


def write_raw_run(tmp_path, extra_payload=None, answer="SENTINEL-7Q4"):
    home = tmp_path / "home" / FAKE_USER
    sandbox = tmp_path / "sandbox"
    home.mkdir(parents=True)
    sandbox.mkdir()
    payload = {
        "hook_event_name": "PreToolUse",
        "cwd": f"{sandbox}/project",
        "session_id": SESSION,
        "transcript_path": f"{home}/.claude/projects/{SESSION}.jsonl",
        "tool_name": "Read",
        "tool_input": {"file_path": f"{home}/notes for {FAKE_USER}.txt"},
        "note": "auth header Bearer abc.def.ghi on " + socket.gethostname(),
    }
    payload.update(extra_payload or {})
    hooks = tmp_path / "hooks.jsonl"
    hooks.write_text(json.dumps({"seq": 1, "label": "PreToolUse", "mode": "log",
                                 "env_keys": ["KIRO_HOME", "KIRO_PROBE_UNLISTED_X"],
                                 "payload": payload}) + "\n")
    stdout = tmp_path / "stdout.txt"
    stdout.write_text(answer.format(home=home) + "\n")
    return home, sandbox, hooks, stdout


def run_redact(tmp_path, home, sandbox, hooks, stdout):
    out = tmp_path / "fixture.json"
    result = subprocess.run(
        [sys.executable, str(REDACT), str(hooks), str(stdout), str(out),
         "--runtime", "kiro-cli-v2", "--runtime-version", "0.0.0", "--engine", "v2",
         "--model", "auto", "--date", "2000-01-01", "--experiment", "log-only",
         "--prompt", "Read probe.txt.", "--sandbox-root", str(sandbox)],
        capture_output=True,
        text=True,
        env={**os.environ, "HOME": str(home), "USER": FAKE_USER, "LOGNAME": FAKE_USER},
    )
    return result, out


def test_redact_replaces_local_values_with_placeholders(tmp_path):
    result, out = run_redact(tmp_path, *write_raw_run(tmp_path))
    assert result.returncode == 0, result.stderr
    fixture = json.loads(out.read_text())
    payload = fixture["events"][0]["payload"]
    assert payload["cwd"] == "<SANDBOX>/project"
    assert payload["session_id"] == "<SESSION_ID>"
    assert payload["transcript_path"] == "<TRANSCRIPT_PATH>"
    assert payload["tool_input"]["file_path"] == "<HOME>/notes for <USER>.txt"
    assert "Bearer <TOKEN>" in payload["note"]
    if socket.gethostname() not in ("", "localhost"):
        assert payload["note"].endswith("<HOST>")
    assert fixture["hook_env_keys"] == ["<OTHER_ENV_KEY>", "KIRO_HOME"]
    assert fixture["observed"]["tool_call_blocked"] == "no"
    assert FAKE_USER not in out.read_text()


def test_redact_fails_closed_on_unknown_id(tmp_path):
    raw = write_raw_run(tmp_path, {"request_ref": "6ba7b810-9dad-11d1-80b4-00c04fd430c8"})
    result, out = run_redact(tmp_path, *raw)
    assert result.returncode == 1
    assert "refusing" in result.stderr
    assert not out.exists()


def test_redact_cuts_long_text_after_redaction(tmp_path):
    filler = "word " * 39
    raw = write_raw_run(tmp_path, answer=filler + "{home}/notes.txt")
    result, out = run_redact(tmp_path, *raw)
    assert result.returncode == 0, result.stderr
    assert json.loads(out.read_text())["answer"] == filler + "<HOME" + "...<truncated>"


@pytest.mark.parametrize(
    "value",
    ["mail probe@example.com", "see https://example.com/x", "key AKIAABCDEFGHIJKLMNOP"],
    ids=["email", "url", "access-key-id"],
)
def test_redact_fails_closed_on_contact_and_key_values(tmp_path, value):
    result, out = run_redact(tmp_path, *write_raw_run(tmp_path, {"extra": value}))
    assert result.returncode == 1
    assert "refusing" in result.stderr
    assert not out.exists()

