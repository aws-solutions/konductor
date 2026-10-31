# SPDX-License-Identifier: Apache-2.0
"""The Briefs paragraph in context/k-direct-work.md is a hand copy of the
routing rules' memory provenance and brief attribution paragraph. Apart from
the sentences each side words for itself, the two must say the same thing."""

import re
from pathlib import Path

CONTEXT_DIR = Path(__file__).resolve().parent.parent / "context"

SENTENCE_BREAK_RE = re.compile(r'(?<=[.:])\s+(?=[A-Z"])')
OWN_SENTENCES = {"Briefs.", "A specialist without a shell relies on that line."}
OWN_OPENERS = (
    ("Before your first spawn in a session, ", "Before your first delegation in a session, "),
)


def _paragraph(name, opener):
    lines = (CONTEXT_DIR / name).read_text(encoding="utf-8").splitlines()
    return next(line for line in lines if opener in line)


def _shared_sentences(paragraph):
    sentences = []
    for sentence in SENTENCE_BREAK_RE.split(paragraph):
        if sentence in OWN_SENTENCES:
            continue
        for direct_opener, routing_opener in OWN_OPENERS:
            sentence = sentence.replace(direct_opener, "").replace(routing_opener, "")
        sentences.append(sentence)
    return sentences


def test_direct_work_brief_paragraph_matches_routing_rules():
    direct = _shared_sentences(_paragraph("k-direct-work.md", "check memory provenance once"))
    routing = _shared_sentences(
        _paragraph("k-orchestrator-routing-rules.md", "check memory provenance once")
    )

    assert len(direct) > 3, "Briefs paragraph not found in k-direct-work.md"
    assert direct == routing
