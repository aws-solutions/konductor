#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Deterministic drift checker: docs/user-guide vs the Konductor source tree.

Verifies the *mechanical* facts the guide states — roster counts, catalog
coverage, config keys, the CLI command surface, internal links — against
their sources of truth. It deliberately does NOT judge prose, workflow
descriptions, or output samples; that is the semantic pass driven by
update-user-guide.prompt.md in this directory.

End-state rule: the guide describes finished behaviour even where the CLI is
stubbed, so this script never checks *whether* a feature is implemented —
only that names, counts, and surfaces agree with what the source declares.

Standard library only, with one exception: the section that parses the published
bundle's inline JavaScript shells out to ``node --check``, because nothing in the
standard library can tell whether the page will actually boot. Node missing is
reported as a failure, not skipped — a gate that passes when its checker is
absent is how a blank-rendering bundle shipped once already.

Exit codes: 0 = no drift found, 1 = drift found, 64 = could not run
(unexpected repo layout).

Usage:  python3 tools/user-guide-sync/check-guide-facts.py [--repo <path>]
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import htmlbundle  # noqa: E402
import naming  # noqa: E402

FAILURES = []
CHECKS = 0

# Source directory each package-total label corresponds to, for the home-page
# diagram's cells. The label and the directory differ for SOPs (`agent-sops/`),
# which is exactly why a pattern built from the label alone missed that cell.
_DIAGRAM_DIR = {"agents": "agents", "skills": "skills", "SOPs": "agent-sops"}

# The noun each layout-tree row uses after its count. Distinct from the label
# for agents ("11 agent specs"), which is why this needs its own map.
_LAYOUT_NOUN = {"agents": "agent specs", "skills": "skills", "SOPs": "SOPs"}

# Commands the CLI accepts but the guide deliberately does not document, with the
# decision recorded so the carve-out is auditable rather than folklore. `config`
# is withheld from the v1 customer-visible surface (reviewer decision on
# reviewer decision); `.konductor/config.yml` itself stays documented, since `init`
# writes it and `doctor` validates it. Adding a name here is a product decision,
# not a way to silence this script -- see docs/user-guide/notes.md.
WITHDRAWN_COMMANDS = {"config"}


def html_pages_for_flags(root: Path):
    return [p for p in (root / "docs" / "site" / "user-guide.html",
                        root / "docs" / "index.html") if p.exists()]


def load_template(path: Path) -> str:
    m = re.search(r'<script type="__bundler/template">(.*?)</script>',
                  path.read_text(encoding="utf-8", errors="replace"), re.DOTALL)
    if not m:
        raise ValueError(f"{path}: no template block")
    return json.loads(m.group(1))


def fail(msg: str) -> None:
    FAILURES.append(msg)
    print(f"  FAIL  {msg}")


def ok(msg: str) -> None:
    print(f"  ok    {msg}")


def section(title: str) -> None:
    global CHECKS
    CHECKS += 1
    print(f"\n[{CHECKS}] {title}")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def strip_md(cell: str) -> str:
    """Strip link syntax, backticks, bold markers, and whitespace from a cell.

    The link unwrap matters: roster cells on the use-cases and sop-workflows
    pages are `[`k-code-review-workflow`](code-review.md#...)`, and leaving the
    wrapper on makes every lookup against a spec name miss silently.
    """
    cell = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", cell)
    return cell.replace("`", "").replace("*", "").strip()


def parse_md_tables(text: str):
    """Yield (header_cells, row_cells_list) for each markdown table."""
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.lstrip().startswith("|") and i + 1 < len(lines) and re.match(
            r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]
        ):
            header = [strip_md(c) for c in line.strip().strip("|").split("|")]
            rows = []
            j = i + 2
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                rows.append([strip_md(c) for c in lines[j].strip().strip("|").split("|")])
                j += 1
            yield header, rows
            i = j
        else:
            i += 1


def fenced_blocks(text: str):
    """Yield the contents of ``` fenced blocks."""
    for m in re.finditer(r"```[^\n]*\n(.*?)```", text, re.DOTALL):
        yield m.group(1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", default=None, help="repository root (default: auto-detect)")
    args = ap.parse_args()

    root = Path(args.repo) if args.repo else Path(__file__).resolve().parents[2]
    guide = root / "docs" / "user-guide"
    for required in (guide, root / "agents", root / "skills", root / "agent-sops"):
        if not required.exists():
            print(f"error: {required} not found — pass --repo <path>", file=sys.stderr)
            return 64

    # ---- Ground truth -------------------------------------------------------
    # The source tree is the only manifest this script reads. An installer
    # manifest is a second list of the same names, so checking the guide against
    # it only ever answered "do two lists agree", never "is the guide right" --
    # and it made the checker refuse to run in a tree that ships without one.
    specs = {}
    for f in sorted((root / "agents").glob("*.agent-spec.json")):
        s = json.loads(read(f))
        kiro = s.get("clientConfig", {}).get("kiroCli", {})
        claude = s.get("clientConfig", {}).get("claudeCli", {})
        specs[s["name"]] = {
            "model": s.get("config", {}).get("model", ""),
            "claude_skills": claude.get("skills", []),
            "sops": s.get("dependencies", {}).get("agentSops", {}).get("agentSopNames", []),
            "kiro_tools": kiro.get("tools", []),
            "kiro_allowed": kiro.get("allowedTools", []),
            "claude_tools": claude.get("tools", []),
        }

    disk_skills = {p.parent.name for p in (root / "skills").glob("*/SKILL.md")}
    disk_sops = {p.name.removesuffix(".sop.md") for p in (root / "agent-sops").glob("*.sop.md")}

    # ---- 1. Roster tables ---------------------------------------------------
    section("agent roster tables (agents.md, reference.md) match the specs")
    for page in ("agents.md", "reference.md"):
        text = read(guide / page)
        checked = set()
        before = len(FAILURES)
        for header, rows in parse_md_tables(text):
            if "Skills" not in header or "Model" not in header:
                continue
            i_agent, i_model, i_skills = 0, header.index("Model"), header.index("Skills")
            for row in rows:
                name = strip_md(row[i_agent])
                if name not in specs or len(row) <= max(i_model, i_skills):
                    continue
                checked.add(name)
                want_n = len(specs[name]["claude_skills"])
                if row[i_skills] != str(want_n):
                    fail(f"{page}: {name} Skills column says {row[i_skills]!r}, spec has {want_n}")
                if row[i_model] != specs[name]["model"]:
                    fail(f"{page}: {name} Model says {row[i_model]!r}, spec says {specs[name]['model']!r}")
                # SOP columns drift the same way the skill counts do -- one spec
                # dropped a SOP as unusable and four places kept listing it.
                # agents.md states a count; reference.md names them.
                i_sops = next((header.index(h) for h in header if h.startswith("SOP")), None)
                if i_sops is not None and len(row) > i_sops:
                    want_sops = specs[name]["sops"]
                    cell = row[i_sops]
                    if header[i_sops] == "SOPs" and cell.isdigit():
                        if cell != str(len(want_sops)):
                            fail(f"{page}: {name} SOPs column says {cell}, "
                                 f"spec declares {len(want_sops)}")
                    else:
                        # parse_md_tables already strips the backticks, so split on
                        # commas. "—"/"none" both mean "declares no SOPs".
                        listed = {t.strip() for t in cell.split(",") if t.strip()}
                        listed = {t for t in listed if t not in {"—", "-", "none", "None"}}
                        if listed != set(want_sops):
                            fail(f"{page}: {name} SOP list is {sorted(listed)}, "
                                 f"spec declares {sorted(want_sops)}")
        if checked == set(specs) and len(FAILURES) == before:
            ok(f"{page}: all {len(specs)} agents present with correct model, skills and SOPs")
        elif missing := set(specs) - checked:
            fail(f"{page}: roster table missing agents: {sorted(missing)}")

    # skills.md carries its OWN per-agent count table ("Which agent has the most
    # skills?"). It is not a roster table -- no Model column -- so the loop above
    # skips it, which is how it kept five stale counts through a roster rewrite.
    skills_counts = {}
    for header, rows in parse_md_tables(read(guide / "skills.md")):
        if header[:2] != ["Agent", "Skills declared"]:
            continue
        for row in rows:
            name = strip_md(row[0])
            if name in specs and len(row) > 1:
                skills_counts[name] = row[1]
    if not skills_counts:
        fail("skills.md: no 'Agent | Skills declared' table found")
    else:
        bad = {n: v for n, v in skills_counts.items()
               if v != str(len(specs[n]["claude_skills"]))}
        for n, v in sorted(bad.items()):
            fail(f"skills.md: {n} says {v}, spec has {len(specs[n]['claude_skills'])}")
        if missing := set(specs) - set(skills_counts):
            fail(f"skills.md: per-agent table missing agents: {sorted(missing)}")
        elif not bad:
            ok(f"skills.md: per-agent counts match all {len(specs)} specs")

    # Two more renderings of the same per-agent figure, neither of them a table
    # the loops above can see. Both drifted silently through the roster rewrite
    # that fixed every table: agents.md's per-agent cards are anonymous two-column
    # tables (no header row to match on), and the bundle's roster rows state the
    # count in prose. Anchoring on the agent name rather than on proximity is what
    # keeps this precise -- an earlier attempt keyed off nearby text and produced
    # 16 false positives.
    card_fails = []
    agents_md = read(guide / "agents.md")
    cards = re.split(r"^### ", agents_md, flags=re.M)[1:]
    cards_seen = set()
    for card in cards:
        title, _, body = card.partition("\n")
        names = [n for n in re.findall(r"`([a-z0-9-]+)`", title) if n in specs]
        if len(names) != 1:
            continue  # shared heading (the two multiplexer orchestrators) or prose
        name = names[0]
        cards_seen.add(name)
        m = re.search(r"^\|\s*\*\*Skills\*\*[^|]*\|\s*\**(\d+)\**", body, re.M)
        if not m:
            continue  # the card spells the list out instead of counting it
        want = len(specs[name]["claude_skills"])
        if m.group(1) != str(want):
            card_fails.append(
                f"agents.md: {name} card says {m.group(1)} skills, spec has {want}"
            )

    guide_bundles = html_pages_for_flags(root)
    for page in guide_bundles:
        try:
            rendered = load_template(page)
        except (ValueError, json.JSONDecodeError):
            continue
        rel = page.relative_to(root)
        for name, spec in specs.items():
            for m in re.finditer(
                r'\{\s*k:\s*"' + re.escape(name) + r'",\s*v:\s*"(.*?)"\s*\}', rendered
            ):
                found = re.search(r"(\d+) skills", m.group(1))
                if found and found.group(1) != str(len(spec["claude_skills"])):
                    card_fails.append(
                        f"{rel}: {name} roster row says {found.group(1)} skills, "
                        f"spec has {len(spec['claude_skills'])}"
                    )

    if card_fails:
        for msg in sorted(set(card_fails)):
            fail(msg)
    else:
        ok(f"per-agent skill counts agree outside the roster tables "
           f"({len(cards_seen)} agents.md cards, {len(guide_bundles)} bundle(s))")

    # ---- 2. Named skills, not just counts -----------------------------------
    # Counts are not the whole story. Two renderings name INDIVIDUAL skills, and
    # nothing checked those names against the specs: `agents.md`'s per-agent cards
    # enumerate a sample of each agent's skills, and `skills.md`'s "Declared by"
    # column names the agents per skill. Both had drifted -- the developer's card
    # claimed a skill only the architect declares, and one "Declared by" cell was
    # two agents short -- and both passed every count check.
    section("named skills agree with the specs, not just counts")
    named_fails = []

    declared_by = {}
    for name, spec in specs.items():
        for skill in spec["claude_skills"]:
            declared_by.setdefault(skill, set()).add(name)

    # (a) agents.md cards: every skill a card NAMES must be declared by that agent.
    #     The cards are samples ("and others"), so absence is fine; a wrong name is not.
    for card in re.split(r"^### ", agents_md, flags=re.M)[1:]:
        title, _, body = card.partition("\n")
        owners = [n for n in re.findall(r"`([a-z0-9-]+)`", title) if n in specs]
        if len(owners) != 1:
            continue
        owner = owners[0]
        m = re.search(r"^\|\s*\*\*Skills\*\*.*$", body, re.M)
        if not m:
            continue
        for skill in re.findall(r"`([a-z0-9-]+)`", m.group(0)):
            if skill in disk_skills and owner not in declared_by.get(skill, set()):
                named_fails.append(
                    f"agents.md: {owner}'s card names `{skill}`, which {owner} does not declare"
                )

    # (b) skills.md "Declared by": the agents a row names must all declare that
    #     skill. Collective phrasings ("all 11", "all 3 orchestrators") are the
    #     page's own shorthand and are checked by count, not by name.
    for header, rows in parse_md_tables(read(guide / "skills.md")):
        if header[:1] != ["Skill"] or "Declared by" not in header:
            continue
        i_by = header.index("Declared by")
        for row in rows:
            skill = strip_md(row[0])
            if skill not in disk_skills or len(row) <= i_by:
                continue
            cell = row[i_by]
            if cell.lstrip().startswith("all "):
                continue
            listed = {t for t in re.findall(r"[a-z0-9-]+", cell) if t in specs}
            actual = declared_by.get(skill, set())
            if extra := sorted(listed - actual):
                named_fails.append(f"skills.md: `{skill}` lists {extra}, which do not declare it")
            if missing := sorted(actual - listed):
                named_fails.append(f"skills.md: `{skill}` omits {missing}, which do declare it")

    if named_fails:
        for msg in sorted(set(named_fails)):
            fail(msg)
    else:
        ok("every named skill-to-agent claim matches the specs")

    # ---- 3. Permission claims -----------------------------------------------
    # The guide spent four revisions asserting that an agent "genuinely cannot
    # write files" in Kiro CLI because its `allowedTools` held only `fs_read`.
    # That reads the wrong list: `tools` is what the agent may use (with a
    # prompt) and `allowedTools` is only the pre-approved subset. Every agent
    # here declares `@builtin`, which carries `fs_write` and `shell`, so no agent
    # is incapable of either -- the difference is whether it asks first. A count
    # check cannot see a claim like that, so it is asserted directly.
    section("permission claims match each runtime's tool model")
    perm_fails = []

    def kiro_capability(spec, tool: str) -> str:
        grants = set(spec["kiro_tools"])
        if "@builtin" not in grants and tool not in grants:
            return "not granted"
        return "pre-approved" if tool in spec["kiro_allowed"] else "asks"

    def claude_capability(spec, names) -> str:
        return "granted" if any(t in spec["claude_tools"] for t in names) else "not granted"

    want_caps = {
        name: {
            "Kiro CLI: write": kiro_capability(spec, "fs_write"),
            "Kiro CLI: shell": kiro_capability(spec, "shell"),
            "Claude Code: write": claude_capability(spec, ("Write", "Edit")),
            "Claude Code: shell": claude_capability(spec, ("Bash",)),
        }
        for name, spec in specs.items()
    }

    seen_caps = set()
    for header, rows in parse_md_tables(agents_md):
        if "Kiro CLI: write" not in header:
            continue
        for row in rows:
            name = strip_md(row[0])
            if name not in specs:
                continue
            seen_caps.add(name)
            for col, want in want_caps[name].items():
                if col not in header:
                    continue
                i = header.index(col)
                if len(row) <= i:
                    continue
                if row[i] != want:
                    perm_fails.append(
                        f"agents.md: {name} '{col}' says {row[i]!r}, the spec means {want!r}"
                    )
    if not seen_caps:
        perm_fails.append("agents.md: no 'Kiro CLI: write' capability table found")
    elif missing := set(specs) - seen_caps:
        perm_fails.append(f"agents.md: capability table missing agents: {sorted(missing)}")

    # Prose forms of the same mistake. Each of these shipped at least once; they
    # are matched literally rather than by pattern so the check cannot start
    # flagging a correct sentence that happens to contain "read-only" -- the SOP
    # pages use that phrase accurately about SOPs, and the routing rules quote it
    # accurately as a prompt rule.
    FORBIDDEN_PERMISSION_CLAIMS = (
        "genuinely cannot write",
        "genuinely read-only",
        "read-only in both runtimes",
        "cannot write files or run shell commands in either runtime",
        "but only Kiro CLI enforces",
    )
    sources = {
        p.relative_to(root): read(p) for p in sorted(guide.rglob("*.md"))
    }
    for page in guide_bundles:
        try:
            sources[page.relative_to(root)] = load_template(page)
        except (ValueError, json.JSONDecodeError):
            continue
    for rel, text in sources.items():
        if rel.name == "notes.md":
            continue  # records why the claim is wrong; naming it is the point
        low = text.lower()
        for phrase in FORBIDDEN_PERMISSION_CLAIMS:
            if phrase in low:
                perm_fails.append(
                    f"{rel}: says {phrase!r} — `tools` grants the capability, "
                    f"`allowedTools` only pre-approves it"
                )

    if perm_fails:
        for msg in sorted(set(perm_fails)):
            fail(msg)
    else:
        ok(f"capability table and prose agree with all {len(specs)} specs "
           f"on both permission models")

    # ---- 4. Catalog coverage ------------------------------------------------
    section("every shipped item is documented")
    skills_md = read(guide / "skills.md")
    if missing := [n for n in sorted(disk_skills) if f"`{n}`" not in skills_md]:
        fail(f"skills.md does not mention shipped skill(s): {missing}")
    else:
        ok(f"skills.md mentions all {len(disk_skills)} shipped skills")

    sop_pages = "".join(read(p) for p in sorted((guide / "sop-workflows").glob("*.md")))
    ref_md = read(guide / "reference.md")
    sop_missing = False
    for name in sorted(disk_sops):
        if f"`{name}`" not in sop_pages:
            fail(f"sop-workflows/ pages do not mention shipped SOP `{name}`")
            sop_missing = True
        if f"`{name}`" not in ref_md:
            fail(f"reference.md does not mention shipped SOP `{name}`")
            sop_missing = True
    if not sop_missing:
        ok(f"sop-workflows/ and reference.md mention all {len(disk_sops)} shipped SOPs")

    agents_md = read(guide / "agents.md")
    if missing := [n for n in sorted(specs) if f"`{n}`" not in agents_md]:
        fail(f"agents.md does not mention shipped agent(s): {missing}")
    else:
        ok(f"agents.md mentions all {len(specs)} shipped agents")

    # ---- 5. Rosters are COMPLETE, not merely mentioning ---------------------
    # Check 2 asserts each shipped name appears *somewhere* in a file. A roster
    # table listing 13 of 19 SOPs passes that, because the missing six are named
    # in the agent roster higher up the same page. Assert the tables themselves.
    section("roster tables list every shipped item")
    ref_text = read(guide / "reference.md")
    for heading, want, label in (("## SOP roster", disk_sops, "SOP"),):
        block = ref_text.split(heading, 1)
        if len(block) < 2:
            fail(f"reference.md: no '{heading}' section")
            continue
        body = block[1].split("\n## ", 1)[0]
        listed = {
            strip_md(row[0])
            for header, rows in parse_md_tables(body)
            for row in rows
            if strip_md(row[0]) in want
        }
        missing = sorted(want - listed)
        if missing:
            fail(f"reference.md {heading!r}: table omits {label}(s): {missing}")
        else:
            ok(f"reference.md {heading!r}: lists all {len(want)} {label}s")

    # ---- 6. SOP ownership stated outside the two roster pages ---------------
    # sop-workflows/README.md carries its own "which agent declares what" table
    # plus prose about it, and use-cases/ pages name owners too. Section 1 only
    # reads agents.md and reference.md, so a removed registration survived in
    # five of these places.
    section("SOP ownership claims outside the roster pages")
    owners = {}
    for sop in disk_sops:
        owners[sop] = {a for a, s in specs.items() if sop in s["sops"]}
    sop_readme = read(guide / "sop-workflows" / "README.md")
    declared = {}
    for header, rows in parse_md_tables(sop_readme):
        if header[:1] != ["Agent"] or not header[1].startswith("SOPs"):
            continue
        for row in rows:
            if len(row) < 2:
                continue
            for agent in (strip_md(a) for a in row[0].split(",")):
                if agent in specs:
                    listed = {t.strip() for t in row[1].split(",") if t.strip()}
                    declared[agent] = {t for t in listed if t in disk_sops}
    if not declared:
        fail("sop-workflows/README.md: no 'Agent | SOPs it declares' table found")
    else:
        bad = {a: v for a, v in declared.items() if v != set(specs[a]["sops"])}
        for a, v in sorted(bad.items()):
            fail(f"sop-workflows/README.md: {a} declares {sorted(v)}, "
                 f"spec says {sorted(specs[a]['sops'])}")
        if not bad:
            ok(f"sop-workflows/README.md: ownership table matches {len(declared)} specs")

    # Any OTHER table that names owners per SOP -- use-cases pages carry one, and
    # it listed two owners for a SOP that has had one since mainline dropped the
    # second registration.
    owner_fails = []
    owner_tables = 0
    for md in sorted(guide.rglob("*.md")):
        if md.name in ("notes.md", "reference.md"):
            continue
        for header, rows in parse_md_tables(read(md)):
            if not header or not re.fullmatch(r"Owner\(s\)|Owners?", header[-2] if len(header) > 2
                                              else header[-1]):
                continue
            i_owner = len(header) - 2 if len(header) > 2 else len(header) - 1
            owner_tables += 1
            for row in rows:
                if len(row) <= i_owner:
                    continue
                sop = strip_md(row[0])
                if sop not in owners:
                    continue
                listed = {strip_md(a) for a in re.split(r",| and ", row[i_owner])}
                listed = {a for a in listed if a in specs}
                if listed and listed != owners[sop]:
                    owner_fails.append(
                        f"{md.relative_to(guide)}: `{sop}` owner column says {sorted(listed)}, "
                        f"specs say {sorted(owners[sop])}")
    for msg in sorted(set(owner_fails)):
        fail(msg)
    if not owner_fails:
        ok(f"{owner_tables} owner column(s) elsewhere in the guide agree with the specs")

    # Plural-owner wording for a SOP that has exactly one owner. Only phrases
    # that cannot be true of a single owner, and only in a paragraph that is not
    # a table -- a paragraph merely naming another agent is fine and common,
    # since every account of k-code-review-workflow explains that step 6 tries
    # to spawn k-architect.
    plural_re = re.compile(
        r"neither owning agent|neither owner|both owning agents|both owners"
        r"|either can run it|declared by two agents|its two owners",
        re.IGNORECASE)  # these phrases open sentences as often as not
    prose_fails = []
    for md in sorted(guide.rglob("*.md")):
        if md.name == "notes.md":
            continue
        # Scoped per SECTION, not per paragraph: the wording and the SOP name
        # routinely sit in different paragraphs of the same section.
        for chunk in re.split(r"\n#{2,} ", read(md)):
            if not (m := plural_re.search(chunk)):
                continue
            for sop, who in owners.items():
                if len(who) == 1 and f"`{sop}`" in chunk:
                    prose_fails.append(
                        f"{md.relative_to(guide)}: says {m.group(0)!r} about `{sop}`, "
                        f"which only {sorted(who)[0]} declares")
    for msg in sorted(set(prose_fails)):
        fail(msg)
    if not prose_fails:
        ok("no passage uses plural-owner wording for a single-owner SOP")

    # ---- 7. The build prompt's page set covers every page -------------------
    # BUILD_USER_GUIDE_PROMPT.md is fed verbatim to the agent that regenerates
    # the bundle, so a page missing from its list is silently dropped from the
    # rebuilt HTML -- which is how orchestration.md came to exist in the bundle
    # but not in the prompt.
    section("the build prompt's page set covers docs/user-guide/")
    prompt = root / "tools" / "build-user-guide" / "BUILD_USER_GUIDE_PROMPT.md"
    if not prompt.exists():
        fail(f"{prompt.relative_to(root)} is missing")
    else:
        listed_paths = set(re.findall(r"(docs/user-guide/[\w./-]+\.md)", read(prompt)))
        # notes.md is deliberately excluded: maintainer-only, never rendered.
        want_paths = {
            str(p.relative_to(root)) for p in guide.rglob("*.md") if p.name != "notes.md"
        }
        if missing := sorted(want_paths - listed_paths):
            fail(f"BUILD_USER_GUIDE_PROMPT.md page set omits: {missing}")
        if stale := sorted(listed_paths - want_paths):
            fail(f"BUILD_USER_GUIDE_PROMPT.md page set names missing file(s): {stale}")
        if not (want_paths - listed_paths) and not (listed_paths - want_paths):
            ok(f"page set lists all {len(want_paths)} rendered pages, and nothing else")

    # ---- 8. `wc -l` sample outputs ----------------------------------------
    # A sample that prints 75 next to a claim of 82 makes the instruction
    # self-defeating, and these blocks are invisible to any prose check.
    section("`wc -l` sample outputs match the source tree")
    wc_fails = []
    wc_samples = 0
    for md in sorted(guide.rglob("*.md")):
        if md.name == "notes.md":
            continue
        for dirname, want in (("skills", len(disk_skills)), ("agent-sops", len(disk_sops))):
            for m in re.finditer(
                rf"ls {dirname}\s*\|\s*wc -l\s*```\s*```text\s*(\d+)\s*```", read(md)
            ):
                wc_samples += 1
                if m.group(1) != str(want):
                    wc_fails.append(f"{md.relative_to(guide)}: `ls {dirname} | wc -l` sample "
                                    f"shows {m.group(1)}, source has {want}")
    for msg in wc_fails:
        fail(msg)
    # A check with nothing to read reporting "ok" is the failure mode this whole
    # script exists to prevent, and these samples have been deliberately thinned
    # once already (the reader-facing "verify it yourself" panels came out). If
    # the last one ever goes, say so rather than passing vacuously.
    if not wc_samples:
        fail("no `ls <dir> | wc -l` sample found in the guide — this section checked nothing")
    elif not wc_fails:
        ok(f"all {wc_samples} `wc -l` sample output(s) agree with the source tree")

    # ---- 9. Config keys -----------------------------------------------------
    section("config keys match cli/gate-config/config.yml")
    cfg = read(root / "cli" / "gate-config" / "config.yml")
    keys = re.findall(r"^([a-z][a-z0-9_]*):", cfg, re.MULTILINE)
    if not keys:
        fail("could not parse any top-level keys from cli/gate-config/config.yml")
    # reference.md is the only page documenting the schema now. The task page that
    # used to carry it went with the `konductor config` command -- see the
    # WITHDRAWN_COMMANDS note below. The FILE is still documented, because
    # `init` writes it and `doctor` validates it.
    for page in ("reference.md",):
        text = read(guide / page)
        missing = [k for k in keys if f"`{k}`" not in text]
        if missing:
            fail(f"{page}: schema/table missing config keys: {missing}")
        else:
            ok(f"{page}: documents all {len(keys)} config keys")
    # Output samples: a fenced block is a *full* `config list` result or
    # config.yml listing when it carries at least 3 known keys at line start;
    # such a block must then carry every key. Blocks with 1-2 keys are treated
    # as deliberately partial snippets (e.g. precedence examples) and skipped.
    n_before = len(FAILURES)
    for md in sorted(guide.rglob("*.md")):
        rel = md.relative_to(guide)
        for block in fenced_blocks(read(md)):
            for sep, kind in ((" = ", "merged-config sample"), (":", "config.yml sample")):
                present = [k for k in keys if re.search(rf"^{k}{sep}", block, re.MULTILINE)]
                if len(present) >= 3 and (missing := [k for k in keys if k not in present]):
                    fail(f"{rel}: {kind} missing keys: {missing}")
    if len(FAILURES) == n_before:
        ok("all config output samples carry every key (where samples exist)")

    # ---- 10. CLI command surface --------------------------------------------
    section("CLI command surface matches cli/README.md")
    cli_readme = read(root / "cli" / "README.md")
    m = re.search(r"^## The (\w+) commands?\n+(.+?)(?=\n#|\n---)", cli_readme, re.MULTILINE | re.DOTALL)
    if not m:
        fail("could not find the '## The N commands' section in cli/README.md")
        commands = []
    else:
        first_para = m.group(2).strip().split("\n\n")[0]
        subcommands = {"get", "set", "list"}
        commands = [
            c for c in re.findall(r"`([a-z][a-z-]*)`", first_para) if c not in subcommands
        ]
    # `config` is a real command the CLI accepts and a deliberately undocumented
    # one: it is not part of the customer-visible surface for the v1 launch, by
    # reviewer decision. Excluding it here keeps this section
    # meaningful rather than deleting it -- every OTHER command must still be
    # documented, and the exclusion itself is asserted against cli/README.md, so
    # a `config` that stops existing (or a second withdrawal nobody recorded)
    # fails loudly instead of silently widening the carve-out.
    documented = [c for c in commands if c not in WITHDRAWN_COMMANDS]
    for cmd in documented:
        if f"`konductor {cmd}" not in ref_md:
            fail(f"reference.md command table missing `konductor {cmd}`")
    for cmd in sorted(WITHDRAWN_COMMANDS):
        if cmd not in commands:
            fail(f"`{cmd}` is listed as withdrawn from the guide, but cli/README.md "
                 f"no longer declares it — drop it from WITHDRAWN_COMMANDS")
        elif f"`konductor {cmd}" in ref_md:
            fail(f"reference.md documents `konductor {cmd}`, which is withdrawn for v1")
    if documented:
        ok(f"reference.md covers all {len(documented)} customer-visible commands: "
           f"{', '.join(documented)} (withheld: {', '.join(sorted(WITHDRAWN_COMMANDS))})")
    cmd_pages = {"concepts.md", "glossary.md"}
    for page in sorted(cmd_pages):
        text = read(guide / page)
        missing = [c for c in documented if f"`{c}`" not in text]
        leaked = [c for c in sorted(WITHDRAWN_COMMANDS) if f"`konductor {c}" in text]
        # Also catch a withdrawn command named BARE inside a command enumeration --
        # "`install`, `update`, ..., `config`, `synth`". Two pages leaked `config`
        # that way and the `konductor <cmd>` form above saw neither. Requiring two
        # other real command names in the same comma-list is what keeps this off
        # legitimate uses: glossary.md's agent-spec field list also contains
        # `config`, but no command names, so it is not an enumeration.
        for run in re.findall(r"(?:`[a-z][a-z-]*`(?:,\s*|,?\s+and\s+)?){3,}", text):
            named = set(re.findall(r"`([a-z][a-z-]*)`", run))
            if len(named & set(documented)) >= 2:
                leaked += sorted(named & WITHDRAWN_COMMANDS)
        leaked = sorted(set(leaked))
        if missing:
            fail(f"{page}: command list missing: {missing}")
        if leaked:
            fail(f"{page}: names withdrawn command(s): {leaked}")
        if not missing and not leaked:
            ok(f"{page}: names every customer-visible command and no withdrawn one")

    # The bundles too. This used to be guaranteed by the deletion edits that
    # stripped the `config` page out of them, but a deletion cannot prove it is
    # already applied, so those are retired (see html_sop_edits.py). Asserting
    # absence here is strictly better: it also covers a REGENERATION, where the
    # page could come back and no edit would be left to remove it.
    for page in html_pages_for_flags(root):
        rel = page.relative_to(root)
        try:
            rendered = load_template(page)
        except (ValueError, json.JSONDecodeError):
            continue
        leaked = [c for c in sorted(WITHDRAWN_COMMANDS) if f"konductor {c} " in rendered]
        if leaked:
            fail(f"{rel}: names withdrawn command(s): {leaked}")
        else:
            ok(f"{rel}: no withdrawn command appears")

    # ---- 11. CLI flags actually exist ---------------------------------------
    # Every `--flag` the guide shows for a konductor subcommand must be declared
    # in the Rust CLI. This catches the class of error a prose review misses
    # entirely: a command that reads fine and exits 64 when a user runs it.
    section("CLI flags in the guide exist in cli.rs")
    cli_rs = root / "cli" / "konductor-rs" / "src" / "cli.rs"
    if not cli_rs.is_file():
        ok("cli.rs not found - skipping flag check")
    else:
        src = read(cli_rs)
        declared = set(re.findall(r'long\s*=\s*"([a-z][a-z0-9-]*)"', src))
        # A bare `#[arg(long)]` takes the field name, underscores to dashes. The
        # attribute body can itself contain brackets (value_parser = ["a","b"]),
        # so match the field that FOLLOWS any arg attribute mentioning `long`.
        for m in re.finditer(r"#\[arg\((.*?)\)\]\s*\n\s*([a-z_]+)\s*:", src, re.DOTALL):
            body, field = m.group(1), m.group(2)
            if re.search(r"\blong\b", body):
                declared.add(field.replace("_", "-"))
        declared |= {"verbose", "json", "version", "no-color", "help"}
        # Flags the guide shows deliberately because they are INVALID: the
        # exit-64 table needs an unknown-flag example. Listing them here keeps
        # the check honest about the difference between "invented by mistake"
        # and "quoted as a counter-example".
        declared |= {"bogus"}

        texts = {str(md.relative_to(guide)): read(md) for md in sorted(guide.rglob("*.md"))}
        for page in html_pages_for_flags(root):
            try:
                texts[str(page.relative_to(root))] = load_template(page)
            except ValueError:
                continue

        bad = []
        for name, text in texts.items():
            # Scan the WHOLE invocation, not a run of adjacent flags. An earlier
            # version captured `((?:\s+--flag)+)`, which stops at the first flag
            # that takes a value -- so in
            # `konductor install --harness kiro-cli-v2 --target /path`
            # only `--harness` was ever checked, and an invented flag placed
            # after any valued flag escaped entirely.
            for m in re.finditer(
                r"konductor[ \t]+[a-z]+(?:[ \t]+[a-z]+)?((?:[ \t]+[^\s<|`]+)*)", text
            ):
                for flag in re.findall(r"--([a-z][a-z0-9-]*)", m.group(1)):
                    if flag not in declared:
                        bad.append(f"{name}: --{flag} is not declared in cli.rs")
        if bad:
            for msg in sorted(set(bad)):
                fail(msg)
        else:
            ok(f"every --flag shown resolves to a real one ({len(declared)} declared)")

    # ---- 12. Internal links --------------------------------------------------
    section("relative links in docs/user-guide resolve")
    broken = 0
    for md in sorted(guide.rglob("*.md")):
        for target in re.findall(r"\]\(([^)]+)\)", read(md)):
            target = target.split("#")[0].strip()
            if not target or "://" in target or target.startswith("mailto:"):
                continue
            if not (md.parent / target).exists():
                fail(f"{md.relative_to(guide)}: broken link -> {target}")
                broken += 1
    if not broken:
        ok("all relative link targets exist")

    # ---- 13. Published HTML ---------------------------------------------------
    # docs/site/user-guide.html and docs/index.html are single-file bundles: the
    # readable page lives in a JSON-encoded <script type="__bundler/template">
    # string, alongside gzipped JS and woff2 font blobs. Checking the rendered
    # text means decoding that string -- a grep over the raw file would also
    # match base64 payloads and produce nonsense either way.
    section("published HTML matches the source tree")

    # Driven by naming.py, the one authoritative map, rather than re-derived from
    # the spec names: an `asdlc-<agent>` reconstruction covers agents and the
    # context file but silently misses every retired SOP name, none of which
    # follow that pattern (`code-cleanup`, `design-review-workflow`,
    # `comprehensive-test-coverage`, ...). A stale one of those surviving in the
    # bundle used to pass this section undetected.
    retired = naming.retired_names()
    # Shipped skills that merely look retired -- never flag these.
    allowed = {s for s in disk_skills if s.startswith("asdlc-")} | set(naming.PRESERVE)

    html_pages = [p for p in (root / "docs" / "site" / "user-guide.html",
                              root / "docs" / "index.html") if p.exists()]
    if not html_pages:
        ok("no built HTML present -- nothing to check")
    for page in html_pages:
        rel = page.relative_to(root)
        m = re.search(
            r'<script type="__bundler/template">(.*?)</script>',
            page.read_text(encoding="utf-8", errors="replace"), re.DOTALL,
        )
        if not m:
            fail(f"{rel}: no __bundler/template block -- not a guide bundle?")
            continue
        try:
            rendered = json.loads(m.group(1))
        except json.JSONDecodeError as exc:
            fail(f"{rel}: template block is not valid JSON ({exc})")
            continue

        hits = sorted(
            n for n in retired
            if n not in allowed
            and re.search(r"(?<![\w-])" + re.escape(n) + r"(?![\w-])", rendered)
        )
        if hits:
            fail(f"{rel}: still names retired agent(s)/context file(s): {hits}")
        else:
            ok(f"{rel}: no retired agent names")

        # PACKAGE-TOTAL roster counts appear in several distinct renderings, and a
        # plain substring sweep sees only the first -- which is how two stale
        # variants survived a full rewrite. Check every rendering that can only
        # mean the package total. Bare "N skills" prose is deliberately NOT
        # checked: per-agent counts ("37 skills") use the same words.
        counts = {"agents": len(specs), "skills": len(disk_skills), "SOPs": len(disk_sops)}
        count_fails = []

        for label, want in counts.items():
            checks = (
                # `skills          82 registered` / `... 82 registered   ok`
                (rf"{label}\s{{2,}}(\d+) registered", "install/doctor sample"),
                # `agents 11 · skills 82 · SOPs 19 · context 1`
                (rf"·\s*{label} (\d+)", "hero banner"),
                # `skills          82 updated`, `SOPs            19`
                (rf"{label}\s{{2,}}(\d+)(?: updated)?\n", "update/uninstall sample"),
                # prose that can only mean the total
                (rf"[Aa]ll (\d+) {label}\b", "prose (all N)"),
                (rf"ships (?:\*\*)?(\d+) {label}", "prose (ships N)"),
                (rf"package's (\d+) {label}", "prose (package's N)"),
                # Repository-layout tree. Keyed on the DIRECTORY and the noun the
                # row actually uses, not on the label twice: `agents/` is followed
                # by "agent specs" and the SOP row's directory is `agent-sops/`, so
                # a label-only pattern silently checked exactly one of the three.
                (
                    rf"{_DIAGRAM_DIR[label]}/\s{{2,}}(\d+) {_LAYOUT_NOUN[label]}",
                    "layout tree",
                ),
                # Home-page "how the pieces relate" diagram. Each directory cell
                # is `<dir>/<br><span ...>N <noun></span>`, with a different noun
                # per directory, so none of the patterns above can see it. Both
                # this cell and the specialist node below shipped stale -- a
                # reviewer reading the rendered page found them, no check did.
                (
                    rf"{_DIAGRAM_DIR[label]}/<br><span[^>]*>(\d+) "
                    rf"(?:specs|modules|workflows)",
                    "home-page diagram cell",
                ),
            )
            for pat, what in checks:
                for m in re.finditer(pat, rendered):
                    if m.group(1) != str(want):
                        count_fails.append(
                            f"{label}: {what} says {m.group(1)}, source has {want}"
                        )

        # Home-page stat tiles: the number and its label are SEPARATE spans, so no
        # text search for "82 skills" can ever see them.
        tile_label = {"AGENTS": "agents", "SKILLS": "skills", "SOPS": "SOPs"}
        for m in re.finditer(
            r">(\d+)</span>\s*<span[^>]*>(AGENTS|SKILLS|SOPS)</span>", rendered
        ):
            want = counts[tile_label[m.group(2)]]
            if m.group(1) != str(want):
                count_fails.append(
                    f"{m.group(2)}: stat tile says {m.group(1)}, source has {want}"
                )

        # "N specialist agents" is the roster split, not a package total, so it
        # needs its own source of truth: every spec whose name starts with `k-`.
        # The rest are orchestrators.
        want_specialists = len([n for n in specs if n.startswith("k-")])
        for m in re.finditer(r"(\d+) specialist agents", rendered):
            if m.group(1) != str(want_specialists):
                count_fails.append(
                    f"specialists: says {m.group(1)}, source has {want_specialists}"
                )

        if count_fails:
            for msg in sorted(set(count_fails)):
                fail(f"{rel}: {msg}")
        else:
            ok(f"{rel}: package-total counts agree in every rendering")

        # Each SOP gets exactly ONE detail entry. An append-style bundle edit that
        # re-runs will silently duplicate its entries instead of failing -- one
        # did, 27 times, and every name/count check still passed because
        # duplicates are invisible to "does this appear at all?".
        dupes = []
        for sop in sorted(disk_sops):
            n = rendered.count(f'name: "{sop}", file:')
            if n > 1:
                dupes.append(f"{sop} x{n}")
        if dupes:
            fail(f"{rel}: duplicated SOP detail entries: {dupes}")
        else:
            ok(f"{rel}: no duplicated SOP entries")

        undocumented = sorted(
            s for s in disk_sops
            if not re.search(r"(?<![\w-])" + re.escape(s) + r"(?![\w-])", rendered)
        )
        if undocumented:
            fail(f"{rel}: does not mention shipped SOP(s): {undocumented}")
        else:
            ok(f"{rel}: mentions all {len(disk_sops)} shipped SOPs")

    # ---- 14. The two bundles agree ------------------------------------------
    # docs/index.html is what GitHub Pages serves (there is a .nojekyll at docs/
    # and no Pages workflow); docs/site/user-guide.html is the standalone
    # artifact. They are the same page, so updating one and not the other
    # publishes a stale guide while the artifact looks correct.
    section("both published bundles carry the same page")
    if len(html_pages) < 2:
        ok("only one bundle present - nothing to compare")
    else:
        pages = {}
        for page in html_pages:
            try:
                pages[page] = load_template(page)
            except (ValueError, json.JSONDecodeError):
                fail(f"{page.relative_to(root)}: could not decode its page")
        if len(pages) == 2:
            (p1, t1), (p2, t2) = pages.items()
            if t1 == t2:
                ok(f"{p1.name} and {p2.name} are identical ({len(t1):,} chars)")
            else:
                fail(
                    f"{p1.relative_to(root)} and {p2.relative_to(root)} differ "
                    f"({len(t1):,} vs {len(t2):,} chars) - one was updated without the other"
                )

    # ---- 15. Every version string in the guide agrees ----------------------
    # The documented version is a decision, not a fact derived from the source --
    # no source file declares it (see notes.md), so it deliberately cannot be
    # checked against Cargo.toml. What CAN be checked is that the guide agrees
    # with itself: one `konductor --version` sample said 0.1.2 while every other
    # version string said 1.0.0, and presenting a LOWER version as the freshly
    # updated one is worse than merely inconsistent.
    section("every version string in the guide agrees")
    ver_re = re.compile(r"[Kk]onductor[- ]v?(\d+\.\d+\.\d+)")
    seen = {}
    for md in sorted(guide.rglob("*.md")):
        if md.name == "notes.md":  # records the source's real versions on purpose
            continue
        for m in ver_re.finditer(read(md)):
            seen.setdefault(m.group(1), []).append(str(md.relative_to(guide)))
    for page in html_pages_for_flags(root):
        try:
            rendered = load_template(page)
        except (ValueError, json.JSONDecodeError):
            continue
        for m in ver_re.finditer(rendered):
            seen.setdefault(m.group(1), []).append(str(page.relative_to(root)))
    if not seen:
        ok("no version string appears in the guide")
    elif len(seen) == 1:
        version, where = next(iter(seen.items()))
        ok(f"all {len(where)} version string(s) say {version}")
    else:
        for version, where in sorted(seen.items()):
            fail(f"version {version} appears in {sorted(set(where))}")

    # ---- 16. The toolchain's own prompts use shipped names --------------------
    # The rename sweep and every check above cover docs/user-guide/. The two
    # prompt files that DRIVE a regeneration were covered by neither, and one of
    # them pointed a rebuild at `context/asdlc-orchestrator-routing-rules.md` --
    # a path that does not exist. An agent following it would have verified
    # against a missing file, or reintroduced the retired name it read there.
    section("the guide toolchain's prompts name shipped paths")
    prompts = sorted((root / "tools").rglob("*.prompt.md")) + sorted(
        (root / "tools").rglob("*PROMPT*.md")
    )
    if not prompts:
        fail("no prompt files found under tools/ — expected at least the build prompt")
    prompt_hits = []
    for prompt in prompts:
        text = read(prompt)
        for name in naming.retired_names():
            if name in allowed:
                continue
            if re.search(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])", text):
                prompt_hits.append(f"{prompt.relative_to(root)}: {name}")
    if prompt_hits:
        for hit in sorted(set(prompt_hits)):
            fail(hit)
    else:
        ok(f"{len(prompts)} prompt file(s) name no retired agent, SOP or context path")

    # ---- 17. Install snippets are runnable -----------------------------------
    # `--harness` has no default: `konductor install` without it is a clap
    # missing-required-argument error remapped to exit 64. The guide shipped two
    # snippets a reader could copy that fail on the spot for exactly that reason,
    # including the home-page hero. Any snippet that invokes install must name a
    # harness.
    section("every `konductor install` snippet passes --harness")
    install_fails = []
    install_re = re.compile(r"konductor install((?:[ \t]+--?[\w-]+(?:[ \t]+[^\s]+)?)*)")

    def check_install_snippets(text, label, in_code_only):
        blocks = list(fenced_blocks(text)) if in_code_only else [text]
        for block in blocks:
            for m in install_re.finditer(block):
                # Prose mentions of the bare command name are fine; only an
                # invocation carrying other flags, or standing alone on a line in
                # a code block, has to be runnable.
                line = block[block.rfind("\n", 0, m.start()) + 1 : m.end()].strip()
                if not line.startswith("konductor install"):
                    continue
                if "--harness" not in m.group(1):
                    install_fails.append(f"{label}: `{line}` has no --harness")

    for md in sorted(guide.rglob("*.md")):
        check_install_snippets(read(md), str(md.relative_to(root)), in_code_only=True)

    for page in html_pages_for_flags(root):
        try:
            rendered = load_template(page)
        except (ValueError, json.JSONDecodeError):
            continue
        rel = page.relative_to(root)
        # The bundle has no fenced blocks. Its runnable snippets live in two
        # places only: <pre> elements, and `code:`/`cmd:` string fields in the
        # page's data. Everything else naming the command is prose or a table
        # cell -- scanning those too produced four false positives, since
        # `<span>konductor install</span> handles the rest` is not a snippet.
        snippets = [m.group(1) for m in re.finditer(r"<pre[^>]*>(.*?)</pre>", rendered, re.S)]
        snippets += [
            m.group(1)
            for m in re.finditer(r'\b(?:code|cmd):\s*"((?:[^"\\]|\\.)*)"', rendered)
        ]
        for snippet in snippets:
            for line in re.split(r"\\n|\n", snippet):
                line = line.strip()
                if line.startswith("konductor install") and "--harness" not in line:
                    install_fails.append(f"{rel}: `{line}` has no --harness")

    if install_fails:
        for msg in sorted(set(install_fails)):
            fail(msg)
    else:
        ok("every install invocation in the guide and both bundles names a harness")

    # ---- 18. No invented download host ---------------------------------------
    # An earlier draft told readers to curl a prebuilt binary from a domain
    # nobody owns. `--from <repo-root>` is still the only way to install, so any
    # reappearance is either a regression or a copy-paste from that draft -- and
    # a reader who runs it gets a 404 at best.
    section("no retired download domain survives")
    domain_hits = []
    for md in sorted(guide.rglob("*.md")):
        text = read(md)
        for domain in naming.RETIRED_DOMAINS:
            if domain in text:
                domain_hits.append(f"{md.relative_to(root)}: {domain}")
    for page in html_pages:
        try:
            rendered = load_template(page)
        except (ValueError, json.JSONDecodeError):
            continue
        for domain in naming.RETIRED_DOMAINS:
            if domain in rendered:
                domain_hits.append(f"{page.relative_to(root)}: {domain}")
    if domain_hits:
        for hit in domain_hits:
            fail(hit)
    else:
        ok(f"none of {', '.join(naming.RETIRED_DOMAINS)} appears in the Markdown or either bundle")

    # ---- 19. The bundle's inline JavaScript parses ---------------------------
    # Every other check here reads characters. The bundle, though, boots by
    # handing its `data-dc-script` block to `new Function()`: prose spliced into
    # a double-quoted JS string with an unescaped `"` closes that string early,
    # the eval aborts, and the page renders blank -- with all the right
    # characters present, so a content check sees nothing wrong. This is the only
    # check that catches that class, and it shipped once because it was missing.
    section("each bundle's inline JavaScript parses")
    if not html_pages:
        ok("no bundle present - nothing to parse")
    for page in html_pages:
        rel = page.relative_to(root)
        try:
            rendered = load_template(page)
        except (ValueError, json.JSONDecodeError):
            fail(f"{rel}: could not decode its page")
            continue
        parsed, detail = htmlbundle.compile_dc_script(rendered)
        if parsed:
            ok(f"{rel}: {detail}")
        else:
            fail(f"{rel}: {detail}")

    # ---- Result -------------------------------------------------------------
    print()
    if FAILURES:
        print(f"DRIFT FOUND: {len(FAILURES)} failure(s). Fix the guide (or the source, "
              f"if docs/user-guide/notes.md says the guide is intentionally ahead).")
        return 1
    print("No drift found. The semantic pass (update-user-guide.prompt.md) still applies "
          "for prose, workflow descriptions, and output samples.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
