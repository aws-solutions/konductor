# SPDX-License-Identifier: Apache-2.0
"""Tests for scripts/read-bundled-mcp-servers.sh."""

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "read-bundled-mcp-servers.sh"


def _run(config: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT), str(config)],
        capture_output=True,
        text=True,
    )


def test_reads_bundled_server_names(tmp_path):
    config = tmp_path / "servers.json"
    config.write_text(
        json.dumps(
            {
                "bundled": {
                    "aws-mcp": {"command": "uvx", "args": ["proxy==1.0.0"]},
                    "example-mcp": {"command": "node", "args": ["server.js"]},
                }
            }
        ),
        encoding="utf-8",
    )

    result = _run(config)

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "aws-mcp,example-mcp"


def test_missing_bundled_object_fails_closed(tmp_path):
    config = tmp_path / "servers.json"
    config.write_text(json.dumps({"byo": {}}), encoding="utf-8")

    result = _run(config)

    assert result.returncode != 0
    assert "must contain a bundled object" in result.stderr


def test_non_object_bundled_value_fails_closed(tmp_path):
    config = tmp_path / "servers.json"
    config.write_text(json.dumps({"bundled": ["aws-mcp"]}), encoding="utf-8")

    result = _run(config)

    assert result.returncode != 0
    assert "bundled must be an object" in result.stderr
