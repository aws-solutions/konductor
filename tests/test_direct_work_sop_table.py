# SPDX-License-Identifier: Apache-2.0
"""konductor's SOP table in context/k-direct-work.md is a hand copy of the SOP
Trigger Table in context/k-orchestrator-routing-rules.md. The two must list the
same SOPs with the same phase counts, or konductor and the mux and cmux
orchestrators announce different workflows for the same request."""

import re
from pathlib import Path

CONTEXT_DIR = Path(__file__).resolve().parent.parent / "context"

ROW_RE = re.compile(r"^\|(?:[^|\n]*\|)?\s*`([a-z0-9-]+)`\s*\|\s*(\d+)\s*\|", re.M)


def _sop_rows(text):
    return sorted(ROW_RE.findall(text))


def _section(text, heading):
    start = text.index(heading)
    end = text.find("\n## ", start + len(heading))
    return text[start:] if end == -1 else text[start:end]


def test_direct_work_sop_table_matches_trigger_table():
    direct = (CONTEXT_DIR / "k-direct-work.md").read_text()
    routing = (CONTEXT_DIR / "k-orchestrator-routing-rules.md").read_text()

    direct_rows = _sop_rows(direct)
    trigger_rows = _sop_rows(_section(routing, "## SOP Trigger Table"))

    assert direct_rows, "no SOP rows found in k-direct-work.md"
    assert direct_rows == trigger_rows
