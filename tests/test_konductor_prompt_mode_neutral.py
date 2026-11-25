# SPDX-License-Identifier: Apache-2.0
"""konductor's system prompt must not name a mode. What konductor does itself
comes from the Direct Work context file it loads, so a later orchestration mode
can swap that file without editing the prompt (the session-start hook does
this for `coordinator`). Dispatcher wording or a named
context file in the prompt would pin one mode."""

import json
from pathlib import Path

import pytest

SPEC = Path(__file__).resolve().parent.parent / "agents" / "konductor.agent-spec.json"

MODE_PHRASES = [
    "DISPATCHER",
    "You do NOT write",
    "routing rules",
    "k-direct-work",
    "k-orchestrator-routing-rules",
]


@pytest.mark.parametrize("phrase", MODE_PHRASES)
def test_konductor_prompt_names_no_mode(phrase):
    prompt = json.loads(SPEC.read_text())["config"]["systemPrompt"]
    assert phrase not in prompt


def _spec():
    return json.loads(SPEC.read_text())


def test_konductor_is_the_agent_that_loads_direct_work():
    # The orchestration hook's MODE_AGENT constant names this agent.
    names = _spec()["dependencies"]["context"]["contextNames"]
    assert "k-direct-work.md" in names
    assert "k-orchestrator-routing-rules.md" not in names


def test_orchestration_rules_item_one_names_the_orchestration_block():
    prompt = _spec()["config"]["systemPrompt"]
    item = prompt[prompt.index("Your Direct Work rules") :].split("\n")[0]
    assert "Orchestration block" in item
