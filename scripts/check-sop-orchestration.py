#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Check that cli/gate-config/sop-orchestration.yml, the SOP marker lines
and agent-sops/*.sop.md agree.

Usage: check-sop-orchestration.py [repo-root]

Exit 0 and print nothing when they agree. Exit 1 and print one
`<code>: <detail>` line per violation to stderr when they do not.
Exit 64 on a bad invocation.

Codes: `bad-entry` means one entry is malformed on its own. The other
`*-mismatch` and `unknown-boundary-*` codes mean a reference that does not
resolve to the SOP or to the entry's own `phases` and `gates`.
"""
import re
import sys
from pathlib import Path

MAP_PATH = Path("cli/gate-config/sop-orchestration.yml")
SOP_DIR = Path("agent-sops")
SOP_SUFFIX = ".sop.md"
GATE_KINDS = {"approval", "check-threshold", "loop-exit"}
TOP_LEVEL_KEYS = {"version", "marker", "gated", "not_gated"}
GATED_ENTRY_KEYS = {"gates", "basis", "phases", "boundaries"}
BOUNDARY_KEYS = {"phase", "kind", "scope"}
BOUNDARY_SCOPES = {"run", "feature"}
PHASE_LIST_BULLET = "- **Phase list.**"
PHASE_LIST_END = "the same ids as"
EX_USAGE = 64


def marker_is_placed(text, marker):
    """True when the marker is its own paragraph right after the `# ` title
    and nowhere in `## Overview`. The installer reads the first Overview
    paragraph as the skill description, so the marker must stay out of it."""
    lines = text.splitlines()
    filled = [i for i, line in enumerate(lines) if line.strip()]
    if len(filled) < 2 or not lines[filled[0]].startswith("# "):
        return False
    at = filled[1]
    if lines[at].rstrip() != marker:
        return False
    if at + 1 < len(lines) and lines[at + 1].strip():
        return False
    return marker not in overview_text(lines)


def overview_text(lines):
    """Return the `## Overview` section, up to the next heading."""
    section, inside = [], False
    for line in lines:
        if line.strip() == "## Overview":
            inside = True
        elif inside and line.startswith("#"):
            break
        elif inside:
            section.append(line)
    return "\n".join(section)


def check_map_shape(data):
    errors = []
    for key in sorted(TOP_LEVEL_KEYS - data.keys()):
        errors.append(f"bad-entry: missing top-level key '{key}'")
    for key in sorted(data.keys() - TOP_LEVEL_KEYS):
        errors.append(f"bad-entry: unknown top-level key '{key}'")
    marker = data.get("marker")
    if "marker" in data and not (isinstance(marker, str) and marker.strip()):
        errors.append("bad-entry: 'marker' must be a non-empty string")
    for section in ("gated", "not_gated"):
        if section in data and not isinstance(data[section], dict):
            errors.append(f"bad-entry: '{section}' must be a mapping of SOP names")
    for name, entry in (data.get("gated") or {}).items():
        gates = entry.get("gates") if isinstance(entry, dict) else None
        basis = entry.get("basis") if isinstance(entry, dict) else None
        if not (isinstance(gates, list) and gates and set(gates) <= GATE_KINDS):
            errors.append(
                f"bad-entry: gated '{name}' needs a non-empty 'gates' list of "
                f"{', '.join(sorted(GATE_KINDS))}"
            )
        if not (isinstance(basis, str) and basis.strip()):
            errors.append(f"bad-entry: gated '{name}' needs a non-empty 'basis'")
        if isinstance(entry, dict):
            for key in sorted(entry.keys() - GATED_ENTRY_KEYS, key=str):
                errors.append(f"bad-entry: gated '{name}' has unknown key '{key}'")
            errors += check_phase_shape(name, entry)
    for name, basis in (data.get("not_gated") or {}).items():
        if not (isinstance(basis, str) and basis.strip()):
            errors.append(f"bad-entry: not_gated '{name}' needs a non-empty basis string")
    return errors


def check_phase_shape(name, entry):
    errors = []
    if "phases" in entry and not phases_are_valid(entry["phases"]):
        errors.append(f"bad-entry: gated '{name}' 'phases' must be a non-empty list of unique ids")
    if "boundaries" in entry:
        problem = boundary_problem(entry["boundaries"])
        if problem:
            errors.append(f"bad-entry: gated '{name}' 'boundaries' {problem}")
        else:
            for phase in duplicate_phases(entry["boundaries"]):
                errors.append(f"bad-entry: gated '{name}' boundary phase '{phase}' listed more than once")
        if "phases" not in entry:
            errors.append(f"bad-entry: gated '{name}' has 'boundaries' without 'phases'")
    return errors


def phases_are_valid(phases):
    return (
        isinstance(phases, list)
        and phases
        # the string check must precede set(): a list id is unhashable
        and all(isinstance(p, str) and p.strip() for p in phases)
        and len(set(phases)) == len(phases)
    )


def boundary_problem(boundaries):
    """Return what is wrong with a `boundaries` value, or None when it is valid."""
    if not isinstance(boundaries, list):
        return "must be a list of {phase, kind, scope}"
    if not boundaries:
        return "must not be empty; omit it when the SOP has no boundaries yet"
    for number, boundary in enumerate(boundaries, 1):
        if not isinstance(boundary, dict):
            return f"item {number} must be a mapping with keys phase, kind, scope"
        if boundary.keys() != BOUNDARY_KEYS:
            missing = sorted(BOUNDARY_KEYS - boundary.keys())
            extra = sorted(map(str, boundary.keys() - BOUNDARY_KEYS))
            return f"item {number} must have exactly phase, kind, scope (missing {missing}, unexpected {extra})"
        for key in ("phase", "kind"):
            if not isinstance(boundary[key], str):
                return f"item {number} '{key}' must be a string"
        if not (isinstance(boundary["scope"], str) and boundary["scope"] in BOUNDARY_SCOPES):
            return f"item {number} 'scope' must be one of {', '.join(sorted(BOUNDARY_SCOPES))}"
    return None


def duplicate_phases(boundaries):
    """Return the phases listed by more than one boundary, in first-repeat order."""
    seen, repeated = set(), []
    for boundary in boundaries:
        phase = boundary["phase"]
        if phase in seen and phase not in repeated:
            repeated.append(phase)
        seen.add(phase)
    return repeated


def sop_phase_list(text):
    """Return the backticked ids of the `- **Phase list.**` bullet in order,
    or None when the SOP has no such bullet. The bullet goes on to name other
    backticked tokens, so only the ids before "the same ids as" (or before the
    first sentence end when that phrase is absent) count."""
    for line in text.splitlines():
        if line.startswith(PHASE_LIST_BULLET):
            listed = line[len(PHASE_LIST_BULLET):]
            if PHASE_LIST_END in listed:
                listed = listed.split(PHASE_LIST_END, 1)[0]
            else:
                listed = re.split(r"\.\s", listed, maxsplit=1)[0]
            return re.findall(r"`([^`]+)`", listed)
    return None


def check_boundaries(root, gated):
    """Check that `phases` matches the SOP's Phase list bullet, and every boundary
    names a phase in `phases` and a kind in `gates`. Entries whose shape is
    already reported as bad-entry are skipped."""
    errors = []
    for name in sorted(gated):
        entry = gated[name]
        if not (isinstance(entry, dict) and phases_are_valid(entry.get("phases"))):
            continue
        phases = entry["phases"]
        sop = SOP_DIR / (name + SOP_SUFFIX)
        try:
            text = (root / sop).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            text = None  # check_agreement already reports a missing or unreadable SOP
        if text is not None:
            listed = sop_phase_list(text)
            if listed is None:
                errors.append(f"phase-list-mismatch: gated '{name}' has phases but {sop} has no Phase list bullet")
            elif listed != phases:
                errors.append(
                    f"phase-list-mismatch: gated '{name}' phases {phases} differ from {sop} Phase list {listed}"
                )
        boundaries = entry.get("boundaries", [])
        if "boundaries" in entry and boundary_problem(boundaries) is not None:
            continue
        gates = entry.get("gates") if isinstance(entry.get("gates"), list) else []
        for boundary in boundaries:
            if boundary["phase"] not in phases:
                errors.append(f"unknown-boundary-phase: gated '{name}' boundary '{boundary['phase']}' is not in phases")
            if boundary["kind"] not in gates:
                errors.append(
                    f"unknown-boundary-kind: gated '{name}' boundary '{boundary['phase']}' "
                    f"kind '{boundary['kind']}' is not in gates"
                )
    return errors


def check_agreement(root, gated, not_gated, marker):
    errors = []
    sop_files = {p.name[: -len(SOP_SUFFIX)]: p for p in (root / SOP_DIR).glob("*" + SOP_SUFFIX)}
    for name in sorted(gated.keys() & not_gated.keys()):
        errors.append(f"listed-twice: '{name}' is in both gated and not_gated")
    for name in sorted(sop_files.keys() - gated.keys() - not_gated.keys()):
        errors.append(f"unlisted-sop: {SOP_DIR / (name + SOP_SUFFIX)} is in neither gated nor not_gated")
    for name in sorted((gated.keys() | not_gated.keys()) - sop_files.keys()):
        errors.append(f"missing-sop-file: '{name}' is listed but {SOP_DIR / (name + SOP_SUFFIX)} does not exist")
    texts = {}
    for name in sorted(sop_files.keys() & (gated.keys() | not_gated.keys())):
        try:
            texts[name] = sop_files[name].read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError) as exc:
            errors.append(f"bad-entry: {SOP_DIR / (name + SOP_SUFFIX)}: {first_line(exc)}")
    for name in sorted(texts.keys() & gated.keys()):
        text = texts[name]
        if not marker_is_placed(text, marker):
            errors.append(
                f"missing-marker: gated '{name}' must have '{marker}' as its own "
                "paragraph right after the title, above ## Overview"
            )
        if text.count(marker) > 1:
            errors.append(f"unexpected-marker: gated '{name}' has the marker more than once")
    for name in sorted(texts.keys() & not_gated.keys()):
        if marker in texts[name]:
            errors.append(f"unexpected-marker: not_gated '{name}' contains '{marker}'")
    return errors


def first_line(exc):
    """Shorten an error to one line. A PyYAML error carries its cause and
    position as attributes; its str() spans several lines."""
    problem, mark = getattr(exc, "problem", None), getattr(exc, "problem_mark", None)
    if problem and mark:
        return f"{problem} at line {mark.line + 1}, column {mark.column + 1}"
    lines = str(exc).strip().splitlines()
    return lines[0] if lines else type(exc).__name__


def check(root):
    try:
        import yaml
    except ImportError:
        return ["setup: PyYAML is required (python3 -m pip install pyyaml)"]
    map_file = root / MAP_PATH
    if not map_file.is_file():
        return [f"bad-entry: {MAP_PATH} does not exist"]
    try:
        data = yaml.safe_load(map_file.read_text(encoding="utf-8"))
    except (yaml.YAMLError, UnicodeDecodeError, OSError) as exc:
        return [f"bad-entry: {MAP_PATH}: {first_line(exc)}"]
    if not isinstance(data, dict):
        return [f"bad-entry: {MAP_PATH} must be a mapping"]
    errors = check_map_shape(data)
    gated = data.get("gated") if isinstance(data.get("gated"), dict) else {}
    not_gated = data.get("not_gated") if isinstance(data.get("not_gated"), dict) else {}
    marker = data.get("marker")
    if isinstance(marker, str) and marker.strip():
        errors += check_agreement(root, gated, not_gated, marker.strip())
    errors += check_boundaries(root, gated)
    return errors


def main(argv):
    if len(argv) > 2 or (len(argv) == 2 and argv[1].startswith("-")):
        print("usage: check-sop-orchestration.py [repo-root]", file=sys.stderr)
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
