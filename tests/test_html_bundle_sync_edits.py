# SPDX-License-Identifier: Apache-2.0
"""Every edit in tools/build-user-guide/sync-html-content.py must match the
published HTML bundles, or make guide-html exits 1. The preview run applies
nothing and exits 0 only when each edit is applied or applies cleanly."""

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "tools" / "build-user-guide" / "sync-html-content.py"

sys.path.insert(0, str(REPO / "tools" / "user-guide-sync"))
import htmlbundle  # noqa: E402


def test_sync_html_content_preview_matches_bundles():
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def _catalog_skill_names(page):
    """Skill names the published skills catalog lists, one per row."""
    start = page.index('sec("sk-behaviour"')
    end = page.index('sec("sk-coverage"', start)
    return re.findall(r'\{"k":"([a-z0-9-]+)","v":"', page[start:end])


def test_skills_catalog_names_only_shipped_skills():
    shipped = {p.parent.name for p in (REPO / "skills").glob("*/SKILL.md")}
    for bundle in htmlbundle.bundles(REPO):
        listed = _catalog_skill_names(htmlbundle.load(bundle))
        assert len(listed) > 50, f"{bundle}: catalog rows not found; the pattern is probably wrong"
        missing = sorted(set(listed) - shipped)
        assert not missing, f"{bundle.relative_to(REPO)} catalogs skills that are not in skills/: {missing}"
