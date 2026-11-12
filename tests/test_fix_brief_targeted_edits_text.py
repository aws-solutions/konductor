# SPDX-License-Identifier: Apache-2.0
"""Each orchestrator's fix brief asks the artifact's owner for targeted edits, not a whole-file rewrite."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORCHESTRATORS = (
    "konductor",
    "konductor-mux-orchestrator",
    "konductor-cmux-orchestrator",
)
ROUTE_FIX_ITEM = re.compile(r"^5\. Route each fix.*$", re.MULTILINE)


def route_fix_item(name: str) -> str:
    spec_path = ROOT / "agents" / f"{name}.agent-spec.json"
    prompt = json.loads(spec_path.read_text(encoding="utf-8"))["config"]["systemPrompt"]
    items = ROUTE_FIX_ITEM.findall(prompt)
    assert len(items) == 1, f"{name}: expected one Verification Protocol item 5, found {len(items)}"
    return items[0]


def test_item_5_is_identical_across_orchestrators():
    items = {name: route_fix_item(name) for name in ORCHESTRATORS}
    assert len(set(items.values())) == 1, items


def test_item_5_asks_for_targeted_edits():
    for name in ORCHESTRATORS:
        assert "targeted edits to the passages the findings name" in route_fix_item(name)
