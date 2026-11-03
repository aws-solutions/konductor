# SPDX-License-Identifier: Apache-2.0
"""Scripted dry run of k-full-sdlc's gate facts against `konductor verify-run`.

Writes the session file a k-full-sdlc run produces when every step follows
the SOP text, then runs the built binary on it the way Step 11 does: working
directory = `codebase_path` (`codebase`), `--root` = an `output_dir` outside
it, absolute `--session`. Without the binary, or with one that lacks a needed
capability, binary cases skip with a visible reason (see `pytest -rs`); with
KONDUCTOR_REQUIRE_FULL_BIN=1 they fail instead. SOP-text and shell cases
always run.

Binary: build/cli/konductor, or the path in KONDUCTOR_BIN. No network:
telemetry is off and HOME is a scratch dir.

Run:  cd tests && pytest -rs test_k_full_sdlc_gate_facts_dry_run.py
"""
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
KONDUCTOR_BIN = Path(os.environ.get("KONDUCTOR_BIN") or REPO_ROOT / "build" / "cli" / "konductor")
SOP_TEXT = (REPO_ROOT / "agent-sops" / "k-full-sdlc.sop.md").read_text(encoding="utf-8")
ENTRY = yaml.safe_load(
    (REPO_ROOT / "cli" / "gate-config" / "sop-orchestration.yml").read_text(encoding="utf-8")
)["gated"]["k-full-sdlc"]
REQUIRE_FULL_BIN = os.environ.get("KONDUCTOR_REQUIRE_FULL_BIN") == "1"
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

# Where the SOP stores each boundary's gate facts, written out from its
# Progress Tracking and Step text rather than read from the boundary config.
SOP_SCOPE = {
    "design-review": "run",
    "feature-splitting": "run",
    "specs": "feature",
    "code-review": "run",
    "testing": "feature",
}

def skip_or_fail(reason):
    """A missing binary or capability skips locally and fails when
    KONDUCTOR_REQUIRE_FULL_BIN=1, so a verify-run regression cannot hide."""
    if REQUIRE_FULL_BIN:
        pytest.fail(reason)
    pytest.skip(reason)


def require_binary():
    if not KONDUCTOR_BIN.is_file():
        skip_or_fail(f"{KONDUCTOR_BIN} not found; run 'make build' first")


def evidence_path(phase):
    return EVIDENCE[phase][0].replace("{feature-name}", FEATURE)


def session_for(
    output_dir,
    run_status,
    last_phase_status,
    results=None,
    overrides=None,
    verdict="APPROVED",
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
        if phase == "code-review":
            facts["gate_code-review_verdict"] = verdict
        if phase in overrides:
            facts[f"gate_{phase}_override"] = overrides[phase]
        (run_data if SOP_SCOPE[phase] == "run" else feature_data).update(facts)
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
    """`codebase` is `codebase_path` and the working directory of every call;
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
    require_binary()
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


@pytest.fixture
def require_root():
    require_binary()
    if not supports_root():
        skip_or_fail("built binary has no verify-run --root; needs a build with --root")


@pytest.fixture
def require_config_source():
    require_binary()
    if b"CONFIG_SOURCE" not in KONDUCTOR_BIN.read_bytes():
        skip_or_fail("built evaluator does not report CONFIG_SOURCE; needs the project-config build")


@pytest.fixture
def require_recorded_cap():
    require_binary()
    if clamps_fix_cap():
        skip_or_fail("built evaluator clamps the recorded max_fix_cycles; needs the recorded-cap evaluator")


needs_root = pytest.mark.usefixtures("require_root")
needs_config_source = pytest.mark.usefixtures("require_config_source")
needs_recorded_cap = pytest.mark.usefixtures("require_recorded_cap")


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
    kwargs = dict(results={"design-review": "none"}, overrides={"design-review": "F-3, F-4 round cap, approved by alice"})
    result = step_11(layout, session_for(layout.output_dir, "in_progress", "IN_PROGRESS", **kwargs), "--allow-running")
    assert result.returncode == 0, combined(result)

    result = step_11(layout, session_for(layout.output_dir, "completed", "COMPLETED", **kwargs))
    assert result.returncode == 0, combined(result)
    assert "PASSED" in result.stdout


@needs_root
@pytest.mark.parametrize("word", ["IMPORTANT", "CRITICAL"])
def test_override_note_alone_does_not_clear_the_result_word(layout, word):
    kwargs = dict(results={"design-review": word}, overrides={"design-review": "F-3 round cap"})
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
        layout.output_dir,
        "in_progress",
        "IN_PROGRESS",
        results={"code-review": "NEEDS_REVALIDATION"},
        verdict="NEEDS_REVALIDATION",
    )
    result = step_11(layout, session, "--allow-running")
    assert result.returncode == 65, combined(result)
    assert "APPROVAL_MISSING" in result.stdout


@needs_root
def test_blocked_pull_request_verdict_does_not_make_the_approval_missing(layout):
    session = session_for(layout.output_dir, "in_progress", "IN_PROGRESS", verdict="BLOCKED")
    result = step_11(layout, session, "--allow-running")
    assert result.returncode == 0, combined(result)
    assert "APPROVAL_MISSING" not in combined(result)


@needs_root
@needs_recorded_cap
def test_fix_cycles_over_the_recorded_cap_are_exit_3_whatever_the_invocation_says(layout):
    session = session_for(layout.output_dir, "in_progress", "IN_PROGRESS")
    session["features"][FEATURE]["counters"]["fix_cycles_used"] = 3
    result = step_11(layout, session, "--allow-running")
    assert result.returncode == 3, combined(result)


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


@pytest.mark.parametrize("number, phase", [(4, "design-review"), (9, "testing")])
def test_steps_4_and_9_stop_on_open_findings_and_name_the_override_path(number, phase):
    section = step_section(number)
    for token in ("CRITICAL", "IMPORTANT", "MUST NOT proceed", "override", f"`gate_{phase}_override`"):
        assert token in section, (number, token)
    assert sentence_with(section, "unattended", "never", "override"), number
    assert "attended resume" in section, number


@needs_root
def test_step_11_runs_from_codebase_path_with_root_output_dir(layout):
    assert not layout.output_dir.is_relative_to(layout.codebase)
    result = step_11(layout, session_for(layout.output_dir, "in_progress", "IN_PROGRESS"), "--allow-running")
    assert result.returncode == 0, combined(result)
    assert "RUNNING" in result.stdout


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


@needs_root
def test_bad_flag_on_a_binary_with_root_is_also_unexpected_argument(layout):
    result = run_binary(layout, "verify-run", "--no-such-flag")
    assert result.returncode == 64
    assert "unexpected argument" in result.stderr


def test_sop_storage_model_matches_boundary_config_and_text():
    assert {b["phase"]: b["scope"] for b in ENTRY["boundaries"]} == SOP_SCOPE
    gate_facts = " ".join(sentence_with(SOP_TEXT, "They go in `run.data` for", "`features.<slug>.data`"))
    assert "`run.data` for `design-review`, `feature-splitting`, and `code-review`" in gate_facts
    assert "`features.<slug>.data` for each feature at `specs` and `testing`" in gate_facts
    assert sentence_with(step_section(8), "record in `run.data`", "gate_code-review_result")


def test_code_review_evidence_rule_names_one_feature_report():
    fact = sentence_with(step_section(8), "gate_code-review_evidence", "first feature in checklist order")
    assert fact
    assert "never leave the placeholder" in fact[0]


@needs_root
def test_two_feature_run_records_one_feature_report_as_code_review_evidence(layout):
    session = session_for(layout.output_dir, "in_progress", "IN_PROGRESS")
    feature_data = {
        key: value.replace(FEATURE, "billing") if isinstance(value, str) else value
        for key, value in session["features"][FEATURE]["data"].items()
    }
    session["features"]["billing"] = {"counters": {"fix_cycles_used": 0}, "data": feature_data}
    for key, value in feature_data.items():
        if key.endswith("_evidence"):
            (layout.output_dir / value).parent.mkdir(parents=True, exist_ok=True)
            (layout.output_dir / value).write_text("report\n", encoding="utf-8")
    second_report = layout.output_dir / "billing" / "code-review" / "report.md"
    second_report.parent.mkdir(parents=True)
    second_report.write_text("report\n", encoding="utf-8")
    result = step_11(layout, session, "--allow-running")
    assert result.returncode == 0, combined(result)

    session["run"]["data"]["gate_code-review_evidence"] = "{feature-name}/code-review/report.md"
    result = step_11(layout, session, "--allow-running")
    assert result.returncode != 0, combined(result)


def test_missing_binary_fails_instead_of_skipping_when_the_flag_is_set(monkeypatch, tmp_path):
    monkeypatch.setattr(sys.modules[__name__], "KONDUCTOR_BIN", tmp_path / "absent")
    monkeypatch.setattr(sys.modules[__name__], "REQUIRE_FULL_BIN", True)
    with pytest.raises(pytest.fail.Exception):
        require_binary()
    monkeypatch.setattr(sys.modules[__name__], "REQUIRE_FULL_BIN", False)
    with pytest.raises(pytest.skip.Exception):
        require_binary()
