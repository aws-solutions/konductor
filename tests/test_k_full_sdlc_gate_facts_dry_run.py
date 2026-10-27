# SPDX-License-Identifier: Apache-2.0
"""Scripted dry run of k-full-sdlc's gate facts against `konductor verify-run`.

Writes the session file a k-full-sdlc run produces when every step follows
the SOP text, then runs the built binary on it the way Step 11 does. Also
pins the two error lines the SOP names as "verify-run unavailable".

Requires build/cli/konductor to exist (`make -C cli build`); skipped
otherwise. No network: telemetry is turned off and HOME is a scratch dir.

Run:  cd tests && pytest test_k_full_sdlc_gate_facts_dry_run.py
"""
import os
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
KONDUCTOR_BIN = REPO_ROOT / "build" / "cli" / "konductor"
SOP_TEXT = (REPO_ROOT / "agent-sops" / "k-full-sdlc.sop.md").read_text(encoding="utf-8")
ENTRY = yaml.safe_load(
    (REPO_ROOT / "cli" / "gate-config" / "sop-orchestration.yml").read_text(encoding="utf-8")
)["gated"]["k-full-sdlc"]
SESSION = ".konductor/sessions/k-full-sdlc-20250101T000000Z-abcd.yml"
FEATURE = "login"

# Each boundary's evidence and checker as the SOP's Steps state them, with
# output_dir at its default `.konductor/`.
EVIDENCE = {
    "design-review": ("output_dir/design/principal-engineer-review.md", "k-architect"),
    "feature-splitting": ("output_dir/feature-split/feature-split.md", "user"),
    "specs": ("output_dir/specs/{feature-name}/tasks.md", "user"),
    "code-review": ("output_dir/{feature-name}/code-review/report.md", "user"),
    "testing": ("output_dir/{feature-name}/testing/test-coverage-review-report.md", "k-quality-assurance"),
}

pytestmark = pytest.mark.skipif(
    not KONDUCTOR_BIN.is_file(),
    reason=f"{KONDUCTOR_BIN} not found; run 'make -C cli build' first",
)


def evidence_path(phase):
    template = EVIDENCE[phase][0]
    return template.replace("output_dir/", ".konductor/").replace("{feature-name}", FEATURE)


def session_for(project, run_status, last_phase_status):
    """The session a run holds at Step 11: every earlier phase COMPLETED and
    every boundary's three gate facts in place."""
    run_data = {"max_fix_cycles": 2, "feature_isolation": "branch"}
    feature_data = {}
    for boundary in ENTRY["boundaries"]:
        phase = boundary["phase"]
        result = "approved" if boundary["kind"] == "approval" else "none"
        facts = {
            f"gate_{phase}_result": result,
            f"gate_{phase}_evidence": evidence_path(phase),
            f"gate_{phase}_checker": EVIDENCE[phase][1],
        }
        (run_data if boundary["scope"] == "run" else feature_data).update(facts)
        evidence = project / evidence_path(phase)
        evidence.parent.mkdir(parents=True, exist_ok=True)
        evidence.write_text("report\n", encoding="utf-8")
    phases = {
        phase: {"name": phase, "status": "COMPLETED", "skip_reason": None, "summary": "done"}
        for phase in ENTRY["phases"]
    }
    phases[ENTRY["phases"][-1]]["status"] = last_phase_status
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


@pytest.fixture
def project(tmp_path):
    root = tmp_path.resolve() / "project"
    (root / ".konductor" / "sessions").mkdir(parents=True)
    (tmp_path / "home").mkdir()
    return root


def run_verify(project, *args):
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(project.parent / "home"),
        "KONDUCTOR_TELEMETRY": "off",
    }
    return subprocess.run(
        [str(KONDUCTOR_BIN), *args],
        cwd=project,
        env=env,
        capture_output=True,
        text=True,
    )


def write_session(project, session):
    (project / SESSION).write_text(yaml.safe_dump(session, sort_keys=False), encoding="utf-8")


def test_sop_text_names_every_boundary_evidence_path():
    for phase, (template, _) in EVIDENCE.items():
        assert f"`{template}`" in SOP_TEXT, phase
    assert {b["phase"] for b in ENTRY["boundaries"]} == EVIDENCE.keys()


def test_step_11_session_is_running_then_passes_once_completed(project):
    write_session(project, session_for(project, "in_progress", "IN_PROGRESS"))
    result = run_verify(project, "verify-run", "--session", SESSION, "--allow-running")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "RUNNING" in result.stdout

    write_session(project, session_for(project, "completed", "COMPLETED"))
    result = run_verify(project, "verify-run", "--session", SESSION)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "PASSED" in result.stdout


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


def test_older_binary_signal_is_an_unrecognized_subcommand(project):
    result = run_verify(project, "no-such-subcommand")
    assert result.returncode == 64
    assert "unrecognized subcommand" in result.stderr
