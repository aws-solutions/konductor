# SPDX-License-Identifier: Apache-2.0
"""Pins the routing rules' account of the Kiro IDE copy of each SOP.

The installer writes `.kiro/skills/sop-<name>/SKILL.md` for the IDE's slash list, and Kiro CLI's
native skill discovery lists that directory to every agent. The rules must not claim the copy is
out of the agent's reach.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROUTING_RULES = (ROOT / "context" / "k-orchestrator-routing-rules.md").read_text(encoding="utf-8")


def test_routing_rules_do_not_claim_the_ide_copy_is_unreadable():
    assert "plays no part in what this agent itself can read" not in ROUTING_RULES


def test_routing_rules_say_kiro_cli_lists_the_ide_copy_as_a_skill():
    section = ROUTING_RULES.split("## SOP Content Delivery", 1)[1].split("\n## ", 1)[0]
    assert "Kiro CLI's native skill discovery does and lists every copy to every agent" in section
    assert "not one of your declared SOPs" in section
    assert "your rules for an SOP you do not declare apply to it" in section
