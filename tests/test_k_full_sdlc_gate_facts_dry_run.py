# SPDX-License-Identifier: Apache-2.0
"""Scripted dry run of k-full-sdlc's gate facts against `konductor verify-run`.

Writes the session file a k-full-sdlc run produces when every step follows
the SOP text, then runs the built binary on it the way Step 11 does: working
directory = the project root (`codebase`), `--root` = an `output_dir` outside
it, absolute `--session`. A binary without `verify-run --root` skips those
cases with a visible reason (see `pytest -rs`).

Binary: build/cli/konductor, or the path in KONDUCTOR_BIN. No network:
telemetry is off and HOME is a scratch dir.

Run:  cd tests && pytest -rs test_k_full_sdlc_gate_facts_dry_run.py
"""
import os
import re
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
KONDUCTOR_BIN = Path(os.environ.get("KONDUCTOR_BIN") or REPO_ROOT / "build" / "cli" / "konductor")
SOP_TEXT = (REPO_ROOT / "agent-sops" / "k-full-sdlc.sop.md").read_text(encoding="utf-8")
ENTRY = yaml.safe_load(
    (REPO_ROOT / "cli" / "gate-config" / "sop-orchestration.yml").read_text(encoding="utf-8")
)["gated"]["k-full-sdlc"]
SESSION = "sessions/k-full-sdlc-20250101T000000Z-abcd.yml"
FEATURE = "login"

# Each boundary's evidence (relative to output_dir) and checker as the SOP's
# Steps state them.
EVIDENCE = {
    "design-review": ("design/principal-engineer-review.md", "k-architect"),
    "feature-splitting": ("feature-split/feature-split.md", "user"),
    "specs": ("specs/{feature-name}/tasks.md", "user"),
    "code-review": ("{feature-name}/code-review/report.md", "user"),
    "testing": ("{feature-name}/testing/test-coverage-review-report.md", "k-quality-assurance"),
}

pytestmark = pytest.mark.skipif(
    not KONDUCTOR_BIN.is_file(),
    reason=f"{KONDUCTOR_BIN} not found; run 'make -C cli build' first",
)


def evidence_path(phase):
    return EVIDENCE[phase][0].replace("{feature-name}", FEATURE)


def session_for(
    output_dir,
    run_status,
    last_phase_status,
    results=None,
    overrides=None,
    skipped=None,
    skip_reason="engineer skipped it",
):
    """The session a run holds at Step 11: every earlier phase COMPLETED and
    every boundary's gate facts in place. `results` maps a boundary phase to
    its result word, `overrides` maps it to a `gate_<phase>_override` note,
    and `skipped` is a boundary phase left SKIPPED with no gate facts."""
    results = results or {}
    overrides = overrides or {}
    run_data = {"max_fix_cycles": 2, "feature_isolation": "branch"}
    feature_data = {}
    for boundary in ENTRY["boundaries"]:
        phase = boundary["phase"]
        if phase == skipped:
            continue
        default = "approved" if boundary["kind"] == "approval" else "none"
        facts = {
            f"gate_{phase}_result": results.get(phase, default),
            f"gate_{phase}_evidence": evidence_path(phase),
            f"gate_{phase}_checker": EVIDENCE[phase][1],
        }
        if phase in overrides:
            facts[f"gate_{phase}_override"] = overrides[phase]
        (run_data if boundary["scope"] == "run" else feature_data).update(facts)
        evidence = output_dir / evidence_path(phase)
        evidence.parent.mkdir(parents=True, exist_ok=True)
        evidence.write_text("report\n", encoding="utf-8")
    phases = {
        phase: {"name": phase, "status": "COMPLETED", "skip_reason": None, "summary": "done"}
        for phase in ENTRY["phases"]
    }
    phases[ENTRY["phases"][-1]]["status"] = last_phase_status
    if skipped:
        phases[skipped].update(status="SKIPPED", skip_reason=skip_reason, summary=None)
    return {
        "run": {
            "schema_version": 1,
            "project_signature": "sig",
            "run_status": run_status,
            "counters": {"doc_fix_cycles_used": 0},
            "data": run_data,
        },
        "phases": phases,
        "features": {FEATURE: {"counters": {"fix_cycles_used": 0}, "data": feature_data}},
    }


class Layout:
    """`codebase` is the project root and the working directory of every call;
    `output_dir` lies outside it, as an unattended run's explicit output_dir may."""

    def __init__(self, tmp_path):
        base = tmp_path.resolve()
        self.codebase = base / "codebase"
        self.output_dir = base / "elsewhere" / "out"
        self.home = base / "home"
        (self.output_dir / "sessions").mkdir(parents=True)
        self.codebase.mkdir()
        self.home.mkdir()

    @property
    def session_file(self):
        return self.output_dir / SESSION

    def write_session(self, session):
        self.session_file.write_text(yaml.safe_dump(session, sort_keys=False), encoding="utf-8")


@pytest.fixture
def layout(tmp_path):
    return Layout(tmp_path)


def run_binary(layout, *args):
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(layout.home),
        "KONDUCTOR_TELEMETRY": "off",
    }
    return subprocess.run(
        [str(KONDUCTOR_BIN), *args],
        cwd=layout.codebase,
        env=env,
        capture_output=True,
        text=True,
    )


def verify_run_help():
    probe = subprocess.run([str(KONDUCTOR_BIN), "verify-run", "--help"], capture_output=True, text=True)
    return probe.returncode, probe.stdout + probe.stderr


def supports_root():
    code, text = verify_run_help()
    return code == 0 and "--root" in text


def clamps_fix_cap():
    """True for an evaluator that lacks the recorded-cap validation message,
    so it clamps a recorded cap above 2. Read from the binary's bytes so the
    check does not depend on the behavior the cap cases assert."""
    return b"run.data.max_fix_cycles is not a non-negative integer" not in KONDUCTOR_BIN.read_bytes()


needs_root = pytest.mark.skipif(
    not supports_root() if KONDUCTOR_BIN.is_file() else False,
    reason="built binary has no verify-run --root; needs a build with --root",
)
needs_config_source = pytest.mark.skipif(
    b"CONFIG_SOURCE" not in KONDUCTOR_BIN.read_bytes() if KONDUCTOR_BIN.is_file() else False,
    reason="built evaluator does not report CONFIG_SOURCE; needs the project-config build",
)
needs_recorded_cap = pytest.mark.skipif(
    clamps_fix_cap() if KONDUCTOR_BIN.is_file() else False,
    reason="built evaluator clamps the recorded max_fix_cycles; needs the recorded-cap evaluator",
)


def step_11_call(layout, *extra):
    """Step 11's invocation: absolute session, --root <output_dir>."""
    return ["verify-run", "--session", str(layout.session_file), "--root", str(layout.output_dir), *extra]


def step_11(layout, session, *extra):
    layout.write_session(session)
    return run_binary(layout, *step_11_call(layout, *extra))


def combined(result):
    return result.stdout + result.stderr


def step_section(number):
    match = re.search(rf"^### {number}\. .*?(?=^#{{2,3}} )", SOP_TEXT, re.MULTILINE | re.DOTALL)
    assert match, number
    return match.group(0)


def sentence_with(text, *tokens):
    return [s for s in re.split(r"(?<=\.)\s+|\n", text) if all(t in s for t in tokens)]


def test_sop_text_names_every_boundary_evidence_path():
    for phase, (template, _) in EVIDENCE.items():
        assert f"`{template}`" in SOP_TEXT, phase
    assert {b["phase"] for b in ENTRY["boundaries"]} == EVIDENCE.keys()


@needs_root
def test_step_11_session_is_running_then_passes_once_completed(layout):
    result = step_11(layout, session_for(layout.output_dir, "in_progress", "IN_PROGRESS"), "--allow-running")
    assert result.returncode == 0, combined(result)
    assert "RUNNING" in result.stdout

    result = step_11(layout, session_for(layout.output_dir, "completed", "COMPLETED"))
    assert result.returncode == 0, combined(result)
    assert "PASSED" in result.stdout


@needs_root
@pytest.mark.parametrize("phase", ["design-review", "testing"])
def test_open_important_finding_without_override_stops_the_run(layout, phase):
    session = session_for(layout.output_dir, "in_progress", "IN_PROGRESS", results={phase: "IMPORTANT"})
    result = step_11(layout, session, "--allow-running")
    assert result.returncode == 2, combined(result)
    assert "FINDING_UNRESOLVED" in result.stdout


@needs_root
@pytest.mark.parametrize("phase", ["design-review", "testing"])
@pytest.mark.parametrize("note", ["IMPORTANT F-3 overridden by engineer jdoe"])
def test_overridden_important_finding_lets_the_run_complete(layout, phase, note):
    kwargs = dict(results={phase: "none"}, overrides={phase: note})
    result = step_11(layout, session_for(layout.output_dir, "in_progress", "IN_PROGRESS", **kwargs), "--allow-running")
    assert result.returncode == 0, combined(result)
    assert "RUNNING" in result.stdout

    result = step_11(layout, session_for(layout.output_dir, "completed", "COMPLETED", **kwargs))
    assert result.returncode == 0, combined(result)
    assert "PASSED" in result.stdout


@needs_root
def test_round_cap_exit_lets_the_design_review_run_complete(layout):
    kwargs = dict(results={"design-review": "none"}, overrides={"design-review": "F-3, F-4 round cap"})
    result = step_11(layout, session_for(layout.output_dir, "in_progress", "IN_PROGRESS", **kwargs), "--allow-running")
    assert result.returncode == 0, combined(result)

    result = step_11(layout, session_for(layout.output_dir, "completed", "COMPLETED", **kwargs))
    assert result.returncode == 0, combined(result)
    assert "PASSED" in result.stdout


@needs_root
def test_override_note_alone_does_not_clear_the_result_word(layout):
    kwargs = dict(results={"design-review": "IMPORTANT"}, overrides={"design-review": "engineer jdoe"})
    result = step_11(layout, session_for(layout.output_dir, "in_progress", "IN_PROGRESS", **kwargs), "--allow-running")
    assert result.returncode == 2, combined(result)


@needs_root
@needs_config_source
def test_project_config_under_codebase_path_is_the_reported_threshold_source(layout):
    config_dir = layout.codebase / ".konductor"
    config_dir.mkdir()
    (config_dir / "config.yml").write_text("fail_on_severity_at_or_above: CRITICAL\n", encoding="utf-8")
    result = step_11(layout, session_for(layout.output_dir, "in_progress", "IN_PROGRESS"), "--allow-running")
    assert result.returncode == 0, combined(result)
    assert "CONFIG_SOURCE" in result.stdout
    assert str(config_dir / "config.yml") in result.stdout


@needs_root
def test_skipped_boundary_is_running_at_step_11_and_exit_6_only_once_completed(layout):
    running = session_for(layout.output_dir, "in_progress", "IN_PROGRESS", skipped="design-review")
    result = step_11(layout, running, "--allow-running")
    assert result.returncode == 0, combined(result)
    assert "PHASE_SKIPPED" in result.stdout

    completed = session_for(layout.output_dir, "completed", "COMPLETED", skipped="design-review")
    result = step_11(layout, completed)
    assert result.returncode == 6, combined(result)
    assert "PHASE_SKIPPED" in result.stdout


@needs_root
def test_skipped_boundary_without_skip_reason_is_exit_65(layout):
    session = session_for(layout.output_dir, "in_progress", "IN_PROGRESS", skipped="design-review", skip_reason=None)
    result = step_11(layout, session, "--allow-running")
    assert result.returncode == 65, combined(result)
    assert "SKIP_UNEXPLAINED" in result.stdout


@needs_root
def test_revalidation_pending_feature_is_not_reported_as_approved(layout):
    session = session_for(
        layout.output_dir, "in_progress", "IN_PROGRESS", results={"code-review": "NEEDS_REVALIDATION"}
    )
    result = step_11(layout, session, "--allow-running")
    assert result.returncode == 65, combined(result)
    assert "APPROVAL_MISSING" in result.stdout


@needs_root
@needs_recorded_cap
def test_raised_fix_cycle_cap_recorded_in_run_data_is_honoured(layout):
    session = session_for(layout.output_dir, "in_progress", "IN_PROGRESS")
    session["run"]["data"]["max_fix_cycles"] = 5
    session["features"][FEATURE]["counters"]["fix_cycles_used"] = 4
    result = step_11(layout, session, "--allow-running")
    assert result.returncode == 0, combined(result)


@needs_root
@needs_recorded_cap
@pytest.mark.parametrize("bad_cap", ["5", 2.5, -1, True])
def test_non_integer_max_fix_cycles_is_a_record_integrity_error(layout, bad_cap):
    session = session_for(layout.output_dir, "in_progress", "IN_PROGRESS")
    session["run"]["data"]["max_fix_cycles"] = bad_cap
    result = step_11(layout, session, "--allow-running")
    assert result.returncode == 65, combined(result)
    assert "non-negative integer" in combined(result)


def test_sop_records_max_fix_cycles_in_run_data_at_minting():
    assert sentence_with(SOP_TEXT, "`max_fix_cycles`", "`run.data`", "written once at minting", "non-negative integer")


@pytest.mark.parametrize("number, phase", [(4, "design-review"), (9, "testing")])
def test_steps_4_and_9_stop_on_open_findings_and_name_the_override_path(number, phase):
    section = step_section(number)
    for token in ("CRITICAL", "IMPORTANT", "MUST NOT proceed", "override", f"`gate_{phase}_override`"):
        assert token in section, (number, token)
    assert sentence_with(section, "unattended", "never", "override"), number
    assert "attended resume" in section, number


def test_step_4_names_the_round_cap_override():
    assert sentence_with(step_section(4), "5-round cap", "recorded cap exit", "no approver")


def test_gate_facts_bullet_names_the_override_key_and_recompute_rule():
    assert sentence_with(SOP_TEXT, "`gate_<phase>_override`", "override", "engineer")
    assert sentence_with(SOP_TEXT, "round cap", "recorded route", "no approver")
    assert sentence_with(step_section(4), "attended cap exit", "`gate_design-review_override`", "`round cap`")
    assert sentence_with(SOP_TEXT, "rewrite `gate_<phase>_result`", "not overridden")


def test_quality_gate_accepts_resolved_or_overridden():
    gate = SOP_TEXT[SOP_TEXT.index("## Quality Gate"):]
    assert sentence_with(gate, "design review ran", "gate_design-review_override")
    assert sentence_with(gate, "testing ran", "overridden", "gate_testing_override")


def test_revalidation_rules_rewrite_the_code_review_fact():
    section = step_section(9)
    assert len(sentence_with(section, "NEEDS_REVALIDATION", "rewrite", "gate_code-review_result")) == 2
    assert sentence_with(step_section(8), "gate_code-review_result", "APPROVED", "verdict word")


def test_step_11_runs_from_the_project_root_with_root_output_dir():
    section = step_section(11)
    call = sentence_with(section, "konductor verify-run --session", "--root <output_dir>", "--allow-running", "`k-developer`")
    assert call
    for token in ("`codebase_path`", "absolute"):
        assert token in call[0], token
    for code in (0, 1, 2, 3, 6, 64, 65):
        assert re.search(rf"\bexit {code}\b", section, re.IGNORECASE), code
    assert "needs a build with --root" in section
    assert "`Gate check` section" in section
    assert sentence_with(section, "every reason and info line", "`CONFIG_SOURCE`", "`Gate check`")


def test_missing_konductor_on_path_reports_not_found(tmp_path):
    empty_bin = tmp_path / "empty-bin"
    empty_bin.mkdir()
    result = subprocess.run(
        ["/bin/sh", "-c", "konductor verify-run --session x"],
        env={"PATH": str(empty_bin)},
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "not found" in result.stderr


def test_older_binary_signal_is_an_unrecognized_subcommand(layout):
    result = run_binary(layout, "no-such-subcommand")
    assert result.returncode == 64
    assert "unrecognized subcommand" in result.stderr


@pytest.mark.skipif(
    KONDUCTOR_BIN.is_file() and supports_root(),
    reason="built binary accepts --root; the unexpected-argument signal is pinned by the next test",
)
def test_binary_without_root_reports_unexpected_argument(layout):
    result = run_binary(layout, *step_11_call(layout, "--allow-running"))
    assert result.returncode == 64
    assert "unexpected argument" in result.stderr and "--root" in result.stderr


@needs_root
def test_bad_flag_on_a_binary_with_root_is_also_unexpected_argument(layout):
    result = run_binary(layout, "verify-run", "--no-such-flag")
    assert result.returncode == 64
    assert "unexpected argument" in result.stderr
