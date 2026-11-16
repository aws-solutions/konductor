# SPDX-License-Identifier: Apache-2.0
"""End-to-end regression test for scripts/assemble-claude-plugin-branch.sh's
MCP tool-name rewrite.

A prior revision collapsed the repo-root plugin layout into the flat
release tree and, in doing so, dropped the only call to
scripts/rewrite-claude-plugin-mcp-tool-names.py. The individual unit tests
in test_rewrite_claude_plugin_mcp_tool_names.py and
test_render_claude_plugin_json_bundled_mcp_servers.py each still passed,
since neither exercises assemble-claude-plugin-branch.sh itself -- so a
missing call site between them went undetected while published release
output silently kept the bare `mcp__aws-mcp__*` grant the published docs
told users to stop using.

This test runs the real script end to end (synth, install, flat-tree
assembly, plugin.json/.mcp.json rendering) and asserts the rewrite's
*output*, not that some script merely ran. It is intentionally the one
place that would fail if the call to rewrite-claude-plugin-mcp-tool-names.py
were ever dropped from assemble-claude-plugin-branch.sh again.

Requires build/cli/konductor to exist (`make -C cli build`); skipped
otherwise, same precondition the script itself enforces at runtime.

Run:  cd tests && pytest test_assemble_claude_plugin_branch_mcp_rewrite.py -v
"""

import json
import os
import re
import subprocess
from html.parser import HTMLParser
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "assemble-claude-plugin-branch.sh"
KONDUCTOR_BIN = REPO_ROOT / "build" / "cli" / "konductor"

pytestmark = pytest.mark.skipif(
    not KONDUCTOR_BIN.is_file(),
    reason=f"{KONDUCTOR_BIN} not found; run 'make -C cli build' first",
)


@pytest.fixture
def assembled(tmp_path):
    """Runs the real assembly script against this repo's own source tree,
    writing the flat plugin tree under a fresh tmp_path subdirectory (the
    script refuses to run if --out already exists). Returns that path."""
    out = tmp_path / "claude-plugin-branch"
    env = dict(os.environ)
    env["KONDUCTOR_BIN"] = str(KONDUCTOR_BIN)
    result = subprocess.run(
        ["bash", str(SCRIPT), "--out", str(out)],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return out


def test_bundled_server_agent_grants_use_the_plugin_scoped_prefix(assembled):
    """k-architect and k-developer are the only agent specs declaring the
    bundled aws-mcp server (see agents/*.agent-spec.json). Their assembled
    frontmatter must carry the plugin-scoped prefix, never the bare one --
    the exact regression PR #28 reintroduced."""
    plugin_name = json.loads(
        (assembled / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
    )["name"]

    checked_any = False
    for agent_file in ["k-architect.md", "k-developer.md"]:
        text = (assembled / "agents" / agent_file).read_text(encoding="utf-8")
        frontmatter = text.split("---", 2)[1]
        assert "mcp__aws-mcp__" not in frontmatter, (
            f"{agent_file}: bundled aws-mcp grant was left bare, the exact "
            f"PR #28 regression -- frontmatter:\n{frontmatter}"
        )
        assert f"mcp__plugin_{plugin_name}_aws-mcp__" in frontmatter, (
            f"{agent_file}: expected a plugin-scoped aws-mcp grant, got:\n{frontmatter}"
        )
        checked_any = True
    assert checked_any


def test_byo_server_grants_are_left_bare(assembled):
    """k-browser's playwright-mcp is bring-your-own, not bundled -- its
    grant must stay in the bare mcp__<server>__ form the user configures
    themselves, unaffected by the bundled-server rewrite."""
    text = (assembled / "agents" / "k-browser.md").read_text(encoding="utf-8")
    frontmatter = text.split("---", 2)[1]
    assert "mcp__playwright-mcp__" in frontmatter
    assert "mcp__plugin_" not in frontmatter


def test_no_assembled_agent_retains_any_bare_bundled_mcp_grant(assembled):
    """Belt-and-suspenders sweep across every assembled agent file: no
    frontmatter block may contain a bare `mcp__<bundled-server>__` prefix
    for a server scripts/claude-plugin-mcp-servers.json actually bundles.
    This is the exact shape `make claude-plugin-check` must fail on if the
    rewrite call is ever dropped again."""
    bundled_config = json.loads(
        (REPO_ROOT / "scripts" / "claude-plugin-mcp-servers.json").read_text(encoding="utf-8")
    )
    bundled_servers = list(bundled_config["bundled"].keys())
    assert bundled_servers, "expected at least one bundled server to check against"

    bare_pattern = re.compile(
        r"mcp__(" + "|".join(re.escape(s) for s in bundled_servers) + r")__"
    )

    offenders = []
    for agent_file in sorted((assembled / "agents").glob("*.md")):
        frontmatter = agent_file.read_text(encoding="utf-8").split("---", 2)[1]
        if bare_pattern.search(frontmatter):
            offenders.append(agent_file.name)
    assert offenders == [], (
        f"found bare bundled-server MCP grant(s) that survived assembly in: {offenders}"
    )


def test_assembled_tree_has_no_repo_root_plugin_layout_leftovers(assembled):
    """The flat tree is the only shape this repo ships -- confirms this
    test's own fixture didn't accidentally validate against a stray
    repo-root .claude-plugin/plugin.json or .mcp.json left over from a
    previous run of the (now removed) repo-root generation path."""
    assert not (REPO_ROOT / ".mcp.json").exists()
    # .claude-plugin/plugin.json is the flat tree's own file, written only
    # under `assembled`, never at the repo root.
    assert (assembled / ".claude-plugin" / "plugin.json").is_file()


def test_assembled_tree_ships_the_telemetry_hook(assembled):
    """The telemetry hook, its hooks.json, and the schema copy land in the
    flat tree, and the SubagentStart matcher covers every assembled agent."""
    assert (assembled / "hooks" / "konductor-telemetry.js").is_file()
    assert (assembled / "docs" / "telemetry-schema.json").read_bytes() == (
        REPO_ROOT / "docs" / "telemetry-schema.json"
    ).read_bytes()

    hooks = json.loads((assembled / "hooks" / "hooks.json").read_text(encoding="utf-8"))["hooks"]
    assert hooks["SessionStart"][0]["matcher"] == "startup|clear"
    for event in ("SessionStart", "SubagentStart"):
        handler = hooks[event][0]["hooks"][0]
        assert handler["async"] is True
        assert '"${CLAUDE_PLUGIN_ROOT}/hooks/konductor-telemetry.js"' in handler["command"]

    plugin = json.loads((assembled / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    assert plugin["userConfig"]["telemetry_enabled"]["type"] == "boolean"
    matcher = re.compile(hooks["SubagentStart"][0]["matcher"])
    for agent_file in (assembled / "agents").glob("*.md"):
        assert matcher.search(f"{plugin['name']}:{agent_file.stem}"), agent_file.name
        assert not matcher.search(agent_file.stem), agent_file.name
    assert not matcher.search("Explore")


def test_assembled_agents_carry_no_ignored_mcp_servers_block(assembled):
    for agent in (assembled / "agents").glob("*.md"):
        frontmatter = agent.read_text(encoding="utf-8").split("---")[1]
        assert not re.search(r"^mcpServers:", frontmatter, re.M), agent.name
    assert (assembled / ".mcp.json").is_file()


def test_plugin_json_leaves_agents_and_skills_to_default_scans(assembled):
    plugin = json.loads((assembled / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    assert "agents" not in plugin
    assert "skills" not in plugin


def test_assembled_agents_use_claude_code_model_ids(assembled):
    for agent in (assembled / "agents").glob("*.md"):
        model = re.search(r"^model: (.+)$", agent.read_text(encoding="utf-8"), re.M).group(1)
        assert re.fullmatch(
            r"claude-(?:opus|sonnet|haiku|fable)-\d{1,2}(?:-\d{1,2})?(?:-\d{8})?|inherit", model
        ), f"{agent.name}: {model}"


class _LinkAttrs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ("src", "href") and value is not None:
                self.targets.append(value)
            elif name == "srcset" and value:
                self.targets += [c.split()[0] for c in value.split(",") if c.strip()]


def _readme_link_targets(readme):
    # Found independently of the rewriter's regex, so a link form the rewriter
    # misses still fails here.
    prose = re.sub(r"^(```|~~~).*?^\1[ \t]*$", "", readme, flags=re.M | re.S)
    attrs = _LinkAttrs()
    attrs.feed(prose)
    targets = list(attrs.targets)
    for match in re.finditer(r"\]\(", prose):
        rest = prose[match.end():]
        if rest.startswith("<"):
            targets.append(rest[1:rest.index(">")])
        else:
            targets.append(re.match(r"[^)\s]*", rest).group(0))
    targets += re.findall(r"^ {0,3}\[[^\]\n]+\]:[ \t]*<?([^>\s]+)", prose, re.M)
    return targets


def test_assembled_tree_ships_notice_and_absolute_readme_links(assembled):
    assert (assembled / "NOTICE.txt").is_file()
    readme = (assembled / "README.md").read_text(encoding="utf-8")
    targets = _readme_link_targets(readme)
    shipped = {"LICENSE.txt", "NOTICE.txt"}
    relative = [
        t for t in targets
        if not re.match(r"^(?:[a-z][a-z0-9+.-]*:|#|/)", t, re.I) and t.split("#", 1)[0] not in shipped
    ]
    assert targets, "expected links in the assembled README"
    assert not relative, f"README links that point at files the plugin does not ship: {relative}"
    assert "](LICENSE.txt)" in readme
