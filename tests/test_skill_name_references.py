# SPDX-License-Identifier: Apache-2.0
"""Skill names that agents are told to load must resolve, and agents must declare them.

1. Every skill named as a load, use or declare target in skills/, agent-sops/,
   context/ and docs/user-guide/, and every name in an agent's skill slots, is a
   skill under skills/ or a skill the AWS MCP server serves.
2. When an agent declares skill S and S tells the agent to load local skill T,
   the agent declares T in both dependencies.skills.skillNames and
   clientConfig.claudeCli.skills.

No network: the AWS MCP skill names are pinned below.

Run:  python3 -m pytest tests/test_skill_name_references.py -v
"""

import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"
AGENTS_DIR = REPO_ROOT / "agents"

LOCAL_SKILLS = {p.parent.name for p in SKILLS_DIR.glob("*/SKILL.md")}
AGENTS = {p.name.removesuffix(".agent-spec.json") for p in AGENTS_DIR.glob("*.agent-spec.json")}
SOPS = {p.name.removesuffix(".sop.md") for p in (REPO_ROOT / "agent-sops").glob("*.sop.md")}

# Skills the AWS MCP server (aws-mcp) serves through aws___retrieve_skill. They
# are not in this repo, so a name here resolves without a local skills/ entry.
# Add a name only after confirming the server serves it.
AWS_MCP_SKILLS = {
    "amazon-dynamodb",
    "aws-billing-and-cost-management",
    "aws-cdk",
    "aws-cloudformation",
    "aws-iam",
    "aws-well-architected-review",
    "creating-secrets-using-best-practices",
    "securing-s3-buckets",
    "setting-up-cloudtrail-multi-region",
}

# Kebab-case names that the patterns below catch but that are not skills.
NOT_SKILLS = {
    "add-to-existing",  # an e2e SOP mode value
    "alert-rule-management",  # an example feature name
    "aws-mcp",  # the MCP server's name
    "data-cy",  # a Cypress selector attribute
    "data-testid",  # a test selector attribute
    "general-tradeoff",  # a deliberation-panel decision_domain value
    "network-monitoring-dashboard",  # an example feature name
    "playwright-mcp",  # the browser MCP server's name
    "research-options",  # a deliberation-panel decision_domain value
    "single-document",  # a design-evaluation mode value
    "user-authentication",  # an example feature name
    "verify-run",  # a konductor CLI subcommand
    "viability-feasibility",  # a deliberation-panel decision_domain value
    "vpc-flow-log-analyzer",  # an example feature name
}

NAME = r"`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`"
REFERENCE_PATTERNS = [
    re.compile(
        r"\b(?:load|loads|loading|loaded|declare|declares|declared|recommend|recommends|invoke|"
        r"invokes|apply|applies|use|uses|run|runs|follow|follows)\s+"
        r"(?:the\s+|its\s+|AWS MCP server's\s+|server's\s+)?" + NAME,
        re.I,
    ),
    re.compile(NAME + r"\s+skill\b"),
    re.compile(r"\bskill\s+" + NAME),
    re.compile(r"\bfrom\s+" + NAME),
    re.compile(NAME + r"\s+covers\b"),
    # a table cell holding only a backticked skill name; bare cells also hold
    # ordinary words ("unit-prompts"), so they are not matched
    re.compile(r"\|\s*" + NAME + r"\s*\|"),
]
# A row of the published skills catalog: the first cell is a skill name.
CATALOG_ROW = re.compile(r"^\| " + NAME + r" \|", re.M)

# What a skill tells its agent to load: "load `x`", "through `find-aws-skills`".
# "`k-developer` with `backend-review`" names another agent's skill, and
# "use `x` instead" points elsewhere; neither is a dependency.
LOAD_TARGET = re.compile(
    r"(?<!` )\b(?:load|loads|loading|invoke|invokes|apply|applies|through|via|with)\s+"
    r"(?:the\s+|its\s+)?" + NAME + r"(?!\s+instead)",
    re.I,
)


def _markdown_files():
    roots = ["skills", "agent-sops", "context", "docs/user-guide"]
    for root in roots:
        yield from sorted((REPO_ROOT / root).rglob("*.md"))


def _specs():
    for spec in sorted(AGENTS_DIR.glob("*.agent-spec.json")):
        yield spec.name.removesuffix(".agent-spec.json"), json.loads(spec.read_text(encoding="utf-8"))


def _slots(spec):
    skill_names = spec.get("dependencies", {}).get("skills", {}).get("skillNames", [])
    claude = spec.get("clientConfig", {}).get("claudeCli", {}).get("skills", [])
    return set(skill_names), set(claude)


def _known(name):
    return name in LOCAL_SKILLS or name in AWS_MCP_SKILLS


def _text_references():
    for path in _markdown_files():
        text = path.read_text(encoding="utf-8")
        found = set()
        for pattern in REFERENCE_PATTERNS:
            found.update(pattern.findall(text))
        if path.name == "skills.md":
            found.update(CATALOG_ROW.findall(text))
        for name in sorted(found - AGENTS - SOPS - NOT_SKILLS):
            yield path.relative_to(REPO_ROOT).as_posix(), name


TEXT_REFERENCES = list(_text_references())


def test_text_references_are_found():
    assert TEXT_REFERENCES, "no skill references found; the patterns are probably wrong"


@pytest.mark.parametrize("where,name", TEXT_REFERENCES, ids=[f"{w}:{n}" for w, n in TEXT_REFERENCES])
def test_text_reference_resolves(where, name):
    assert _known(name), f"{where} names skill {name}, which is not under skills/ or in AWS_MCP_SKILLS"


@pytest.mark.parametrize("agent,spec", list(_specs()), ids=[a for a, _ in _specs()])
def test_agent_skill_slots_resolve(agent, spec):
    skill_names, claude = _slots(spec)
    unknown = sorted(n for n in skill_names | claude if n not in LOCAL_SKILLS)
    assert not unknown, f"{agent} declares skills that are not under skills/: {unknown}"


def test_allowlists_are_still_needed():
    seen = {name for _, name in TEXT_REFERENCES}
    hits = set()
    for path in _markdown_files():
        text = path.read_text(encoding="utf-8")
        for pattern in REFERENCE_PATTERNS:
            hits.update(pattern.findall(text))
    stale_aws = sorted(AWS_MCP_SKILLS - seen)
    stale_not = sorted(NOT_SKILLS - hits)
    assert not stale_aws, f"AWS_MCP_SKILLS entries no longer referenced: {stale_aws}"
    assert not stale_not, f"NOT_SKILLS entries no longer matched: {stale_not}"


def load_targets(skill):
    """Local skills that `skill` tells its agent to load."""
    directory = SKILLS_DIR / skill
    files = [directory / "SKILL.md", *sorted((directory / "references").glob("*.md"))]
    targets = set()
    for path in files:
        targets.update(LOAD_TARGET.findall(path.read_text(encoding="utf-8")))
    return {t for t in targets if t in LOCAL_SKILLS and t != skill}


def closure_gaps(agent, spec):
    skill_names, claude = _slots(spec)
    gaps = []
    for skill in sorted((skill_names | claude) & LOCAL_SKILLS):
        for target in sorted(load_targets(skill)):
            missing = [slot for slot, names in (("skillNames", skill_names), ("claudeCli.skills", claude))
                       if target not in names]
            if missing:
                gaps.append(f"{skill} loads {target}, missing from {', '.join(missing)}")
    return gaps


@pytest.mark.parametrize("agent,spec", list(_specs()), ids=[a for a, _ in _specs()])
def test_agent_declares_the_skills_its_skills_load(agent, spec):
    gaps = closure_gaps(agent, spec)
    assert not gaps, f"{agent}: " + "; ".join(gaps)
