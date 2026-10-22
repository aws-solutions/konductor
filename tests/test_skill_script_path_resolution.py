# SPDX-License-Identifier: Apache-2.0
"""Regression tests for how skills locate the scripts they bundle.

Claude Code substitutes only the exact text `${CLAUDE_SKILL_DIR}` in a
SKILL.md; `${CLAUDE_SKILL_DIR:-}` is left alone and expands to nothing. On
runtimes without the substitution (Kiro), each snippet falls back, in order,
to a global install, a recorded project install, then a konductor source
checkout. Any other repo's `skills/` directory must never be picked.

Run:  cd tests && pytest test_skill_script_path_resolution.py -v
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"

# skill -> (variable the snippet resolves, its target relative to the skill dir)
SKILLS_WITH_SCRIPT_RESOLUTION = {
    "persistent-memory": ("VALIDATOR", "scripts/memory-validator.sh"),
    "legacy-to-agentic-estimate": ("SCRIPT", "scripts/convert_estimates.py"),
    "mux-dispatch": ("MUX_DISPATCH_DIR", ""),
    "cmux-dispatch": ("CMUX_DISPATCH_DIR", ""),
}

CLAUDE_SKILL_DIR_RE = re.compile(r"\$\{CLAUDE_SKILL_DIR\}")
BASH_BLOCK_RE = re.compile(r"^[ \t]*```bash\n(.*?)^[ \t]*```", re.S | re.M)


def _resolution_snippets(skill):
    """Each bash block using ${CLAUDE_SKILL_DIR}, cut after its fail-closed line."""
    text = (SKILLS_DIR / skill / "SKILL.md").read_text(encoding="utf-8")
    snippets = []
    for block in BASH_BLOCK_RE.findall(text):
        if not CLAUDE_SKILL_DIR_RE.search(block):
            continue
        lines = block.splitlines()
        end = next((i for i, line in enumerate(lines) if "exit 1" in line), None)
        if end is not None:
            snippets.append("\n".join(lines[: end + 1]))
    return snippets


@pytest.mark.parametrize("skill", SKILLS_WITH_SCRIPT_RESOLUTION)
def test_only_the_exact_substitutable_form_is_used(skill):
    text = (SKILLS_DIR / skill / "SKILL.md").read_text(encoding="utf-8")
    assert CLAUDE_SKILL_DIR_RE.search(text), f"{skill}: never uses ${{CLAUDE_SKILL_DIR}}"
    assert "${CLAUDE_SKILL_DIR:" not in text, (
        f"{skill}: Claude Code does not substitute ${{CLAUDE_SKILL_DIR:...}}"
    )
    assert _resolution_snippets(skill), f"{skill}: no resolution snippet that fails closed"


CASES = [
    (skill, i)
    for skill in SKILLS_WITH_SCRIPT_RESOLUTION
    for i in range(len(_resolution_snippets(skill)))
]


@pytest.fixture(params=CASES, ids=[f"{skill}-{i}" for skill, i in CASES])
def case(request, tmp_path):
    skill, index = request.param
    var, target = SKILLS_WITH_SCRIPT_RESOLUTION[skill]
    snippet = _resolution_snippets(skill)[index]
    home = tmp_path / "home"
    home.mkdir()

    def resolve(cwd, skill_dir=None):
        """Runs the snippet as the model would. With skill_dir it emulates
        Claude Code's substitution; without, Kiro (variable unset)."""
        text = snippet
        if skill_dir is not None:
            text = text.replace("${CLAUDE_SKILL_DIR}", str(skill_dir))
        env = {k: v for k, v in os.environ.items() if k not in ("SKILLS_HOME", "CLAUDE_SKILL_DIR")}
        env["HOME"] = str(home)
        env["GIT_CEILING_DIRECTORIES"] = str(tmp_path)
        result = subprocess.run(
            ["bash", "-c", f'{text}\nprintf "%s" "${var}"'],
            cwd=cwd, env=env, capture_output=True, text=True,
        )
        return result.returncode, result.stdout

    def expected(skill_dir):
        return str(skill_dir / target) if target else str(skill_dir)

    return skill, home, resolve, expected


def _install(dest, skill):
    shutil.copytree(SKILLS_DIR / skill, dest)
    return dest


def _git_repo(path):
    path.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    return path


def test_claude_skill_dir_wins(case, tmp_path):
    skill, home, resolve, expected = case
    own = _install(tmp_path / "plugin" / "skills" / skill, skill)
    _install(home / ".konductor" / "skills" / skill, skill)
    assert resolve(home, skill_dir=own) == (0, expected(own))


def test_kiro_global_install_beats_hostile_repo_skills(case, tmp_path):
    skill, home, resolve, expected = case
    hostile = _git_repo(tmp_path / "hostile")
    _install(hostile / "skills" / skill, skill)
    global_dir = _install(home / ".konductor" / "skills" / skill, skill)
    assert resolve(hostile) == (0, expected(global_dir))


def test_hostile_repo_skills_are_never_picked(case, tmp_path):
    skill, home, resolve, _ = case
    hostile = _git_repo(tmp_path / "hostile")
    _install(hostile / "skills" / skill, skill)
    _install(hostile / ".konductor" / "skills" / skill, skill)
    assert resolve(hostile) == (1, "")


def test_project_install_needs_the_install_manifest(case, tmp_path):
    skill, home, resolve, expected = case
    project = _git_repo(tmp_path / "project")
    project_dir = _install(project / ".konductor" / "skills" / skill, skill)
    (project / ".konductor" / "manifest").write_text("{}\n", encoding="utf-8")
    assert resolve(project) == (0, expected(project_dir))


def test_konductor_source_checkout_is_used_last(case, tmp_path):
    skill, home, resolve, expected = case
    checkout = _git_repo(tmp_path / "konductor")
    shutil.copytree(REPO_ROOT / ".claude-plugin", checkout / ".claude-plugin")
    checkout_dir = _install(checkout / "skills" / skill, skill)
    assert resolve(checkout) == (0, expected(checkout_dir))
    global_dir = _install(home / ".konductor" / "skills" / skill, skill)
    assert resolve(checkout) == (0, expected(global_dir))


def test_fails_closed_outside_any_repo(case):
    _, home, resolve, _ = case
    assert resolve(home) == (1, "")


DISPATCH_SKILLS = {
    "mux-dispatch": ("MUX_DISPATCH_DIR", "konductor-mux-orchestrator"),
    "cmux-dispatch": ("CMUX_DISPATCH_DIR", "konductor-cmux-orchestrator"),
}


@pytest.mark.parametrize("skill", DISPATCH_SKILLS)
def test_dispatch_commands_use_the_printed_path_not_a_shell_variable(skill):
    """Each Bash call starts a fresh shell, so a variable set by the resolver
    is gone by the next command. The resolver prints the path instead, and
    every command uses it through the <VAR> placeholder."""
    var, orchestrator = DISPATCH_SKILLS[skill]
    skill_md = (SKILLS_DIR / skill / "SKILL.md").read_text(encoding="utf-8")
    spec = (REPO_ROOT / "agents" / f"{orchestrator}.agent-spec.json").read_text(encoding="utf-8")

    resolver = next(b for b in BASH_BLOCK_RE.findall(skill_md) if CLAUDE_SKILL_DIR_RE.search(b))
    assert f'echo "{var}=${var}"' in resolver, f"{skill}: resolver must print the resolved path"

    for name, text in ((f"{skill}/SKILL.md", skill_md.replace(resolver, "")), (f"{orchestrator}.agent-spec.json", spec)):
        assert f"${var}" not in text, f"{name}: uses ${var} outside the resolver"
        assert f"<{var}>/" in text, f"{name}: commands should use the <{var}> placeholder"
