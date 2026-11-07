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


def _code(text):
    """Inline code span in the bundle's prose markup."""
    return f"<code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">{text}</code>"


def _mono(text):
    """Plain monospace span used by the quick-start and install pages."""
    return f"<span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">{text}</span>"


def _chip(text):
    """Highlighted monospace span used by the quick-start step 4 prose."""
    return (
        "<span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx);"
        f"background:rgba(124,92,255,.16);border-radius:5px;padding:1.5px 6px\">{text}</span>"
    )


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
    ("install summary", "Registers the 11 agents, 82 skills, 19 SOPs, and the orchestrator routing rules",
     "Registers the 11 agents, 82 skills, 19 SOPs, the core rules, and the orchestrator routing rules"),
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
    # ---- aws-mcp launches a pinned version, not a floating @latest ----------
    ("reference MCP registry note: pinned aws-mcp",
     'note":"MCP registry entries — aws-mcp (k-architect, k-developer): command uvx, args '
     'mcp-proxy-for-aws@latest, https://aws-mcp.us-east-1.api.aws/mcp, --metadata, AWS_REGION=us-east-1.',
     'note":"MCP registry entries — aws-mcp (k-architect, k-developer): command uvx, args '
     'mcp-proxy-for-aws-cli==1.7.0, https://aws-mcp.us-east-1.api.aws/mcp, --metadata, AWS_REGION=us-east-1.'),
    ("architect card: pinned aws-mcp",
     'MCP: aws-mcp, launched via uvx mcp-proxy-for-aws@latest — allowedTools grants documentation '
     'search/read, region list, and regional availability.',
     'MCP: aws-mcp, launched via uvx mcp-proxy-for-aws-cli==1.7.0 — allowedTools grants documentation '
     'search/read, region list, and regional availability.'),
    # ---- every agent loads context/k-core-rules.md ---------------------------
    ('concepts context file paragraph', 'There are two today. <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">context/k-core-rules.md</span> holds the NEVER DO rules, the writing-habits rule, and the engineering practices, and all 11 agents load it. <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">context/k-orchestrator-routing-rules.md</span> is loaded by all three orchestrators. The routing rules file contains', 'There are four today. <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">context/k-core-rules.md</span> holds the NEVER DO rules, the writing-habits rule, and the engineering practices, and all 11 agents load it. <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">context/k-direct-work.md</span> is loaded by konductor; <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">context/k-orchestrator-routing-rules.md</span> is loaded by the mux and cmux orchestrators; <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">context/k-orchestrator-shared.md</span> holds the handoff, split, denial and brief rules, and all three orchestrators load it. The routing rules file contains'),
    # ---- single-writer shape: konductor does the work itself (R4-144.c) ----
    ("quick-start step 3: konductor does the work itself",
     "You are now talking to the coordinator. It never implements anything itself — it routes each piece of work to the specialist that owns it, checks what comes back, and re-delegates if a check fails.</p>",
     "You are now talking to the orchestrator. It does the work itself, in this one session, and spawns a fresh k-* reviewer when a phase closes (a lookup, a listing or a one-file change of at most 50 lines that builds, tests and lints clean needs none, reported with the diff stat); it spawns a specialist to do work only for a tool, skill or SOP it lacks or for parallel work on disjoint files.</p>"),
    ("concepts context paragraph: coordinator rules, not a routing table",
     "The routing rules file contains the capability-to-agent routing table and three",
     "The routing rules file contains the coordinator rules and three"),
    ("concepts hub caption: direct-work rules are always active",
     "Hub-and-spoke: you talk only to konductor; routing rules are always active;",
     "Hub-and-spoke: you talk only to konductor; its direct-work rules are always active;"),
    ("concepts hub diagram: single-writer label",
     "HUB — READ-ONLY</div>",
     "HUB: SINGLE WRITER</div>"),
    ("concepts hub diagram: direct-work rules box",
     "color:var(--tx)\">context/ routing rules</div>",
     "color:var(--tx)\">context/ direct-work rules</div>"),
    ("AGENTS array: konductor does the work itself",
     '["konductor", "The main entry point. Coordinates everything, delegates all work, never implements directly."],',
     '["konductor", "The main entry point. Does the work itself and spawns a fresh reviewer at each phase gate."],'),
    ("glossary Orchestrator: konductor also does the work itself",
     'v: "An agent that coordinates other agents and never implements directly. Three exist:',
     'v: "An agent that coordinates other agents; konductor also does the work itself. Three exist:'),
    # Two edits around the "uc owned-by prose" fragment, which stays byte-identical
    # in the middle of this paragraph so that entry remains satisfied.
    ("use-cases owned-by-the-orchestrator: mux and cmux dispatch, konductor works",
     "The orchestrators are dispatchers by design. " + _code("konductor")
     + " <strong style=\"color:var(--tx);font-weight:600\">pre-approves reads only in Kiro CLI</strong>",
     "The mux and cmux orchestrators are dispatchers by design, and " + _code("konductor")
     + " does the work itself; no runtime enforces either shape. " + _code("konductor")
     + " <strong style=\"color:var(--tx);font-weight:600\">pre-approves reads only in Kiro CLI</strong>"),
    ("use-cases owned-by-the-orchestrator: konductor's Claude Code tools",
     "alone; in Claude Code its tool list has no " + _code("Bash") + ", " + _code("Write") + ", or " + _code("Edit")
     + ". What it has is " + _code("Read") + ", " + _code("Glob") + ", " + _code("Grep") + ", " + _code("WebFetch")
     + ", " + _code("WebSearch") + ", " + _code("TodoWrite") + ", " + _code("Workflow") + ", an " + _code("Agent(...)")
     + " tool scoped to the eight specialists, and " + _code("SendMessage") + ".</p>",
     "alone; in Claude Code it is granted " + _code("Bash") + ", " + _code("Write") + " and " + _code("Edit")
     + " alongside " + _code("Read") + ", " + _code("Glob") + ", " + _code("Grep") + ", " + _code("WebFetch")
     + ", " + _code("WebSearch") + ", " + _code("TodoWrite") + ", " + _code("Workflow") + ", " + _code("Skill") + ", "
     + _code("SendMessage") + ", and an " + _code("Agent(...)") + " tool scoped to the eight specialists, and uses"
     + " them as its direct-work rules allow. For the mux and cmux orchestrators only the routing rules stop"
     + " them, so the dispatcher behaviour you see there is a convention rather than a wall.</p>"),
    ("use-cases chain: konductor runs the steps itself",
     "So when you run this chain \"via the orchestrator\", the orchestrator reads, synthesises, and routes."
     + " The file writes, " + _code("git diff") + " calls, and build and test commands execute through"
     + " whichever specialist it delegates to — " + _code("k-developer") + " for implementation and shell work, "
     + _code("k-researcher") + " for parallel research, " + _code("k-architect") + " for escalations.</p>",
     "So when you run this chain through " + _code("konductor") + ", it reads, synthesises, writes the files"
     + " and runs the " + _code("git diff") + ", build and test commands itself, as its direct-work rules allow;"
     + " it spawns a specialist only for a tool, skill or SOP it lacks or for independent work on disjoint files ("
     + _code("k-researcher") + " for parallel research), and a fresh reviewer when a phase closes."
     + " Through the mux or cmux orchestrator the same steps execute in whichever specialist it delegates to: "
     + _code("k-developer") + " for implementation and shell work, " + _code("k-researcher")
     + " for parallel research, " + _code("k-architect") + " for escalations.</p>"),
    # A request that is the procedure of an SOP konductor does not declare goes to
    # the SOP's owner; the same reading as quick-start step 4 and k-direct-work.md.
    ("use-cases design invocation: konductor spawns the SOP owner",
     "Through the orchestrator, which routes design requests to " + _code("k-architect") + ":</p>",
     "Through the orchestrator. " + _code("konductor") + " spawns " + _code("k-architect")
     + ", which declares these SOPs, to run them; a design step inside a task it owns, " + _code("konductor")
     + " writes itself. The mux and cmux orchestrators route every design request to "
     + _code("k-architect") + ":</p>"),
    ("use-cases codebase invocation: konductor spawns the SOP owner",
     "The orchestrator routes both to " + _code("k-developer") + ", which owns both SOPs. To skip the routing hop,"
     + " start a session with the developer agent directly: " + _code("k-developer") + ", on either runtime.</p>",
     _code("konductor") + " spawns " + _code("k-developer") + ", which declares both SOPs, to run them: each is a"
     + " multi-step procedure of an SOP " + _code("konductor") + " does not declare. The mux and cmux orchestrators"
     + " route both to " + _code("k-developer") + " as well. To skip the hop, start a session with the developer"
     + " agent directly: " + _code("k-developer") + ", on either runtime.</p>"),
    ("quick-start step 4: konductor spawns the codebase-analysis owner",
     "The orchestrator routes this to " + _chip("k-developer") + ", which owns the " + _chip("k-codebase-analysis")
     + " workflow. It produces",
     _chip("konductor") + " spawns " + _chip("k-developer") + ", which owns the " + _chip("k-codebase-analysis")
     + " workflow, to run it. It produces"),
    ("quick-start step 4: konductor names the k-full-sdlc SOP",
     "Here the orchestrator routes the design to " + _chip("k-architect") + ", implementation to "
     + _chip("k-developer") + ", and test coverage to " + _chip("k-quality-assurance")
     + ", verifying each handoff before moving on.</p>",
     "Here " + _chip("konductor") + " names the " + _chip("k-full-sdlc") + " SOP and its command, then waits for"
     + " you to type it. That SOP runs each phase in a specialist subagent and reviews it before moving on.</p>"),
    ("landing column 02: konductor does the work",
     "<span style=\"font-size:14px\">The orchestrator routes it to the owner</span>",
     "<span style=\"font-size:14px\">konductor does the work in your session</span>"),
    ("landing column 03: a reviewer at each phase gate",
     "<span style=\"font-size:14px\">Maker-checker runs before every handoff</span>",
     "<span style=\"font-size:14px\">A fresh reviewer checks each phase</span>"),
    ("landing column 04: one fix and one re-review",
     "<span style=\"font-size:14px\">Failed checks re-delegate, up to 2 cycles</span>",
     "<span style=\"font-size:14px\">One fix and one re-review, then it reports</span>"),
    ("install step 5: konductor spawns the code-review owner",
     "The orchestrator routes this to " + _mono("k-developer") + ", which is the agent that declares that SOP.</p>",
     _mono("konductor") + " spawns " + _mono("k-developer") + ", the agent that declares that SOP, to run it.</p>"),
    ("use-cases card: konductor does it or spawns the SOP owner",
     "Describe what you want in plain language and let it route.</div>",
     "Describe what you want in plain language; konductor does it or spawns the agent that declares the SOP.</div>"),
    ("troubleshooting SOP fix: konductor spawns the SOP owner",
     "Either start with konductor and let it route, or go directly to the owning agent.",
     "Either start with konductor, which spawns the agent that declares the SOP, or go directly to the owning agent."),
    ("concepts hub: konductor acts on a split",
     "inputs and files, and konductor routes it.</p>",
     "inputs and files, and konductor does that step or spawns for it as its direct-work rules allow.</p>"),
    ("concepts NEVER MUTATE follow-up: mux and cmux hand off",
     "That is why the orchestrator hands file edits and shell commands to <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">k-developer</span> rather than doing them itself.</p>",
     "That is why the mux and cmux orchestrators hand file edits and shell commands to <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">k-developer</span> rather than doing them themselves.</p>"),
    # Runs before SOP_EDITS so the "sop-orch page" block (whose `new` carries the
    # same card text) is already satisfied when that entry is checked.
    ("sop-orch know card: coordinates under this SOP",
     '{ title: "The orchestrator coordinates and never implements.", body: "',
     '{ title: "Under this SOP the orchestrator coordinates; each phase runs in the agent the SOP names.", body: "'),
    ("concepts: no repeat review",
     "k-delegate</span> step 8). A review finding gets one fix, a fresh build and test run for code, and one re-review of every first-review CRITICAL or IMPORTANT finding plus the fix and what depends on it; a first-review finding still open, or any CRITICAL or IMPORTANT finding the re-review reports in the task's own output, carried over or new, or caused by the fix, blocks done, and the orchestrator stops and reports it to you; a finding in code the task did not add or change is listed for you as pre-existing. An SOP's own fix scope and limit on fix rounds win; a finding it leaves open is reported to you as unresolved, never dropped. An artifact that passed review is not reviewed again unless it changes.</p>",
     "k-delegate</span> step 8). A review finding gets one fix, a fresh build and test run for code, and one re-review of every first-review CRITICAL or IMPORTANT finding plus the fix and what depends on it; a first-review finding still open, or any CRITICAL or IMPORTANT finding the re-review reports in the task's own output, carried over or new, or caused by the fix, blocks done, and the orchestrator stops and reports it to you; a finding in code the task did not add or change is listed for you as pre-existing. An SOP's own fix scope and limit on fix rounds win; a finding it leaves open is reported to you as unresolved, never dropped. An artifact that passed review is not reviewed again unless it changes. When konductor made the artifact itself, a CRITICAL or IMPORTANT finding it would reject goes to you first and blocks done until you answer.</p>"),
    ("concepts: re-delegate sentence without a dash",
     "it re-delegates — <strong",
     "it re-delegates, <strong"),
    ('concepts context files row',
     '{ k: "Context files — 2", v: "The core rules for every agent and the orchestrator routing rules, always active" }',
     '{ k: "Context files — 4", v: "The core rules for every agent, the shared orchestrator rules, and the direct-work or routing rules, always active" }'),
    ('glossary orchestrator entry: konductor works itself',
     'Three exist: konductor (background subagents), konductor-mux-orchestrator (tmux/zellij panes), and konductor-cmux-orchestrator (cmux surfaces). All are read-only by rule — they delegate every file write and shell command.',
     'Three exist: konductor (background subagents), konductor-mux-orchestrator (tmux/zellij panes), and konductor-cmux-orchestrator (cmux surfaces). The mux and cmux orchestrators are read-only by rule and delegate every file write and shell command; konductor writes in its own session and spawns a reviewer at each phase gate.'),
    ('glossary read-only entry: mux and cmux only',
     'The orchestrators are read-only by rule. Applied to a SOP',
     'The mux and cmux orchestrators are read-only by rule. Applied to a SOP'),
    ('glossary context file',
     'Two exist: context/k-core-rules.md, loaded by all 11 agents, and context/k-orchestrator-routing-rules.md, loaded by all three orchestrators.',
     'Four exist: context/k-core-rules.md, loaded by all 11 agents; context/k-orchestrator-shared.md, loaded by all three orchestrators; context/k-direct-work.md, loaded by konductor; and context/k-orchestrator-routing-rules.md, loaded by the mux and cmux orchestrators.'),
    ("reference roster note: context files",
     'Every agent declares context/k-core-rules.md. Only the three orchestrators also declare context/k-orchestrator-routing-rules.md."]',
     'Every agent declares context/k-core-rules.md. Only the mux and cmux orchestrators also declare context/k-orchestrator-routing-rules.md; konductor declares context/k-direct-work.md. The three orchestrators also declare context/k-orchestrator-shared.md."]'),
    ("agents note: context files",
     "Every agent declares the context/k-core-rules.md context file. Only the three orchestrators also declare context/k-orchestrator-routing-rules.md, which is what makes them behave as dispatchers.",
     "Every agent declares the context/k-core-rules.md context file. Only the mux and cmux orchestrators also declare context/k-orchestrator-routing-rules.md, which is what makes them behave as dispatchers. konductor declares context/k-direct-work.md and does the work itself. The three orchestrators also declare context/k-orchestrator-shared.md."),
    ('layout tree context',
     '│   ├── k-core-rules.md\\n│   └── k-orchestrator-routing-rules.md\\n',
     '│   ├── k-core-rules.md\\n│   ├── k-direct-work.md\\n│   ├── k-orchestrator-routing-rules.md\\n│   └── k-orchestrator-shared.md\\n'),
    ('troubleshooting context count',
     'it should report 2 registered.',
     'it should report 4 registered.'),
    ("contributing: seven files", "Five files control five different things.", "Seven files control seven different things."),
    ("contributing: core rules row",
     '{ k: "context/k-core-rules.md", v: "Rules every agent must follow, NEVER DO rules and writing habits, loaded at session start for every agent" }',
     '{ k: "context/k-core-rules.md", v: "Rules every agent must follow, NEVER DO rules, writing habits, and engineering practices, loaded at session start for every agent" }'),
    ("faq: core rules row",
     '{ k: "context/k-core-rules.md", v: "Change the core rules, the NEVER DO rules and writing habits loaded at session start for every agent" }',
     '{ k: "context/k-core-rules.md", v: "Change the core rules, the NEVER DO rules, writing habits, and engineering practices loaded at session start for every agent" }'),
    ("skills catalog: constraints row",
     "Workflow rules for every agent: maker-checker validation, severity ordering, the 2-strike circuit breaker, and the quality gate. The NEVER DO rules, writing habits, and engineering practices live in context/k-core-rules.md.",
     "Workflow rules for every agent: maker-checker validation, the 2-strike circuit breaker, and the quality gate. The NEVER DO rules, writing habits, and engineering practices live in context/k-core-rules.md."),
    ("skills catalog: constraints reach",
     "REACH FOR IT: Always on. You never invoke it; it is the floor every agent stands on.",
     "REACH FOR IT: You never invoke it. Claude Code preloads it only into subagents; otherwise it loads on demand."),
    # ---- k-architect is no longer on a different model ----------------------
    ("architect model prose",
     "Both are owned by <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">k-architect</code>, which carries 37 of the package's 82 skills — close to half, and by far the largest share of any agent.",
     "Both are owned by <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">k-architect</code>, which carries 38 of the package's 82 skills — close to half, and by far the largest share of any agent."),
    ("reference roster note",
     "Every agent runs claude-sonnet-5.5. Skill counts are from each spec's clientConfig.claudeCli.skills array. Claude Code preloads that list only when the agent runs as a subagent. A top-level Claude Code agent, and every agent on Kiro CLI, loads skills on demand. The list differs from dependencies.skills.skillNames in two places. konductor declares claude-teams-behavior for Claude Code only. Seven agents (the three orchestrators, k-quality-assurance, k-researcher, k-browser, k-media-analyzer) declare humanize-writing in skillNames only, so no runtime preloads it for them.",
     "Every agent runs claude-sonnet-5.5 on Kiro CLI and claude-sonnet-5-5 on Claude Code. Skill counts are from each spec's clientConfig.claudeCli.skills array. Claude Code preloads that list only when the agent runs as a subagent. A top-level Claude Code agent, and every agent on Kiro CLI, loads skills on demand. The list differs from dependencies.skills.skillNames in two places. konductor declares claude-teams-behavior for Claude Code only. Seven agents (the three orchestrators, k-quality-assurance, k-researcher, k-browser, k-media-analyzer) declare humanize-writing in skillNames only, so no runtime preloads it for them.",),
    # ---- humanize-writing is declared by every agent, preloaded by four -----
    ("skills catalog: humanize-writing row",
     '"k":"humanize-writing","v":"Rewrites text to remove AI-writing tells across 34 categories while preserving meaning and voice. — REACH FOR IT: Writing or editing prose, or a draft reads machine-written. · DECLARED BY: architect, developer, product-manager, tpm preload it; every other agent loads it on demand"',
     '"k":"humanize-writing","v":"Rewrites text to remove AI-writing tells across 34 categories while preserving meaning and voice. — REACH FOR IT: Writing or editing prose, or a draft reads machine-written. · DECLARED BY: all 11. On Claude Code, k-architect, k-developer, k-product-manager and k-tpm preload it when they run as subagents. Otherwise, and on Kiro CLI, it loads on demand"'),
    ("skills most: k-media-analyzer and the preload note",
     "k-media-analyzer carries constraints and humanize-writing, and preloads only constraints. Its capability is the model's ability to interpret PDFs and images, not a skill library.\",\"The counts are the skills Claude Code preloads (clientConfig.claudeCli.skills). Seven agents, the three orchestrators plus k-quality-assurance, k-researcher, k-browser and k-media-analyzer, also declare humanize-writing and load it on demand, so it is not counted for them.\"]",
     "k-media-analyzer carries constraints and humanize-writing, and preloads only constraints. Its capability is the model's ability to interpret PDFs and images, not a skill library.\",\"The counts are clientConfig.claudeCli.skills, the list Claude Code preloads when the agent runs as a subagent. Seven agents, the three orchestrators plus k-quality-assurance, k-researcher, k-browser and k-media-analyzer, also declare humanize-writing and load it on demand, so it is not counted for them.\"]"),
    ("skills most: column header",
     '"h1":"AGENT","h2":"SKILLS DECLARED"',
     '"h1":"AGENT","h2":"SKILLS PRELOADED (CLAUDE CODE)"'),
    ("agents bullet: humanize-writing loads on demand",
     '"Five agents declare zero SOPs: product-manager',
     '"humanize-writing loads on demand for seven agents. The three orchestrators, k-quality-assurance, k-researcher, k-browser and k-media-analyzer declare it but do not preload it, so the counts above leave it out for them.", "Five agents declare zero SOPs: product-manager'),
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
     'your own ~/.claude/settings.json, which sorts calls into allow, ask, and deny.", "These '
     'rows describe agents started by konductor. konductor-mux-orchestrator and '
     'konductor-cmux-orchestrator start each specialist with permission checks off '
     '(--dangerously-skip-permissions on Claude Code, --trust-all-tools on Kiro CLI), so under '
     'them every granted tool runs without asking, MCP tools included. On Claude Code, deny rules '
     'in your settings.json still block, and an ask rule denies the call, because each specialist '
     'runs with -p and can\'t prompt. Add deny rules for anything a dispatched agent must never '
     'do."]'),
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
     "and ask for a code review workflow, the SOP is not loaded there. Start with konductor and "
     "let it route — that is the form this guide uses throughout, and the one that does not "
     "require you to know who owns what.",
     "and ask for a code review workflow, the SOP is not loaded there. Start with konductor, which "
     "spawns the agent that declares the SOP; that is the form this guide uses throughout, and the "
     "one that does not require you to know who owns what."),
    ("sop invoke: reliable-way heading",
     ">The reliable way: ask the orchestrator</h3>", ">The reliable way: ask konductor</h3>"),
    ("sop invoke: recommends prose",
     "konductor's routing rules send code review to " + _code("k-developer") + ", which declares that SOP. This",
     "konductor spawns " + _code("k-developer") + ", which declares that SOP, to run it. This"),
    ("sop invoke: direct-agent heading",
     ">Or start with the owning agent directly</h3>", ">Starting a specialist directly</h3>"),
    ("sop invoke: direct-agent prose",
     "If you know exactly which SOP you want, go straight to the agent that declares it.",
     "A specialist is not hidden, and the SOPs it declares are loaded in its own session. Prefer "
     "konductor anyway: it is the only entry point that verifies a handoff before moving on. "
     "Reach for the direct form when you are deliberately scoping a session to one agent, and "
     "treat it as the exception."),
    ("ik which agent: prose",
     ">Start with konductor and let it route. That is the default for everything in this guide: "
     "it is the only entry point that verifies a handoff before moving on, and it does not "
     "require you to know who owns which workflow. Starting a specialist directly is supported "
     'and occasionally what you want — see <a href="#/sops">which agent owns which SOP</a>.</p>',
     ">Start with konductor and ask in plain language; it does the work itself or spawns the agent "
     "that declares the SOP you need. That is the default for everything in this guide: "
     "it is the only entry point that verifies a handoff before moving on, and it does not "
     "require you to know who owns which workflow. Starting a specialist directly is supported "
     'and occasionally what you want — see <a href="#/sops">which agent owns which SOP</a>.</p>'),
    ("ik which agent: konductor first",
     ">kiro-cli chat --agent k-architect</pre>", ">kiro-cli chat --agent konductor</pre>"),
    # ---- specialists return handoffs instead of spawning ---------------------
    ("test coverage review: recommendation to the caller",
     "it may offer to spawn k-developer to implement the missing tests.",
     "it may recommend that k-developer implement the missing tests."),
    ("usecases: adversarial workaround runs through konductor",
     "yourself against <code style=\"font-family:'JetBrains Mono',monospace;font-size:.9em;color:var(--tx)\">k-architect</code>, which owns it. That is step 4 below.",
     "through <code style=\"font-family:'JetBrains Mono',monospace;font-size:.9em;color:var(--tx)\">konductor</code>, which coordinates it. That is step 4 below."),
    ("usecases: adversarial review agent card",
     "Adversarial security review</div><div style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--lav)\">k-architect</div>",
     "Adversarial security review</div><div style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--lav)\">konductor</div>"),
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
     '{"k":"konductor","v":"claude-sonnet-5.5 · kiro-spec-workflow, k-delegate, k-plan, k-context-gathering, k-verify, k-light-ui-testing, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, about-konductor · 13 · —"}',
     '{"k":"konductor","v":"claude-sonnet-5.5 · kiro-spec-workflow, k-delegate, k-plan, k-context-gathering, k-verify, k-light-ui-testing, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, k-adversarial-pull-request-review, about-konductor · 13 · —"}'),
    ("ref mux",
     '{"k":"konductor-mux-orchestrator","v":"claude-sonnet-5.5 · kiro-spec-workflow, k-plan, k-context-gathering, k-verify, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, k-light-ui-testing, about-konductor · 10 · —"}',
     '{"k":"konductor-mux-orchestrator","v":"claude-sonnet-5.5 · kiro-spec-workflow, k-plan, k-context-gathering, k-verify, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, k-light-ui-testing, k-adversarial-pull-request-review, about-konductor · 10 · —"}'),
    ("ref cmux",
     '{"k":"konductor-cmux-orchestrator","v":"claude-sonnet-5.5 · kiro-spec-workflow, k-plan, k-context-gathering, k-verify, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, k-light-ui-testing, about-konductor · 10 · —"}',
     '{"k":"konductor-cmux-orchestrator","v":"claude-sonnet-5.5 · kiro-spec-workflow, k-plan, k-context-gathering, k-verify, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, k-light-ui-testing, k-adversarial-pull-request-review, about-konductor · 10 · —"}'),
    ("ref architect",
     '{"k":"k-architect","v":"claude-sonnet-5.5 · k-design-doc-creation, k-existing-design-review, k-principal-engineer-design-review, k-adversarial-pull-request-review · 38 · aws-mcp"}',
     '{"k":"k-architect","v":"claude-sonnet-5.5 · k-design-doc-creation, k-existing-design-review, k-principal-engineer-design-review · 38 · aws-mcp"}'),
    ("ref developer",
     '{"k":"k-developer","v":"claude-sonnet-5.5 · k-code-cleanup, k-pre-cr-critique, k-codebase-analysis, k-code-review-workflow · 26 · aws-mcp"}',
     '{"k":"k-developer","v":"claude-sonnet-5.5 · k-code-cleanup, k-pre-cr-critique, k-codebase-analysis, k-code-review-workflow · 27 · aws-mcp"}'),
    # k-code-review-workflow was removed from k-quality-assurance's spec as
    # unusable (its step 6 needs the adversarial review, which QA cannot run),
    # so QA is down to one declared SOP.
    ("ref qa",
     '{"k":"k-quality-assurance","v":"claude-sonnet-5.5 · k-test-coverage-review, k-code-review-workflow · 11 · —"}',
     '{"k":"k-quality-assurance","v":"claude-sonnet-5.5 · k-test-coverage-review · 12 · —"}'),
    ("ref pm",
     '{"k":"k-product-manager","v":"claude-sonnet-5.5 · none · 15 · —"}',
     '{"k":"k-product-manager","v":"claude-sonnet-5.5 · none · 16 · —"}'),
    ("ref researcher",
     '{"k":"k-researcher","v":"claude-sonnet-5.5 · none · 7 · —"}',
     '{"k":"k-researcher","v":"claude-sonnet-5.5 · none · 8 · —"}'),
    ("sop owners: k-code-review-workflow",
     '{"k":"k-code-review-workflow","v":"k-developer, k-quality-assurance · source_dir"}',
     '{"k":"k-code-review-workflow","v":"k-developer · source_dir"}'),
    ("sop-review owner line",
     'owner: "k-developer, k-quality-assurance — no file changes"',
     'owner: "k-developer — no file changes"'),
    ("faq: house rules and rulings",
     'sec("faq-outputs", "Where SOP output goes"',
     'sec("faq-house-rules", "Why konductor asked me", "Why did konductor ask me which commit style to use, and where did it save my answer?", {\n'
     '        paras: ["Konductor\'s own formats and workflow (Conventional Commits, a pull request per feature, EARS, the review mechanism) are defaults. Your request, your project\'s AGENTS.md or CLAUDE.md, user-written memory, and the conventions your code already shows all outrank them. When those sources leave a collision open, konductor asks once and saves your answer as a Ruling: entry in .konductor/memory/. The entry settles only the collision it names. If two rulings disagree, the newer one wins.", '
     '"A file your AGENTS.md names directly, such as CONTRIBUTING.md, speaks for the same categories and nothing else. konductor-mux-orchestrator and konductor-cmux-orchestrator cannot write memory: they ask and pass your answer to the specialist, which saves it as an agent-written entry until you confirm it with konductor or a specialist."] }),\n'
     '      sec("faq-outputs", "Where SOP output goes"'),
    ("sop roster: QA's declared SOPs",
     '{ agent: "k-quality-assurance", sops: "k-test-coverage-review, k-code-review-workflow" }',
     '{ agent: "k-quality-assurance", sops: "k-test-coverage-review" }'),
    ("agents card: QA SOPs + skill count",
     '{ k: "k-quality-assurance", v: "SOPs: k-test-coverage-review, k-code-review-workflow (shared with the developer). 10 skills —',
     '{ k: "k-quality-assurance", v: "SOPs: k-test-coverage-review. 12 skills —'),
    ("agents card: k-media-analyzer skills",
     "No SOPs. 1 skill \u2014 constraints only.",
     "No SOPs. 1 skill, constraints. It also declares humanize-writing, loaded on demand."),
    ("skills-per-agent table",
     '"rows":[{"k":"k-architect","v":"32"},{"k":"k-developer","v":"20"},{"k":"k-product-manager","v":"14"},{"k":"k-tpm","v":"14"},{"k":"konductor","v":"12"},{"k":"konductor-cmux-orchestrator","v":"11"},{"k":"konductor-mux-orchestrator","v":"11"},{"k":"k-quality-assurance","v":"10"},{"k":"k-researcher","v":"7"},{"k":"k-browser","v":"4"},{"k":"k-media-analyzer","v":"1"}]',
     '"rows":[{"k":"k-architect","v":"38"},{"k":"k-developer","v":"27"},{"k":"k-product-manager","v":"16"},{"k":"k-tpm","v":"14"},{"k":"konductor","v":"13"},{"k":"k-quality-assurance","v":"12"},{"k":"konductor-cmux-orchestrator","v":"10"},{"k":"konductor-mux-orchestrator","v":"10"},{"k":"k-researcher","v":"8"},{"k":"k-browser","v":"4"},{"k":"k-media-analyzer","v":"1"}]'),
    # at-a-glance cards
    ("card konductor", 'Coordinator. Delegates everything, implements nothing. claude-sonnet-5.5 · 13 skills · 11 SOPs',
     'Single writer. Does the work, reviews at each phase gate. claude-sonnet-5.5 · 22 skills · 11 SOPs'),
    ("card mux", 'Same, dispatching into tmux/zellij panes. claude-sonnet-5.5 · 10 skills · 10 SOPs',
     'Coordinator. Delegates every change, dispatching into tmux/zellij panes. claude-sonnet-5.5 · 10 skills · 10 SOPs'),
    ("card cmux", 'Same, dispatching into cmux surfaces. claude-sonnet-5.5 · 10 skills · 10 SOPs',
     'Coordinator. Delegates every change, dispatching into cmux surfaces. claude-sonnet-5.5 · 10 skills · 10 SOPs'),
    ("troubleshooting t-3: symptom names the mux orchestrators",
     'You asked konductor to implement something and it started editing files',
     'You asked konductor-mux-orchestrator or konductor-cmux-orchestrator to implement something and it started editing files'),
    ("troubleshooting t-3: only mux and cmux load the routing rules",
     'Only the three orchestrators load this file',
     'Only the mux and cmux orchestrators load this file'),
    ("card pm", 'Requirements, user stories, decision research. claude-sonnet-5.5 · 15 skills · 0 SOPs',
     'Requirements, user stories, decision research. claude-sonnet-5.5 · 16 skills · 0 SOPs'),
    ("card architect", 'System designs, APIs, data models, threat models. claude-sonnet-5.5 · 38 skills · 4 SOPs · aws-mcp',
     'System designs, APIs, data models, threat models. claude-sonnet-5.5 · 38 skills · 3 SOPs · aws-mcp'),
    ("card developer", 'Implementation, code review, git, builds. claude-sonnet-5.5 · 26 skills · 4 SOPs · aws-mcp',
     'Implementation, code review, git, builds. claude-sonnet-5.5 · 27 skills · 4 SOPs · aws-mcp'),
    ("card qa", 'Test coverage, E2E strategy, security tests. claude-sonnet-5.5 · 11 skills · 2 SOPs',
     'Test coverage, E2E strategy, security tests. claude-sonnet-5.5 · 12 skills · 1 SOP'),
    ("card researcher", 'External documentation and web research. claude-sonnet-5.5 · 7 skills · 0 SOPs',
     'External documentation and web research. claude-sonnet-5.5 · 8 skills · 0 SOPs'),
]


def apply_all(page, problems, edits=None):
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
    for label, old, new in (EDITS + ROSTER + SOP_EDITS if edits is None else edits):
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
        # Per-edit already-applied checks can't see two edits undoing each other.
        if not problems and apply_all(new, []) != new:
            failed = True
            again = [e[0] for e in EDITS + ROSTER + SOP_EDITS if apply_all(new, [], [e]) != new]
            print(f"  {rel}: NOT written — a second pass would change the result again; "
                  f"edit(s) still firing:")
            for label in again or ["(only in combination)"]:
                print(f"      - {label}")
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
        print("\nSome edits did not match or are not idempotent -- update EDITS.",
              file=sys.stderr)
        return 1
    if not args.apply:
        print("\nPreview only. Re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
