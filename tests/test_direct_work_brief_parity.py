# SPDX-License-Identifier: Apache-2.0
"""The Briefs paragraph in context/k-direct-work.md is a hand copy of the
routing rules' brief attribution paragraph, because konductor does not load
the routing rules. Apart from its "Briefs." label, it must say the same thing."""

from pathlib import Path

CONTEXT_DIR = Path(__file__).resolve().parent.parent / "context"

OPENER = "Copy each `Ruling:` entry from the project's memory"
DIRECT_LABEL = "Briefs. "


def _paragraph(name):
    lines = (CONTEXT_DIR / name).read_text(encoding="utf-8").splitlines()
    return next(line for line in lines if OPENER in line)


def test_direct_work_brief_paragraph_matches_routing_rules():
    direct = _paragraph("k-direct-work.md")
    routing = _paragraph("k-orchestrator-routing-rules.md")

    assert direct.startswith(DIRECT_LABEL + OPENER), direct
    assert direct[len(DIRECT_LABEL):] == routing
