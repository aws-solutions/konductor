# SPDX-License-Identifier: Apache-2.0
"""Docs qualify 'konductor edits files itself' by orchestration mode and state
the hook-location rule in one place (cli/README.md)."""

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


def test_mode_clause_in_every_page_that_says_konductor_edits_itself():
    for name in ["troubleshooting", "faq", "agents", "glossary", "quick-start"]:
        assert CLAUSE in _flat(GUIDE / f"{name}.md"), name


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
