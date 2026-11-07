# SPDX-License-Identifier: Apache-2.0
"""Every user-facing SOP an orchestrator declares has a row in the SOP Trigger Table.

Without a row, a request for that SOP falls through to the capability table and lands on a
specialist, which may not declare the SOP at all.
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ROUTING_RULES = (ROOT / "context" / "k-orchestrator-routing-rules.md").read_text(encoding="utf-8")
SOP_GUIDE = (ROOT / "docs" / "user-guide" / "sop-workflows" / "README.md").read_text(encoding="utf-8")
ORCHESTRATORS = ["konductor", "konductor-mux-orchestrator", "konductor-cmux-orchestrator"]

# `k-delegate` is the orchestrator's own delegation procedure and `about-konductor` answers the
# onboarding meta-question; neither is a workflow a user request selects through the table.
NOT_USER_SELECTED = frozenset({"k-delegate", "about-konductor"})


def trigger_table_rows():
    start = ROUTING_RULES.index("## SOP Trigger Table")
    end = ROUTING_RULES.index("\n## ", start + 1)
    rows = {}
    for line in ROUTING_RULES[start:end].splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) == 4 and cells[1].startswith("`"):
            rows[cells[1].strip("`")] = cells
    return rows


def declared_sops(agent):
    spec = json.loads((ROOT / "agents" / f"{agent}.agent-spec.json").read_text(encoding="utf-8"))
    return set(spec["dependencies"]["agentSops"]["agentSopNames"])


@pytest.mark.parametrize("agent", ORCHESTRATORS)
def test_every_declared_user_sop_has_a_trigger_row(agent):
    missing = declared_sops(agent) - NOT_USER_SELECTED - set(trigger_table_rows())
    assert not missing, f"{agent} declares SOPs with no trigger row: {sorted(missing)}"


@pytest.mark.parametrize("agent", ORCHESTRATORS)
def test_every_trigger_row_names_a_declared_sop(agent):
    undeclared = set(trigger_table_rows()) - declared_sops(agent)
    assert not undeclared, f"trigger rows for SOPs {agent} does not declare: {sorted(undeclared)}"


def test_adversarial_row_counts_its_step_headings():
    sop = (ROOT / "agent-sops" / "k-adversarial-pull-request-review.sop.md").read_text(encoding="utf-8")
    row = trigger_table_rows()["k-adversarial-pull-request-review"]
    assert row[2] == str(len(re.findall(r"^### ", sop, re.MULTILINE)))
    assert "after standard review" in row[0]
    assert "`diff_input` is always required" in row[3]


def test_the_sop_guide_lists_every_trigger_table_sop():
    paragraph = SOP_GUIDE[SOP_GUIDE.index("SOPs sit\nin `konductor`'s own SOP trigger table") :]
    paragraph = paragraph[: paragraph.index("For the rest")]
    listed = set(re.findall(r"`([a-z0-9-]+)`", paragraph)) - {"konductor"}
    assert listed == set(trigger_table_rows())
