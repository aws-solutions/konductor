# SPDX-License-Identifier: Apache-2.0
"""Regression test: every agent spec in this package's own `agents/`
directory, with an effective `clientConfig.claudeCli.tools` allowlist --
inline or inherited via `includes` -- must include "Skill".

`clientConfig.claudeCli.tools`, when present, is an allowlist: Claude Code
grants only the tools listed there. `Skill` is Claude Code's native tool for
on-demand skill discovery -- skills not preloaded via `clientConfig.
claudeCli.skills` are unreachable without it.

This package is consumed by downstream packages from the version set, not
from a sibling checkout, so this test is fully self-contained: it only
walks this package's own `agents/` directory and only resolves `includes`
targets found there. It never reads or references any other package.

An `includes` target that does not resolve within this package's own
`agents/` directory is a real defect (a dangling or typo'd reference) --
there is no sibling-checkout ambiguity here, since every target this
package's specs can legally `includes` lives in this same directory.

A bare "*" in a tools list grants every tool, including "Skill"; that is
treated as satisfying the check rather than flagged as a violation.

Run:  cd tests && pytest test_claude_skill_tool_grant.py -v
"""

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = REPO_ROOT / "agents"


def _load_json(path):
    return json.loads(path.read_text())


def _own_claude_tools(spec):
    """Return this spec's own claudeCli.tools, or None if the field is
    absent from the spec's own JSON."""
    return spec.get("clientConfig", {}).get("claudeCli", {}).get("tools")


def _grants_skill(tools):
    """True if `tools` grants "Skill" -- named directly, or via a bare "*"
    wildcard that grants every tool."""
    return tools is not None and ("Skill" in tools or "*" in tools)


def _build_spec_index(agents_dir):
    """Map agent name -> spec dict, scanning every *.agent-spec.json in
    `agents_dir`. A duplicate name is a build-breaking condition and raises
    immediately rather than silently collapsing to the last file scanned."""
    index = {}
    name_sources = {}
    for spec_path in sorted(agents_dir.glob("*.agent-spec.json")):
        spec = _load_json(spec_path)
        name = spec.get("name", spec_path.stem.replace(".agent-spec", ""))
        assert name not in index, (
            f"duplicate agent name {name!r}: declared by both {name_sources[name]} and {spec_path}"
        )
        index[name] = spec
        name_sources[name] = spec_path
    return index


def _effective_claude_tools(name, index, _seen=None):
    """Resolve `name`'s effective clientConfig.claudeCli.tools: union-merge
    its own tools (if any) with the effective tools of every agent in its
    `includes` chain.

    Returns `(tools, unresolved)`: `tools` is None only if nothing in the
    chain declares a tools allowlist. `unresolved` is the set of `includes`
    names, anywhere in the chain, not found in `index` -- always a real
    defect in this package, since there is no other directory a valid
    `includes` target could legally live in.
    """
    if _seen is None:
        _seen = set()
    if name in _seen:
        return None, set()
    _seen = _seen | {name}

    spec = index.get(name)
    if spec is None:
        return None, {name}

    merged = None
    own = _own_claude_tools(spec)
    if own is not None:
        merged = list(own)

    unresolved = set()
    for entry in spec.get("includes") or []:
        included_name = entry["agent"] if isinstance(entry, dict) else entry
        inherited, inherited_unresolved = _effective_claude_tools(included_name, index, _seen)
        unresolved |= inherited_unresolved
        if inherited is None:
            continue
        if merged is None:
            merged = []
        for tool in inherited:
            if tool not in merged:
                merged.append(tool)

    return merged, unresolved


def test_claude_cli_tools_allowlist_grants_skill():
    index = _build_spec_index(AGENTS_DIR)
    specs = sorted(AGENTS_DIR.glob("*.agent-spec.json"))
    assert specs, f"no agent specs found in {AGENTS_DIR}"

    failures = []
    for spec_path in specs:
        spec = _load_json(spec_path)
        name = spec.get("name", spec_path.stem.replace(".agent-spec", ""))
        tools, unresolved = _effective_claude_tools(name, index)

        if unresolved:
            failures.append(
                f"{spec_path.name}: includes target(s) {sorted(unresolved)} "
                "not found in this package's own agents directory"
            )
            continue
        if tools is None:
            continue
        if not _grants_skill(tools):
            failures.append(spec_path.name)

    assert not failures, (
        "The following agent specs either end up with an effective "
        "clientConfig.claudeCli.tools allowlist (declared inline and/or "
        "inherited via `includes`) that omits \"Skill\", so they cannot "
        "invoke any skill on demand in Claude Code, or reference an "
        "`includes` target that does not exist in this package's own "
        "agents directory:\n" + "\n".join(failures)
    )


def _write_spec(agents_dir, name, *, includes=None, own_tools=None):
    """Write a minimal agent-spec.json fixture into `agents_dir` (always a
    pytest `tmp_path` subdirectory in this regression test -- never a real
    package directory)."""
    spec = {"schemaVersion": "1", "name": name, "config": {"description": "fixture agent"}}
    if includes is not None:
        spec["includes"] = includes
    if own_tools is not None:
        spec["clientConfig"] = {"claudeCli": {"tools": own_tools}}
    agents_dir.mkdir(parents=True, exist_ok=True)
    (agents_dir / f"{name}.agent-spec.json").write_text(json.dumps(spec))


def test_unresolved_include_fails(tmp_path):
    """A dangling `includes` reference is always a real defect in this
    package -- there is no sibling-checkout case to give it the benefit of
    the doubt, so it must fail rather than skip."""
    agents_dir = tmp_path / "agents"
    _write_spec(agents_dir, "child", includes=["base-does-not-exist"])

    index = _build_spec_index(agents_dir)
    tools, unresolved = _effective_claude_tools("child", index)
    assert unresolved == {"base-does-not-exist"}


def test_wildcard_tools_grant_satisfies_skill_check():
    assert _grants_skill(["Read", "*"])
    assert _grants_skill(["*"])
    assert not _grants_skill(["Read", "Glob"])
    assert not _grants_skill(None)


def test_included_agent_contributes_skill(tmp_path):
    """An agent that inherits "Skill" via `includes` (rather than declaring
    it itself) still passes -- inheritance is a legitimate grant path."""
    agents_dir = tmp_path / "agents"
    _write_spec(agents_dir, "base", own_tools=["Read", "Skill"])
    _write_spec(agents_dir, "child", includes=["base"], own_tools=["Read"])

    index = _build_spec_index(agents_dir)
    tools, unresolved = _effective_claude_tools("child", index)
    assert unresolved == set()
    assert _grants_skill(tools)
