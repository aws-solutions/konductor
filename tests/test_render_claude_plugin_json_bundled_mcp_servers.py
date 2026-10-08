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

The launch definition for an allowlisted server comes straight from the
agent specs' own dependencies.mcpRegistry entry -- there is no separate
override file. k-architect and k-developer each declare the pinned
`mcp-proxy-for-aws-cli==1.7.0` command directly, and must declare it
identically (see test_bundled_server_definitions_are_byte_identical_across_
agent_specs and test_direct_pinned_definition_reaches_rendered_mcp_output
below).

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


def _run(tmp_path: Path, bundled_mcp_servers=None):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "k-example.md").write_text("---\nname: k-example\n---\n", encoding="utf-8")

    agent_specs_dir = tmp_path / "agent-specs"
    agent_specs_dir.mkdir()
    _write_agent_spec(
        agent_specs_dir / "k-architect.agent-spec.json",
        "k-architect",
        {"aws-mcp": {"command": "uvx", "args": ["mcp-proxy-for-aws-cli==1.7.0"]}},
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


def test_direct_pinned_definition_reaches_rendered_mcp_output(tmp_path):
    """The launch definition written to .mcp.json for an allowlisted
    server comes straight from the agent spec's own
    dependencies.mcpRegistry entry -- no override file sits in between."""
    result, mcp_output = _run(tmp_path, bundled_mcp_servers="aws-mcp")
    assert result.returncode == 0, result.stderr

    rendered = json.loads(mcp_output.read_text(encoding="utf-8"))
    assert rendered["mcpServers"]["aws-mcp"]["args"] == ["mcp-proxy-for-aws-cli==1.7.0"], rendered


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


def test_bundled_server_definitions_are_byte_identical_across_agent_specs():
    """Regression guard for the direct-pin simplification: k-architect and
    k-developer are the only agent specs declaring the bundled aws-mcp
    server, and the renderer's own conflict detection (see
    _load_mcp_registry_union) would already fail the build if they ever
    diverged -- this test fails fast and names the exact mismatch instead
    of waiting for that generic conflict error."""
    specs_dir = REPO_ROOT / "agents"
    definitions = {}
    for name in ("k-architect", "k-developer"):
        spec = json.loads((specs_dir / f"{name}.agent-spec.json").read_text(encoding="utf-8"))
        definitions[name] = spec["dependencies"]["mcpRegistry"]["aws-mcp"]

    assert definitions["k-architect"] == definitions["k-developer"], (
        f"k-architect and k-developer must declare an identical aws-mcp "
        f"launch definition, got:\n{definitions}"
    )


def test_shipped_bundled_aws_proxy_is_exactly_pinned():
    """The pinned command lives in the agent specs themselves now, not in
    scripts/claude-plugin-mcp-servers.json's "bundled" object (which only
    lists bundled server NAMES -- see that file's own $comment)."""
    spec = json.loads(
        (REPO_ROOT / "agents" / "k-architect.agent-spec.json").read_text(encoding="utf-8")
    )

    assert (
        spec["dependencies"]["mcpRegistry"]["aws-mcp"]["args"][0] == "mcp-proxy-for-aws-cli==1.7.0"
    )
