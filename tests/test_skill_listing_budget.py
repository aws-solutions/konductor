# SPDX-License-Identifier: Apache-2.0
"""The skill listing Claude Code builds from skill descriptions must stay under its budget.

Claude Code warns "Skill listing over budget: 96 skills, 31237 chars > 30000" and
drops descriptions once the listing passes 30,000 chars. A skill whose description
is dropped can no longer be picked, so this test fails at 29,000 to leave room.
"""

import re
from pathlib import Path

import yaml

LISTING_MAX_CHARS = 29_000
# Claude Code's 12 built-in skills measured 5,262 chars; rounded up so a small
# change in a Claude Code release does not break the test.
BUILTIN_ALLOWANCE_CHARS = 5_300
ROOT = Path(__file__).resolve().parent.parent


def listing_entries():
    entries = {}
    for path in sorted((ROOT / "skills").glob("*/SKILL.md")):
        match = re.match(r"^---\n(.*?)\n---\n", path.read_text(encoding="utf-8"), re.S)
        if not match:
            continue
        frontmatter = yaml.safe_load(match.group(1)) or {}
        name = str(frontmatter.get("name", path.parent.name))
        description = frontmatter.get("description")
        description = "" if description is None else str(description).strip()
        description = description.replace("<", "&lt;").replace(">", "&gt;")
        entries[name] = f"- {name}: {description}" if description else f"- {name}"
    entries.update(sop_listing_entries())
    return entries


# Mirrors `MAX_DESCRIPTION_CHARS` in cli/konductor-rs/src/cli/install/claude.rs.
SOP_DESCRIPTION_MAX_CHARS = 400


def sop_listing_entries():
    """The `sop-<name>` skills the installer builds from agent-sops/.

    They are model-invocable on Claude Code, so their descriptions are in the
    listing too. A SOP marked `Invocation: user-only (` is hidden from the model
    (`disable-model-invocation: true`), so it adds nothing to the listing. The
    marker text mirrors `USER_ONLY_MARKER` in claude.rs, and
    tests/test_sop_user_only_marker.py ties the skipped SOPs to its allowlist.

    shortcut: approximates the installer's Overview reflow and
    truncation (first paragraph, whitespace joined, cut at 400 chars); switch to
    the installer's own output if the two ever disagree.
    """
    entries = {}
    for path in sorted((ROOT / "agent-sops").glob("*.sop.md")):
        text = path.read_text(encoding="utf-8")
        if re.search(r"^Invocation: user-only \(", text, re.M):
            continue
        match = re.search(r"^## Overview[ \t]*\n(.*?)(?:\n[ \t]*\n|\n#|\Z)", text, re.S | re.M)
        description = " ".join(match.group(1).split()) if match else ""
        description = description[:SOP_DESCRIPTION_MAX_CHARS].replace("<", "&lt;").replace(">", "&gt;")
        name = "sop-" + path.name[: -len(".sop.md")]
        entries[name] = f"- {name}: {description}" if description else f"- {name}"
    return entries


def test_skill_listing_fits_the_claude_code_budget():
    entries = listing_entries()
    assert len(entries) > 50
    skills_total = sum(len(e) for e in entries.values()) + len(entries) - 1
    total = skills_total + BUILTIN_ALLOWANCE_CHARS
    largest = sorted(((len(e), n) for n, e in entries.items()), reverse=True)[:10]
    report = "\n".join(f"  {length}\t{name}" for length, name in largest)
    assert total <= LISTING_MAX_CHARS, (
        f"skill listing is {total} chars ({skills_total} from skills + "
        f"{BUILTIN_ALLOWANCE_CHARS} built-in allowance), over {LISTING_MAX_CHARS}.\n"
        f"Largest entries:\n{report}"
    )
