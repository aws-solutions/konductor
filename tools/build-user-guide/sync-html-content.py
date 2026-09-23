#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Apply source-derived content updates to the published user-guide HTML bundles.

The published guide is a hand-authored single-page app whose prose and data live
in the JSON-encoded page inside each bundle (see ``htmlbundle``). It is not a
render of the Markdown, so it cannot simply be regenerated from it -- but the
facts it states must still match the source tree.

This script carries the facts that drift: roster counts, per-agent model/skill/SOP
figures, the SOP catalogue, and the command surface. Every edit is an exact-match
replacement that ASSERTS its target exists, so a bundle that has moved on fails
loudly here instead of being silently half-patched.

Renames are NOT done here -- ``tools/user-guide-sync/apply-renames.py`` owns those
for both Markdown and HTML, from one map.

    python3 tools/build-user-guide/sync-html-content.py            # preview
    python3 tools/build-user-guide/sync-html-content.py --apply    # write

Exit codes: 0 = applied/nothing to do, 1 = an edit's target was not found, 64 = bad layout.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "user-guide-sync"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import htmlbundle  # noqa: E402
from html_sop_edits import SOP_EDITS  # noqa: E402

# Each entry: (label, old, new). `old` must appear exactly once unless `count` is
# given. Sourced from agents/*.agent-spec.json, agent-sops/, skills/, cli/README.md.
EDITS = [
    # ---- global roster counts ------------------------------------------------
    # The prose skills-count edit that used to live here is gone: the sentence it
    # targeted was inside the "verify it yourself" panel a reviewer asked us to
    # drop, and the replacement paragraph carries the count in its own markup.
    # Section 13's package-total check still covers that number in every
    # rendering, so nothing is unguarded by the removal.
    ("skills count (sidebar)", "Browse all 75 skills", "Browse all 82 skills"),
    ("skills count (summary)", 'skills: "All 75 skills grouped across 8 capability areas',
     'skills: "All 82 skills grouped across 8 capability areas'),
    ("skills count (catalog intro)", "intro: \"All 75 skills the package ships",
     "intro: \"All 82 skills the package ships"),
    ("skills coverage", "All 75 skills are declared by at least one agent.",
     "All 82 skills are declared by at least one agent."),
    ("install summary", "Registers the 11 agents, 75 skills, 13 SOPs, and the orchestrator routing rules",
     "Registers the 11 agents, 82 skills, 19 SOPs, and the orchestrator routing rules"),
    ("reference count row", '{ k: "Count", v: "75 skills · 13 SOPs" }',
     '{ k: "Count", v: "82 skills · 19 SOPs" }'),
    ("concepts SOP blurb", "<div>13 SOPs that encode multi-step procedures",
     "<div>19 SOPs that encode multi-step procedures"),
    ("SOP count (concepts)",
     "<strong style=\"color:var(--tx);font-weight:600\">The package ships 13 SOPs.</strong> Twelve are meant for you to invoke;",
     "<strong style=\"color:var(--tx);font-weight:600\">The package ships 19 SOPs.</strong> Eighteen are meant for you to invoke;"),
    ("SOP count (section intro)", "Konductor ships <strong style=\"color:var(--tx);font-weight:600\">13 SOPs</strong>",
     "Konductor ships <strong style=\"color:var(--tx);font-weight:600\">19 SOPs</strong>"),
    ("SOP section covers-all", "This section covers all 13: what each does",
     "This section covers all 19: what each does"),
    ("SOP glance heading", "All 13 SOPs at a glance", "All 19 SOPs at a glance"),
    ("SOP roster intro", '"paras":["All 13, with owning agent and required parameters.',
     '"paras":["All 19, with owning agent and required parameters.'),
    # ---- repository layout tree ---------------------------------------------
    ("layout tree SOPs", "├── agent-sops/                   13 SOPs (*.sop.md)",
     "├── agent-sops/                   19 SOPs (*.sop.md)"),
    ("layout tree skills", "├── skills/                       75 skills (<name>/SKILL.md",
     "├── skills/                       82 skills (<name>/SKILL.md"),
    # ---- k-architect is no longer on a different model ----------------------
    ("architect model prose",
     "Both are owned by <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">k-architect</code>, which carries 37 of the package's 82 skills — close to half, and by far the largest share of any agent.",
     "Both are owned by <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">k-architect</code>, which carries 38 of the package's 82 skills — close to half, and by far the largest share of any agent."),
    ("reference roster note",
     "k-architect is the only agent on a different model. Skill counts are from each spec's clientConfig.claudeCli.skills array.",
     "Every agent runs claude-sonnet-5. Skill counts are from each spec's clientConfig.claudeCli.skills array, which matches dependencies.skills.skillNames everywhere except konductor — that one adds claude-teams-behavior for Claude Code only, so Kiro CLI sees 12.",),
    # ---- Claude Code does not prefix agent names ----------------------------
    # Spent: the prefix sentences these edits produced have since been removed
    # from the guide entirely, so neither their `old` nor their `new` exists any
    # more and they can never fire again.
    # ---- the two runtimes' permission models --------------------------------
    # The guide read the wrong Kiro CLI list. `tools` is what an agent may use,
    # subject to a prompt; `allowedTools` is only the pre-approved subset. Every
    # agent declares `@builtin`, which carries `fs_write` and `shell`, so "this
    # agent genuinely cannot write files" was false for all eleven. The bundles
    # stated it in six places, including the capability table's own rows.
    # check-guide-facts.py now derives the table from the specs and rejects the
    # prose forms outright, so this class cannot come back quietly.
    ("qs checkpoint permission prose",
     "That is the whole design. In Kiro CLI the orchestrator is genuinely read-only — its "
     "allowedTools is fs_read alone. In Claude Code it holds Write and Bash, and only its "
     "routing rules stop it using them.",
     "That is the whole design, and it is a rule rather than a wall in both runtimes. In Kiro "
     "CLI konductor pre-approves fs_read alone, so a write or a command stops to ask you rather "
     "than being refused; in Claude Code it holds Write and Bash outright. Either way what keeps "
     "it delegating is its routing rules."),
    ("ik success permission prose",
     "That last point is the real signal. In Kiro CLI the orchestrator genuinely cannot write "
     "files or run shell commands — its allowedTools is fs_read alone. (In Claude Code it is "
     "granted Write and Bash; only its routing rules stop it using them.)",
     "That last point is the real signal. In Kiro CLI the orchestrator pre-approves fs_read "
     "alone, so a write or a shell command surfaces a permission prompt instead of happening "
     "quietly — it is not refused, because @builtin grants both. (In Claude Code it is granted "
     "Write and Bash with no prompt gate of its own; only its routing rules stop it using them.)"),
    ("dx capability prose",
     "konductor</span> cannot write files or run shell commands in Kiro CLI (though Claude Code "
     "grants it Bash and Write), and <span style=\"font-family:'JetBrains Mono',monospace;"
     "font-size:13px;color:var(--tx)\">k-researcher</span> is read-only everywhere.",
     "konductor</span> pre-approves nothing but reads in Kiro CLI, so its writes and commands "
     "ask first, while Claude Code grants both outright; and <span style=\"font-family:"
     "'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">k-researcher</span> has no "
     "write or shell tool in Claude Code at all."),
    ("uc owned-by prose",
     "<code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">"
     "konductor</code> <strong style=\"color:var(--tx);font-weight:600\">cannot write files or "
     "run shell commands in Kiro CLI</strong> — though Claude Code grants it Bash and Write, so "
     "only its routing rules stop it there — in Kiro CLI its <code style=\"font-family:"
     "'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">allowedTools</code> is "
     "<code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">"
     "fs_read</code> only;",
     "<code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">"
     "konductor</code> <strong style=\"color:var(--tx);font-weight:600\">pre-approves reads only "
     "in Kiro CLI</strong> — a write or a command still reaches you as a permission prompt, "
     "because @builtin grants both, and Claude Code grants them with no prompt of its own — in "
     "Kiro CLI its <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;"
     "color:var(--tx)\">allowedTools</code> is <code style=\"font-family:'JetBrains Mono',"
     "monospace;font-size:.87em;color:var(--tx)\">fs_read</code> alone;"),
    # The `\"` escapes below are load-bearing: this passage lands inside a
    # double-quoted JS string in the bundle's `data-dc-script` block, which
    # `dc-runtime` compiles with `new Function()`.
    ("ag-access intro para",
     'paras: ["This is the table to check before you let an agent loose on a repository. '
     '\\"Write\\" means the agent can create or modify files; \\"shell\\" means it can run '
     'commands. Kiro CLI values come from clientConfig.kiroCli.allowedTools (fs_write, shell); '
     'Claude Code values from clientConfig.claudeCli.tools (Write/Edit, Bash)."]',
     'paras: ["This is the table to check before you let an agent loose on a repository. '
     '\\"Write\\" means the agent can create or modify files; \\"shell\\" means it can run '
     'commands.", "The two runtimes draw the line in different places. Kiro CLI has two lists: '
     'tools is what the agent may use, and reaching for it prompts you; allowedTools is the '
     'subset that is pre-approved and runs silently. Every agent here declares @builtin, which '
     'carries fs_write and shell, so no agent is incapable of either — the difference is whether '
     'it asks first.", "Claude Code has one list. clientConfig.claudeCli.tools is the ceiling: a '
     'tool absent from it cannot be used at all. Whether a granted tool prompts is decided by '
     'your own ~/.claude/settings.json, which sorts calls into allow, ask, and deny."]'),
    ("ag-access rows",
     '          { k: "konductor", v: "no / no · YES / YES" },\n'
     '          { k: "konductor-mux-orchestrator", v: "no / YES · YES / YES" },\n'
     '          { k: "konductor-cmux-orchestrator", v: "no / YES · YES / YES" },\n'
     '          { k: "k-product-manager", v: "YES / no · YES / YES" },\n'
     '          { k: "k-architect", v: "YES / YES · YES / YES" },\n'
     '          { k: "k-developer", v: "YES / YES · YES / YES" },\n'
     '          { k: "k-quality-assurance", v: "YES / YES · YES / YES" },\n'
     '          { k: "k-tpm", v: "YES / no · YES / YES" },\n'
     '          { k: "k-researcher", v: "no / no · no / no" },\n'
     '          { k: "k-browser", v: "no / no · YES / YES" },\n'
     '          { k: "k-media-analyzer", v: "no / no · YES / YES" }',
     '          { k: "konductor", v: "asks / asks · GRANTED / GRANTED" },\n'
     '          { k: "konductor-mux-orchestrator", v: "asks / PRE-APPROVED · GRANTED / GRANTED" },\n'
     '          { k: "konductor-cmux-orchestrator", v: "asks / PRE-APPROVED · GRANTED / GRANTED" },\n'
     '          { k: "k-product-manager", v: "PRE-APPROVED / asks · GRANTED / GRANTED" },\n'
     '          { k: "k-architect", v: "PRE-APPROVED / PRE-APPROVED · GRANTED / GRANTED" },\n'
     '          { k: "k-developer", v: "PRE-APPROVED / PRE-APPROVED · GRANTED / GRANTED" },\n'
     '          { k: "k-quality-assurance", v: "PRE-APPROVED / PRE-APPROVED · GRANTED / GRANTED" },\n'
     '          { k: "k-tpm", v: "PRE-APPROVED / asks · GRANTED / GRANTED" },\n'
     '          { k: "k-researcher", v: "asks / asks · not granted / not granted" },\n'
     '          { k: "k-browser", v: "asks / asks · GRANTED / GRANTED" },\n'
     '          { k: "k-media-analyzer", v: "asks / asks · GRANTED / GRANTED" }'),
    ("ag-access bullets",
     'bullets: ["No orchestrator is locked down in Claude Code: all three declare Write and '
     'Bash. In Kiro CLI the picture is the one you would expect — konductor has neither write '
     'nor shell, and the two multiplexer variants have shell but not write — but that restraint '
     'is a Kiro CLI property, not a property of the agent.", "k-browser and k-media-analyzer are '
     'read-only in Kiro CLI but can write files and run shell commands in Claude Code. The two '
     'runtime configurations disagree.", "k-product-manager and k-tpm gain shell access in '
     'Claude Code that they do not have in Kiro CLI."]',
     'bullets: ["No orchestrator is locked down in Claude Code, and none is incapable in Kiro '
     'CLI either: all three declare Write and Bash, and in Kiro CLI konductor pre-approves '
     'nothing but fs_read while the two multiplexer variants pre-approve shell. That is a '
     'prompting difference, not a capability one.", "k-browser and k-media-analyzer pre-approve '
     'reads only in Kiro CLI and are granted write and shell outright in Claude Code. If you '
     'expect a media analyser to be incapable of editing your repository, that does not hold in '
     'either runtime.", "k-product-manager and k-tpm pre-approve writes but not shell in Kiro '
     'CLI, and are granted both in Claude Code.", "Delegation does not narrow permissions in '
     "Claude Code. A subagent runs inside its parent's permission context, so the parent must "
     'hold a tool for the subagent to use it."]'),
    ("ag-access note",
     'note: "k-researcher is the only agent — specialist or orchestrator — that is read-only in '
     'both runtimes, which makes it the safe default for exploratory work."',
     'note: "k-researcher is the only agent — specialist or orchestrator — with no write or '
     'shell tool in Claude Code at all, which makes it the safe default for exploratory work '
     'there. In Kiro CLI it pre-approves fs_read alone, so anything beyond reading stops to ask '
     'you."'),
    ("ag-access researcher card",
     "the narrowest tool list of any agent. Read-only in both runtimes, which makes it the "
     "safest agent to point at unfamiliar code.",
     "the narrowest tool list of any agent, and the only one with no write or shell tool at all "
     "— which makes it the safest agent to point at unfamiliar code. In Kiro CLI it pre-approves "
     "fs_read alone, so anything more asks first."),
    ("ag-orch intent prose",
     "Treat that as intent, not enforcement: in Kiro CLI it is backed by narrow allowedTools, "
     "but in Claude Code all three are granted Write and Bash regardless.",
     "Treat that as intent, not enforcement: it is a prompt rule, and the tool configuration "
     "does not back it up in either runtime — Kiro CLI pre-approves reads only, so a mutating "
     "call stops to ask you rather than being refused, and Claude Code grants all three Write "
     "and Bash outright."),
    ("ag runtime diff: permission model row",
     '{ k: "Tool naming", v: "fs_read, fs_write, shell · Read, Write, Edit, Bash" },',
     '{ k: "Tool naming", v: "fs_read, fs_write, shell · Read, Write, Edit, Bash" },\n'
     '          { k: "Permission model", v: "two lists: tools grants with a prompt, '
     'allowedTools pre-approves · one list: clientConfig.claudeCli.tools is the ceiling, and '
     'your settings.json decides what prompts" },'),
    ("ag runtime diff: browser / media-analyzer",
     '{ k: "browser / media-analyzer", v: "read-only · can write files and run shell" },',
     '{ k: "browser / media-analyzer", v: "reads pre-approved; writes and shell ask first · '
     'write and shell granted" },'),
    ("ag runtime diff: pm / tpm",
     '{ k: "product-manager / tpm", v: "no shell · shell available" },',
     '{ k: "product-manager / tpm", v: "shell asks first · shell granted" },'),
    ("ic permissions team-level note",
     '>Permissions are <strong style="color:var(--tx);font-weight:600">team-level</strong>: they '
     'apply to every agent in the team, not per agent.</p>',
     '>Permissions are <strong style="color:var(--tx);font-weight:600">team-level</strong>: they '
     "apply to every agent in the team, not per agent. A subagent runs inside its parent's "
     'permission context, so the parent has to hold a tool before any specialist it dispatches '
     'can use it. allow is one of three verdicts this file supports — ask prompts you, deny '
     'refuses outright — but a background subagent cannot answer a prompt, so in team mode ask '
     'lands as a silent denial.</p>'),
    # ---- quick start step 1 is a build, not a download ----------------------
    # Nothing has been published to download, and the step already built from a
    # clone -- the heading and the lead-in were the last two places still framing
    # it as a fetch, one of them by narrating the absent release.
    ("qs prereq row: release framing",
     ">No release has been published yet, so you build the CLI from a clone — rustup is the "
     "usual way to get one<",
     ">Built from a clone of the repository — rustup is the usual way to get a toolchain<"),
    ("qs step 1 heading", ">Download the CLI</h3>", ">Build the CLI</h3>"),
    ("qs step 1 toc", ">1 — Download the CLI</a>", ">1 — Build the CLI</a>"),
    ("qs step 1 intro", ">Get the build for your platform:</p>",
     ">Build konductor from a clone of the repository. You need a Rust toolchain:</p>"),
    # ---- the layout tree omitted mcp/ ---------------------------------------
    ("rf layout tree: mcp/",
     "├── docs/\\n│   ├── guides/                   Integration guides",
     "├── mcp/                          MCP servers the CLI installs alongside the agents\\n"
     "│   ├── lib/                      Shared crates: skill-lookup-core, telemetry-net\\n"
     "│   └── servers/skill-lookup/     Serves skills to Kiro CLI sessions\\n"
     "├── docs/\\n│   ├── guides/                   Integration guides"),
    # ---- konductor is the documented entry point ----------------------------
    # A specialist can be started directly and the guide still says so, but
    # every invocation example leads with the orchestrator now: it is the only
    # entry point that verifies a handoff, and it does not require the reader to
    # know which agent declares which SOP.
    ("sop invoke: start with konductor",
     "and ask for a code review workflow, the SOP is not loaded there. Start with the "
     "orchestrator and let it route, or start with the owning agent.",
     "and ask for a code review workflow, the SOP is not loaded there. Start with konductor and "
     "let it route — that is the form this guide uses throughout, and the one that does not "
     "require you to know who owns what."),
    ("sop invoke: reliable-way heading",
     ">The reliable way: ask the orchestrator</h3>", ">The reliable way: ask konductor</h3>"),
    ("sop invoke: recommends prose",
     "The orchestrator's routing rules send code review to",
     "konductor's routing rules send code review to"),
    ("sop invoke: direct-agent heading",
     ">Or start with the owning agent directly</h3>", ">Starting a specialist directly</h3>"),
    ("sop invoke: direct-agent prose",
     "If you know exactly which SOP you want, go straight to the agent that declares it.",
     "A specialist is not hidden, and the SOPs it declares are loaded in its own session. Prefer "
     "konductor anyway: it is the only entry point that verifies a handoff before moving on. "
     "Reach for the direct form when you are deliberately scoping a session to one agent, and "
     "treat it as the exception."),
    ("ik which agent: prose",
     ">Start with the orchestrator and let it route. Invoke a specialist directly only when you "
     'know exactly which workflow you want — see <a href="#/sops">which agent owns which SOP</a>'
     ".</p>",
     ">Start with konductor and let it route. That is the default for everything in this guide: "
     "it is the only entry point that verifies a handoff before moving on, and it does not "
     "require you to know who owns which workflow. Starting a specialist directly is supported "
     'and occasionally what you want — see <a href="#/sops">which agent owns which SOP</a>.</p>'),
    ("ik which agent: konductor first",
     ">kiro-cli chat --agent k-architect</pre>", ">kiro-cli chat --agent konductor</pre>"),
]

# Per-agent roster figures, verified against agents/*.agent-spec.json.
# (label, old, new) -- model · SOPs declared · skills · MCP
#
# `old` is whatever the CURRENTLY published bundle says, not the pristine
# pre-patch text: these figures move every time a spec gains a skill, and a
# chain of superseded links (32 -> 37 -> 38) would make every link but the last
# report "target not found" on the next run. When a count changes again, edit
# `new` and move the previous `new` into `old`.
ROSTER = [
    ("ref konductor",
     '{"k":"konductor","v":"claude-sonnet-5 · kiro-spec-workflow, k-delegate, k-plan, k-context-gathering, k-verify · 9 · —"}',
     '{"k":"konductor","v":"claude-sonnet-5 · kiro-spec-workflow, k-delegate, k-plan, k-context-gathering, k-verify, k-light-ui-testing, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, about-konductor · 13 · —"}'),
    ("ref mux",
     '{"k":"konductor-mux-orchestrator","v":"claude-sonnet-5 · kiro-spec-workflow, k-plan, k-context-gathering, k-verify · 8 · —"}',
     '{"k":"konductor-mux-orchestrator","v":"claude-sonnet-5 · kiro-spec-workflow, k-plan, k-context-gathering, k-verify, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, k-light-ui-testing, about-konductor · 10 · —"}'),
    ("ref cmux",
     '{"k":"konductor-cmux-orchestrator","v":"claude-sonnet-5 · kiro-spec-workflow, k-plan, k-context-gathering, k-verify · 8 · —"}',
     '{"k":"konductor-cmux-orchestrator","v":"claude-sonnet-5 · kiro-spec-workflow, k-plan, k-context-gathering, k-verify, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, k-light-ui-testing, about-konductor · 10 · —"}'),
    ("ref architect",
     '{"k":"k-architect","v":"claude-sonnet-5 · k-design-doc-creation, k-existing-design-review, k-principal-engineer-design-review, k-adversarial-pull-request-review · 37 · aws-mcp"}',
     '{"k":"k-architect","v":"claude-sonnet-5 · k-design-doc-creation, k-existing-design-review, k-principal-engineer-design-review, k-adversarial-pull-request-review · 38 · aws-mcp"}'),
    ("ref developer",
     '{"k":"k-developer","v":"claude-sonnet-5 · k-code-cleanup, k-pre-cr-critique, k-codebase-analysis, k-code-review-workflow · 26 · aws-mcp"}',
     '{"k":"k-developer","v":"claude-sonnet-5 · k-code-cleanup, k-pre-cr-critique, k-codebase-analysis, k-code-review-workflow · 27 · aws-mcp"}'),
    # k-code-review-workflow was removed from k-quality-assurance's spec as
    # unusable (it spawns k-architect, which QA cannot reach), so QA is down to
    # one declared SOP.
    ("ref qa",
     '{"k":"k-quality-assurance","v":"claude-sonnet-5 · k-test-coverage-review, k-code-review-workflow · 11 · —"}',
     '{"k":"k-quality-assurance","v":"claude-sonnet-5 · k-test-coverage-review · 12 · —"}'),
    ("ref pm",
     '{"k":"k-product-manager","v":"claude-sonnet-5 · none · 15 · —"}',
     '{"k":"k-product-manager","v":"claude-sonnet-5 · none · 16 · —"}'),
    ("ref researcher",
     '{"k":"k-researcher","v":"claude-sonnet-5 · none · 7 · —"}',
     '{"k":"k-researcher","v":"claude-sonnet-5 · none · 8 · —"}'),
    ("sop owners: k-code-review-workflow",
     '{"k":"k-code-review-workflow","v":"k-developer, k-quality-assurance · source_dir"}',
     '{"k":"k-code-review-workflow","v":"k-developer · source_dir"}'),
    ("sop-review owner line",
     'owner: "k-developer, k-quality-assurance — no file changes"',
     'owner: "k-developer — no file changes"'),
    ("agents warn: who declares the review SOP",
     'That SOP is declared only by k-developer and k-quality-assurance — and neither can spawn the architect in either runtime.',
     'That SOP is declared only by k-developer — which cannot spawn the architect in either runtime.'),
    ("agents prose: routing the review SOP",
     'so it delegates the whole SOP to the developer or QA agent, which hits the same wall.',
     'so it delegates the whole SOP to the developer, which hits the same wall.'),
    ("faq prose: routing the review SOP",
     'so it hands the SOP to the developer or QA agent, which hits the same wall.',
     'so it hands the SOP to the developer, which hits the same wall.'),
    ("faq prose: who owns the review SOP",
     'neither agent that owns the SOP can spawn the architect',
     'the only agent that owns the SOP cannot spawn the architect'),
    ("sop roster: QA's declared SOPs",
     '{ agent: "k-quality-assurance", sops: "k-test-coverage-review, k-code-review-workflow" }',
     '{ agent: "k-quality-assurance", sops: "k-test-coverage-review" }'),
    ("agents card: QA SOPs + skill count",
     '{ k: "k-quality-assurance", v: "SOPs: k-test-coverage-review, k-code-review-workflow (shared with the developer). 10 skills —',
     '{ k: "k-quality-assurance", v: "SOPs: k-test-coverage-review. 12 skills —'),
    ("sops callout: two agents declare the review SOP",
     'is declared by <strong style="color:var(--tx);font-weight:600">two</strong> agents — the developer and QA. Either can run it.',
     'is declared by <strong style="color:var(--tx);font-weight:600">one</strong> agent — the developer. QA declared it too until that registration was removed as unusable: step 6 spawns k-architect, which QA cannot reach.'),
    ("sop step 6 node: who cannot spawn",
     'because neither owning agent can spawn the architect.',
     'because its one owning agent cannot spawn the architect.'),
    # The `\"` escapes are load-bearing: this passage lands inside a
    # double-quoted JS string in the bundle's `data-dc-script` block, which
    # `dc-runtime` compiles with `new Function()`. A raw `"` closes that string
    # early and the whole template eval aborts -- blank page, no console clue
    # beyond a SyntaxError. build-user-guide.sh and check-guide-facts.py both
    # compile the extracted block now, so this class fails loudly instead.
    ("sop know: who cannot spawn",
     'Step 6 tells the agent to spawn k-architect, but neither owning agent can: in Kiro CLI their subagent.availableAgents lists do not include the architect, and in Claude Code neither has an Agent(...) tool at all.',
     'Step 6 tells the agent to spawn k-architect, but its one owning agent cannot: in Kiro CLI k-developer\'s subagent.availableAgents is [\\"k-quality-assurance\\"], which does not include the architect, and in Claude Code it has no Agent(...) tool at all.'),
    ("use-case bullet: neither owner lists the architect",
     'and neither owner lists the architect: the developer\'s is <code style="font-family:\'JetBrains Mono\',monospace;font-size:.9em;color:var(--tx)">["k-quality-assurance"]</code>, QA\'s is <code style="font-family:\'JetBrains Mono\',monospace;font-size:.9em;color:var(--tx)">["k-developer"]</code>.',
     'and the developer, this SOP\'s only owner, does not list the architect: its targets are <code style="font-family:\'JetBrains Mono\',monospace;font-size:.9em;color:var(--tx)">["k-quality-assurance"]</code>.'),
    ("skills-per-agent table",
     '"rows":[{"k":"k-architect","v":"32"},{"k":"k-developer","v":"20"},{"k":"k-product-manager","v":"14"},{"k":"k-tpm","v":"14"},{"k":"konductor","v":"12"},{"k":"konductor-cmux-orchestrator","v":"11"},{"k":"konductor-mux-orchestrator","v":"11"},{"k":"k-quality-assurance","v":"10"},{"k":"k-researcher","v":"7"},{"k":"k-browser","v":"4"},{"k":"k-media-analyzer","v":"1"}]',
     '"rows":[{"k":"k-architect","v":"38"},{"k":"k-developer","v":"27"},{"k":"k-product-manager","v":"16"},{"k":"k-tpm","v":"14"},{"k":"konductor","v":"13"},{"k":"k-quality-assurance","v":"12"},{"k":"konductor-cmux-orchestrator","v":"10"},{"k":"konductor-mux-orchestrator","v":"10"},{"k":"k-researcher","v":"8"},{"k":"k-browser","v":"4"},{"k":"k-media-analyzer","v":"1"}]'),
    # at-a-glance cards
    ("card konductor", 'Coordinator. Delegates everything, implements nothing. claude-sonnet-5 · 9 skills · 5 SOPs',
     'Coordinator. Delegates everything, implements nothing. claude-sonnet-5 · 13 skills · 10 SOPs'),
    ("card mux", 'Same, dispatching into tmux/zellij panes. claude-sonnet-5 · 8 skills · 4 SOPs',
     'Same, dispatching into tmux/zellij panes. claude-sonnet-5 · 10 skills · 9 SOPs'),
    ("card cmux", 'Same, dispatching into cmux surfaces. claude-sonnet-5 · 8 skills · 4 SOPs',
     'Same, dispatching into cmux surfaces. claude-sonnet-5 · 10 skills · 9 SOPs'),
    ("card pm", 'Requirements, user stories, decision research. claude-sonnet-5 · 15 skills · 0 SOPs',
     'Requirements, user stories, decision research. claude-sonnet-5 · 16 skills · 0 SOPs'),
    ("card architect", 'System designs, APIs, data models, threat models. claude-sonnet-5 · 37 skills · 4 SOPs · aws-mcp',
     'System designs, APIs, data models, threat models. claude-sonnet-5 · 38 skills · 4 SOPs · aws-mcp'),
    ("card developer", 'Implementation, code review, git, builds. claude-sonnet-5 · 26 skills · 4 SOPs · aws-mcp',
     'Implementation, code review, git, builds. claude-sonnet-5 · 27 skills · 4 SOPs · aws-mcp'),
    ("card qa", 'Test coverage, E2E strategy, security tests. claude-sonnet-5 · 11 skills · 2 SOPs',
     'Test coverage, E2E strategy, security tests. claude-sonnet-5 · 12 skills · 1 SOP'),
    ("card researcher", 'External documentation and web research. claude-sonnet-5 · 7 skills · 0 SOPs',
     'External documentation and web research. claude-sonnet-5 · 8 skills · 0 SOPs'),
]


def apply_all(page, problems):
    """Apply every edit exactly once, and never twice.

    Whether an edit has already been applied cannot be decided the same way for
    both shapes of edit, and getting it wrong is silent:

    * APPEND (``old`` is part of ``new``) -- ``old`` survives a successful apply,
      so "is ``old`` still here?" always says yes and the edit re-appends on every
      run. One table gained the same six rows 27 times before this was fixed.
      Decide on ``new``.
    * SUBSTITUTION (``old`` disappears) -- deciding on ``new`` is wrong when two
      edits share a ``new``, or when ``new`` is a fragment of ``old``: the first
      edit's result makes the second look done. Decide on ``old``.

    A DELETION (``new`` empty) is decided on ``old`` alone. "Is ``new`` already
    here?" cannot work for one -- the empty string is in every page -- so a
    deletion with no match is a failure, never an already-applied no-op.

    Every ``old`` is required to match EXACTLY once. ``str.replace`` rewrites all
    matches, so a second unintended match -- easy to acquire, since several
    roster and card targets differ only by a little surrounding markup -- would
    be silently rewritten too. Counting first turns that into a loud failure.
    """
    for label, old, new in EDITS + ROSTER + SOP_EDITS:
        hits = page.count(old)
        if hits > 1:
            problems.append(f"{label} (matched {hits}x, expected 1)")
            continue
        if old in new:  # append-style
            if new in page:
                continue
            if hits == 1:
                page = page.replace(old, new)
            else:
                problems.append(label)
        else:  # substitution
            if hits == 1:
                page = page.replace(old, new)
            # `new and` is load-bearing: for a DELETION (`new == ""`) the test
            # `new in page` is `"" in page`, which is always True -- so a deletion
            # whose anchor had drifted was silently treated as already-applied and
            # the content it should have removed shipped instead. That defeated
            # this module's whole guarantee, and 13 entries are deletions,
            # including every step of the `konductor config` withdrawal.
            elif new and new in page:
                continue
            else:
                problems.append(label)
    return page


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", default=".", type=Path)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    repo = args.repo.resolve()
    targets = htmlbundle.bundles(repo)
    if not targets:
        print("error: no published guide bundle found under docs/", file=sys.stderr)
        return 64

    failed = False
    for bundle in targets:
        page = htmlbundle.load(bundle)
        problems = []
        new = apply_all(page, problems)
        rel = bundle.relative_to(repo)
        if problems:
            failed = True
            print(f"  {rel}: {len(problems)} edit target(s) NOT FOUND:")
            for p in problems:
                print(f"      - {p}")
        if new == page:
            print(f"  {rel}: no change")
            continue
        matched = len(EDITS) + len(ROSTER) + len(SOP_EDITS) - len(problems)
        # Never write a partially-patched bundle. Without this guard an --apply
        # run with unmatched targets still saved the subset that did match and
        # only then exited 1, leaving a committed artifact half-updated -- worst
        # with the append-style edits, whose re-application depends on their own
        # result being absent (see apply_all's docstring). All-or-nothing means a
        # failed run leaves the bundle exactly as it was, so fixing the edit
        # table and re-running is always the recovery.
        if problems:
            print(f"  {rel}: {matched} edit(s) matched, but NOT written — "
                  f"fix the unmatched target(s) above first")
            continue
        print(f"  {rel}: {'applied' if args.apply else 'would apply'} {matched} edit(s)")
        if args.apply:
            htmlbundle.save(bundle, new)

    if failed:
        print("\nSome edits did not match. The bundle has moved on -- update EDITS.",
              file=sys.stderr)
        return 1
    if not args.apply:
        print("\nPreview only. Re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
