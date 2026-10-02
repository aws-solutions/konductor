#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Check every skills/*/SKILL.md under a Kiro Power tree against the
required parts of the Agent Skills frontmatter spec (agentskills.io/
specification), used by `make kiro-power-check`:

- YAML frontmatter block is present (opens and closes with `---`)
- `name` is present, 1-64 chars, lowercase letters/digits/hyphens only,
  no leading/trailing/double hyphen, and matches the containing directory
  name exactly (this repo's own established convention -- see
  skills/about-konductor/SKILL.md and every other skill here)
- `description` is present, non-empty, and <= 1024 chars

Deliberately hand-written against stdlib only (no PyYAML dependency),
same rationale as validate-kiro-power-plugin-json.py: this repo has no
requirements.txt/pyproject.toml anywhere, and the frontmatter shape this
checks is narrow enough (flat `key: value` pairs, no nested YAML) that a
line-based parse is sufficient and keeps this script dependency-free.

Usage:
  validate-kiro-power-skill-frontmatter.py <power-root>

Where <power-root> contains a skills/ directory (e.g. powers/konductor/,
or an assembled flat tree that has skills/ at its own root). Exits 0 and
prints nothing on success. Exits 1 and prints every violation found (not
just the first) to stderr on failure.
"""
import re
import sys
from pathlib import Path

_NAME_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_MAX_DESCRIPTION_CHARS = 1024


def parse_frontmatter(text: str) -> dict | None:
    """Returns a dict of the flat `key: value` frontmatter pairs, or None
    if the file has no `---`-delimited frontmatter block at all."""
    if not text.startswith("---\n") and not text.startswith("---\r\n"):
        return None
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return None

    fields: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip() or line.strip().startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_-]+):\s?(.*)$", line)
        if not m:
            continue
        key, value = m.group(1), m.group(2)
        # Only the top-level scalar keys this checker cares about
        # (name/description) are read this way; a multi-line or nested
        # value for an unrelated key is left as its raw first line, which
        # is fine since this checker never inspects those keys.
        if key not in fields:
            fields[key] = value.strip()
    return fields


def check_skill(skill_dir: Path) -> list[str]:
    errors: list[str] = []
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return [f"{skill_dir}: no SKILL.md found"]

    text = skill_md.read_text(encoding="utf-8")
    frontmatter = parse_frontmatter(text)
    if frontmatter is None:
        return [f"{skill_md}: missing or malformed YAML frontmatter (must open and close with '---')"]

    name = frontmatter.get("name")
    if not name:
        errors.append(f"{skill_md}: missing required frontmatter field 'name'")
    else:
        if not (1 <= len(name) <= 64):
            errors.append(f"{skill_md}: name must be 1-64 characters, got {len(name)}")
        elif not _NAME_PATTERN.match(name):
            errors.append(
                f"{skill_md}: name {name!r} must be lowercase letters/digits/hyphens only, "
                "no leading/trailing/double hyphen"
            )
        if name != skill_dir.name:
            errors.append(
                f"{skill_md}: frontmatter name {name!r} does not match containing directory {skill_dir.name!r}"
            )

    description = frontmatter.get("description")
    if not description:
        errors.append(f"{skill_md}: missing required frontmatter field 'description'")
    elif len(description) > _MAX_DESCRIPTION_CHARS:
        errors.append(
            f"{skill_md}: description is {len(description)} characters, exceeds the {_MAX_DESCRIPTION_CHARS}-character limit"
        )

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate-kiro-power-skill-frontmatter.py <power-root>", file=sys.stderr)
        return 64

    power_root = Path(sys.argv[1])
    skills_dir = power_root / "skills"
    if not skills_dir.is_dir():
        print(f"error: {skills_dir} not found", file=sys.stderr)
        return 1

    skill_dirs = sorted(p for p in skills_dir.iterdir() if p.is_dir())
    if not skill_dirs:
        print(f"error: no skill directories found under {skills_dir}", file=sys.stderr)
        return 1

    all_errors: list[str] = []
    for skill_dir in skill_dirs:
        all_errors.extend(check_skill(skill_dir))

    if all_errors:
        print("error: skill frontmatter validation failed:", file=sys.stderr)
        for e in all_errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
