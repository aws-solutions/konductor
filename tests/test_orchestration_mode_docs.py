# SPDX-License-Identifier: Apache-2.0
"""Docs qualify 'konductor edits files itself' by orchestration mode and state
the hook-location rule in one place (cli/README.md)."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUIDE = ROOT / "docs" / "user-guide"
CLAUSE = "In `coordinator` mode it hands every change to a specialist"
OWNER_SENTENCE = (
    "The hook acts only for the install that wired it: it looks for the nearest install that owns"
)
LINK_CLAUSE = "The hook acts only for the install that wired it; see [where the hook may point]"
OLD_CLAIM = "The hook names only the installed rules file"


def _flat(path):
    return " ".join(path.read_text().split())


SELF_WORK_PHRASES = [
    "does the work itself",
    "edits files itself",
    "writes and runs commands itself",
    "commits itself",
]
EXEMPT_LINE_PREFIXES = ("|", "#", "- [")


def _paragraphs(path):
    paragraph = []
    for line in path.read_text().splitlines() + [""]:
        if line.strip():
            if not line.lstrip().startswith(EXEMPT_LINE_PREFIXES):
                paragraph.append(line)
        elif paragraph:
            yield " ".join(" ".join(paragraph).split())
            paragraph = []


def test_mode_clause_in_every_paragraph_that_says_konductor_edits_itself():
    missing = []
    for path in sorted(GUIDE.rglob("*.md")):
        for paragraph in _paragraphs(path):
            if "konductor" in paragraph and any(p in paragraph for p in SELF_WORK_PHRASES):
                if "coordinator" not in paragraph:
                    missing.append(f"{path.relative_to(GUIDE)}: {paragraph[:80]}")
    assert not missing, missing


def _github_slug(heading):
    text = heading.replace("`", "").lower()
    text = re.sub(r"[^\w\s-]", "", text)
    return text.strip().replace(" ", "-")


def test_faq_coordinator_pointer_is_a_link_to_a_real_heading():
    text = (GUIDE / "faq.md").read_text()
    slugs = {_github_slug(m.group(1)) for m in re.finditer(r"^#{1,6} (.+)$", text, re.M)}
    anchors = re.findall(r"\]\(#([^)]+)\)", text)
    assert "how-do-i-make-konductor-hand-every-change-to-a-specialist" in anchors
    assert [a for a in anchors if a not in slugs] == []
    assert "see Coordinator mode below" not in text


def test_readme_states_resume_restate_and_per_harness_owner():
    text = _flat(ROOT / "cli" / "README.md")
    assert "for the harness that fired it" in text
    assert "`Orchestration: auto`, so a session that changed mode" in text


def test_hook_location_has_one_owner():
    assert OWNER_SENTENCE in _flat(ROOT / "cli" / "README.md")
    for path in [ROOT / "README.md", GUIDE / "concepts.md", GUIDE / "faq.md"]:
        text = _flat(path)
        assert LINK_CLAUSE in text, path.name
        assert OLD_CLAIM not in text, path.name
    assert OLD_CLAIM not in _flat(ROOT / "cli" / "README.md")


def test_html_bundle_points_concepts_at_faq_entry():
    for bundle in [ROOT / "docs" / "index.html", ROOT / "docs" / "site" / "user-guide.html"]:
        text = bundle.read_text()
        assert "see Orchestration shapes" not in text
        assert "see the FAQ entry Coordinator mode" in text


def test_html_faq_qualifies_konductor_editing_by_mode():
    sentence = (
        "konductor loads k-direct-work.md instead and edits files itself in the default auto mode. "
        "In coordinator mode it hands every change to a specialist"
    )
    for bundle in [ROOT / "docs" / "index.html", ROOT / "docs" / "site" / "user-guide.html"]:
        text = bundle.read_text()
        assert sentence in text, bundle.name
        assert '\\", \\"konductor edits' not in text, bundle.name


def test_owner_bullet_describes_out_of_trust_install_as_fallback():
    text = _flat(ROOT / "cli" / "README.md")
    assert "treated as content" not in text
    assert "an install outside the locations above" in text
    assert "the working directory itself or a git checkout root that contains it" in text
