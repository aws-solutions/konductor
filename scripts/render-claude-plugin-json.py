#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Render .claude-plugin/plugin.json deterministically from
scripts/claude-plugin.template.json, overriding only two fields:

- `version`: read from the repo's root VERSION file, which is this repo's
  single source of truth for the released version (see
  scripts/validate-version-semver.sh and .github/workflows/release.yml's
  check-version job; the CLI's own Cargo.toml version is required to
  match VERSION before a release, never the other way around).
- `agents`: the sorted list of *.md files under
  generated/claude-plugin/agents/, so the manifest always reflects exactly
  what synth produced, never hand-maintained.

Also strips two keys from `metadata`, if present, defensively: the
committed template never carries either key, but a hand-edit could
reintroduce one, and neither belongs in the rendered output:

- `sourcePackage`: would name an internal-only package identifier that has
  no meaning outside this repo's own internal mirror; it does not belong in
  a public artifact.
- `generatedAt`: a real timestamp would make every regeneration
  byte-different for no benefit. `make claude-plugin-check` (and anyone
  diffing two runs) depends on byte-identical re-runs when nothing in the
  source content actually changed.

Every other field (name, displayName, description, author, homepage,
repository, license, keywords, defaultEnabled, skills, and the remaining
metadata fields) is carried through from the template unchanged, in its
original key order. This script does not know or need to know what those
fields mean; it only knows how to compute `version` and `agents`, and (with
--path-prefix) rewrite path-shaped fields.

--path-prefix supports a second caller: .github/workflows/release.yml's
`publish-claude-plugin` job (via scripts/assemble-claude-plugin-branch.sh)
renders a second plugin.json for the flat tree published to the
`claude-plugin` branch, where `agents/` and `skills/` sit at the tree root
instead of under `generated/claude-plugin/`. Any template string that starts
with the default prefix (`./generated/claude-plugin/`) has that leading
segment replaced with --path-prefix's value; every other string is left
untouched. This is a generic, field-name-agnostic string rewrite (it also
catches the template's static `skills` entry, not just the freshly computed
`agents` list) rather than two copies of the same substitution logic.

--agent-specs-dir and --mcp-output (both optional, required together) also
render a SECOND file: .mcp.json, the plugin-level MCP server declaration
Claude Code reads at a plugin's root
(https://code.claude.com/docs/en/plugins/components#mcp-servers). This is
the deduplicated union of every agents/*.agent-spec.json's
dependencies.mcpRegistry entry, sorted by server name for determinism.
Necessary because Claude Code ignores an agent's own `mcpServers:`
frontmatter when that agent is loaded from a plugin (unlike a standalone
`.claude/agents/` install, where `konductor install --harness claude`
already renders `mcpServers:` per agent from the same
dependencies.mcpRegistry source. See cli/konductor-rs/src/cli/synth/
claude.rs's own module docstring. So the plugin needs this file to
declare the identical servers at the plugin level instead. Two agents
declaring the SAME server name with DIFFERENT definitions is an error, not
a silently-resolved conflict: which one wins would depend on directory
iteration order, and reconciling a real conflict is a decision for a
human, not this script. Conflict detection runs across every declared
server regardless of --bundled-mcp-servers, so a reference-only (BYO)
entry like k-browser's playwright-mcp still gets validated for
consistency even though it is filtered out of the written .mcp.json.

--bundled-mcp-servers (optional) is a comma-separated allowlist that
filters the union computed above down to only the servers Konductor
actually packages. MCP servers are bring-your-own by default (the user
configures them under the same name the agent's tool grant already
names), and today only aws-mcp is packaged for Claude Code. Sourced from
scripts/claude-plugin-mcp-servers.json's "bundled" object (keys only),
the single source of truth this flag and `konductor synth
--claude-bundled-mcp-servers` (cli/konductor-rs/src/cli.rs) both read, so
the Rust-side agent-file rendering and this script's plugin-level
.mcp.json never disagree about which servers are packaged. Omitting it
is an empty allowlist: .mcp.json's "mcpServers" is written empty,
matching `--claude-bundled-mcp-servers`'s own documented default.

--bundled-mcp-config (optional) points at that same
scripts/claude-plugin-mcp-servers.json file (or a compatible one) to
source the actual launch DEFINITION (command/args/url) for each
allowlisted server from its "bundled" object, instead of from the
agent-spec union computed above, so the pinned command Konductor
recommends always wins over whatever an individual agent spec's own
dependencies.mcpRegistry entry happens to say for that server. A name
present in --bundled-mcp-servers but absent from this file's "bundled"
object still falls back to the agent-spec union unchanged.

Called by scripts/generate-claude-plugin.sh and
scripts/assemble-claude-plugin-branch.sh. Not meant to be run directly.
"""
import argparse
import json
import sys
from pathlib import Path

DEFAULT_PREFIX = "./generated/claude-plugin/"

# The only keys a --bundled-mcp-config "bundled.<name>" entry may carry.
# "command"/"args" are required (the launch shape every entry uses today);
# "url" is optional and documented here for a future HTTP-based bundled
# server, matching the third field of the Rust side's McpServerDef struct
# (cli/konductor-rs/src/cli/synth/parser.rs). No other key is allowed.
_BUNDLED_CONFIG_ENTRY_KEYS = {"command", "args", "url"}


def _validate_bundled_config(config_bundled) -> str | None:
    """Validates the shape of --bundled-mcp-config's top-level "bundled"
    value. Returns None on success, or a human-readable error string
    describing the first shape violation found (the caller prints it to
    stderr and exits non-zero). Never raises, so a malformed config
    fails cleanly instead of with a Python traceback."""
    if not isinstance(config_bundled, dict):
        return (
            '"bundled" must be a JSON object mapping server name to launch '
            f"definition, got {type(config_bundled).__name__}"
        )
    for name, definition in config_bundled.items():
        if not isinstance(definition, dict):
            return (
                f'"bundled.{name}" must be a JSON object, got '
                f"{type(definition).__name__}"
            )
        extra_keys = sorted(set(definition.keys()) - _BUNDLED_CONFIG_ENTRY_KEYS)
        if extra_keys:
            return f'"bundled.{name}" has unsupported key(s): {extra_keys}'
        command = definition.get("command")
        if not isinstance(command, str):
            return f'"bundled.{name}.command" must be a string, got {type(command).__name__}'
        args = definition.get("args")
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            return f'"bundled.{name}.args" must be a list of strings'
        if "url" in definition and not isinstance(definition["url"], str):
            return (
                f'"bundled.{name}.url" must be a string, got '
                f"{type(definition['url']).__name__}"
            )
    return None


def _load_mcp_registry_union(agent_specs_dir: Path):
    """Reads every *.agent-spec.json under agent_specs_dir (sorted, for
    deterministic error messages) and returns the union of
    dependencies.mcpRegistry entries as a dict keyed by server name, sorted
    by key for deterministic output.

    Returns (servers, None) on success, or (None, error_message) when two
    specs declare the same server name with conflicting definitions --
    the caller is expected to print error_message to stderr and exit
    non-zero rather than silently pick one definition over the other."""
    servers: dict = {}
    declared_by: dict = {}
    for spec_path in sorted(agent_specs_dir.glob("*.agent-spec.json")):
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        registry = spec.get("dependencies", {}).get("mcpRegistry", {})
        for server_name, definition in registry.items():
            if server_name in servers and servers[server_name] != definition:
                return None, (
                    f"conflicting dependencies.mcpRegistry definitions for server "
                    f"'{server_name}': {declared_by[server_name]} declares "
                    f"{json.dumps(servers[server_name])}, {spec_path.name} declares "
                    f"{json.dumps(definition)}"
                )
            servers[server_name] = definition
            declared_by[server_name] = spec_path.name
    return dict(sorted(servers.items())), None


def _rewrite_prefix(value, path_prefix: str):
    """Recursively replace a leading DEFAULT_PREFIX with path_prefix in every
    string found in `value` (a JSON-decoded structure: dict/list/scalar)."""
    if isinstance(value, str):
        if value.startswith(DEFAULT_PREFIX):
            return path_prefix + value[len(DEFAULT_PREFIX):]
        return value
    if isinstance(value, list):
        return [_rewrite_prefix(v, path_prefix) for v in value]
    if isinstance(value, dict):
        return {k: _rewrite_prefix(v, path_prefix) for k, v in value.items()}
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--template",
        required=True,
        type=Path,
        help=(
            "scripts/claude-plugin.template.json (or a compatible file) to use as the "
            "base for every field other than version/agents. Its own version/agents "
            "values are placeholders always overwritten, kept in the template only "
            "so the rendered output preserves their original key position."
        ),
    )
    parser.add_argument(
        "--version-file",
        required=True,
        type=Path,
        help="Path to the repo's root VERSION file",
    )
    parser.add_argument(
        "--agents-dir",
        required=True,
        type=Path,
        help="Directory whose sorted *.md filenames become the agents list",
    )
    parser.add_argument(
        "--path-prefix",
        default=DEFAULT_PREFIX,
        help=(
            f"Replace the default '{DEFAULT_PREFIX}' path prefix with this value "
            "everywhere it appears in the template (agents entries and any other "
            "path-shaped field, e.g. skills). Default: no rewrite (identity)."
        ),
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="Where to write the rendered plugin.json",
    )
    parser.add_argument(
        "--agent-specs-dir",
        type=Path,
        default=None,
        help=(
            "Directory of source agents/*.agent-spec.json files (this repo's own "
            "agents/ directory) to derive the union of dependencies.mcpRegistry "
            "entries from, for --mcp-output. Required together with --mcp-output; "
            "omit both to skip generating .mcp.json."
        ),
    )
    parser.add_argument(
        "--mcp-output",
        type=Path,
        default=None,
        help=(
            "Where to write the generated .mcp.json (the plugin-level MCP server "
            "declaration Claude Code reads at the plugin root). Written as the "
            "union of every --agent-specs-dir agent spec's dependencies.mcpRegistry "
            "entries, sorted by server name for determinism. Requires "
            "--agent-specs-dir; omit both to skip."
        ),
    )
    parser.add_argument(
        "--bundled-mcp-servers",
        default=None,
        help=(
            "Comma-separated allowlist of dependencies.mcpRegistry server names to "
            "include in --mcp-output (e.g. 'aws-mcp'). Servers not in this list are "
            "still validated for cross-spec definition conflicts, but dropped from "
            "the written .mcp.json. See scripts/claude-plugin-mcp-servers.json, "
            "the file this list is normally sourced from. Only meaningful together "
            "with --agent-specs-dir/--mcp-output. Omitting it is an empty "
            "allowlist, matching --claude-bundled-mcp-servers' own default on the "
            "`konductor synth` side."
        ),
    )
    parser.add_argument(
        "--bundled-mcp-config",
        type=Path,
        default=None,
        help=(
            "Path to scripts/claude-plugin-mcp-servers.json (or a compatible file) "
            "whose top-level \"bundled\" object maps a server name to its own "
            "launch definition (command/args/url). When given, the definition "
            "written to --mcp-output for each allowlisted name that also appears "
            "in this file's \"bundled\" object comes from HERE, not from the union "
            "of agent specs' own dependencies.mcpRegistry entries, so the launch "
            "command/args/pin this file declares always wins over whatever an "
            "individual agent spec happens to say for that same server name. A "
            "name only present in --bundled-mcp-servers but absent from this "
            "file's \"bundled\" object falls back to the agent-spec union, "
            "unchanged. Optional; omitting it preserves the pre-existing "
            "agent-spec-sourced behavior entirely."
        ),
    )
    args = parser.parse_args()

    if bool(args.agent_specs_dir) != bool(args.mcp_output):
        print(
            "error: --agent-specs-dir and --mcp-output must be given together",
            file=sys.stderr,
        )
        return 1

    if not args.template.is_file():
        print(f"error: template not found: {args.template}", file=sys.stderr)
        return 1
    if not args.version_file.is_file():
        print(f"error: VERSION file not found: {args.version_file}", file=sys.stderr)
        return 1
    if not args.agents_dir.is_dir():
        print(f"error: agents directory not found: {args.agents_dir}", file=sys.stderr)
        return 1

    plugin = json.loads(args.template.read_text(encoding="utf-8"))

    version = args.version_file.read_text(encoding="utf-8").strip()
    if not version:
        print(f"error: {args.version_file} is empty", file=sys.stderr)
        return 1
    plugin["version"] = version

    agent_files = sorted(p.name for p in args.agents_dir.glob("*.md"))
    if not agent_files:
        print(f"error: no agent .md files found under {args.agents_dir}", file=sys.stderr)
        return 1
    plugin["agents"] = [f"{DEFAULT_PREFIX}agents/{name}" for name in agent_files]

    metadata = plugin.get("metadata")
    if isinstance(metadata, dict):
        metadata.pop("sourcePackage", None)
        metadata.pop("generatedAt", None)

    if args.path_prefix != DEFAULT_PREFIX:
        plugin = _rewrite_prefix(plugin, args.path_prefix)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(plugin, indent=2) + "\n", encoding="utf-8")

    if args.agent_specs_dir and args.mcp_output:
        if not args.agent_specs_dir.is_dir():
            print(
                f"error: agent specs directory not found: {args.agent_specs_dir}",
                file=sys.stderr,
            )
            return 1
        servers, error = _load_mcp_registry_union(args.agent_specs_dir)
        if error is not None:
            print(f"error: {error}", file=sys.stderr)
            return 1
        allowlist = {
            name.strip()
            for name in (args.bundled_mcp_servers or "").split(",")
            if name.strip()
        }
        servers = {name: definition for name, definition in servers.items() if name in allowlist}
        if args.bundled_mcp_config is not None:
            if not args.bundled_mcp_config.is_file():
                print(
                    f"error: --bundled-mcp-config not found: {args.bundled_mcp_config}",
                    file=sys.stderr,
                )
                return 1
            try:
                config = json.loads(args.bundled_mcp_config.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                print(
                    f"error: --bundled-mcp-config {args.bundled_mcp_config} is not valid "
                    f"JSON: {exc}",
                    file=sys.stderr,
                )
                return 1
            if not isinstance(config, dict) or "bundled" not in config:
                print(
                    f"error: --bundled-mcp-config {args.bundled_mcp_config} must contain a "
                    'top-level "bundled" object',
                    file=sys.stderr,
                )
                return 1
            config_bundled = config["bundled"]
            shape_error = _validate_bundled_config(config_bundled)
            if shape_error is not None:
                print(
                    f"error: --bundled-mcp-config {args.bundled_mcp_config}: {shape_error}",
                    file=sys.stderr,
                )
                return 1
            for name in servers:
                if name in config_bundled:
                    servers[name] = config_bundled[name]
        args.mcp_output.parent.mkdir(parents=True, exist_ok=True)
        args.mcp_output.write_text(
            json.dumps({"mcpServers": servers}, indent=2) + "\n", encoding="utf-8"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
