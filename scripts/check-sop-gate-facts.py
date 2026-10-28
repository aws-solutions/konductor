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
FACT_KEY = re.compile(r"gate_([a-z0-9][a-z0-9-]*)_(result|evidence|checker)")
STEP_HEADING = re.compile(r"^### \d+\. ", re.MULTILINE)
SECTION_END = re.compile(r"^#{2,3} ", re.MULTILINE)
CHECKER_WORDS = r"IMPORTANT|SUGGESTION|MINOR|WARNING"
GATE_IDS = r"HIGH|MEDIUM|LOW|INFO"
MAPS_TO = r"\s*(?:->|\u2192|=|maps to|means|becomes|counts as|is treated as)\s*"
WORD_MAPPING = re.compile(
    rf"\b(?:{CHECKER_WORDS})\b`?{MAPS_TO}`?\b(?:{GATE_IDS})\b"
    rf"|\b(?:{GATE_IDS})\b`?{MAPS_TO}`?\b(?:{CHECKER_WORDS})\b"
)
ABSOLUTE_PATH = re.compile(r"`(?:/|~|[A-Za-z]:[\\/])")
SUMMARY_WRITE = re.compile(r"\bwrite `sdlc-summary\.md`", re.IGNORECASE)
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


def check_fact_keys(name, text, sections, boundary_phases):
    errors = []
    for phase in boundary_phases:
        section = sections.get(phase, "")
        for suffix in FACT_SUFFIXES:
            key = f"gate_{phase}_{suffix}"
            if key not in section:
                errors.append(f"gate-fact-missing: '{name}' Step for '{phase}' does not name `{key}`")
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
    if "relative to the project root" not in text:
        errors.append(f"gate-evidence-path: '{name}' does not say evidence is relative to the project root")
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


def check_word_mapping(name, text):
    errors = []
    if not any("verbatim" in s and "checker" in s for s in sentences(text)):
        errors.append(f"gate-word-mapped: '{name}' does not say the result is copied verbatim from the checker")
    for match in WORD_MAPPING.finditer(text):
        errors.append(f"gate-word-mapped: '{name}' maps a checker word to a gate id: '{match.group(0).strip()}'")
    return errors


def check_result_rule(name, text):
    errors = []
    if not any("highest" in s and "still open" in s and "whatever its verdict" in s for s in sentences(text)):
        errors.append(
            f"gate-result-rule: '{name}' lacks the rule that the result is the highest severity still open, whatever its verdict"
        )
    if "only after the checker's report is complete" not in text:
        errors.append(f"gate-result-rule: '{name}' does not say the result is written only after the checker's report is complete")
    return errors


def check_verify_run_step(name, section):
    errors = []
    call = section.find(VERIFY_CALL)
    write = SUMMARY_WRITE.search(section)
    if call < 0:
        return [f"verify-run-step: '{name}' final Step does not delegate `{VERIFY_CALL}`"]
    sentence = sentences(section[call:])[0]
    if "--allow-running" not in sentence or "`k-developer`" not in sentence:
        errors.append(f"verify-run-step: '{name}' verify-run call must pass --allow-running and go to `k-developer`")
    if write is None or write.start() < call:
        errors.append(f"verify-run-step: '{name}' verify-run must come before the first write of `sdlc-summary.md`")
    for phrase in ("no session file", "verify-run unavailable", "not found", "unrecognized subcommand"):
        if phrase not in section:
            errors.append(f"verify-run-step: '{name}' final Step does not cover '{phrase}'")
    return errors


def check_sop(name, text, entry):
    phases = entry["phases"]
    boundary_phases = [b["phase"] for b in entry["boundaries"]]
    sections = step_sections(text, phases)
    errors = check_fact_keys(name, text, sections, boundary_phases)
    errors += check_skip_rule(name, text)
    errors += check_evidence(name, text)
    errors += check_word_mapping(name, text)
    errors += check_result_rule(name, text)
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
