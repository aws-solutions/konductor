# SPDX-License-Identifier: Apache-2.0
"""Tests for the fixtures under tests/fixtures/runtime-hooks/.

Run:  python3 -m pytest -q tests/test_runtime_hook_fixtures.py
"""

import importlib.util
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
REDACT = REPO_ROOT / "tools" / "hook-probe" / "redact.py"
FIXTURES = REPO_ROOT / "tests" / "fixtures" / "runtime-hooks"
RUNTIMES = ("claude-code", "kiro-cli-v2", "kiro-cli-v3")
EXPERIMENTS = ("log-only", "exit-1", "exit-2", "deny-output", "ordering")
FIXTURE_KEYS = {
    "runtime", "runtime_version", "engine", "model", "date", "experiment",
    "prompt", "answer", "observed", "hook_env_keys", "events",
}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


redact = load_module("hook_probe_redact", REDACT)

def fixture_paths():
    return [FIXTURES / rt / f"{exp}.json" for rt in RUNTIMES for exp in EXPERIMENTS]


@pytest.mark.parametrize("path", fixture_paths(), ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_fixture_shape_and_hygiene(path):
    text = path.read_text()
    fixture = json.loads(text)
    assert set(fixture) == FIXTURE_KEYS
    assert fixture["runtime"] == path.parent.name
    assert fixture["experiment"] == path.stem
    assert fixture["events"], "a run with no hook events is not evidence"
    assert not redact.LOCAL_PATH.search(text)
    assert not redact.UUID.search(text)
    assert not redact.DASHES.search(text)


EXPECTED_BLOCKED = {
    "claude-code": {"log-only": "no", "exit-1": "no", "exit-2": "yes", "deny-output": "yes",
                    "ordering": "not-tested"},
    "kiro-cli-v2": {"log-only": "no", "exit-1": "no", "exit-2": "yes", "deny-output": "no",
                    "ordering": "not-tested"},
    "kiro-cli-v3": {"log-only": "no", "exit-1": "no", "exit-2": "yes", "deny-output": "no",
                    "ordering": "not-tested"},
}


@pytest.mark.parametrize("path", fixture_paths(), ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_fixture_observed_matches_events(path):
    fixture = json.loads(path.read_text())
    observed, events = fixture["observed"], fixture["events"]
    labels = [e["label"] for e in events]
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert observed["event_order"] == labels
    assert observed["pre_tool_events"] == sum(x.lower() == "pretooluse" for x in labels)
    assert observed["post_tool_events"] == sum(x.lower() == "posttooluse" for x in labels)
    assert observed["tool_call_blocked"] == EXPECTED_BLOCKED[fixture["runtime"]][fixture["experiment"]]
    assert set(fixture["hook_env_keys"]) <= redact.KNOWN_ENV_KEYS | {redact.OTHER_ENV_KEY}


def test_fixture_tree_has_no_extra_files():
    found = sorted(FIXTURES.rglob("*.json"))
    assert found == sorted(fixture_paths())
