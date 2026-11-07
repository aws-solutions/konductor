# SPDX-License-Identifier: Apache-2.0
"""A welcome message offers only SOPs its agent declares, and no page names k-architect as the adversarial SOP's owner.

The Kiro `welcomeMessage` lists SOPs by hand, so it kept `/k-adversarial-pull-request-review`
after that SOP moved from `k-architect` to the orchestrators.
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ADVERSARIAL_SOP = "k-adversarial-pull-request-review"
WELCOME_SOP_LINE = re.compile(r"^\s+/([a-z][a-z0-9-]*) \u2014 ", flags=re.MULTILINE)
GENERATED_DIRS = ["dist/kiro-v3/agents", "dist/kiro-cli-v2/agents"]
BUNDLES = ["docs/index.html", "docs/site/user-guide.html"]


def all_agents():
    return sorted(p.name.removesuffix(".agent-spec.json") for p in (ROOT / "agents").glob("*.agent-spec.json"))


def spec(agent):
    return json.loads((ROOT / "agents" / f"{agent}.agent-spec.json").read_text(encoding="utf-8"))


def declared_sops(agent):
    return spec(agent)["dependencies"]["agentSops"]["agentSopNames"]


def advertised_sops(welcome):
    return WELCOME_SOP_LINE.findall(welcome)


@pytest.mark.parametrize("agent", all_agents())
def test_spec_welcome_offers_only_declared_sops(agent):
    welcome = spec(agent)["clientConfig"]["kiroCli"].get("welcomeMessage", "")
    undeclared = [s for s in advertised_sops(welcome) if s not in declared_sops(agent)]
    assert not undeclared, f"{agent} welcomeMessage offers SOPs it does not declare: {undeclared}"


@pytest.mark.parametrize("generated", GENERATED_DIRS)
@pytest.mark.parametrize("agent", all_agents())
def test_generated_welcome_offers_only_declared_sops(generated, agent):
    path = ROOT / generated / f"{agent}.json"
    welcome = json.loads(path.read_text(encoding="utf-8")).get("welcomeMessage", "")
    undeclared = [s for s in advertised_sops(welcome) if s not in declared_sops(agent)]
    assert not undeclared, f"{generated}/{agent}.json offers SOPs {agent} does not declare: {undeclared}"


def test_the_welcome_parser_sees_the_sop_lines():
    assert advertised_sops(spec("k-developer")["clientConfig"]["kiroCli"]["welcomeMessage"]) == declared_sops(
        "k-developer"
    )


OWNER_CELL = re.compile(
    re.escape(ADVERSARIAL_SOP) + r'<\\u002Fdiv><div style=\\"[^"\\]*\\">([^<]*)<\\u002Fdiv>'
)


@pytest.mark.parametrize("bundle", BUNDLES)
def test_bundle_owner_tables_do_not_name_the_architect_as_owner(bundle):
    owners = OWNER_CELL.findall((ROOT / bundle).read_text(encoding="utf-8"))
    assert owners, f"{bundle}: no owner cell found next to {ADVERSARIAL_SOP}"
    assert "k-architect" not in owners, f"{bundle}: an owner table names k-architect as the owner of {ADVERSARIAL_SOP}"
