#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Check that each gated SOP with gate boundaries in
cli/gate-config/sop-orchestration.yml records its gate facts and runs
`konductor verify-run` the way its boundaries require.

Usage: check-sop-gate-facts.py [repo-root]

Exit 0 and print nothing when they agree. Exit 1 and print one
`<code>: <detail>` line per violation to stderr when they do not.
Exit 64 on a bad invocation.
"""
import importlib.util
import re
import sys
from pathlib import Path

EX_USAGE = 64
FACT_SUFFIXES = ("result", "evidence", "checker")
FACT_KEY = re.compile(r"gate_([a-z0-9][a-z0-9-]*)_(result|evidence|checker|override)")
STEP_HEADING = re.compile(r"^### (\d+)\. ", re.MULTILINE)
SECTION_END = re.compile(r"^#{2,3} ", re.MULTILINE)
CHECKER_WORDS = r"IMPORTANT|SUGGESTION|MINOR|WARNING"
GATE_IDS = r"HIGH|MEDIUM|LOW|INFO"
MAPS_TO = r"\s*(?:->|\u2192|=|maps to|means|becomes|counts as|is treated as)\s*"
WORD_MAPPING = re.compile(
    rf"\b(?:{CHECKER_WORDS})\b`?{MAPS_TO}`?\b(?:{GATE_IDS})\b"
    rf"|\b(?:{GATE_IDS})\b`?{MAPS_TO}`?\b(?:{CHECKER_WORDS})\b"
)
RELATIVE_TO_ROOT = re.compile(r"relative to (?:the project root|`output_dir`)")
RELATIVE_TO_OUTPUT_DIR = "relative to `output_dir`"
RELATIVE_TO_PROJECT_ROOT = "relative to the project root"
RUN_FROM_OUTPUT_DIR = re.compile(r"(?:run from|working directory (?:set to )?)\s*`output_dir`")
EXIT_CODES = (1, 2, 3, 6, 64, 65)
ABSOLUTE_PATH = re.compile(r"`(?:/|~|[A-Za-z]:[\\/])")
SUMMARY_WRITE = re.compile(r"\bwrite `sdlc-summary\.md`", re.IGNORECASE)
VERIFY_RUN_SOP = "k-full-sdlc"
VERIFY_CALL = "konductor verify-run --session"


def load_orchestration_check():
    """The orchestration lint owns the map and Phase list parsing; reuse it."""
    path = Path(__file__).resolve().parent / "check-sop-orchestration.py"
    spec = importlib.util.spec_from_file_location("check_sop_orchestration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sentences(text):
    return re.split(r"(?<=\.)\s+", text)


def step_sections(text, phases):
    """Map each phase id to its `### <n>.` Step section, in order."""
    starts = [m.start() for m in STEP_HEADING.finditer(text)]
    sections = {}
    for phase, start in zip(phases, starts):
        end = SECTION_END.search(text, start + 1)
        sections[phase] = text[start : end.start() if end else len(text)]
    return sections


def check_step_headings(name, text, phases):
    """The phase list maps to Steps by position, so the Step headings must be
    numbered 0..N-1 and match the phase count."""
    numbers = [int(m.group(1)) for m in STEP_HEADING.finditer(text)]
    if numbers == list(range(len(phases))):
        return []
    return [
        f"step-phase-mismatch: '{name}' has Step headings numbered {numbers}, "
        f"but its {len(phases)} phases need Steps 0 through {len(phases) - 1} in order"
    ]


def check_fact_keys(name, text, sections, boundaries):
    errors = []
    boundary_phases = [b["phase"] for b in boundaries]
    for boundary in boundaries:
        phase = boundary["phase"]
        section = sections.get(phase, "")
        suffixes = FACT_SUFFIXES + (("override",) if boundary["kind"] == "check-threshold" else ())
        for suffix in suffixes:
            key = f"gate_{phase}_{suffix}"
            if key not in section:
                errors.append(f"gate-fact-missing: '{name}' Step for '{phase}' does not name `{key}`")
        if boundary["kind"] == "approval" and f"gate_{phase}_override" in section:
            errors.append(f"gate-fact-unknown-phase: '{name}' names `gate_{phase}_override`, but '{phase}' is an approval boundary")
    for phase in sorted({m.group(1) for m in FACT_KEY.finditer(text)} - set(boundary_phases)):
        errors.append(f"gate-fact-unknown-phase: '{name}' names a gate fact for '{phase}', which is not a boundary")
    return errors


def check_skip_rule(name, text):
    for line in text.splitlines():
        if "`skip_phases`" in line and "no gate facts" in line and "`skip_reason`" in line:
            return []
    return [f"gate-skip-unexplained: '{name}' lacks the sentence that a skipped boundary writes no gate facts and needs a `skip_reason`"]


def check_evidence(name, text):
    errors = []
    if not RELATIVE_TO_ROOT.search(text):
        errors.append(
            f"gate-evidence-path: '{name}' does not say evidence is relative to the project root or `output_dir`"
        )
    for line in text.splitlines():
        for match in re.finditer(r"gate_([a-z0-9][a-z0-9-]*)_evidence", line):
            rest = line[match.end() :]
            following = re.search(r"gate_[a-z0-9-]+_(?:result|checker)", rest)
            segment = rest[: following.start()] if following else rest
            if ABSOLUTE_PATH.search(segment) or "worktree" in segment.lower():
                errors.append(
                    f"gate-evidence-path: '{name}' gate_{match.group(1)}_evidence names an absolute or worktree path"
                )
    return errors


def check_evidence_root(name, text):
    """k-full-sdlc only: Step 11 passes --root <output_dir>, so evidence must
    be anchored to output_dir, not the project root."""
    if RELATIVE_TO_OUTPUT_DIR in text and RELATIVE_TO_PROJECT_ROOT not in text:
        return []
    return [f"gate-evidence-root (k-full-sdlc only): '{name}' must anchor evidence relative to `output_dir` and nowhere relative to the project root"]


def check_word_mapping(name, text):
    errors = []
    if not any("verbatim" in s and "checker" in s for s in sentences(text)):
        errors.append(f"gate-word-mapped: '{name}' does not say the result is copied verbatim from the checker")
    for match in WORD_MAPPING.finditer(text):
        errors.append(f"gate-word-mapped: '{name}' maps a checker word to a gate id: '{match.group(0).strip()}'")
    return errors


def check_result_rule(name, text):
    errors = []
    result_tokens = ("highest", "still open", "not overridden", "verdict")
    if not any(all(tok in s for tok in result_tokens) for s in sentences(text)):
        errors.append(
            f"gate-result-rule: '{name}' lacks the rule that the result is the highest severity still open and not overridden, whatever its verdict"
        )
    written_tokens = ("only after", "checker's report", "complete")
    if not any(all(tok in s for tok in written_tokens) for s in sentences(text)):
        errors.append(f"gate-result-rule: '{name}' does not say the result is written only after the checker's report is complete")
    return errors


def check_override_rule(name, text):
    """Needed when a boundary is check-threshold: the engineer's way past an open finding."""
    errors = []
    way_forward = ("`gate_<phase>_override`", "override", "engineer")
    if not any(all(tok in s for tok in way_forward) for s in sentences(text)):
        errors.append(
            f"gate-override-rule: '{name}' lacks the sentence recording an engineer override as `gate_<phase>_override`"
        )
    if not any(all(tok in s for tok in ("unattended", "never", "override")) for s in sentences(text)):
        errors.append(f"gate-override-rule: '{name}' does not say an unattended run never overrides")
    if name == VERIFY_RUN_SOP and not any(
        all(tok in s for tok in ("round cap", "engineer", "only on that decision")) for s in sentences(text)
    ):
        errors.append(f"gate-override-rule: '{name}' does not say the engineer decides at the round cap and the note is written only on that decision")
    return errors


def check_max_fix_cycles(name, text):
    """k-full-sdlc only: the evaluator reads the fix-cycle cap from run.data."""
    required = ("`max_fix_cycles`", "`run.data`", "minting", "non-negative integer")
    if any(all(part in s for part in required) for s in sentences(text)):
        return []
    return [
        f"max-fix-cycles-unrecorded (k-full-sdlc only): '{name}' does not say `max_fix_cycles` is written into `run.data` at minting as a non-negative integer"
    ]


def check_verify_run_step(name, section):
    """Rules for the final Step of k-full-sdlc only (sdlc-summary.md, k-developer);
    check_sop runs this for no other SOP."""
    errors = []
    call = section.find(VERIFY_CALL)
    write = SUMMARY_WRITE.search(section)
    if call < 0:
        return [f"verify-run-step (k-full-sdlc only): '{name}' final Step does not delegate `{VERIFY_CALL}`"]
    sentence = sentences(section[call:])[0]
    if not all(part in sentence for part in ("--allow-running", "--root", "`k-developer`")):
        errors.append(f"verify-run-step (k-full-sdlc only): '{name}' verify-run call must pass --allow-running and --root and go to `k-developer`")
    if not all(part in sentence for part in ("--root <output_dir>", "`codebase_path`", "absolute")) or RUN_FROM_OUTPUT_DIR.search(sentence):
        errors.append(
            f"verify-run-root (k-full-sdlc only): '{name}' verify-run call must run from `codebase_path` with an absolute session path and `--root <output_dir>`"
        )
    if write is None or write.start() < call:
        errors.append(f"verify-run-step (k-full-sdlc only): '{name}' verify-run must come before the first write of `sdlc-summary.md`")
    if "no session file" not in section:
        errors.append(f"verify-run-step (k-full-sdlc only): '{name}' final Step does not cover 'no session file'")
    if not any("not found" in s and "verify-run unavailable" in s for s in sentences(section)):
        errors.append(f"verify-run-step (k-full-sdlc only): '{name}' final Step does not cover 'verify-run unavailable' for a binary that is not found")
    if "unrecognized subcommand" not in section:
        errors.append(f"verify-run-step (k-full-sdlc only): '{name}' final Step does not cover 'unrecognized subcommand'")
    for code in EXIT_CODES:
        if not re.search(rf"\bexit {code}\b", section, re.IGNORECASE):
            errors.append(f"verify-run-exits (k-full-sdlc only): '{name}' final Step does not say what to do with exit {code}")
    for phrase in ("unexpected argument", "needs a build with --root"):
        if phrase not in section:
            errors.append(f"verify-run-exits (k-full-sdlc only): '{name}' final Step does not cover '{phrase}'")
    expected = re.search(r"\*\*Expected Output:\*\*[^\n]*", section)
    if expected is None or "`Gate check`" not in expected.group(0):
        errors.append(f"verify-run-step (k-full-sdlc only): '{name}' final Step's Expected Output does not name the `Gate check` section")
    return errors


def check_sop(name, text, entry):
    phases = entry["phases"]
    boundaries = entry["boundaries"]
    sections = step_sections(text, phases)
    errors = check_step_headings(name, text, phases)
    errors += check_fact_keys(name, text, sections, boundaries)
    errors += check_skip_rule(name, text)
    errors += check_evidence(name, text)
    errors += check_word_mapping(name, text)
    errors += check_result_rule(name, text)
    if any(b["kind"] == "check-threshold" for b in boundaries):
        errors += check_override_rule(name, text)
    if name == VERIFY_RUN_SOP:
        errors += check_evidence_root(name, text)
        errors += check_max_fix_cycles(name, text)
        errors += check_verify_run_step(name, sections.get(phases[-1], ""))
    return errors


def check(root):
    orchestration = load_orchestration_check()
    try:
        import yaml
    except ImportError:
        return ["setup: PyYAML is required (python3 -m pip install pyyaml)"]
    map_file = root / orchestration.MAP_PATH
    try:
        data = yaml.safe_load(map_file.read_text(encoding="utf-8"))
    except (yaml.YAMLError, UnicodeDecodeError, OSError) as exc:
        return [f"bad-entry: {orchestration.MAP_PATH}: {orchestration.first_line(exc)}"]
    gated = data.get("gated") if isinstance(data, dict) else None
    if not isinstance(gated, dict):
        return [f"bad-entry: {orchestration.MAP_PATH} has no 'gated' mapping"]
    errors = []
    for name in sorted(gated):
        entry = gated[name]
        if not (isinstance(entry, dict) and "boundaries" in entry):
            continue
        if not (
            orchestration.phases_are_valid(entry.get("phases"))
            and orchestration.boundaries_are_valid(entry["boundaries"])
        ):
            continue  # check-sop-orchestration.py reports the bad shape
        sop = orchestration.SOP_DIR / (name + orchestration.SOP_SUFFIX)
        try:
            text = (root / sop).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError) as exc:
            errors.append(f"bad-entry: {sop}: {orchestration.first_line(exc)}")
            continue
        errors += check_sop(name, text, entry)
    return errors


def main(argv):
    if len(argv) > 2 or (len(argv) == 2 and argv[1].startswith("-")):
        print("usage: check-sop-gate-facts.py [repo-root]", file=sys.stderr)
        return EX_USAGE
    root = Path(argv[1]) if len(argv) == 2 else Path(".")
    if not root.is_dir():
        print(f"usage: repo root '{root}' is not a directory", file=sys.stderr)
        return EX_USAGE
    errors = check(root)
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
