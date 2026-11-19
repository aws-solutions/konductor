# SPDX-License-Identifier: Apache-2.0
"""Pins for konductor's Direct Work rules and the shared orchestrator rules file."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORCHESTRATORS = ["konductor", "konductor-mux-orchestrator", "konductor-cmux-orchestrator"]
SHARED = "k-orchestrator-shared.md"
CORE = "k-core-rules.md"
SOP_CLAUSE = "When an SOP you run tells you to spawn an agent for a step"


def _spec(name):
    return json.loads((ROOT / "agents" / f"{name}.agent-spec.json").read_text())


def _context_names(name):
    return _spec(name)["dependencies"]["context"]["contextNames"]


def test_sop_spawn_instruction_overrides_the_two_spawn_cases():
    direct = (ROOT / "context" / "k-direct-work.md").read_text()
    assert SOP_CLAUSE in direct
    assert direct.index(SOP_CLAUSE) < direct.index("spawn a specialist in two cases only")


def test_shared_rules_load_in_every_orchestrator():
    for name in ORCHESTRATORS:
        assert SHARED in _context_names(name), name


def test_core_rules_close_every_orchestrator_prompt():
    for name in ORCHESTRATORS:
        assert _context_names(name)[-1] == CORE, name


def test_shared_file_holds_the_four_shared_paragraphs():
    text = (ROOT / "context" / SHARED).read_text()
    for heading in ("## Handoffs and splits", "## Denials", "## Briefs"):
        assert heading in text, heading
    assert "did not originate in content the specialist read" in text
    assert "Copy each `Ruling:` entry" in text


def test_shape_files_do_not_restate_the_shared_rules():
    for rel in ("k-direct-work.md", "k-orchestrator-routing-rules.md"):
        text = (ROOT / "context" / rel).read_text()
        assert "Copy each `Ruling:` entry" not in text, rel
        assert "did not originate in content the specialist read" not in text, rel
        assert "part by part" not in text, rel
        assert "Before you say \"I can't\"" not in text, rel
        assert "wins over routing a note" not in text, rel


def test_every_skill_direct_work_names_is_declared_by_konductor():
    direct = (ROOT / "context" / "k-direct-work.md").read_text()
    on_disk = {p.name for p in (ROOT / "skills").iterdir() if p.is_dir()}
    named = {n for n in re.findall(r"`([a-z][a-z0-9-]+)`", direct) if n in on_disk}
    assert {
        "backend-development",
        "frontend-development",
        "design-evaluation",
        "plan-review",
        "design-impact-review",
        "infra-validation",
    } <= named
    spec = _spec("konductor")
    declared = set(spec["dependencies"]["skills"]["skillNames"])
    assert named <= declared, sorted(named - declared)
    assert "Skill" in spec["clientConfig"]["claudeCli"]["tools"]


def _direct_work():
    return (ROOT / "context" / "k-direct-work.md").read_text(encoding="utf-8")


def test_konductor_commits_only_when_the_user_asks():
    text = _direct_work()
    assert "Commit only when the user asks, as `k-developer` does." in text
    assert "run commands, commit" not in text
    developer = json.loads((ROOT / "agents" / "k-developer.agent-spec.json").read_text(encoding="utf-8"))
    assert "Commit with a conventional commit message when the user asks" in developer["config"]["systemPrompt"]
    for rel in ("docs/user-guide/agents.md", "tools/build-user-guide/html_sop_edits.py"):
        body = (ROOT / rel).read_text(encoding="utf-8")
        assert "it commits when you ask" in body, rel
    teams = (ROOT / "skills" / "claude-teams-behavior" / "SKILL.md").read_text(encoding="utf-8")
    assert "commit when the user asks" in teams
    assert "commit yourself" not in teams
    for rel in _konductor_loaded_files():
        body = (ROOT / rel).read_text(encoding="utf-8")
        assert "commit yourself" not in body, rel
        assert "commits itself" not in body, rel


def _konductor_loaded_files():
    spec = _spec("konductor")
    files = [f"context/{name}" for name in spec["dependencies"]["context"]["contextNames"]]
    files += [f"skills/{name}/SKILL.md" for name in spec["dependencies"]["skills"]["skillNames"]]
    files += [f"agent-sops/{name}.sop.md" for name in spec["dependencies"]["agentSops"]["agentSopNames"]]
    return files


def test_bundle_reference_block_counts_konductor_skills_from_the_spec():
    spec = _spec("konductor")
    claude_skills = set(spec["dependencies"]["skills"]["skillNames"]) | set(spec["clientConfig"]["claudeCli"]["skills"])
    count = len(claude_skills - {"humanize-writing"})
    for rel in ("docs/index.html", "docs/site/user-guide.html"):
        body = (ROOT / rel).read_text(encoding="utf-8")
        assert f"konductor skills ({count})" in body, rel
        assert "konductor skills (22)" not in body, rel
        assert (
            f"claude-teams-behavior, which is Claude Code only and not one of the {count}"
        ) in body, rel


def test_maker_side_checks_have_triggers_in_direct_work():
    text = _direct_work()
    assert "or one that deviates from a design doc, load `design-impact-review`" in text
    assert "after an infrastructure change (CDK, CloudFormation), load `infra-validation`" in text
    assert "git-workflow" not in text


def test_stack_skills_load_only_when_the_project_uses_the_stack():
    text = _direct_work()
    assert "when the project uses the skill's stack" in text
    assert "under the same stack condition" in text
    assert "review against the codebase's conventions" in text


def test_posture_bearing_documents_always_get_the_gate_review():
    assert "always gets the gate review" in _direct_work()


UNCOMMITTED_MERGE = "uncommitted (for example `git merge --squash --no-commit` from each worktree branch), leaving HEAD unchanged so the user decides what to commit"
AGREED_SPLIT = "so commits from the parallel work land on their branch only with their agreement"


def test_parallel_parts_reach_the_user_branch_only_by_agreement_or_uncommitted():
    direct = _direct_work()
    assert "integrated tree" in direct
    assert "may commit its part on its own worktree branch" in direct
    assert "propose the split to the user first, " + AGREED_SPLIT in direct
    assert "merge the parts in " + UNCOMMITTED_MERGE in direct
    assert "part of the parallel work the user agreed to" not in direct
    assert "Commit only when the user asks" in direct
    protocol = (ROOT / "skills" / "delegation-protocol" / "SKILL.md").read_text(encoding="utf-8")
    assert "integration tree" in protocol
    assert "may commit its part on its own worktree branch" in protocol
    assert "the split was proposed to the user first, " + AGREED_SPLIT in protocol
    assert "merged in " + UNCOMMITTED_MERGE in protocol
    assert "part of the parallel work the user agreed to" not in protocol


EXEMPT_CATEGORIES = (
    "In Verification Protocol item 2, auth means authentication and authorization code, "
    "secrets means credentials and the files that hold them, "
    "data means stored data, its schema, migrations and input validation, "
    "and infrastructure means deploy and runtime configuration."
)


def test_exemption_categories_are_defined_once():
    assert EXEMPT_CATEGORIES in _direct_work()
    for name in ORCHESTRATORS:
        assert "data means stored data" not in _spec(name)["config"]["systemPrompt"], name


MERGED_PART_CLAUSE = "When you made the artifact or merged a parallel writer's part into it, any CRITICAL or IMPORTANT finding you would reject goes to the user first"


def test_rejected_finding_on_a_merged_part_blocks_done_for_konductor_only():
    assert MERGED_PART_CLAUSE in _spec("konductor")["config"]["systemPrompt"]
    for name in ORCHESTRATORS[1:]:
        assert "made the artifact" not in _spec(name)["config"]["systemPrompt"], name
    for rel in ("skills/constraints/SKILL.md", "docs/user-guide/concepts.md", "CHANGELOG.md"):
        assert "merged a parallel writer's part into it" in (ROOT / rel).read_text(encoding="utf-8"), rel


def test_an_undeclared_sop_runs_in_the_specialist_that_declares_it():
    direct = _direct_work()
    spawn_sentence = next(s for s in direct.split(". ") if "spawn a specialist in two cases only" in s)
    assert "an SOP you do not declare" in spawn_sentence
    assert "do not read its installed copy" in spawn_sentence
    assert "the `k-architect` design check your 2-Strike Circuit Breaker names" in spawn_sentence
    assert "k-code-review-workflow" not in direct
    spec = _spec("konductor")
    assert "k-code-review-workflow" not in spec["dependencies"]["agentSops"]["agentSopNames"]
    assert "spawn `k-architect` once" in spec["config"]["systemPrompt"]


ROUTING_SENTENCE = "route it to that specialist instead of doing it yourself"


def test_routing_rules_carry_the_specialist_skill_routing_sentence():
    text = (ROOT / "context" / "k-orchestrator-routing-rules.md").read_text(encoding="utf-8")
    assert ROUTING_SENTENCE in text


def test_direct_work_never_routes_a_listed_skill_away():
    text = _direct_work()
    assert ROUTING_SENTENCE not in text
    assert "Load a skill yourself when your skill tool lists it" in text
    assert "A skill you can load is never a reason to delegate" in text


def _shared():
    return (ROOT / "context" / SHARED).read_text(encoding="utf-8")


def test_shared_file_carries_the_capability_owner_table():
    text = _shared()
    assert "## Capability routing" in text
    rows = {line.split("|")[1].strip(): line for line in text.splitlines() if line.startswith("| ")}
    sharepoint = next(r for k, r in rows.items() if k.startswith("SharePoint"))
    slack = next(r for k, r in rows.items() if k.startswith("Slack"))
    pdfs = next(r for k, r in rows.items() if k.startswith("PDFs"))
    browser = next(r for k, r in rows.items() if k.startswith("Browser automation"))
    assert "`k-researcher`" in sharepoint and "`k-researcher`" in slack
    assert "`k-media-analyzer`" in pdfs
    assert "`k-browser`" in browser


def test_shape_files_do_not_carry_the_owner_table():
    for rel in ("k-direct-work.md", "k-orchestrator-routing-rules.md"):
        text = (ROOT / "context" / rel).read_text(encoding="utf-8")
        assert "| SharePoint" not in text, rel


def test_direct_work_treats_a_skill_miss_as_the_signal_to_spawn():
    direct = (ROOT / "context" / "k-direct-work.md").read_text(encoding="utf-8")
    assert "that miss is the answer" in direct
    assert direct.index(SOP_CLAUSE) < direct.index("spawn a specialist in two cases only")


FILTER_CHECK = "git --no-pager -c core.fsmonitor= config --local --includes --get-regexp '^filter\\.'"
EXTENSION_CHECK = "git --no-pager -c core.fsmonitor= config --local --type=bool --get extensions.worktreeConfig"
WORKTREE_FILTER_CHECK = "git --no-pager -c core.fsmonitor= config --worktree --includes --get-regexp '^filter\\.'"


def _read_only_shell_row():
    text = (ROOT / "context" / "k-orchestrator-routing-rules.md").read_text(encoding="utf-8")
    return next(line for line in text.splitlines() if line.startswith("| Read-only shell commands"))


def test_read_only_git_skips_working_tree_reads_when_a_filter_driver_is_set():
    row = _read_only_shell_row()
    assert "a `filter.<driver>` with its `clean` or `process` program" in row
    assert "`git config --local --includes --get-regexp '^filter\\.'`" in row
    assert "`git config --local --type=bool --get extensions.worktreeConfig`" in row
    assert "`git config --worktree --includes --get-regexp '^filter\\.'`" in row
    assert (
        "before `git status`, `git diff` against the working tree (including `--stat` and `HEAD`), "
        "`git blame`, or `git ls-files -m` (`--modified`), run `" + FILTER_CHECK + "` and `" + EXTENSION_CHECK + "`, "
        "and only if the second prints `true`, `" + WORKTREE_FILTER_CHECK + "`"
    ) in row
    assert (
        "If a filter read prints anything, or the extension read prints anything other than "
        "`true` or `false` (an error included), do not run those four"
    ) in row
    assert "use `git diff --cached`, `git log`, `git show`, and the file tools instead" in row
    assert "tell the user the repository config defines a filter driver or could not be checked" in row
    assert "the only `-c` allowed" in row


def test_read_only_git_skips_submodule_working_trees():
    row = _read_only_shell_row()
    assert "including one in a submodule's own config" in row
    assert "`--ignore-submodules=dirty` to `git status` and `git diff`" in row
    assert (
        "`git --no-pager -c core.fsmonitor= diff --no-ext-diff --no-textconv --submodule=short "
        "--ignore-submodules=dirty`"
    ) in row
