# SPDX-License-Identifier: Apache-2.0
"""konductor applies review findings to its own work as targeted edits, not a whole-file rewrite."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_verification_protocol_item_3_asks_for_targeted_edits():
    spec = json.loads((ROOT / "agents" / "konductor.agent-spec.json").read_text(encoding="utf-8"))
    prompt = spec["config"]["systemPrompt"]
    assert "targeted edits to the passages the findings name, not a rewrite of the whole file" in prompt


def test_direct_work_fix_points_at_item_3():
    text = (ROOT / "context" / "k-direct-work.md").read_text(encoding="utf-8")
    assert "made as targeted edits as Verification Protocol item 3 says" in text
