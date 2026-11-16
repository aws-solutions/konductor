# SPDX-License-Identifier: Apache-2.0
"""Every edit in tools/build-user-guide/sync-html-content.py must match the
published HTML bundles, or make guide-html exits 1. The preview run applies
nothing and exits 0 only when each edit is applied or applies cleanly."""

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "tools" / "build-user-guide" / "sync-html-content.py"


def test_sync_html_content_preview_matches_bundles():
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
