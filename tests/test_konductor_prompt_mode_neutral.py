# SPDX-License-Identifier: Apache-2.0
"""konductor's system prompt must not name a mode. What konductor does itself
comes from the Direct Work context file it loads, so a later orchestration mode
can swap that file without editing the prompt. Dispatcher wording or a named
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
