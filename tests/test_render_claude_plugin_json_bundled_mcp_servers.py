# SPDX-License-Identifier: Apache-2.0
"""Regression tests for scripts/render-claude-plugin-json.py's
--bundled-mcp-servers flag.

MCP servers are bring-your-own by default: an agent's `dependencies.
mcpRegistry` entry documents how a USER would configure that server
themselves, and only servers explicitly opted into --bundled-mcp-servers
(sourced from scripts/claude-plugin-mcp-servers.json's "bundled" list) are
actually packaged into the rendered .mcp.json. Today that allowlist is just
["aws-mcp"] -- k-browser's playwright-mcp entry is a documented reference
config, not something Konductor ships.

These tests exercise the script as a subprocess (matching this repo's other
scripts/*.py regression tests, e.g. test_validate_version_semver.py), since
--bundled-mcp-servers is argparse-level behavior, not something importable
in isolation without also invoking main().

Run:  cd tests && pytest test_render_claude_plugin_json_bundled_mcp_servers.py -v
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "render-claude-plugin-json.py"
TEMPLATE = REPO_ROOT / "scripts" / "claude-plugin.template.json"


def _write_agent_spec(path: Path, name: str, mcp_registry: dict) -> None:
    path.write_text(
        json.dumps(
            {
                "schemaVersion": "1",
                "name": name,
                "config": {"description": "d", "systemPrompt": "p", "model": "m"},
                "dependencies": {"mcpRegistry": mcp_registry},
                "clientConfig": {"claudeCli": {}},
            }
        ),
        encoding="utf-8",
    )


def _run(tmp_path: Path, bundled_mcp_servers=None, bundled_mcp_config=None, bundled_mcp_config_raw=None):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "k-example.md").write_text("---\nname: k-example\n---\n", encoding="utf-8")

    agent_specs_dir = tmp_path / "agent-specs"
    agent_specs_dir.mkdir()
    _write_agent_spec(
        agent_specs_dir / "k-architect.agent-spec.json",
        "k-architect",
        {"aws-mcp": {"command": "uvx", "args": ["mcp-proxy-for-aws-cli@latest"]}},
    )
    _write_agent_spec(
        agent_specs_dir / "k-browser.agent-spec.json",
        "k-browser",
        {
            "playwright-mcp": {
                "command": "npx",
                "args": ["-y", "@playwright/mcp@latest", "--output-dir", "browser-output"],
            }
        },
    )

    version_file = tmp_path / "VERSION"
    version_file.write_text("9.9.9\n", encoding="utf-8")

    output = tmp_path / "plugin.json"
    mcp_output = tmp_path / ".mcp.json"

    argv = [
        sys.executable,
        str(SCRIPT),
        "--template",
        str(TEMPLATE),
        "--version-file",
        str(version_file),
        "--agents-dir",
        str(agents_dir),
        "--output",
        str(output),
        "--agent-specs-dir",
        str(agent_specs_dir),
        "--mcp-output",
        str(mcp_output),
    ]
    if bundled_mcp_servers is not None:
        argv += ["--bundled-mcp-servers", bundled_mcp_servers]
    if bundled_mcp_config is not None:
        config_path = tmp_path / "claude-plugin-mcp-servers.json"
        config_path.write_text(json.dumps({"bundled": bundled_mcp_config}), encoding="utf-8")
        argv += ["--bundled-mcp-config", str(config_path)]
    if bundled_mcp_config_raw is not None:
        config_path = tmp_path / "claude-plugin-mcp-servers-raw.json"
        config_path.write_text(bundled_mcp_config_raw, encoding="utf-8")
        argv += ["--bundled-mcp-config", str(config_path)]

    result = subprocess.run(argv, capture_output=True, text=True)
    return result, mcp_output


def test_bundled_mcp_servers_aws_mcp_keeps_only_aws_mcp(tmp_path):
    result, mcp_output = _run(tmp_path, bundled_mcp_servers="aws-mcp")
    assert result.returncode == 0, result.stderr

    rendered = json.loads(mcp_output.read_text(encoding="utf-8"))
    assert list(rendered["mcpServers"].keys()) == ["aws-mcp"], rendered


def test_bundled_mcp_servers_omitted_writes_no_servers(tmp_path):
    result, mcp_output = _run(tmp_path, bundled_mcp_servers=None)
    assert result.returncode == 0, result.stderr

    rendered = json.loads(mcp_output.read_text(encoding="utf-8"))
    assert rendered["mcpServers"] == {}, (
        "expected an empty allowlist to write no mcpServers entries at all, "
        f"got: {rendered}"
    )


def test_bundled_mcp_servers_empty_string_writes_no_servers(tmp_path):
    result, mcp_output = _run(tmp_path, bundled_mcp_servers="")
    assert result.returncode == 0, result.stderr

    rendered = json.loads(mcp_output.read_text(encoding="utf-8"))
    assert rendered["mcpServers"] == {}


def test_unknown_bundled_server_name_is_silently_dropped_not_an_error(tmp_path):
    """Allowlisting a server name that no agent spec declares is not a
    conflict or a typo detector's job -- it simply contributes nothing to
    the rendered .mcp.json. `scripts/claude-plugin-mcp-servers.json` naming
    a server no agent currently declares is a legitimate future-facing
    state (e.g. staging a name ahead of the agent spec that will use it)."""
    result, mcp_output = _run(tmp_path, bundled_mcp_servers="aws-mcp,some-future-mcp")
    assert result.returncode == 0, result.stderr

    rendered = json.loads(mcp_output.read_text(encoding="utf-8"))
    assert list(rendered["mcpServers"].keys()) == ["aws-mcp"], rendered


def test_bundled_mcp_config_overrides_the_agent_specs_own_definition(tmp_path):
    """--bundled-mcp-config's own "bundled" object wins over the agent
    spec's own dependencies.mcpRegistry entry for the same server name --
    the plugin's .mcp.json always gets the pinned command Konductor
    recommends, regardless of what an individual agent spec happens to
    declare for that server."""
    result, mcp_output = _run(
        tmp_path,
        bundled_mcp_servers="aws-mcp",
        bundled_mcp_config={
            "aws-mcp": {
                "command": "uvx",
                "args": [
                    "mcp-proxy-for-aws-cli@latest",
                    "https://aws-mcp.us-east-1.api.aws/mcp",
                    "--metadata",
                    "AWS_REGION=us-east-1",
                ],
            }
        },
    )
    assert result.returncode == 0, result.stderr

    rendered = json.loads(mcp_output.read_text(encoding="utf-8"))
    assert rendered["mcpServers"]["aws-mcp"]["args"] == [
        "mcp-proxy-for-aws-cli@latest",
        "https://aws-mcp.us-east-1.api.aws/mcp",
        "--metadata",
        "AWS_REGION=us-east-1",
    ], rendered


def test_bundled_mcp_config_falls_back_to_registry_for_unlisted_name(tmp_path):
    """A name allowlisted via --bundled-mcp-servers but absent from
    --bundled-mcp-config's own "bundled" object falls back to the agent
    spec's own dependencies.mcpRegistry entry unchanged."""
    result, mcp_output = _run(
        tmp_path,
        bundled_mcp_servers="aws-mcp",
        bundled_mcp_config={"some-other-server": {"command": "npx", "args": ["-y", "other@latest"]}},
    )
    assert result.returncode == 0, result.stderr

    rendered = json.loads(mcp_output.read_text(encoding="utf-8"))
    assert rendered["mcpServers"]["aws-mcp"]["args"] == ["mcp-proxy-for-aws-cli@latest"], rendered


def test_bundled_mcp_config_malformed_json_fails_cleanly(tmp_path):
    """A --bundled-mcp-config file that isn't valid JSON fails with a
    clean `error: ...` message and a non-zero exit, not a Python
    traceback."""
    result, _ = _run(
        tmp_path,
        bundled_mcp_servers="aws-mcp",
        bundled_mcp_config_raw="{not valid json,,,",
    )
    assert result.returncode != 0
    assert "error:" in result.stderr, result.stderr
    assert "Traceback" not in result.stderr, result.stderr


def test_bundled_mcp_config_bad_entry_shape_fails_cleanly(tmp_path):
    """A "bundled" entry missing a string `command` and a list-of-strings
    `args` fails with a clean `error: ...` message rather than raising or
    silently writing a malformed .mcp.json."""
    result, _ = _run(
        tmp_path,
        bundled_mcp_servers="aws-mcp",
        bundled_mcp_config={"aws-mcp": {"command": 123, "args": "not-a-list"}},
    )
    assert result.returncode != 0
    assert "error:" in result.stderr, result.stderr
    assert "command" in result.stderr, result.stderr


def test_bundled_mcp_config_unsupported_key_fails_cleanly(tmp_path):
    """A "bundled" entry with a key outside the documented
    command/args/url shape fails with a clean `error: ...` message."""
    result, _ = _run(
        tmp_path,
        bundled_mcp_servers="aws-mcp",
        bundled_mcp_config={
            "aws-mcp": {
                "command": "uvx",
                "args": ["mcp-proxy-for-aws-cli@latest"],
                "env": {"FOO": "bar"},
            }
        },
    )
    assert result.returncode != 0
    assert "error:" in result.stderr, result.stderr
    assert "env" in result.stderr, result.stderr


def test_conflicting_definitions_still_error_even_when_filtered_out(tmp_path):
    """A cross-spec conflict on a server that --bundled-mcp-servers would
    filter OUT anyway must still fail loudly: conflict detection runs on
    the full union before the allowlist is applied (see the script's own
    module docstring), so a broken reference config for a BYO server like
    playwright-mcp is still caught even though it never reaches .mcp.json."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "k-example.md").write_text("---\nname: k-example\n---\n", encoding="utf-8")

    agent_specs_dir = tmp_path / "agent-specs"
    agent_specs_dir.mkdir()
    _write_agent_spec(
        agent_specs_dir / "k-browser.agent-spec.json",
        "k-browser",
        {"playwright-mcp": {"command": "npx", "args": ["-y", "@playwright/mcp@latest"]}},
    )
    _write_agent_spec(
        agent_specs_dir / "k-other.agent-spec.json",
        "k-other",
        {"playwright-mcp": {"command": "npx", "args": ["-y", "@playwright/mcp@different"]}},
    )

    version_file = tmp_path / "VERSION"
    version_file.write_text("9.9.9\n", encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--template",
            str(TEMPLATE),
            "--version-file",
            str(version_file),
            "--agents-dir",
            str(agents_dir),
            "--output",
            str(tmp_path / "plugin.json"),
            "--agent-specs-dir",
            str(agent_specs_dir),
            "--mcp-output",
            str(tmp_path / ".mcp.json"),
            "--bundled-mcp-servers",
            "aws-mcp",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "conflicting" in result.stderr, result.stderr
