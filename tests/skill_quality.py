# SPDX-License-Identifier: Apache-2.0
"""Static quality checks for skills/*/SKILL.md, used by tests/test_skill_quality.py.

Checks each skill for: frontmatter `name` matching its directory; a description
with an activation condition and a length window; line and byte ceilings; no
unclosed code fence; and link, bare-path and `references/` integrity. Sizes over a threshold must be
carried by tests/skill-quality-baseline.json, which may only shrink.

Needs PyYAML. Without it, run: uvx --with pyyaml pytest -q tests/

CLI (run from anywhere):
  python3 tests/skill_quality.py --scorecard
  python3 tests/skill_quality.py --print-baseline > /tmp/b.json && mv /tmp/b.json tests/skill-quality-baseline.json
  python3 tests/skill_quality.py --print-baseline --allow-growth   (only after lowering a threshold)
  python3 tests/skill_quality.py --check-ratchet OLD_BASELINE.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"
BASELINE_PATH = Path(__file__).resolve().parent / "skill-quality-baseline.json"

DIMENSIONS = ("bytes", "description_chars", "lines")
DEFAULT_THRESHOLDS = {"bytes": 32768, "description_chars": 512, "lines": 500}
DEFAULT_TOLERANCE = {"bytes": 1024, "description_chars": 50, "lines": 50}
DESCRIPTION_MIN_CHARS = 60
DESCRIPTION_MIN_WORDS = 8

BASELINE_COMMENT = (
    "Shrink-only ratchet read by tests/test_skill_quality.py. An entry is the exact "
    "measured value of a dimension that is over its threshold. Lower or delete an entry "
    "when you slim a skill; never raise one; never add one for an existing skill unless "
    "the threshold above was lowered in the same change. Renaming a skill adds an entry, so "
    "bring a renamed skill under every threshold first. Regenerate with: "
    "python3 tests/skill_quality.py --print-baseline"
)

# Activation signals. These are heuristics: any one passing is enough, and the
# verb proxy alone only warns.
# "Use/load/run ... when/for/before ..." where the verb starts a clause.
TRIGGER_CLAUSE = re.compile(
    r"(?:^|[.;:!?,]\s+)(use|invoke|run|load|apply)\b.{0,60}?"
    r"\b(when|for|after|before|whenever|to|if|during|on)\b",
    re.IGNORECASE,
)
# A condition word anywhere in the description.
CONDITION_WORD = re.compile(r"\b(when|whenever|before|after|triggers?)\b", re.IGNORECASE)
# Passive applicability, e.g. "Loaded only in Claude Code sessions".
SCOPE_CLAUSE = re.compile(r"\bonly (in|for|when|on)\b|\bapplies to\b", re.IGNORECASE)
# An explicit mandate.
MUST_USE = re.compile(r"\bMUST USE\b", re.IGNORECASE)
# Behavior-summary form: a capitalised third-person verb first ("Validates ...").
# A plural noun before a preposition ("Notes on ...") is not a verb.
VERB_PROXY = re.compile(r"^[A-Z][a-z]+s\b(?!\s+(?:on|of|for|about|in|to|from|with|at|by)\b)")
VERB_PROXY_STOPLIST = frozenset({"This", "Has", "Was", "Its", "Is", "Does", "Thus", "Plus"})

FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
FENCE_CLOSE = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*$")
# The destination may hold one level of balanced parentheses, e.g. "a(1).md".
INLINE_LINK = re.compile(r"\]\(((?:[^()]|\([^()]*\))*)\)")
REFERENCE_DEFINITION = re.compile(r"^ {0,3}\[(?!\^)[^\]]+\]:\s*(\S+)")
CODE_SPAN = re.compile(r"(`+)(?!`)(.+?)(?<!`)\1(?!`)")
URL_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)
BARE_PATH = re.compile(r"(?<![\w/.-])((?:references|scripts|evals|templates|assets)/[\w./-]+)")
READ_VERB = re.compile(r"\b(read|open|consult|load)\b", re.IGNORECASE)
READ_CONDITION = re.compile(r"\b(when|whenever|before|after|if|unless|during|only)\b", re.IGNORECASE)
SKILL_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*$")


@dataclass
class Finding:
    skill: str
    rule: str
    message: str
    severity: str = "error"


@dataclass
class SkillReport:
    skill: str
    metrics: dict | None = None
    findings: list = field(default_factory=list)

    def fail(self, rule: str, message: str) -> None:
        self.findings.append(Finding(self.skill, rule, message))

    def warn(self, rule: str, message: str) -> None:
        self.findings.append(Finding(self.skill, rule, message, "warning"))


class BaselineError(ValueError):
    pass


# ── Parsing ──────────────────────────────────────────────────────────────────


def count_lines(text: str) -> int:
    """Same value as `wc -l`: newline characters, nothing else."""
    return text.count("\n")


def split_frontmatter(text: str) -> tuple[str, list[str], int]:
    """Return (frontmatter, body lines, 1-based line number of the first body line)."""
    if not text.startswith("---\n"):
        raise ValueError("file does not start with a '---' frontmatter line")
    lines = text.split("\n")
    for index in range(1, len(lines)):
        if lines[index] == "---":
            return "\n".join(lines[1:index]), lines[index + 1 :], index + 2
    raise ValueError("frontmatter has no closing '---' line")


def blank_fenced_lines(lines: list[str]) -> tuple[list[str], int | None]:
    """Replace every line of a CommonMark fenced block (fences included) with ''.

    Also return the 0-based index of a fence still open at the end, else None.
    """
    out = []
    fence = None
    opened_at = None
    for index, line in enumerate(lines):
        if fence is None:
            match = FENCE_OPEN.match(line)
            if match and not (match.group(1)[0] == "`" and "`" in match.group(2)):
                fence = match.group(1)
                opened_at = index
                out.append("")
            else:
                out.append(line)
        else:
            match = FENCE_CLOSE.match(line)
            if match and match.group(1)[0] == fence[0] and len(match.group(1)) >= len(fence):
                fence = None
            out.append("")
    return out, (opened_at if fence is not None else None)


def link_target(destination: str) -> str:
    destination = destination.strip()
    if destination.startswith("<"):
        end = destination.find(">")
        return destination[1:end] if end != -1 else destination[1:]
    return destination.split(None, 1)[0] if destination else ""


def has_activation_condition(description: str) -> tuple[bool, bool]:
    """Return (passes, passes_only_via_verb_proxy)."""
    for pattern in (TRIGGER_CLAUSE, CONDITION_WORD, SCOPE_CLAUSE, MUST_USE):
        if pattern.search(description):
            return True, False
    match = VERB_PROXY.match(description)
    if match and match.group(0) not in VERB_PROXY_STOPLIST:
        return True, True
    return False, False


# ── Content checks (everything except the baselined sizes) ───────────────────


def check_skill_content(skill_dir: Path) -> SkillReport:
    """Measure one skill and run every rule that does not depend on the baseline."""
    report = SkillReport(skill_dir.name)
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        report.fail("skill-md", f"{skill_md} is missing")
        return report
    raw = skill_md.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        report.fail("encoding", f"SKILL.md is not UTF-8 (byte offset {error.start})")
        return report
    if "\r" in text:
        report.fail("encoding", "SKILL.md has CRLF line endings")
        return report
    try:
        frontmatter, body, body_start = split_frontmatter(text)
        meta = yaml.safe_load(frontmatter)
    except (ValueError, yaml.YAMLError) as error:
        report.fail("frontmatter", f"SKILL.md frontmatter does not parse: {error}")
        return report
    if not isinstance(meta, dict):
        report.fail("frontmatter", "SKILL.md frontmatter is not a mapping")
        return report
    for key in ("name", "description"):
        if not isinstance(meta.get(key), str):
            report.fail("frontmatter", f"frontmatter '{key}' is missing or not a string")
    if report.findings:
        return report

    description = " ".join(meta["description"].split())
    report.metrics = {
        "bytes": len(raw),
        "lines": count_lines(text),
        "description_chars": len(description),
    }
    _check_name(report, meta["name"])
    _check_description(report, description)
    unfenced, open_fence = blank_fenced_lines(body)
    if open_fence is not None:
        # Fail closed: an unclosed fence would hide every later line from the checks below.
        report.fail("fence", f"line {body_start + open_fence}: code fence opened here is never closed")
    _check_links(report, skill_dir, unfenced, body_start)
    _check_bare_paths(report, skill_dir, unfenced, body_start)
    _check_references(report, skill_dir, text, unfenced, body_start)
    return report


def _check_name(report: SkillReport, name: str) -> None:
    if name != report.skill:
        report.fail("name", f"frontmatter name '{name}' does not match directory '{report.skill}'")


def _check_description(report: SkillReport, description: str) -> None:
    chars = len(description)
    words = len(description.split())
    if chars < DESCRIPTION_MIN_CHARS:
        report.fail("description", f"description is {chars} chars, minimum {DESCRIPTION_MIN_CHARS}")
    if words < DESCRIPTION_MIN_WORDS:
        report.fail("description", f"description is {words} words, minimum {DESCRIPTION_MIN_WORDS}")
    passes, proxy_only = has_activation_condition(description)
    if not passes:
        report.fail(
            "activation",
            "description gives no activation condition: add a 'Use when ...' clause "
            "or open with a behavior summary ('Validates ...')",
        )
    elif proxy_only:
        report.warn(
            "activation",
            "description passes only as a behavior summary (first-word verb); "
            "check that it says when the skill applies",
        )


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _resolves_to_file(target: Path, root: Path) -> str | None:
    """Return None when target is a regular file inside root, else the reason."""
    if not _inside(target, root):
        return "escapes the skill directory"
    current = target
    while current != root and current != current.parent:
        if current.is_symlink():
            return "is a symlink"
        current = current.parent
    if not target.is_file():
        return "is not an existing file"
    return None


def blank_code_spans(line: str) -> str:
    """Replace each inline code span with spaces of the same length."""
    return CODE_SPAN.sub(lambda match: " " * len(match.group(0)), line)


def _link_destinations(line: str) -> list[str]:
    destinations = [match.group(1) for match in INLINE_LINK.finditer(line)]
    definition = REFERENCE_DEFINITION.match(line)
    if definition:
        destinations.append(definition.group(1))
    return destinations


def _check_links(report: SkillReport, skill_dir: Path, unfenced: list[str], start: int) -> None:
    for offset, line in enumerate(unfenced):
        for destination in _link_destinations(blank_code_spans(line)):
            target = link_target(destination)
            if URL_SCHEME.match(target) or target.startswith("#"):
                continue
            path = target.split("#", 1)[0]
            reason = _resolves_to_file(skill_dir / path, skill_dir)
            if reason:
                report.fail("link", f"line {start + offset}: link target '{target}' {reason}")


def _check_bare_paths(report: SkillReport, skill_dir: Path, unfenced: list[str], start: int) -> None:
    for offset, line in enumerate(unfenced):
        for match in BARE_PATH.finditer(line):
            path = match.group(1).rstrip(".,;:)")
            if not (skill_dir / path.split("/", 1)[0]).is_dir():
                continue
            target = skill_dir / path
            if not _inside(target, skill_dir) or not target.exists():
                report.fail("path", f"line {start + offset}: '{path}' does not exist in the skill directory")


def _check_references(
    report: SkillReport, skill_dir: Path, text: str, unfenced: list[str], start: int
) -> None:
    references = skill_dir / "references"
    if not (references.exists() or references.is_symlink()):
        return
    if references.is_symlink() or not references.is_dir():
        report.fail("references", "references/ must be a real directory")
        return
    for entry in sorted(references.iterdir()):
        rel = f"references/{entry.name}"
        if entry.is_symlink():
            report.fail("references", f"{rel} is a symlink")
        elif entry.is_dir():
            report.fail("references", f"{rel} is a subdirectory; references/ is one level deep")
        elif not entry.is_file():
            report.fail("references", f"{rel} is not a regular file")
        elif entry.name.lower() == "skill.md":
            report.fail("references", f"{rel} would look like a second skill; rename it")
        elif entry.suffix != ".md":
            report.fail("references", f"{rel} is not Markdown (.md)")
        else:
            _check_reference_cue(report, rel, text, unfenced, start)


def _check_reference_cue(report: SkillReport, rel: str, text: str, unfenced: list[str], start: int) -> None:
    if rel not in text:
        report.fail("references", f"{rel} is never mentioned in SKILL.md (orphan)")
        return
    mentions = [(start + i, line) for i, line in enumerate(unfenced) if rel in line]
    if any(READ_VERB.search(line) and READ_CONDITION.search(line) for _, line in mentions):
        return
    quoted = "; ".join(f"line {number}: {line.strip()}" for number, line in mentions) or "only inside fences"
    report.fail(
        "references",
        f"{rel} has no read cue: one unfenced line naming it needs a read verb "
        f"(read/open/consult/load) and a condition (when/before/after/if/...). Mentions: {quoted}",
    )


# ── Baseline ─────────────────────────────────────────────────────────────────


def validate_baseline(baseline: object) -> None:
    """Raise BaselineError on any schema violation."""
    if not isinstance(baseline, dict):
        raise BaselineError("top level is not an object")
    expected = {"_comment", "skills", "thresholds", "tolerance"}
    if set(baseline) != expected:
        raise BaselineError(f"top-level keys must be exactly {sorted(expected)}, got {sorted(baseline)}")
    if not isinstance(baseline["_comment"], str):
        raise BaselineError("_comment is not a string")
    for section in ("thresholds", "tolerance"):
        values = baseline[section]
        if not isinstance(values, dict) or set(values) != set(DIMENSIONS):
            raise BaselineError(f"{section} must have exactly the keys {list(DIMENSIONS)}")
        for dim, value in values.items():
            if not _positive_int(value):
                raise BaselineError(f"{section}.{dim} is not a positive integer")
    if not isinstance(baseline["skills"], dict):
        raise BaselineError("skills is not an object")
    for skill, entry in baseline["skills"].items():
        if not SKILL_NAME.match(skill):
            raise BaselineError(f"skills key '{skill}' is not a skill name")
        if not isinstance(entry, dict) or not entry or not set(entry) <= set(DIMENSIONS):
            raise BaselineError(f"skills.{skill} must be a non-empty object over {list(DIMENSIONS)}")
        for dim, value in entry.items():
            if not _positive_int(value):
                raise BaselineError(f"skills.{skill}.{dim} is not a positive integer")
            if value <= baseline["thresholds"][dim]:
                raise BaselineError(
                    f"baseline entry is under threshold: skills.{skill}.{dim} = {value} "
                    f"<= {baseline['thresholds'][dim]}"
                )


def _positive_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def load_baseline(path: Path | None = None) -> dict:
    path = path or BASELINE_PATH
    try:
        baseline = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise BaselineError(f"cannot read {path}: {error}") from error
    validate_baseline(baseline)
    return baseline


def render_baseline(baseline: dict) -> str:
    return json.dumps(baseline, indent=2, sort_keys=True) + "\n"


def missing_baseline_skills(baseline: dict, skills_dir: Path) -> list[str]:
    return sorted(skill for skill in baseline["skills"] if not (skills_dir / skill).is_dir())


def check_sizes(skill: str, metrics: dict, baseline: dict) -> list[Finding]:
    """Apply the shrink-only pass rule to each baselined dimension, first match wins."""
    findings = []
    entry = baseline["skills"].get(skill, {})
    for dim in DIMENSIONS:
        measured = metrics[dim]
        threshold = baseline["thresholds"][dim]
        tolerance = baseline["tolerance"][dim]
        ceiling = entry.get(dim)
        message = None
        if ceiling is None:
            if measured > threshold:
                message = f"{dim} {measured} is over threshold {threshold} and not in baseline"
        elif measured > ceiling:
            message = f"{dim} {measured} grew past its baseline ceiling {ceiling}"
        elif measured <= threshold:
            message = f"{dim} {measured} is at or under threshold {threshold}: stale baseline, delete the entry"
        elif measured <= ceiling - tolerance:
            message = f"{dim} {measured} is well under ceiling {ceiling}: stale baseline, lower to {measured}"
        if message:
            findings.append(Finding(skill, "size", message))
    return findings


def skill_dirs(skills_dir: Path) -> list[Path]:
    return sorted(path for path in skills_dir.iterdir() if path.is_dir())


def build_baseline(skills_dir: Path, thresholds: dict, tolerance: dict) -> dict:
    """Return a baseline holding the exact measured value of every over-threshold dimension."""
    skills = {}
    for skill_dir in skill_dirs(skills_dir):
        report = check_skill_content(skill_dir)
        if report.metrics is None:
            reasons = "; ".join(f.message for f in report.findings)
            raise BaselineError(f"{skill_dir.name}: {reasons}")
        entry = {d: report.metrics[d] for d in DIMENSIONS if report.metrics[d] > thresholds[d]}
        if entry:
            skills[skill_dir.name] = entry
    return {
        "_comment": BASELINE_COMMENT,
        "skills": skills,
        "thresholds": dict(thresholds),
        "tolerance": dict(tolerance),
    }


def check_ratchet(old: dict, new: dict) -> list[str]:
    """Return one line per way NEW grew relative to OLD; empty when NEW only shrank."""
    violations = []
    for section in ("thresholds", "tolerance"):
        for dim in DIMENSIONS:
            if new[section][dim] > old[section][dim]:
                violations.append(f"{section}.{dim} raised from {old[section][dim]} to {new[section][dim]}")
    for skill, entry in sorted(new["skills"].items()):
        old_entry = old["skills"].get(skill, {})
        for dim, value in sorted(entry.items()):
            if dim not in old_entry:
                threshold_cut = new["thresholds"][dim] < old["thresholds"][dim]
                if not (threshold_cut and value <= old["thresholds"][dim]):
                    violations.append(f"skills.{skill}.{dim} = {value} added")
            elif value > old_entry[dim]:
                violations.append(f"skills.{skill}.{dim} raised from {old_entry[dim]} to {value}")
    return violations


# ── CLI ──────────────────────────────────────────────────────────────────────


def _baseline_limits() -> tuple[dict, dict]:
    try:
        baseline = load_baseline()
        return baseline["thresholds"], baseline["tolerance"]
    except BaselineError:
        return DEFAULT_THRESHOLDS, DEFAULT_TOLERANCE


def _scorecard() -> int:
    thresholds, tolerance = _baseline_limits()
    baselined = build_baseline(SKILLS_DIR, thresholds, tolerance)["skills"]
    rows = []
    for skill_dir in skill_dirs(SKILLS_DIR):
        metrics = check_skill_content(skill_dir).metrics or {d: 0 for d in DIMENSIONS}
        rows.append((skill_dir.name, metrics, skill_dir.name in baselined))
    rows.sort(key=lambda row: row[1]["bytes"], reverse=True)
    print(f"{'name':<40} {'lines':>6} {'bytes':>7} {'desc':>5}  baselined")
    for name, metrics, flagged in rows:
        print(
            f"{name:<40} {metrics['lines']:>6} {metrics['bytes']:>7} "
            f"{metrics['description_chars']:>5}  {'yes' if flagged else ''}"
        )
    return 0


def _print_baseline(allow_growth: bool) -> int:
    thresholds, tolerance = _baseline_limits()
    try:
        built = build_baseline(SKILLS_DIR, thresholds, tolerance)
    except (BaselineError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    if not allow_growth:
        if not BASELINE_PATH.exists():
            violations = []
        else:
            try:
                violations = check_ratchet(load_baseline(), built)
            except BaselineError as error:
                # Redirecting straight onto the baseline truncates it before it is read.
                print(
                    f"error: committed baseline is unreadable ({error}); write the output "
                    "to a temp file, then move it into place",
                    file=sys.stderr,
                )
                return 1
        if violations:
            for line in violations:
                print(f"ratchet: {line}", file=sys.stderr)
            print(
                "error: the new baseline would grow; slim the skill instead, or pass "
                "--allow-growth if a threshold was lowered on purpose",
                file=sys.stderr,
            )
            return 1
    sys.stdout.write(render_baseline(built))
    return 0


def _check_ratchet(old_path: Path) -> int:
    try:
        old = load_baseline(old_path)
    except BaselineError as error:
        print(f"error: old baseline {old_path}: {error}", file=sys.stderr)
        return 1
    try:
        new = load_baseline()
    except BaselineError as error:
        print(f"error: new baseline {BASELINE_PATH}: {error}", file=sys.stderr)
        return 1
    violations = check_ratchet(old, new)
    for line in violations:
        print(f"ratchet: {line}", file=sys.stderr)
    return 1 if violations else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--scorecard", action="store_true", help="print per-skill sizes")
    mode.add_argument("--print-baseline", action="store_true", help="print a baseline built from the tree")
    mode.add_argument("--check-ratchet", metavar="OLD", type=Path, help="fail if the baseline grew vs OLD")
    parser.add_argument(
        "--allow-growth",
        action="store_true",
        help="with --print-baseline, print even when an entry would be raised or added",
    )
    args = parser.parse_args(argv)
    if args.allow_growth and not args.print_baseline:
        parser.error("--allow-growth only applies to --print-baseline")
    if args.scorecard:
        return _scorecard()
    if args.print_baseline:
        return _print_baseline(args.allow_growth)
    return _check_ratchet(args.check_ratchet)


if __name__ == "__main__":
    sys.exit(main())
