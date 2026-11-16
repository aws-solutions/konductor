# SPDX-License-Identifier: Apache-2.0
"""The adversarial SOP describes k-architect's toolset without a spawn tool."""
from pathlib import Path

SOP = (
    Path(__file__).resolve().parent.parent
    / "agent-sops"
    / "k-adversarial-pull-request-review.sop.md"
).read_text()


def test_toolset_has_no_spawn_tool():
    assert "`@builtin` and `@aws-mcp` only" in SOP


def test_stale_subagent_toolset_is_gone():
    assert "`subagent`, and `@aws-mcp`" not in SOP
    assert "`@builtin`, `subagent`" not in SOP
