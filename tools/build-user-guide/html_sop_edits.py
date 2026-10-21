# SPDX-License-Identifier: Apache-2.0
"""The six SOPs added to the published guide, as exact-match HTML bundle edits.

Content mirrors docs/user-guide/sop-workflows/{design,testing-and-specs,orchestration}.md
and was derived from the SOP sources in agent-sops/. Structure, helper calls
(``param``/``node``) and styling all follow the page's existing conventions, so the
new sections render identically to the ones already there.

Imported by ``sync-html-content.py``; every entry is (label, old, new) and must
match exactly once.
"""

# `_ORCH_PAGE` and the three fragments that built it (`_FULL_SDLC`, `_SEARCH`,
# `_ABOUT`) used to live here and were never referenced: the "sop-orch page"
# entry below carries its own copy of that content. Two copies of the same page,
# one of them unused, had already drifted -- the dead one was missing
# `reply_channel_available` while the applied one had it. Deleted rather than
# wired up, since the applied entry is regenerated from the bundle when it goes
# stale and a second source would just diverge again.
# --- entries appended to existing pages ---------------------------------------
_PE_REVIEW = ''',
      { name: "k-principal-engineer-design-review", file: "agent-sops/k-principal-engineer-design-review.sop.md", owner: "k-architect",
        what: "Runs a pre-submission quality gate on a design document before it goes to a Principal Engineer. It combines slop detection, an architecture-principles evaluation, and an adversarial review loop, so the most common human review comments are already resolved by the time a person opens the document.",
        when: "A design document is finished and about to be sent for human review.",
        get: "A findings report at output_file covering the slop/quality gate, the architecture-principles evaluation, and every adversarial round, ordered CRITICAL → IMPORTANT → MINOR.",
        prompt: "Run the k-principal-engineer-design-review SOP. doc_input: docs/design/rate-limiting.md",
        params: [param("doc_input", true, "— a path to the design document, or the document content itself"), param("output_file", false, "<doc-name>-principal-engineer-review.md beside the input doc, or docs/design/principal-engineer-review.md when invoked without a path")],
        flowCaption: "k-principal-engineer-design-review: two gates, then a bounded adversarial loop.",
        flow: [
          node("00", "doc_input provided?", "ask once and wait", "gate"),
          node("01", "Load document", "", ""),
          node("02", "Quality gate", "design-quality-check — slop and quality detection", ""),
          node("03", "Architecture principles gate", "design-evaluation", ""),
          node("04", "Adversarial review loop", "adversarial-design-review + argumentation-reference fallacy check; max 5 rounds. Any CRITICAL architectural finding after round 2 stops the loop immediately \u2014 FUNDAMENTAL REDESIGN REQUIRED.", "decision"),
          node("05", "Write findings report", "", "")
        ],
        know: [
          { title: "Step 1 is a hard gate.", body: " The quality score is 1-5, and a score below 3 STOPS the SOP outright \u2014 it presents the issues and asks for a revision rather than proceeding to step 2." },
          { title: "The adversarial loop is bounded at 5 rounds.", body: " It exits early when 0 CRITICAL, 0 IMPORTANT and fewer than 3 MINOR findings remain. Hitting round 5 without converging exits with the outstanding findings rather than looping forever." },
          { title: "One finding can end the loop early.", body: " Any CRITICAL ARCHITECTURAL finding still present after round 2 stops the loop immediately and forces the FUNDAMENTAL REDESIGN REQUIRED verdict. A CRITICAL FACTUAL finding does not \u2014 a wrong technical claim is correctable by revision, so it yields REVISIONS NEEDED instead." },
          { title: "The report is headed by a verdict.", body: " PE-READY (quality score at least 3, 0 CRITICAL, 0 IMPORTANT, fewer than 3 MINOR), REVISIONS NEEDED, or FUNDAMENTAL REDESIGN REQUIRED. These strings are user-visible." },
          { title: "Three skills do the work:", body: " design-quality-check for the slop and quality gate, design-evaluation for architecture principles, and adversarial-design-review for the loop, with argumentation-reference checking the reasoning for fallacies." },
          { title: "It reviews one document, not a directory.", body: " For a set of design artifacts — system design, threat model, API specs, data models — use k-existing-design-review." }
        ] }'''

_E2E = ''',
      { name: "k-e2e-test-generation", file: "agent-sops/k-e2e-test-generation.sop.md", owner: "all three orchestrators",
        what: "Discovers a deployed web application through browser automation, then generates either structured markdown unit test prompts or executable Cypress / Playwright specs — bootstrapping a new test project or adding to an existing one.",
        when: "You have a deployed web app and want test coverage generated from what is actually live, rather than from reading the source. Not for unit-testing source logic, API-only testing, or apps behind non-browser authentication such as mTLS.",
        get: "With unit-prompts, markdown test-case files in prompts_dir. With cypress or playwright, an executable spec suite that has been run once and committed, plus a summary report.",
        prompt: "Run the k-e2e-test-generation SOP. url: https://staging.example.com output_mode: playwright project_mode: bootstrap",
        params: [param("url", true, "— unless credentials_file supplies test_url"), param("output_mode", true, "one of unit-prompts, cypress, playwright"), param("project_mode", true, "when output_mode is cypress or playwright — one of bootstrap, add-to-existing"), param("project_dir", true, "when project_mode is add-to-existing"), param("username / password", false, "— the password is never logged or displayed"), param("credentials_file", false, "— a .properties file with test_url, user_name, password"), param("prompts_dir", false, "{project_root}/tests/page/ — only used by unit-prompts"), param("scope_confirmed", false, "false — set true to skip the step 3 prompt; unattended callers MUST")],
        flowCaption: "k-e2e-test-generation: discovery, a scope gate, then one of two generation branches.",
        flow: [
          node("01", "Load credentials", "from parameters or credentials_file", ""),
          node("02", "Discover the application", "k-browser + dom-inspection", ""),
          node("03", "Confirm discovery scope", "skipped when scope_confirmed is true", "gate"),
          node("04", "Generate", "4A unit test prompts, or 4B functional tests (bootstrap / add-to-existing)", "decision"),
          node("05", "Validate generated tests", "functional modes only — the suite is run once", ""),
          node("06", "Commit generated tests", "functional modes only", ""),
          node("07", "Output summary report", "", "")
        ],
        know: [
          { title: "It uses Playwright's bundled Chromium,", body: " not your system Chrome. That is deliberate: it avoids the \\u0022Browser is already in use\\u0022 error when Chrome is already open on macOS." },
          { title: "scope_confirmed matters for automation.", body: " Left at its default, step 3 stops and waits. Any parallel or unattended caller must set it true." },
          { title: "Only the two functional modes validate and commit.", body: " unit-prompts writes prompt files and goes straight to the summary." }
        ] }'''

_LIGHT_UI = ''',
      { name: "k-light-ui-testing", file: "agent-sops/k-light-ui-testing.sop.md", owner: "all three orchestrators",
        what: "Discovers a deployed page, writes structured markdown test prompts for the features you describe, then executes those prompts live in the browser and reports pass/fail for each one.",
        when: "During development, when a page is not yet ready for full functional test generation. It gives immediate feedback on what works without requiring a test framework or any scaffolding.",
        get: "Markdown test prompts in output_dir and a pass/fail result per prompt, produced by actually driving the page.",
        prompt: "Run the k-light-ui-testing SOP. url: http://localhost:3000/settings features: the notification toggles and the save button",
        params: [param("url", true, "— unless credentials_file supplies test_url"), param("features", true, "— free text describing the features or flows to test"), param("username / password", false, "— the password is never logged or displayed"), param("credentials_file", false, "— a .properties file with test_url, user_name, password"), param("output_dir", false, "tests/page/"), param("scope_confirmed", false, "false — when true, steps 3 and 5 report and proceed instead of prompting")],
        flowCaption: "k-light-ui-testing: two confirmation gates, both governed by the same scope_confirmed flag.",
        flow: [
          node("01", "Load credentials", "", ""),
          node("02", "Discover the page", "k-browser + dom-inspection", ""),
          node("03", "Confirm discovery scope", "skipped when scope_confirmed is true", "gate"),
          node("04", "Write test prompts", "into output_dir", ""),
          node("05", "Review prompts", "skipped when scope_confirmed is true", "gate"),
          node("06", "Execute test prompts", "live in the browser", ""),
          node("07", "Report pass/fail per prompt", "", "good")
        ],
        know: [
          { title: "Both SOPs run what they produce \u2014 differently.", body: " k-e2e-test-generation builds a framework suite and runs it once in step 5 to validate it. This one writes plain-language prompts and executes them live against the page, reporting pass/fail per prompt, with no framework involved." },
          { title: "Two gates, one flag.", body: " scope_confirmed governs both step 3 and step 5." },
          { title: "Same Chromium note applies:", body: " Playwright's bundled browser, not system Chrome." }
        ] }'''

SOP_EDITS = [
    # NAV entry for the new page
    ("NAV: orchestration page",
     '["sop-test","Testing, analysis, specs"]]]',
     '["sop-test","Testing, analysis, specs"],["sop-orch","Orchestration and orientation"]]]'),
    # rewire the chain: sop-test -> sop-orch -> agents
    ("sop-test next link",
     'prev: ["sop-code", "Code review and cleanup"], next: ["agents", "Agents reference"],',
     'prev: ["sop-code", "Code review and cleanup"], next: ["sop-orch", "Orchestration and orientation"],'),
    ("agents prev link",
     'prev: ["sop-test", "Testing, codebase analysis, specs"], next: ["skills", "Skills catalog"],',
     'prev: ["sop-orch", "Orchestration and orientation"], next: ["skills", "Skills catalog"],'),
    ("sop-test intro",
     'intro: "The remaining three SOPs: a QA chain that ends in a release recommendation, a standalone architecture deep-dive, and the most interactive SOP in the package — three approval gates in a row.",',
     'intro: "Five SOPs: a QA chain that ends in a release recommendation, a standalone architecture deep-dive, the most interactive SOP in the package, and the two browser-driven SOPs that test a deployed page rather than source.",'),
    # the new page itself, inserted before sop-plan
    ("sop-orch page",
     "const SOP_PAGES = {\n  \"sop-plan\": {",
     "const SOP_PAGES = {\n  \"sop-orch\": {\n    eyebrow: \"ORCHESTRATION AND ORIENTATION\", title: \"Orchestration and orientation\",\n    intro: \"Three SOPs declared by all three orchestrators. They do not belong to one SDLC phase: one runs the whole lifecycle, one is a research amplifier you can call from anywhere, and one exists to orient a newcomer.\",\n    prev: [\"sop-test\", \"Testing, codebase analysis, specs\"], next: [\"agents\", \"Agents reference\"],\n    sops: [\n      { name: \"k-full-sdlc\", file: \"agent-sops/k-full-sdlc.sop.md\", owner: \"all three orchestrators\",\n        what: \"Takes a project or feature through the full lifecycle in twelve gated phases: intake elicitation, codebase analysis, requirements, design, principal-engineer design review, feature splitting, per-feature specs, implementation, code review and pull request, testing, documentation, and a final summary. Each phase delegates to an existing SOP where one covers the work, or spawns a specialist where none does.\",\n        when: \"You want something built end to end. For a single phase, run that phase's SOP directly instead.\",\n        get: \"One subdirectory per phase under output_dir (default .konductor/), plus a session state file under output_dir/sessions/. Implementation code is not written there — it follows the project's own structure.\",\n        prompt: \"Run the k-full-sdlc SOP. project_description: a URL shortener with per-user rate limits\",\n        params: [param(\"project_description\", true, \"—\"), param(\"codebase_path\", false, \"current directory — a resumed run MUST pass this explicitly\"), param(\"skip_phases\", false, \"none — comma-separated phase names\"), param(\"output_dir\", false, \".konductor/ — resolved to an absolute path at intake\"), param(\"elicitation_depth\", false, \"standard (10 questions); also quick (5) or deep (15)\"), param(\"max_fix_cycles\", false, \"2 — shared per feature across steps 7, 8 and 9\"), param(\"deployed_url\", false, \"— required for step 9's functional and UI test passes\"), param(\"credentials_file\", false, \"— forwarded to k-e2e-test-generation and k-light-ui-testing\"), param(\"feature_isolation\", false, \"branch; only worktree allows parallel feature work\"), param(\"reply_channel_available\", false, \"true — set false for a batch or CI run with no one to ask\")],\n        flowCaption: \"k-full-sdlc: twelve phases; steps 6-9 repeat per feature.\",\n        flow: [\n          node(\"00\", \"project_description provided?\", \"no reply channel → mark BLOCKED and stop\", \"gate\"),\n          node(\"01\", \"Intake\", \"resolve output_dir to an absolute path; mint or resume a session\", \"\"),\n          node(\"02\", \"Codebase analysis\", \"k-developer\", \"\"),\n          node(\"03\", \"Requirements\", \"k-product-manager\", \"\"),\n          node(\"04\", \"Design\", \"k-architect\", \"\"),\n          node(\"05\", \"Principal engineer design review\", \"k-architect\", \"\"),\n          node(\"06\", \"Feature splitting\", \"\", \"\"),\n          node(\"07\", \"Per feature: specs → implementation → code review → testing\", \"parallel only when feature_isolation is worktree, max 4\", \"decision\"),\n          node(\"08\", \"Documentation\", \"\", \"\"),\n          node(\"09\", \"Final summary\", \"\", \"\")\n        ],\n        know: [\n          { title: \"The orchestrator coordinates and never implements.\", body: \" Every phase runs in a subagent, routed by task rather than by step number. A design fix goes back to step 3, a code fix to step 7, a documentation fix to step 10 — never to whoever is closest.\" },\n          { title: \"Fix cycles are a shared budget.\", body: \" max_fix_cycles (default 2) is per feature for the whole run: steps 7, 8 and 9 draw from one count, so a feature with sticky findings cannot churn. Step 10 has its own run-level counter, because documentation validation is project-wide.\" },\n          { title: \"Parallelism requires worktrees.\", body: \" Features sharing one working directory run sequentially. With feature_isolation: worktree, up to four run at once. Phases themselves are always sequential.\" },\n          { title: \"Resuming is a pause point, not an assumption.\", body: \" An attended run reports the candidate session and waits for explicit confirmation. A resumed run must pass codebase_path explicitly — leaving it at its default resolves a fresh value and silently mints a new session instead.\" },\n          { title: \"Unattended runs must pass output_dir.\", body: \" With no reply channel the SOP stops at intake rather than sharing the default directory with another project.\" },\n          { title: \"Every default is an opinion.\", body: \" Ask for a different layout, extra README sections, or one pull request instead of per-feature, and the SOP follows the instruction and notes the deviation in step 11.\" }\n        ] },\n      { name: \"k-comprehensive-search\", file: \"agent-sops/k-comprehensive-search.sop.md\", owner: \"all three orchestrators\",\n        what: \"Activates search mode — it maximises search effort across the codebase and external documentation by spawning parallel search agents and synthesising their findings.\",\n        when: \"Finding a pattern or implementation in a codebase, hunting for external documentation, locating a specific file or configuration, or any research task that deserves more than one pass.\",\n        get: \"A Search Results Summary with a section per source — k-developer for the codebase, k-researcher for documentation — followed by consolidated key findings.\",\n        prompt: \"Run the k-comprehensive-search SOP. search_target: how retries are configured for the S3 client\",\n        params: [param(\"search_target\", true, \"—\"), param(\"search_scope\", false, \"both; also codebase or documentation\"), param(\"project_root\", false, \"current directory\")],\n        flowCaption: \"k-comprehensive-search: scope, fan out, synthesize.\",\n        flow: [\n          node(\"00\", \"search_target provided?\", \"ask once and wait\", \"gate\"),\n          node(\"01\", \"Identify search scope\", \"\", \"\"),\n          node(\"02\", \"Spawn search agents\", \"k-developer for codebase, k-researcher for documentation; both in parallel when scope is both\", \"decision\"),\n          node(\"03\", \"Synthesize results\", \"per-source findings, then consolidated key findings\", \"\")\n        ],\n        know: [\n          { title: \"It is a fan-out, not a grep.\", body: \" The value is in running two specialists with different tools against the same question and reconciling what they return.\" },\n          { title: \"search_scope: both is the default\", body: \" and spawns both agents in parallel.\" }\n        ] },\n      { name: \"about-konductor\", file: \"agent-sops/about-konductor.sop.md\", owner: \"all three orchestrators\",\n        what: \"Orients a new or lost user: what this package is, how to install the CLI, how to talk to the orchestrator in plain language, and what it can take on.\",\n        when: \"You would otherwise ask \\u0022what is this\\u0022, \\u0022how do I install it\\u0022, or \\u0022what can I ask it\\u0022 — or you want a tour before starting real work.\",\n        get: \"A spoken orientation rather than a file, scaled to your question if you asked one.\",\n        prompt: \"Run the about-konductor SOP.\",\n        params: [param(\"question\", false, \"none — a specific question such as \\u0022how do I install this\\u0022. Omitted, you get the general orientation\")],\n        flowCaption: \"about-konductor: establish the runtime first, because the answer differs by runtime.\",\n        flow: [\n          node(\"01\", \"Identify runtime\", \"Kiro CLI or Claude Code — the answer differs by runtime\", \"\"),\n          node(\"02\", \"Lead with the orchestrator, not the model\", \"\", \"\"),\n          node(\"03\", \"Answer from the live sources, not from memory\", \"\", \"\"),\n          node(\"04\", \"Hand off if the user is ready to work\", \"\", \"good\")\n        ],\n        know: [\n          { title: \"Step 1 is not a formality.\", body: \" The two runtimes surface SOPs and skills differently — /prompts versus /help, /<sop-name> versus /sop-<name> — so the answer itself differs by runtime, not just the command used to start a session.\" },\n          { title: \"It reads the live sources.\", body: \" Step 3 requires answering from what is actually installed rather than from a memorised description, which is what keeps this SOP correct as the package changes.\" },\n          { title: \"It is the one SOP whose output is a conversation\", body: \" rather than an artifact.\" }\n        ] }\n    ]\n  },\n  \"sop-plan\": {"),
    # glance table rows
    ("SOP_ROWS additions",
     '  { sop: "kiro-spec-workflow", what: "Chains three skills into a complete Kiro IDE spec", when: "You want requirements.md + design.md + tasks.md", page: "sop-test" }\n];',
     '  { sop: "kiro-spec-workflow", what: "Chains three skills into a complete Kiro IDE spec", when: "You want requirements.md + design.md + tasks.md", page: "sop-test" },\n'
     '  { sop: "k-principal-engineer-design-review", what: "Slop gate, architecture-principles gate, then a bounded adversarial loop", when: "A design doc is about to go to a human reviewer", page: "sop-design" },\n'
     '  { sop: "k-e2e-test-generation", what: "Discovers a deployed app, then generates unit-test prompts or Cypress/Playwright specs", when: "You have a running web app and want a test suite", page: "sop-test" },\n'
     '  { sop: "k-light-ui-testing", what: "Writes test prompts for a live page and immediately executes them", when: "Mid-development feedback, before a suite is worth building", page: "sop-test" },\n'
     '  { sop: "k-full-sdlc", what: "Twelve gated phases from intake to documentation, each delegated", when: "You want something built end to end", page: "sop-orch" },\n'
     '  { sop: "k-comprehensive-search", what: "Parallel codebase and documentation search, then synthesis", when: "A question that deserves more than one search pass", page: "sop-orch" },\n'
     '  { sop: "about-konductor", what: "Runtime-aware orientation, answered from the live sources", when: "What is this, and what can I ask it?", page: "sop-orch" }\n];'),
]

# Per-page entries, anchored on the closing `] }` of each page's current last SOP.
_DESIGN_TAIL = '{ title: "Only IMPORTANT issues is still READY.", body: "The SOP\'s troubleshooting states a design with only IMPORTANT issues remains ready for implementation." }\n        ] }'
_TEST_TAIL = '{ title: "The SOP notes it writes files,", body: "so an agent without write tools delegates that to a specialist per its routing rules." }\n        ] }'

SOP_EDITS += [
    ("sop-design: append k-principal-engineer-design-review",
     _DESIGN_TAIL, _DESIGN_TAIL + _PE_REVIEW),
    ("sop-test: append the two browser SOPs",
     _TEST_TAIL, _TEST_TAIL + _E2E + _LIGHT_UI),
    # page intro now covers three SOPs, not two
    ("sop-design intro",
     'intro: "Two SOPs, both declared by k-architect. One authors a design document; the other evaluates design artifacts that already exist. k-existing-design-review\'s own header marks it deprecated for design doc review',
     'intro: "Three SOPs, all declared by k-architect. One authors a design document, one evaluates design artifacts that already exist, and one runs a pre-submission gate on a document about to go to a human reviewer. k-existing-design-review\'s own header marks it deprecated for design doc review'),
]

# SOP ownership table + the CLI reference's SOP roster, from
# agents/*.agent-spec.json dependencies.agentSops.agentSopNames.
SOP_EDITS += [
    ("SOP_OWNERS konductor",
     '{ agent: "konductor", sops: "kiro-spec-workflow, k-delegate, k-plan, k-context-gathering, k-verify" }',
     '{ agent: "konductor", sops: "kiro-spec-workflow, k-delegate, k-plan, k-context-gathering, k-verify, k-light-ui-testing, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, about-konductor" }'),
    ("SOP_OWNERS mux",
     '{ agent: "konductor-mux-orchestrator", sops: "kiro-spec-workflow, k-plan, k-context-gathering, k-verify" }',
     '{ agent: "konductor-mux-orchestrator", sops: "kiro-spec-workflow, k-plan, k-context-gathering, k-verify, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, k-light-ui-testing, about-konductor" }'),
    ("SOP_OWNERS cmux",
     '{ agent: "konductor-cmux-orchestrator", sops: "kiro-spec-workflow, k-plan, k-context-gathering, k-verify" }',
     '{ agent: "konductor-cmux-orchestrator", sops: "kiro-spec-workflow, k-plan, k-context-gathering, k-verify, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, k-light-ui-testing, about-konductor" }'),
    ("SOP_OWNERS architect",
     '{ agent: "k-architect", sops: "k-design-doc-creation, k-existing-design-review, k-adversarial-pull-request-review" }',
     '{ agent: "k-architect", sops: "k-design-doc-creation, k-existing-design-review, k-principal-engineer-design-review, k-adversarial-pull-request-review" }'),
    ("rf-sops roster rows",
     '{"k":"k-test-coverage-review","v":"k-quality-assurance \u00b7 source_dir, test_dir"}',
     '{"k":"k-test-coverage-review","v":"k-quality-assurance \u00b7 source_dir, test_dir"},'
     '{"k":"k-principal-engineer-design-review","v":"k-architect \u00b7 doc_input"},'
     '{"k":"k-e2e-test-generation","v":"orchestrators \u00b7 url, output_mode (+ project_mode / project_dir for spec modes)"},'
     '{"k":"k-light-ui-testing","v":"orchestrators \u00b7 url, features"},'
     '{"k":"k-full-sdlc","v":"orchestrators \u00b7 project_description"},'
     '{"k":"k-comprehensive-search","v":"orchestrators \u00b7 search_target"},'
     '{"k":"about-konductor","v":"orchestrators \u00b7 none \u2014 question is optional"}'),
]

# Orchestrator permissions used to be patched here, one table row and one bullet
# at a time. All five entries are retired: they still read `allowedTools` as the
# capability boundary, which is the mistake the current pass corrects -- `tools`
# grants a capability subject to a prompt and `allowedTools` only pre-approves
# it. The whole passage is now owned by one group of edits in
# sync-html-content.py, and check-guide-facts.py derives the table from the
# specs, so a row cannot be wrong here without failing there.

# k-architect's model and skill count, in the agents page's own prose and tables.
SOP_EDITS += [
    ("agents bullet: architect model",
     "k-architect is the only agent on a different model (claude-opus-4.6) and carries 32 skills \u2014 nearly a third of the library.",
     "k-architect carries 37 skills \u2014 close to half the library, and by far the largest share of any agent. Every agent runs the same model, claude-sonnet-5."),
    ("specialists table: architect",
     '{ k: "k-architect", v: "claude-opus-4.6, the only agent not on Sonnet. SOPs: k-design-doc-creation, k-existing-design-review, k-adversarial-pull-request-review. 32 skills.',
     '{ k: "k-architect", v: "claude-sonnet-5, the model every agent runs. SOPs: k-design-doc-creation, k-existing-design-review, k-principal-engineer-design-review, k-adversarial-pull-request-review. 38 skills.'),
    ("specialists table: developer skills",
     '{ k: "k-developer", v: "SOPs: k-code-cleanup, k-pre-cr-critique, k-codebase-analysis, k-code-review-workflow. 19 skills',
     '{ k: "k-developer", v: "SOPs: k-code-cleanup, k-pre-cr-critique, k-codebase-analysis, k-code-review-workflow. 27 skills'),
]

# The "read-only dispatcher" framing: true of the Kiro CLI grants, not of Claude Code.
SOP_EDITS += [
    # "orchestrators: dispatcher framing" is retired -- its replacement text has
    # itself been rewritten, because "backed by narrow allowedTools" reads the
    # pre-approval list as if it were the capability list. Owned by
    # "ag-orch intent prose" in sync-html-content.py now.
    ("orchestrators: shell distinction",
     "That is why they need shell access while the plain orchestrator does not, and why they are the only orchestrators that can run commands.",
     "That is why they are granted shell in Kiro CLI while the plain orchestrator is not. In Claude Code the distinction disappears \u2014 all three declare Bash there."),
]

# Exit-code contract: the table listed only 0 and 64, and omitted 1, 2, 6, 65.
SOP_EDITS += [
    ("exit codes: full table",
     '"rows":[{"k":"0","v":"Success"},{"k":"64","v":"Usage error (EX_USAGE) \u2014 a bad flag, unknown command, missing argument, invalid value, or an invalid config"},',
     '"rows":[{"k":"0","v":"Success"},'
     '{"k":"1 (EXIT_HALTED)","v":"A command ran correctly and reported failure \u2014 today, doctor with one or more failed/stale checks"},'
     '{"k":"2","v":"RESERVED for the run-engine\'s unresolved-CRITICAL-gate signal. The run-engine is not yet built, so nothing emits 2 today \u2014 and a bad invocation never will"},'
     '{"k":"6 (EXIT_SUCCESS_WITH_WARNINGS)","v":"Everything the command was responsible for succeeded, but something peripheral did not \u2014 today, uninstall when a tracked --link-bin symlink could not be removed"},'
     '{"k":"64 (EXIT_USAGE_ERROR)","v":"Usage error (EX_USAGE) \u2014 a bad flag, unknown command, missing argument, invalid value, or an invalid config"},'
     '{"k":"65 (EXIT_VERIFY_FAILED)","v":"A verification failed \u2014 a checksum mismatch on a fetched install source, or an unsupported ~/.konductor/installs schema version"},'),
]

# CLI command table: install needs --harness, update is an unconditional overwrite,
# both update and uninstall gained --dry-run, and metrics (a stub) was missing entirely.
SOP_EDITS += [
    ("commands: install/update/uninstall rows",
     'konductor install","v":"Detect the runtime and register agents, skills, SOPs, and context files with it"},{"k":"konductor update","v":"Fetch the latest release and re-register it, preserving local modifications"},{"k":"konductor uninstall","v":"Deregister Konductor from the runtime"}',
     'konductor install","v":"Register agents, skills, SOPs and context files with the harness named by --harness (required \u2014 there is no auto-detection)"},{"k":"konductor update","v":"Unconditionally overwrite a tracked install in place from --from. There is no merge: local edits are clobbered. --dry-run previews, per path"},{"k":"konductor uninstall","v":"Remove a tracked install\'s files and its index entry. No confirmation prompt; --dry-run previews, per path"}'),
    ("commands: add metrics row",
     '{"k":"konductor synth","v":"Parse agents/, skills/, and agent-sops/ and write per-runtime output to <source>/dist/"}]',
     '{"k":"konductor synth","v":"Parse agents/, skills/, and agent-sops/ and write per-runtime output to <source>/dist/"},{"k":"konductor metrics","v":"Quality trends from recent runs \u2014 a STUB in this release; it prints \'not yet implemented\'"}]'),
]

# The update/uninstall TASK pages: hand-written blocks that promised local edits
# were preserved and that uninstall asks for confirmation. Both are false against
# cli/README.md -- update is an unconditional overwrite, and uninstall proceeds
# directly with no prompt of any kind.
SOP_EDITS += [
    ("update task: sample output",
     "Installed 0.1.0, latest 0.1.2\n\nUpdating Konductor\n  agents          11 updated\n  skills          75 updated (2 new)\n  SOPs            13 updated\n  context files    1 updated\n\nPreserved 1 locally modified file:\n  skills/backend-review/SKILL.md\n\nUpdated to 0.1.2. Start a new session to pick up the changes.",
     "Updating Konductor\n  agents          11 updated\n  skills          82 updated\n  SOPs            19 updated\n  context files    1 updated\n\n2 files were overwritten while diverged from the manifest.\n\nUpdated. Start a new session to pick up the changes."),
    ("update task: locally-modified row",
     "Your files are kept. The release version is not applied to them.",
     "OVERWRITTEN. The count of clobbered files is reported afterwards; run --dry-run first to see which."),
    ("uninstall task: sample output",
     "This will remove Konductor 0.1.0 from Kiro CLI:\n  agents          11\n  skills          75\n  SOPs            13\n  context files    1\n\nProject files under .konductor/ will be left in place.\n\nContinue? [y/N]",
     "Would remove Konductor 1.0.0 from Kiro CLI:\n  agents          11\n  skills          82\n  SOPs            19\n  context files    1\n\n  skills/backend-review/SKILL.md   (local edits would be destroyed)\n\nProject files under .konductor/ would be left in place."),
    ("uninstall task: prompt prose",
     'Answer <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">y</span> and it reports <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">Removed. Project files under .konductor/ were left in place.</span> Exit code <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">0</span>. Answering anything else cancels and changes nothing. To skip the prompt in a script:',
     'That was <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">--dry-run</span>, which touches the filesystem in no way at all and flags each path whose content has diverged from the manifest. <strong style="color:var(--tx);font-weight:600">A real run has no confirmation prompt</strong> \u2014 it proceeds directly and reports <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">Removed. Project files under .konductor/ were left in place.</span> with exit code <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">0</span>. To remove it for real:'),
]

# Install samples: --harness is required and there is no destination auto-detection,
# so the "Detected runtime:" banner never appears. cli/README.md: "There is no default
# and no destination-marker auto-detection -- every install invocation must say
# explicitly which harness it means."
SOP_EDITS += [
    # Retired with its Claude-page twin below: every invented install transcript is
    # out of the guide, so neither edit has a target left.
    # The "install sample: claude banner + counts" edit that was here fixed a stale
    # install transcript on the Claude page. Every invented install transcript has
    # since been removed from the guide at a reviewer's request, so it has no
    # target. Package totals are asserted from the hero banner, the stat tiles and
    # the layout tree instead of from a transcript.
    ("install command blocks: add --harness",
     'overflow-x:auto">konductor install</pre>',
     'overflow-x:auto">konductor install --harness kiro-cli-v2</pre>'),
]


# `doctor` output samples, which use a different column width from the install
# samples and so were not covered by those edits. Two widths appear in the page.
SOP_EDITS += [
]

# The home page hero: the stat tiles and the install snippet under them. The tiles
# render the number and its label as separate spans, so a "75 skills" text search
# never sees them; the snippet's banner is lowercase and also claims an install
# command with no --harness.
SOP_EDITS += [
    ("hero tile: skills",
     '>75</span>\n            <span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;letter-spacing:.16em;color:var(--mu2)">SKILLS</span>',
     '>82</span>\n            <span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;letter-spacing:.16em;color:var(--mu2)">SKILLS</span>'),
    ("hero tile: SOPs",
     '>13</span>\n            <span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;letter-spacing:.16em;color:var(--mu2)">SOPS</span>',
     '>19</span>\n            <span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;letter-spacing:.16em;color:var(--mu2)">SOPS</span>'),
    ("hero snippet: banner",
     "detected runtime: {{ runtimeLabel }}<br>agents 11 · skills 75 · SOPs 13 · context 1",
     "harness: {{ harnessFlag }}<br>agents 11 · skills 82 · SOPs 19 · context 1"),
    ("runtime binding: harnessFlag",
     'runtimeLabel: kiro ? "KIRO CLI" : "CLAUDE CODE",',
     'runtimeLabel: kiro ? "KIRO CLI" : "CLAUDE CODE",\n      harnessFlag: kiro ? "kiro-cli-v2" : "claude",'),
]

# Per-command flags, from cli/konductor-rs/src/cli.rs. The table had install/synth
# on a --local flag that does not exist, claimed update and doctor take no flags,
# and offered an uninstall --yes for a confirmation prompt that was removed.
SOP_EDITS += [
    ("per-command flags table",
     "\"rows\":[{\"k\":\"install --local <PATH>\",\"v\":\"path · no · install into this repository root instead of the current directory\"},{\"k\":\"update\",\"v\":\"— · takes no command-specific flags\"},{\"k\":\"uninstall --yes\",\"v\":\"flag · no · skip the confirmation prompt\"},{\"k\":\"doctor\",\"v\":\"— · takes no command-specific flags; honours --json\"},{\"k\":\"init --preset <PRESET>\",\"v\":\"enum · no · solo, team, org\"},{\"k\":\"init --force\",\"v\":\"flag · no · overwrite an existing .konductor/ instead of failing\"},{\"k\":\"synth --local <PATH>\",\"v\":\"path · no · synthesize this source tree instead of the current directory. Output goes to <PATH>/dist/\"}",
     "\"rows\":[{\"k\":\"install --harness <NAME>\",\"v\":\"enum · YES · kiro-cli-v2, kiro-v3, claude. No default and no auto-detection\"},{\"k\":\"install --from <PATH>\",\"v\":\"path · no · install from a local repo root with already-synthed content instead of fetching a release. A maintainer path — the documented workflows all install from a release\"},{\"k\":\"install --target <DIR>\",\"v\":\"path · no · destination; defaults to $HOME\"},{\"k\":\"install --link-bin\",\"v\":\"flag · no · symlink konductor into $HOME/.local/bin\"},{\"k\":\"install --no-telemetry\",\"v\":\"flag · no · suppress telemetry for this invocation\"},{\"k\":\"install --use-github-token\",\"v\":\"flag · no · authenticate the release fetch with a GitHub token\"},{\"k\":\"update --from <PATH>\",\"v\":\"path · no · source repo root. No default — pass it every time\"},{\"k\":\"update --target <DIR> / --all\",\"v\":\"path / flag · no · which tracked install(s) to update; mutually exclusive\"},{\"k\":\"update --dry-run\",\"v\":\"flag · no · report what would be overwritten, per path, flagging local edits. Writes nothing\"},{\"k\":\"uninstall --target <DIR> / --all\",\"v\":\"path / flag · no · which tracked install(s) to remove; mutually exclusive\"},{\"k\":\"uninstall --dry-run\",\"v\":\"flag · no · report what would be removed, per path, flagging local edits. Writes nothing\"},{\"k\":\"doctor --from <PATH> / --target <DIR> / --all\",\"v\":\"path / path / flag · no · what to check; --all conflicts with the other two. Honours --json\"},{\"k\":\"init --preset <PRESET>\",\"v\":\"enum · no · solo, team, org\"},{\"k\":\"init --force\",\"v\":\"flag · no · overwrite an existing .konductor/ instead of failing\"},{\"k\":\"synth --from <PATH>\",\"v\":\"path · no · synthesize this source tree instead of the current directory. Output goes to <PATH>/dist/\"},{\"k\":\"metrics --since <WINDOW>\",\"v\":\"string · no · limit the report to a time window. metrics is a STUB in this release\"}"),
]

# Remaining --local / --yes usages outside the flags table: the install task page's
# command block, synth's prose and code samples, and uninstall's scripted example.
# cli.rs: Synth takes --from; Install takes --target; Uninstall has no --yes.
SOP_EDITS += [
    ("install task: --local -> --target",
     "konductor install --local /path/to/your-project",
     "konductor install --harness kiro-cli-v2 --target /path/to/your-project"),
    ("synth samples: --local -> --from",
     "konductor synth --local /path/to/konductor",
     "konductor synth --from /path/to/konductor"),
    ("synth bullet: --local -> --from",
     "so --local <dir> writes to <dir>/dist/.",
     "so --from <dir> writes to <dir>/dist/."),
    ("synth prose: --local -> --from",
     "To synthesize a tree other than the current directory, pass --local.",
     "To synthesize a tree other than the current directory, pass --from."),
    ("uninstall: --yes does not exist",
     "konductor uninstall --yes",
     "konductor uninstall"),
]

# Quick Start's Claude Code aside: there is no runtime detection (--harness is
# required) and Claude Code does not prefix agent names -- dist/claude/agents/*.md
# carry the bare name.
SOP_EDITS += [
    ("quick start: claude aside",
     "If you have Claude Code instead, the detected runtime and the final command differ \u2014 Claude Code prefixes agent names, and needs two settings before a team of agents can run.",
     "If you have Claude Code instead, pass --harness claude. Agent names are the same on both runtimes, but Claude Code needs two further settings before a team of agents can run."),
]

SOP_EDITS += [
    # Spent: the prefix sentences these edits produced have since been removed
    # from the guide entirely, so neither their `old` nor their `new` exists any
    # more and they can never fire again.
]


# The Claude Code install page's own command block: --harness claude, not
# kiro-cli-v2. Anchored through the output that follows it, because the command
# line itself is identical on the Kiro page. This span is captured from the page
# as the EARLIER edits leave it, so it must stay last: it assumes the "Detected
# runtime" banner is already gone and the counts already updated.
SOP_EDITS += [
    # The "install command: claude page" edit that was here fixed a Kiro command
    # left on the Claude page. Both its old and new text are gone now: the mock
    # OUTPUT panel it anchored on was removed, and `--from` came out of every
    # documented install. The correct command on that page is asserted instead by
    # the install-page edits further down, plus section 17's --harness check.
]

# ── Reviewer findings: claims the HTML shares with the Markdown ────────────────
# Each verified against a primary source before being written here.
SOP_EDITS += [
    # update is an unconditional overwrite (cli/README.md §update; cli.rs Update doc comment)
    ("update: install-kiro row",
     "update</span> preserves local modifications and names the files it skipped.",
     "update</span>, by contrast, <strong style=\"color:var(--tx);font-weight:600\">overwrites it</strong> \u2014 run konductor update --dry-run to see what would be lost."),
    ("update: state table row",
     "Updates content, preserves local modifications, names what it skipped.",
     "OVERWRITES content, including any local edits. The diverged-file count is reported afterwards; --dry-run lists them per path beforehand."),
    ("update: faq bullet",
     "konductor update preserves local modifications and names the files it skipped, so your edits survive an update \u2014 but commit them anyway so you can tell what you changed.",
     "konductor update DESTROYS local modifications \u2014 it unconditionally overwrites every tracked file under .kiro/agents/, .konductor/skills/ and .konductor/manifest. Commit your edits, and run konductor update --dry-run before every update to see what would be clobbered."),
    ("update: preserved callout heading",
     ">Local modifications are preserved</div>",
     ">Local modifications are overwritten</div>"),
    ("update: preserved callout body",
     "update</span> names every file it skipped so you know what is now diverged",
     "update</span> reports only a count, after the fact. Run --dry-run first to see which files are diverged"),
    ("update: page intro",
     "Moves your installed agents, skills, and SOPs to the latest release, keeping any local modifications you have made.",
     "Overwrites a tracked install in place from a source tree. Any local edit under the managed destinations is destroyed \u2014 read the warning below before running it."),
    ("update: troubleshooting note",
     "If you want your edits to survive future updates, note that konductor update preserves locally modified files and names the ones it skipped.",
     "Your edits will NOT survive the next konductor update \u2014 it overwrites every tracked file unconditionally. Keep them in version control, and run konductor update --dry-run first to see which files would be clobbered."),
    # The quick-start and install-kiro orchestrator claims were patched here and
    # are retired: both replacements said "genuinely read-only" / "genuinely
    # cannot write", which is the same misreading of `allowedTools`. Owned by
    # "qs checkpoint permission prose" and "ik success permission prose".
    # specialists do talk to each other (toolsSettings.subagent.availableAgents)
    ("concepts: specialists never talk",
     "is a hub. Specialists never talk to each other; every piece of work routes through the orchestrator",
     "is a hub \u2014 though not an exclusive one. In Kiro CLI four specialists can also spawn each other directly (k-architect \u2192 developer and QA; k-developer \u2192 QA; k-quality-assurance \u2192 developer and browser; k-tpm \u2192 developer and researcher), and in Claude Code k-architect and k-quality-assurance carry Agent(...) tools of their own. In the common case, though, work routes through the orchestrator"),
    # k-e2e-test-generation step 5 also runs its suite
]

SOP_EDITS += [
    # konductor's delegation is an explicit 8-name allowlist, not "unrestricted"
    ("delegation: usecase prose",
     "it is the one agent built to coordinate across all three SOPs in one pass, and the only one with unrestricted delegation.",
     "it is the one agent built to coordinate across all three SOPs in one pass, and the one with the widest delegation reach \u2014 an explicit allowlist of all eight specialists."),
    ("delegation: konductor row",
     '{ k: "konductor", v: "any agent (unrestricted) \u00b7 the 8 specialists via Agent(...), plus SendMessage" }',
     '{ k: "konductor", v: "the 8 specialists (an explicit allowlist, not anything) \u00b7 the same 8 via Agent(...), plus SendMessage" }'),
    ("delegation: k-architect row",
     '{ k: "k-architect", v: "k-developer, k-quality-assurance \u00b7 nothing" }',
     '{ k: "k-architect", v: "k-developer, k-quality-assurance \u00b7 k-developer, k-quality-assurance via Agent(...)" }'),
    ("delegation: k-quality-assurance row",
     '{ k: "k-quality-assurance", v: "k-developer \u00b7 nothing" }',
     '{ k: "k-quality-assurance", v: "k-developer, k-browser \u00b7 k-developer, k-browser via Agent(...)" }'),
    ("delegation: orchestrators bullet",
     "it is the only agent with unrestricted delegation, and the only one that declares k-delegate.",
     "it has the widest delegation reach \u2014 an explicit allowlist of all eight specialists \u2014 and is the only one that declares k-delegate."),
    ("delegation: glossary",
     "An empty list means the agent holds the subagent tool but can spawn nothing. Only konductor is unrestricted.",
     "An empty list means the agent holds the subagent tool but can spawn nothing. konductor's list is the widest, naming all eight specialists."),
    ("delegation: claude-only caption",
     "Agent(...) tool at all.\"],",
     "Agent(...) tool at all. In Claude Code, k-architect and k-quality-assurance carry Agent(...) tools too, so delegation there is not konductor-only.\"],"),
    # k-browser's kiroCli.allowedTools has 13 @playwright-mcp entries
    ("k-browser tool count",
     "the Kiro CLI allowedTools enumerates 12 specific browser tools: snapshot, screenshot, console messages, network requests, tabs, navigate, navigate back, wait for, click, type, select option, press key.",
     "the Kiro CLI allowedTools enumerates 13 specific browser tools: snapshot, screenshot, console messages, network requests, tabs, navigate, navigate back, wait for, click, type, select option, press key, close."),
    # counts
    ("concepts tree: skills/sops counts",
     "skills/ \u2014 75 modules</span>\n                      <span style=\"font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--mu)\">agent-sops/ \u2014 13 procedures",
     "skills/ \u2014 82 modules</span>\n                      <span style=\"font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--mu)\">agent-sops/ \u2014 19 procedures"),
    ("concepts grid: skills count",
     ">75 modules</span>",
     ">82 modules</span>"),
    ("home: on-demand modules",
     "<div>11 agents with scoped tools and 75 on-demand knowledge modules.</div>",
     "<div>11 agents with scoped tools and 82 on-demand knowledge modules.</div>"),
    # pr_url is context-only (agent-sops/k-adversarial-pull-request-review.sop.md:15)
    ("pr_url: flow gate",
     'node("00", "diff_input OR pr_url given?", "If neither, the SOP asks for one and waits. It will not ask for output_file.", "gate")',
     'node("00", "diff_input given?", "pr_url does not substitute \u2014 the SOP asks for diff_input even when pr_url is present. It will not ask for output_file.", "gate")'),
    ("pr_url: param description",
     'given, step 0 fetches the diff and linked docs")',
     'given, step 0 reads it for linked issues and design docs \u2014 never for the diff, which auto-fetch does not support")'),
    # install does no version comparison
    ("install: same-version row",
     "Reports that the installed version is current and makes no changes.",
     "Overwrites the tracked files from --from. install does no version comparison \u2014 it has no notion of a \"same\" or \"older\" version."),
]

# doctor's real output: six checks named source/runtime/manifest/config/
# container_runtime/index_status (cli/README.md §doctor; string literals in
# cli/konductor-rs/src/cli/doctor.rs). The page invented Runtime/Content/Project/
# Updates sections, an installed-vs-available version comparison the README says
# doctor does not do, Claude Code environment checks it explicitly does not do,
# and rows for SOPs and context files, which install never writes.
SOP_EDITS += [
    # Same for "doctor: wide kiro block": the wide doctor transcript it rewrote is
    # gone with the rest of the mock CLI output.
    # The "doctor: claude block" edit that was here replaced the Claude install
    # page's stale doctor transcript. That whole mock transcript has since been
    # removed from both install pages at a reviewer's request, so the edit has no
    # target left. The quick-start and diagnose-problems samples are the ones the
    # doctor-check names are now asserted against.
    ("doctor: narrow block", 'Runtime\n  Kiro CLI            detected (0.4.2)     ok\nContent\n  agents              11 registered        ok\n  skills              75 registered        ok\n  SOPs                13 registered        ok\n  context files        1 registered        ok\nProject\n  .konductor/config.yml valid (version 1)  ok\nUpdates\n  installed 0.1.0, latest 0.1.0            ok\n\nAll checks passed.', 'source             parsed, refs resolve     ok\nruntime            Kiro CLI detected        ok\nmanifest           complete, no drift       ok\nconfig             config.yml valid         ok\ncontainer_runtime  docker on PATH         info\nindex_status       matches manifest         ok\n\nAll checks passed.'),
]

SOP_EDITS += [
    ("doctor: broken-state block", 'Runtime\n  Claude Code       detected (2.1.174)  stale\n    Agent teams needs 2.1.178 or later.\n  agent teams enabled  not set        failed\n    Run: claude settings set env.CLAUD…\n  tool permissions  no allowlist      failed\n    Add a permissions.allow block\nProject\n  .konductor/config.yml not found      info\n    Optional. Run `konductor init`.\nUpdates\n  installed 0.1.0, latest 0.1.2       stale\n    Run: konductor update\n\n3 checks failed.', 'source             agent k-developer references a missing skill   failed\n    fix: add the skill under skills/, or remove the reference\nruntime            no runtime detected at this target          failed\n    fix: install Kiro CLI or Claude Code, or pass --target\nmanifest           4 files differ from their recorded hash       warn\n    fix: run konductor update --from <repo-root> --dry-run\nconfig             .konductor/config.yml not found              info\n    fix: optional. Run `konductor init` to create one.\ncontainer_runtime  none of docker/podman/nerdctl/finch on PATH  info\nindex_status       index says complete, manifest says partial    warn\n\n2 checks failed.'),
    ("doctor: standalone updates block", 'Updates\n  installed 0.1.0, latest 0.1.2                             stale\n    Run: konductor update', 'manifest           complete, no hash drift                     ok\nindex_status       matches the manifest                        ok'),
]

SOP_EDITS += [
    ("update: already-current claim",
     "If you are already current: <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">Installed 0.1.2, latest 0.1.2 \u2014 already up to date.</span> Exit code",
     "update does not detect \u0022already current\u0022 \u2014 it has no version awareness. Running it against an unchanged source overwrites every tracked file with byte-identical content and reports the same counts. Exit code"),
]

# synth writes dist/<harness>/{agents,skills,sops,context}; the harness directory is
# kiro-cli-v2, not "kiro". agents/ also holds _skill_scopes.json and _sop_scopes.json,
# so a bare `ls | wc -l` there reports 13, not 11.
SOP_EDITS += [
    ("synth path: dist/kiro -> dist/kiro-cli-v2", "dist/kiro/agents", "dist/kiro-cli-v2/agents"),
    ("synth: agent-count caveat",
     "Silence plus 11 files in dist/kiro-cli-v2/agents/ means everything parsed.",
     "Silence plus 11 agent JSONs in dist/kiro-cli-v2/agents/ means everything parsed. (That directory also holds _skill_scopes.json and _sop_scopes.json, so a bare ls | wc -l reports 13.)"),
]

# The adversarial SOP's real structure (agent-sops/k-adversarial-pull-request-review.sop.md):
# a coordinator, three PARALLEL k-developer generator subagents, a fourth for reuse, then a
# checker phase k-architect runs itself. The page showed four sequential in-agent passes and
# omitted steps 0.5 and 5, both of which are permanent no-ops here.
SOP_EDITS += [
    ("adversarial: flow nodes", "node(\"01\", \"Context ramp-up\", \"Fetches the PR diff if only pr_url was given, reads linked issues (max 3) and referenced design docs (max 3), and searches the codebase for existing patterns \u2014 error mapping, transactions, validation, pagination. One pass per source, no recursive following, never blocks on missing context.\", \"\"),\n          node(\"02\", \"Ingest diff\", \"Excludes binaries, lock files, build artifacts, .js.map; reports file count and lines changed. Stops if the diff is empty.\", \"stop\"),\n          node(\"03\", \"Pass 2 \u2014 Security\", \"Error and log information disclosure, API input leaks, pagination token injection, abstraction violations. CRITICAL when stack traces, internal IDs, or raw exceptions reach a caller, or unvalidated input lands in a query.\", \"\"),\n          node(\"04\", \"Pass 3 \u2014 Data integrity\", \"Partial writes, unconditional overwrites, missing conditional writes, untested write paths. CRITICAL for a multi-item mutation with no transaction, or an unconditional overwrite on a contested resource.\", \"\"),\n          node(\"05\", \"Pass 4 \u2014 Schema / validation\", \"Missing map guards, missing standalone fields, validate-then-act ordering, integration wiring. IMPORTANT for ordering violations and wiring gaps. Never flags test files.\", \"\"),\n          node(\"06\", \"Pass 5 \u2014 Codebase awareness\", \"Flags inline reimplementation of an existing shared utility as IMPORTANT.\", \"\"),\n          ", "node(\"01\", \"Context ramp-up\", \"Reads pr_url for linked issues (max 3) and referenced design docs (max 3) \u2014 never for the diff \u2014 and searches the codebase for existing patterns: error mapping, transactions, validation, pagination. One pass per source, no recursive following, never blocks on missing context.\", \"\"),\n          node(\"0.5\", \"Load prior review state\", \"ALWAYS SKIPPED on this package \u2014 a documented no-op. Recorded as 'historical filtering unavailable', never as 'no prior revisions'.\", \"skip\"),\n          node(\"02\", \"Ingest diff\", \"Excludes binaries, lock files, build artifacts, .js.map; reports file count and lines changed. Stops if the diff is empty.\", \"stop\"),\n          node(\"03\", \"Parallel review passes\", \"Spawns k-developer THREE times concurrently, each loading exactly one pass skill \u2014 adversarial-code-review-pass-security, -integrity, -schema \u2014 each receiving the diff plus the step 0 summary. Findings are never shared between them.\", \"\"),\n          node(\"04\", \"Reuse pass\", \"A FOURTH k-developer spawn, looking only for cross-pass reuse: an existing utility the diff reimplements or bypasses, or one that would resolve two or more of the findings. IMPORTANT for a bypassed shared utility, transaction helper, validation middleware, error-mapping layer, or pagination utility.\", \"\"),\n          node(\"05\", \"Checker phase\", \"k-architect switches roles and runs adversarial-code-review in Validator Mode itself, tagging every finding KEEP or REJECT with a reason and dropping the REJECTs. It proposes nothing new \u2014 it is a filter. Independence holds because the coordinator never ran a generator pass.\", \"\"),\n          node(\"06\", \"Historical filter\", \"ALWAYS SKIPPED on this package, for the same reason as step 0.5. Findings pass through unchanged.\", \"skip\"),\n          "),
    ("adversarial: invoker",
     "Typically the orchestrator invokes it by spawning k-architect in adversarial mode as the checker in a maker-checker cycle.",
     "Only k-architect declares this SOP \u2014 k-developer and the three orchestrators do not, so none of them invokes it directly. k-architect acts as the coordinator: it spawns the generator subagents and then runs the checker phase itself, which is what keeps generator and checker independent."),
    ("adversarial: reference roster params",
     '{"k":"k-adversarial-pull-request-review","v":"k-architect \u00b7 diff_input or pr_url"}',
     '{"k":"k-adversarial-pull-request-review","v":"k-architect \u00b7 diff_input (always; pr_url is context-only)"}'),
]

# Remaining pass-2 reviewer findings, verified against source before writing here.
SOP_EDITS += [
    # install/claude.rs copies agent files verbatim -- no prefix is applied
    # k-full-sdlc implements/commits; k-e2e-test-generation commits its suite
    ("use-case: only-SOP-in-package claim",
     "is the only SOP in the entire package that changes your source files in place. Everything else here writes report files next to your code.",
     "is the only SOP on this page that changes your source files in place; everything else here writes report files next to your code. Elsewhere in the package, k-full-sdlc implements and commits per feature, and k-e2e-test-generation commits the suite it generates."),
    # k-architect and k-quality-assurance both hold Agent(...) in Claude Code
    ("use-case: claude spawn claim",
     "have no cross-agent spawn capability there, period.",
     "cannot reach the architect there: k-developer has no Agent(...) tool at all, and k-quality-assurance's names k-developer and k-browser. (k-architect and k-quality-assurance do hold Agent(...) tools, so delegation in Claude Code is not orchestrator-only.)"),
    # seven SOPs have no use-case walkthrough
    ("use-case: walkthrough coverage",
     "One SOP has no walkthrough here yet: ",
     "These four pages walk 11 of the 19 SOPs. Seven have no walkthrough here yet — k-principal-engineer-design-review, k-e2e-test-generation, k-light-ui-testing, k-full-sdlc, k-comprehensive-search, about-konductor, and "),
    # skills/mux-dispatch/ holds five .sh files
    ("skills: mux-dispatch script count", "Ships four shell scripts", "Ships five shell scripts"),
    # orchestrators declare 10/9/9 SOPs
    ("sop-plan: page intro",
     "intro: \"The four SOPs declared by the orchestrators.",
     "intro: \"Four of the SOPs the orchestrators declare."),
    # The "konductor cannot write in Kiro CLI" claim was patched here and is
    # retired -- it cannot write *silently*, which is a different statement.
    # Owned by "dx capability prose".
]

# plan-and-verify-work's copy of the orchestrator capability claim was patched
# here and is retired for the same reason as the rest of this group. Owned by
# "uc owned-by prose".

# ── HTML-parity audit findings ────────────────────────────────────────────────
# Claims that lived only in the HTML, or that the earlier passes missed there.
# `asdlc-*` as a literal glob is deliberately NOT in naming.py's map (that map
# renames whole agent names), so the rename pass could never reach these.
SOP_EDITS += [
    ("asdlc-* specialists (kiro verify)",
     'asdlc-*</span> specialists — developer, architect, quality-assurance, researcher, product-manager, tpm, browser, media-analyzer.',
     'k-*</span> specialists — k-developer, k-architect, k-quality-assurance, k-researcher, k-product-manager, k-tpm, k-browser, k-media-analyzer.'),
    ("asdlc-* specialists (install page)",
     'asdlc-*</span> specialists: developer, architect, quality-assurance, researcher, tpm, product-manager, browser, media-analyzer.',
     'k-*</span> specialists: k-developer, k-architect, k-quality-assurance, k-researcher, k-tpm, k-product-manager, k-browser, k-media-analyzer.'),
    ("asdlc-* specialists (checklist)",
     'lists <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">asdlc-*</span> specialists.',
     'lists <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">k-*</span> specialists.'),
    ("contributing: agent-name convention",
     '{ k: "Agent names", v: "asdlc- prefix" }',
     '{ k: "Agent names", v: "k- prefix for specialists; konductor for the orchestrator" }'),
]

# The real --json shape is cli/README.md:597-620: command/ok/warnings/checks[].
# The page invented runtime/content/project/updates objects and a `failed` count,
# with 75/13 counts and a version comparison doctor does not perform.
SOP_EDITS += [
    ("doctor --json schema", '{\n  "runtime": { "name": "kiro-cli", "version": "0.4.2", "status": "ok" },\n  "content": { "agents": 11, "skills": 75, "sops": 13, "context": 1, "status": "ok" },\n  "project": { "config": ".konductor/config.yml", "status": "ok" },\n  "updates": { "installed": "0.1.0", "latest": "0.1.0", "status": "ok" },\n  "failed": 0\n}', '{\n  "command": "doctor",\n  "ok": true,\n  "warnings": false,\n  "checks": [\n    { "name": "source", "status": "ok", "summary": "..." },\n    { "name": "runtime", "status": "ok", "summary": "..." },\n    { "name": "manifest", "status": "ok", "summary": "..." },\n    { "name": "config", "status": "ok", "summary": "..." },\n    { "name": "container_runtime", "status": "info", "summary": "..." },\n    { "name": "index_status", "status": "ok", "summary": "..." }\n  ]\n}'),
    ("doctor --json prose",
     "failed</span> rather than the exit code if you want to distinguish a real problem from a usage error \u2014 both exit non-zero.",
     "ok</span> rather than the exit code if you want to distinguish a real problem from a usage error: it is false when any check is failed or stale. doctor exits 1 (EXIT_HALTED) for that, and 64 only for a bad invocation."),
    # cli/README.md:628 -- doctor exits 1 (EXIT_HALTED) on a failed check, not 64
    ("doctor: broken-sample exit code", "BROKEN \u00b7 EXIT 64", "BROKEN \u00b7 EXIT 1"),
    ("doctor: exits-64 claim",
     "konductor doctor also exits 64 when a check fails \u2014 if you are scripting, use --json and read the failed count to tell a real problem from a typo.",
     "konductor doctor exits 1 (EXIT_HALTED) when a check is failed or stale, never 64 \u2014 64 is reserved for a bad invocation. If you are scripting, use --json and read ok to tell a real problem from a typo."),
]

# The "three orchestrators" reference block was entirely pre-correction: every
# figure contradicted the At-a-glance table 50 lines above it on the same page.
# Values from agents/konductor*.agent-spec.json.
SOP_EDITS += [
    ("orchestrators: konductor SOPs",
     '{ k: "konductor SOPs", v: "kiro-spec-workflow, k-delegate, k-plan, k-context-gathering, k-verify" }',
     '{ k: "konductor SOPs (10)", v: "kiro-spec-workflow, k-delegate, k-plan, k-context-gathering, k-verify, k-light-ui-testing, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, about-konductor" }'),
    ("orchestrators: konductor skills",
     '{ k: "konductor skills (9)", v: "constraints, delegation-protocol, agents-md-authoring, claude-teams-behavior, pre-planning-analysis, socratic-elicitation, verification, persistent-memory, workspace-skills" }',
     '{ k: "konductor skills (13)", v: "constraints, delegation-protocol, agents-md-authoring, claude-teams-behavior, pre-planning-analysis, socratic-elicitation, deliberation-panel, verification, persistent-memory, workspace-skills, sdlc-navigator, sop-state-management, about-konductor — claude-teams-behavior is Claude Code only, so Kiro CLI loads 12" }'),
    ("orchestrators: konductor tools",
     'Claude Code: Workflow, WebFetch, WebSearch, TodoWrite, Agent(...) over the 8 specialists, SendMessage, Read, Glob, Grep" }',
     'Claude Code: Workflow, WebFetch, WebSearch, TodoWrite, Agent(...) over the 8 specialists, SendMessage, Read, Glob, Grep, Bash, Write, Skill — so it CAN write and run shell there; only its routing rules stop it" }'),
    ("orchestrators: mux/cmux SOPs",
     '{ k: "mux / cmux SOPs", v: "kiro-spec-workflow, k-plan, k-context-gathering, k-verify — the same four, minus k-delegate" }',
     '{ k: "mux / cmux SOPs (9)", v: "kiro-spec-workflow, k-plan, k-context-gathering, k-verify, k-comprehensive-search, k-full-sdlc, k-e2e-test-generation, k-light-ui-testing, about-konductor — konductor\'s ten, minus k-delegate" }'),
    ("orchestrators: mux/cmux skills",
     '{ k: "mux / cmux skills (8)", v: "constraints, delegation-protocol, sdlc-navigator, git-merge, pre-planning-analysis, socratic-elicitation, verification, plus mux-dispatch or cmux-dispatch" }',
     '{ k: "mux / cmux skills (10)", v: "constraints, delegation-protocol, sdlc-navigator, git-merge, pre-planning-analysis, socratic-elicitation, verification, sop-state-management, about-konductor, plus mux-dispatch or cmux-dispatch" }'),
    ("orchestrators: mux/cmux tools",
     'Claude Code: Workflow, TodoWrite, Read, Bash, Grep, Glob. No write, but yes shell — needed for pane dispatch" }',
     'Claude Code: Workflow, TodoWrite, Read, Bash, Grep, Glob, Write, Skill. Kiro CLI gives them shell but not write — needed for pane dispatch; Claude Code gives them both" }'),
]

# An earlier draft of the guide told readers to curl a prebuilt binary from a
# download host that never existed; `--from <repo-root>` is still the only way to
# install. Those four edits have been retired: every bundle has long since been
# patched, so they only ever matched zero times, and carrying the dead URLs here
# tripped the dependency-download scanner for no benefit. The domains are now
# pinned as forbidden in naming.RETIRED_DOMAINS and asserted absent from the
# Markdown and both bundles by check-guide-facts.py, which is a stronger
# guarantee than a replacement that can no longer fire.
SOP_EDITS += [
    ("install: detects-runtime claim",
     "install</span> detects which runtime you have and registers the agents, skills, SOPs, and context files with it.",
     "install</span> registers the agents, skills, SOPs and context files with the harness you name. --harness is required — there is no auto-detection."),
    # cli/README.md:20 -- "## The 8 commands"
    # The "reference: seven commands" edit that was here predated the config
    # withdrawal, which rewrote that whole sentence to "Seven commands." with no
    # subcommand clause. One edit owns the sentence now.
    ("reference: doctor and-available-updates",
     '{"k":"konductor doctor","v":"Check the runtime, the installed content, the project config, and available updates"}',
     '{"k":"konductor doctor","v":"Run six checks — source, runtime, manifest, config, container_runtime, index_status — and print remediation. It does NOT compare installed against available versions"}'),
]

SOP_EDITS += [
    # SOP:20 -- diff_input required "even when pr_url is present"
    ("adversarial: diff_input param",
     'param("diff_input", true, "— unless pr_url is given. Accepts git diff output, file paths, or raw PR diff content")',
     'param("diff_input", true, "— ALWAYS required, even when pr_url is present. Accepts git diff output, file paths, or raw PR diff content")'),
    # cli/README.md:740 -- doctor does not compare installed vs available versions
    ("update: doctor Updates checklist item",
     'konductor doctor</span> reports the Updates check as <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">ok</span>.',
     'konductor doctor</span> reports <span style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--tx)">manifest</span> as ok with no hash drift. (There is no Updates check — doctor does not compare versions.)'),
    # cli/README.md:533 -- stale means drifted from the manifest, not "newer version exists"
    ("doctor: stale status definition",
     '>Works, but a newer version exists</div>',
     '>Installed content has drifted from the manifest — a hash mismatch or a missing file. Needs a re-install</div>'),
    # cli/README.md:379 -- update silently clobbers local edits
    ("tasks card: update subtitle",
     '{ id: "update", title: "Update an installation", what: "The latest release, with your local modifications kept." }',
     '{ id: "update", title: "Update an installation", what: "An unconditional overwrite from a source tree. Local edits are destroyed." }'),
    # leftover advice from the old preserve-and-skip model
    # update and doctor make no release calls; only install's no---from path does
    ("faq: network claim", "The CLI touches the network only to fetch or compare releases \u2014 install, update, and doctor. init, config, and synth are entirely local. ", "The CLI touches the network in one place only: install, fetching the release it installs from. Everything else \u2014 update, doctor, init, synth, metrics \u2014 is entirely local. "),
    # garbled hand-edit
    ("install: older-version row",
     "Tells you a newer release is available and to run <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">konductor update</span>.",
     "Tracked files are overwritten from --from. install does no version comparison at all."),
]

# k-principal-engineer-design-review's three mandated gates, missing from BOTH
# surfaces until now: the step-1 score<3 hard stop, the round-2 architectural
# escalation, and the verdict taxonomy. Verdict strings are user-visible.
SOP_EDITS += [
]

# prerequisites page: neither update nor doctor makes a release call, and there is
# no published binary to download (cli/README.md "Current limitations").
SOP_EDITS += [
    # The two "prerequisites:" edits that were here targeted prose inside the
    # "What you do not need" section, which a reviewer had removed. Their facts
    # did not vanish with it: the Rust-toolchain requirement moved into the
    # essentials table, and the CLI network-surface detail is stated on the
    # install pages and in reference.md.
]

# k-test-coverage-review: the NOT EVALUATED path, the scope flags, the real file set,
# and the fact that declining at step 3 skips one step rather than halting the run.
SOP_EDITS += [
    ("k-tcr: confirm-scope gate", "node(\"04\", \"Confirm scope\", \"Shows gap counts by severity, then asks \\\"Plan E2E tests for these gaps? [y/n]\\\" \u2014 it will not proceed without your answer.\", \"gate\")", "node(\"04\", \"Confirm scope\", \"Shows gap counts by severity, then asks \\\"Plan E2E tests for these gaps? [y/n]\\\". A \\\"no\\\" is treated exactly as scope_declined=true and skips ONLY step 4 \u2014 the security pass, the report and the verdict still run. scope_confirmed skips the prompt (an unattended run must set it); scope_declined skips step 4 without asking. The two are mutually exclusive.\", \"gate\")"),
    ("k-tcr: security step output",
     "organized by layer (frontend / backend / infra) \u2192 output_dir/security-test-plan.md.",
     "organized by layer (frontend / backend / infra). It writes its OWN files: tasks.md on Kiro, or per-category files plus security-test-overview.md and best-practices-reference.md elsewhere \u2014 there is no security-test-plan.md."),
    ("k-tcr: what-you-get", "get: \"Four files in test-coverage-review/ (or your output_dir): test-gap-analysis.md, e2e-test-strategy.md, security-test-plan.md, and test-coverage-review-report.md. The consolidated report ends with READY FOR RELEASE or NOT READY \u2014 reason, followed by a pri", "get: \"Three named files in test-coverage-review/ (or your output_dir) \u2014 test-gap-analysis.md, e2e-test-strategy.md, test-coverage-review-report.md \u2014 plus whatever the security skill writes (tasks.md on Kiro; elsewhere per-category files plus security-test-overview.md and best-practices-reference.md), so the count varies by runtime. The report is NOT READY on critical gaps in the coverage analysis, critical gaps in the security plan, or a security plan reported as NOT EVALUATED \u2014 which is what Kiro stub mode produces and must not be read as a clean pass, followed by a pri"),
    ("k-tcr: what-it-does", "security test plan generation \u2014 and writes four files, ending in a READY / NOT READY release recommendation.", "security test generation \u2014 and writes three named files plus the security skill's own output, ending in a READY / NOT READY release recommendation."),
    ("k-tcr: what-you-get table row", "{ k: \"security-test-plan.md\", v: \"Security tests by domain and by layer\" }", "{ k: \"the security skill's own output\", v: \"tasks.md on Kiro; elsewhere per-category files plus security-test-overview.md and best-practices-reference.md. There is no security-test-plan.md\" }"),
    ("k-tcr: artifact row", "{ k: \"k-test-coverage-review\", v: \"test-coverage-review/ \u2014 four files\" }", "{ k: \"k-test-coverage-review\", v: \"test-coverage-review/ \u2014 three named files plus the security skill's own output\" }"),
    ("use-case: tcr step 5", "{ n: \"05\", title: \"Security test plan\", body: \"security-test-generation writes test-coverage-review/security-test-plan.md, covering all 7 domains", "{ n: \"05\", title: \"Security tests\", body: \"security-test-generation writes its OWN files under test-coverage-review/ (tasks.md on Kiro; elsewhere per-category files plus security-test-overview.md and best-practices-reference.md \u2014 there is no security-test-plan.md), covering all 7 domains"),
    ("use-case: tcr out", "out: \"four files under test-coverage-review/.\"", "out: \"three named files under test-coverage-review/, plus whatever the security skill wrote.\""),
    ("use-case: tcr checkpoint", "Four files exist under <code style=\"font-family:'JetBrains Mono',monospace;font-size:.9em;color:var(--tx)\">test-coverage-review/</code>.", "test-gap-analysis.md, e2e-test-strategy.md and test-coverage-review-report.md exist under <code style=\"font-family:'JetBrains Mono',monospace;font-size:.9em;color:var(--tx)\">test-coverage-review/</code>, alongside the security skill's own output."),
    ("usecases index: tcr outputs", "out: \"A code review report, four test-coverage files, source files edited in place by one SOP, and an adversarial security review\"", "out: \"A code review report, three named test-coverage files plus the security skill's own output, source files edited in place by one SOP, and an adversarial security review\""),
]

# Remote install: release.yml now publishes konductor-v<version>.tar.gz plus its
# .sha256 sidecar, which is exactly what synth::artifact_filename() and
# install/github.rs::expected_artifact_filename() look for. Both cli/README.md's
# "Current limitations" and github.rs's own module comment still describe an older
# pipeline. Assert the mechanism is wired, not that the path is broken.
SOP_EDITS += [
]

# doctor reports FIVE statuses (cli/README.md:522-535); the table listed four and
# omitted `warn`, which its own sample output uses.
SOP_EDITS += [
    ("doctor: add warn status row", "<div style=\"display:grid;grid-template-columns:.5fr 2fr;border-bottom:1px solid var(--bd)\"><div style=\"padding:12px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--mu)\">stale</div><div style=\"padding:12px 16px;font-size:14.5px;color:var(--mu)\">Installed content has drifted from the manifest \u2014 a hash mismatch or a missing file. Needs a re-install</div></div>", "<div style=\"display:grid;grid-template-columns:.5fr 2fr;border-bottom:1px solid var(--bd)\"><div style=\"padding:12px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--mu)\">warn</div><div style=\"padding:12px 16px;font-size:14.5px;color:var(--mu)\">A hygiene issue, not a broken install \u2014 an unreadable manifest falling back, for example</div></div><div style=\"display:grid;grid-template-columns:.5fr 2fr;border-bottom:1px solid var(--bd)\"><div style=\"padding:12px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--mu)\">stale</div><div style=\"padding:12px 16px;font-size:14.5px;color:var(--mu)\">Installed content has drifted from the manifest \u2014 a hash mismatch or a missing file. Needs a re-install</div></div>"),
]

# ── Review findings ───────────────────────────────────────────────────────────
# Each of these was raised in review, verified against the source, and fixed in
# docs/user-guide/ as well. Grouped here so the pair of artifacts moves together.
SOP_EDITS += [
    # `konductor synth` writes agents/, skills/, sops/ AND context/ under
    # dist/<harness>/ -- see cli/konductor-rs/src/cli/synth/{kiro_cli_v2,claude}.rs
    # and the dist/ tree itself. The old sentence contradicted the same page's
    # own "four directories" claim two paragraphs up.
    ("reference: synth writes only agents",
     "Skills and SOPs are parsed and validated, but only agent files are written.",
     "Skills and SOPs are parsed and validated before anything is written, so a bad skill name or a duplicate SOP fails the whole run rather than producing a partial tree."),

    # Kiro CLI does NOT resolve packaged skills through `.kiro/skills/` resource
    # URIs. install/kiro_cli.rs puts them under `.konductor/skills/`, deliberately
    # outside the tree Kiro CLI scans, and install/mcp_server.rs injects the
    # bundled skill-lookup MCP server that serves them. Claude Code is the native
    # case: `clientConfig.claudeCli.skills` plus `.claude/skills/<name>/SKILL.md`.
    ("runtime differences: skills resolution row",
     '{ k: "Skills resolution", v: "skill://~/.kiro/skills/<name>/SKILL.md resource URIs · clientConfig.claudeCli.skills names" }',
     '{ k: "Skills resolution", v: "through the bundled skill-lookup MCP server — skills install to .konductor/skills/, outside the .kiro/skills/ tree Kiro CLI scans · native Claude Code skills: clientConfig.claudeCli.skills names the set, each body at .claude/skills/<name>/SKILL.md" }'),

    # Same correction in the contributing example: there is no per-skill entry
    # under clientConfig.kiroCli.resources. The only skill:// resource any spec
    # carries is the `ws-*` workspace-skills glob.
    ("contributing: add-a-skill JSON",
     'code: "{\\n  \\"clientConfig\\": {\\n    \\"kiroCli\\": {\\n      \\"resources\\": [\\"skill://~/.kiro/skills/my-new-skill/SKILL.md\\"]\\n    },\\n    \\"claudeCli\\": {\\n      \\"skills\\": [\\"my-new-skill\\"]\\n    }\\n  }\\n}"',
     'code: "{\\n  \\"dependencies\\": {\\n    \\"skills\\": {\\n      \\"skillNames\\": [\\"my-new-skill\\"]\\n    }\\n  },\\n  \\"clientConfig\\": {\\n    \\"claudeCli\\": {\\n      \\"skills\\": [\\"my-new-skill\\"]\\n    }\\n  }\\n}"'),
    ("skills: recently-fixed wiring sentence",
     "Both runtimes were wired: the skill name in clientConfig.claudeCli.skills and a matching skill:// resource entry in clientConfig.kiroCli.resources.",
     "Both runtimes were wired: the skill name in dependencies.skills.skillNames, which is what konductor synth reads for either harness, and in clientConfig.claudeCli.skills, which is what Claude Code lists in the rendered agent's skills: frontmatter."),

    # Three design SOPs, not two: k-principal-engineer-design-review is one, and
    # the picker's own comparison table already contrasts it with
    # k-existing-design-review.
    ("sop picker: design SOP count",
     "Four SOPs review code and two handle design documents.",
     "Four SOPs review code and three handle design documents."),
    ("sop picker: design branch",
     '<div style="border:1px solid var(--bd2);border-radius:10px;background:var(--surf);padding:13px 15px;font-size:14px;color:var(--mu)">Reviewing existing artifacts → <code style="font-family:\'JetBrains Mono\',monospace;font-size:.9em;color:var(--tx)">k-existing-design-review</code></div>',
     '<div style="border:1px solid var(--bd2);border-radius:10px;background:var(--surf);padding:13px 15px;font-size:14px;color:var(--mu)">Reviewing a directory of existing artifacts → <code style="font-family:\'JetBrains Mono\',monospace;font-size:.9em;color:var(--tx)">k-existing-design-review</code></div>\n            <div style="border:1px solid var(--bd2);border-radius:10px;background:var(--surf);padding:13px 15px;font-size:14px;color:var(--mu)">Hardening one doc before its review → <code style="font-family:\'JetBrains Mono\',monospace;font-size:.9em;color:var(--tx)">k-principal-engineer-design-review</code></div>'),

    # Roster detail rows -- a THIRD rendering of the per-agent figures, separate
    # from the at-a-glance cards and the skills-per-agent table above, and the one
    # that kept drifting unnoticed. Counts from dependencies.skills.skillNames;
    # delegation from availableAgents plus each spec's Agent(...) tool.
    ("roster row: architect delegation runtimes",
     "Can delegate to developer and QA in Kiro CLI.",
     "Can delegate to developer and QA in both runtimes."),
    ("roster row: QA delegation",
     "Can delegate to the developer in Kiro CLI.",
     "Can delegate to the developer and the browser agent in both runtimes."),
    ("roster row: PM skills",
     "No SOPs — skill-driven. 14 skills: user-story-writing",
     "No SOPs — skill-driven. 16 skills: user-story-writing"),
    ("roster row: researcher skills",
     "No SOPs — skill-driven. 7 skills: external-research",
     "No SOPs — skill-driven. 8 skills: external-research"),
]

# ── Review findings: bundle-only drift ────────────────────────────────────────
# Bundle-only drift: each of these is already correct in docs/user-guide/ and was
# wrong only in the published page, which is why no Markdown check caught it. The
# two homepage-diagram counts and the leaked verification line were spotted by a
# reviewer reading the rendered guide, not by any tool.
SOP_EDITS += [
    ("concepts: verified-by-counting leak",
     "<p style=\"margin:0;font-size:16px;line-height:1.75;color:var(--mu)\">Verified by counting <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">agents/*.agent-spec.json</span> — 11 files. For each agent's model, tools, ",
     "<p style=\"margin:0;font-size:16px;line-height:1.75;color:var(--mu)\">For each agent's model, tools, "),
    ("homepage diagram: agent-sops count",
     "agent-sops/<br><span style=\"color:var(--mu2)\">13 workflows</span>",
     "agent-sops/<br><span style=\"color:var(--mu2)\">19 workflows</span>"),
    ("homepage diagram: specialist count",
     ">9 specialist agents</div>",
     ">8 specialist agents</div>"),
    ("hero snippet: install needs --harness",
     "make -C konductor build &amp;&amp; make -C konductor link\nkonductor install\n{{ startCmd }}",
     "make -C konductor build &amp;&amp; make -C konductor link\nkonductor install --harness {{ harnessFlag }}\n{{ startCmd }}"),
    ("troubleshooting: reinstall snippet needs --harness",
     "code: \"konductor synth\\nkonductor install\",",
     "code: \"konductor synth\\nkonductor install --harness <harness>\","),
    ("concepts: orchestrator is a hub",
     "The <strong style=\"color:var(--tx);font-weight:600\">orchestrator</strong> is a hub — though not an exclusive one.",
     "<strong style=\"color:var(--tx);font-weight:600\">konductor</strong>, as the orchestrator, is a hub — though not an exclusive one."),
    ("download step: drop chmod and mkdir",
     "<p style=\"margin:0 0 14px;font-size:16px;line-height:1.75;color:var(--mu)\">Make it executable:</p>\n            <div style=\"border:1px solid var(--bd);border-radius:12px;overflow:hidden;background:var(--code);margin-bottom:14px\">\n              <div style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--bd)\"><span style=\"font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.16em;color:var(--mu2)\">BASH</span><button data-copy=\"1\" style=\"all:unset;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mu2)\" style-hover=\"color:var(--sig)\">copy</button></div>\n              <pre style=\"margin:0;padding:14px 14px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;color:#E8E4F5;overflow-x:auto\">chmod +x konductor</pre>\n            </div>\n            <p style=\"margin:0 0 14px;font-size:16px;line-height:1.75;color:var(--mu)\">Move it somewhere on your <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx);background:rgba(124,92,255,.16);border-radius:5px;padding:1.5px 6px\">PATH</span>:</p>\n            <div style=\"border:1px solid var(--bd);border-radius:12px;overflow:hidden;background:var(--code);margin-bottom:18px\">\n              <div style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--bd)\"><span style=\"font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.16em;color:var(--mu2)\">BASH</span><button data-copy=\"1\" style=\"all:unset;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mu2)\" style-hover=\"color:var(--sig)\">copy</button></div>\n              <pre style=\"margin:0;padding:14px 14px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;color:#E8E4F5;overflow-x:auto\">mkdir -p ~/.local/bin &amp;&amp; mv konductor ~/.local/bin/</pre>\n            </div>\n            ",
     "<p style=\"margin:0 0 22px;font-size:16px;line-height:1.75;color:var(--mu)\"><span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx);background:rgba(124,92,255,.16);border-radius:5px;padding:1.5px 6px\">make link</span> symlinks the binary into <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx);background:rgba(124,92,255,.16);border-radius:5px;padding:1.5px 6px\">~/.local/bin</span>, creating the directory if it is missing.</p>\n            "),
]

# ── Review findings: reader-facing framing ────────────────────────────────────
# A reviewer found the reader-facing "verify it yourself" framing unhelpful: a
# product manual should state its numbers, not invite the reader to audit them.
# The `ls skills | wc -l` samples survive in appendix/contributing.md, where they
# are an instruction to a contributor rather than a claim needing proof -- which
# is also what keeps check-guide-facts.py's sample-output section fed.
#
# "What you do not need" went with it. Its one load-bearing fact -- a Rust
# toolchain IS required today, which sat oddly under that heading -- moved into
# the essentials table instead of being dropped.
SOP_EDITS += [
    ("concepts: drop the verify-it-yourself panel",
     "<div style=\"border:1px solid rgba(61,220,151,.35);border-radius:12px;background:rgba(61,220,151,.05);padding:18px 20px\">\n              <div style=\"font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.18em;color:var(--sig);margin-bottom:10px\">COUNT · VERIFY IT YOURSELF</div>\n              <p style=\"margin:0 0 12px;font-size:14.5px;line-height:1.6;color:var(--mu)\">The package ships 82 skills — 82 directories under <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">skills/</span>, each with a <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">SKILL.md</span>.</p>\n              <pre style=\"margin:0;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;color:var(--tx)\">ls skills | wc -l</pre>\n            </div>\n          </section>",
     "<p style=\"margin:0;font-size:16px;line-height:1.75;color:var(--mu)\"><strong style=\"color:var(--tx);font-weight:600\">The package ships 82 skills</strong> — 82 directories under <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">skills/</span>, each with a <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">SKILL.md</span>. All 82 are catalogued, grouped, with a when-to-use note each, in the <a href=\"#/skills\">Skills catalog</a>.</p>\n          </section>"),
    ("skills: coverage section drops check-it-yourself",
     "{\"paras\":[\"All 82 skills are declared by at least one agent. Check it yourself with ls skills | wc -l, then compare that against the union of every spec's declared skills — if the two ever diverge, a skill exists that no agent can load, which matters most when a SOP instructs an agent to use it.\"],\"code\":\"ls skills | wc -l\",",
     "{\"paras\":[\"All 82 skills are declared by at least one agent. That matters because a skill no agent declares cannot be loaded by anything — which bites hardest when a SOP instructs an agent to use it. Contributors adding a skill should see Contributing → check skill coverage.\"],"),
    ("prerequisites: drop the what-you-do-not-need section",
     "\n\n          <section id=\"p-not\" style=\"padding-bottom:44px;border-top:1px solid var(--bd);padding-top:40px\">\n            <h2 style=\"margin:0 0 16px;font-size:30px;letter-spacing:-.025em;font-weight:600\">What you do <em>not</em> need</h2>\n            <p style=\"margin:0 0 22px;font-size:16px;line-height:1.75;color:var(--mu)\">Worth stating, because it is unusual:</p>\n            <div style=\"display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px\">\n              <div style=\"border:1px solid var(--bd);border-radius:12px;background:var(--surf);padding:18px 20px\">\n                <div style=\"font-size:15.5px;font-weight:600;margin-bottom:7px\">No servers or infrastructure</div>\n                <div style=\"font-size:14px;line-height:1.6;color:var(--mu)\">Agents are configuration files your runtime executes.</div>\n              </div>\n              <div style=\"border:1px solid var(--bd);border-radius:12px;background:var(--surf);padding:18px 20px\">\n                <div style=\"font-size:15.5px;font-weight:600;margin-bottom:7px\">No database</div>\n                <div style=\"font-size:14px;line-height:1.6;color:var(--mu)\">Nothing persists except plain files you can read.</div>\n              </div>\n              <div style=\"border:1px solid var(--bd);border-radius:12px;background:var(--surf);padding:18px 20px\">\n                <div style=\"font-size:15.5px;font-weight:600;margin-bottom:7px\">No build toolchain</div>\n                <div style=\"font-size:14px;line-height:1.6;color:var(--mu)\">There is no published binary yet, so you build the CLI from a clone with make build. A Rust toolchain is required.</div>\n              </div>\n              <div style=\"border:1px solid var(--bd);border-radius:12px;background:var(--surf);padding:18px 20px\">\n                <div style=\"font-size:15.5px;font-weight:600;margin-bottom:7px\">No network access at run time for the CLI</div>\n                <div style=\"font-size:14px;line-height:1.6;color:var(--mu)\"><span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">init</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">config</span>, and <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">synth</span> touch only the local filesystem — and so do <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">update</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">doctor</span> and <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">metrics</span>. The single remote path is <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">install</span> with --from omitted, which tries a GitHub Release. Every documented workflow here passes --from, so in practice nothing reaches the network.</div>\n              </div>\n            </div>\n          </section>\n\n          ",
     "\n\n          "),
    ("prerequisites: essentials gains a Rust row",
     "<div style=\"display:grid;grid-template-columns:1.2fr 1.7fr 1.1fr\">\n                <div style=\"padding:13px 16px;font-size:14.5px;font-weight:600\">A terminal</div>",
     "<div style=\"display:grid;grid-template-columns:1.2fr 1.7fr 1.1fr;border-bottom:1px solid var(--bd)\">\n                <div style=\"padding:13px 16px;font-size:14.5px;font-weight:600\">A Rust toolchain</div>\n                <div style=\"padding:13px 16px;font-size:14.5px;line-height:1.55;color:var(--mu)\">No release has been published yet, so you build the CLI from a clone — rustup is the usual way to get one</div>\n                <div style=\"padding:13px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--lav)\">cargo --version</div>\n              </div>\n              <div style=\"display:grid;grid-template-columns:1.2fr 1.7fr 1.1fr\">\n                <div style=\"padding:13px 16px;font-size:14.5px;font-weight:600\">A terminal</div>"),
]

# A SECOND "install detects the runtime" claim, on the Kiro CLI install page --
# the edit above only caught the one on the quick start. `--harness` is required
# (cli.rs declares it without a default), so the sentence is wrong on two counts:
# there is no detection, and `--target` defaults to $HOME rather than the current
# directory. The Markdown has said both correctly the whole time; this was
# bundle-only, like the two shell blocks and the home-page diagram counts.
SOP_EDITS += [
    ("install page: detects-the-runtime claim",
     "<span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">install</span> detects the runtime for you. To install into a specific repository rather than the current directory:",
     "<span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">--harness</span> is required — there is no default and no auto-detection from the destination. <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">--from</span> is the source; <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">--target</span> is the destination, and defaults to <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">$HOME</span>. To install somewhere else:"),
]

# Reviewer decision: `--from` comes out of every documented
# `konductor install`. It survives only as one row in reference.md's flag table,
# marked a maintainer path. See notes.md -- this reads correctly for the shipped
# product and is wrong only until the repository is public and a release exists,
# which was the call made on the CR thread with the 404 evidence in hand.
SOP_EDITS += [
    ("install page claude: drop --from",
     "konductor install --from &lt;repo-root&gt; --harness claude",
     "konductor install --harness claude"),
    # The "faq: network answer drops the --from framing" edit that was here is
    # folded into the edit above, which owns that sentence outright now: two
    # edits rewriting the same prose in sequence invalidate each other the
    # moment a third change lands.
    ("install page kiro: drop --from (main snippet)",
     "<pre style=\"margin:0;padding:14px 14px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;color:#E8E4F5;overflow-x:auto\">konductor install --from &lt;repo-root&gt; --harness kiro-cli-v2</pre>",
     "<pre style=\"margin:0;padding:14px 14px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;color:#E8E4F5;overflow-x:auto\">konductor install --harness kiro-cli-v2</pre>"),
    ("troubleshooting page: drop --from",
     "<pre style=\"margin:0;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;color:#E8E4F5;overflow-x:auto\">konductor install --from &lt;repo-root&gt; --harness kiro-cli-v2</pre>",
     "<pre style=\"margin:0;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;color:#E8E4F5;overflow-x:auto\">konductor install --harness kiro-cli-v2</pre>"),
]

# Reviewer asked for the fabricated CLI output off the two install pages: none of
# it came from a real run, and a manual that invents a transcript invites the
# reader to trust a shape we have not verified. Replaced with prose describing
# what the command reports. The quick start keeps its one install and doctor
# sample -- that is where check-guide-facts.py reads the package totals and the
# doctor check names from, so removing every sample would leave those unguarded.
SOP_EDITS += [
    ("install page kiro: drop the mock install output",
     "<div style=\"border:1px solid var(--bd);border-radius:12px;overflow:hidden;background:var(--bg2);margin-bottom:18px\">\n              <div style=\"padding:9px 14px;border-bottom:1px solid var(--bd);font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.16em;color:var(--mu2)\">OUTPUT</div>\n              <pre style=\"margin:0;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.75;color:var(--mu);overflow-x:auto\">Installing Konductor 0.1.0\n  agents          11 registered\n  skills          82 registered\n  SOPs            19 registered\n  context files    1 registered\n\nInstalled. Start a session with:\n  kiro-cli chat --agent konductor</pre>\n            </div>\n            ",
     "<p style=\"margin:0 0 22px;font-size:16px;line-height:1.75;color:var(--mu)\">On success it reports a per-content-type count — agents, skills, SOPs and context files — and the command to start a session with. Exit code <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">0</span>.</p>\n            "),
    ("install page claude: drop the mock install output",
     "<div style=\"border:1px solid var(--bd);border-radius:12px;overflow:hidden;background:var(--bg2);margin-bottom:18px\">\n              <div style=\"padding:9px 14px;border-bottom:1px solid var(--bd);font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.16em;color:var(--mu2)\">OUTPUT</div>\n              <pre style=\"margin:0;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.75;color:var(--mu);overflow-x:auto\">Installing Konductor 0.1.0\n  agents          11 registered\n  skills          82 registered\n  SOPs            19 registered\n  context files    1 registered\n\nInstalled. Two more settings are required before teammates can run —\nsee 'Enable agent teams' and 'Grant tool permissions'.\n\n  claude --agent konductor</pre>\n            </div>\n            ",
     "<p style=\"margin:0 0 22px;font-size:16px;line-height:1.75;color:var(--mu)\">On success it reports a per-content-type count — agents, skills, SOPs and context files — and says that two more settings are required before teammates can run. Both are below.</p>\n            "),
    ("install page kiro: drop the mock doctor output",
     "<div style=\"border:1px solid var(--bd);border-radius:12px;overflow:hidden;background:var(--bg2);margin-bottom:14px\">\n              <div style=\"padding:9px 14px;border-bottom:1px solid var(--bd);font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.16em;color:var(--mu2)\">OUTPUT</div>\n              <pre style=\"margin:0;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.75;color:var(--mu);overflow-x:auto\">source             parsed, all cross-references resolve        ok\nruntime            Kiro CLI detected                           ok\nmanifest           complete, no hash drift                     ok\nconfig             .konductor/config.yml valid                 ok\ncontainer_runtime  docker found on PATH                      info\nindex_status       matches the manifest                        ok\n\nAll checks passed.</pre>\n            </div>\n            ",
     "<p style=\"margin:0 0 22px;font-size:16px;line-height:1.75;color:var(--mu)\">It runs six checks — <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">source</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">runtime</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">manifest</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">config</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">container_runtime</span> and <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">index_status</span> — and prints a status per check plus remediation for anything that is not <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">ok</span>. Exit code <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">0</span> when nothing failed. Full status vocabulary in <a href=\"#/diagnose\">Diagnose problems</a>.</p>\n            "),
    ("install page claude: drop the mock doctor output",
     "<div style=\"border:1px solid var(--bd);border-radius:12px;overflow:hidden;background:var(--bg2);margin-bottom:20px\">\n              <div style=\"padding:9px 14px;border-bottom:1px solid var(--bd);font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.16em;color:var(--mu2)\">konductor doctor</div>\n              <pre style=\"margin:0;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.75;color:var(--mu);overflow-x:auto\">source             parsed, all cross-references resolve        ok\nruntime            Claude Code detected                           ok\nmanifest           complete, no hash drift                     ok\nconfig             .konductor/config.yml valid                 ok\ncontainer_runtime  docker found on PATH                      info\nindex_status       matches the manifest                        ok\n\nAll checks passed.</pre>\n            </div>\n            ",
     "<p style=\"margin:0 0 22px;font-size:16px;line-height:1.75;color:var(--mu)\">It runs six checks — <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">source</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">runtime</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">manifest</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">config</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">container_runtime</span> and <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">index_status</span> — and prints a status per check plus remediation for anything that is not <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">ok</span>. Exit code <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">0</span> when nothing failed. Full status vocabulary in <a href=\"#/diagnose\">Diagnose problems</a>.</p>\n            "),
]

# ── `konductor config` withdrawn from the v1 customer-visible surface ──────────
# Reviewer decision: the command is not shipping visibly in v1, so
# the guide does not document it. The whole `is.config` page, its nav and router
# registration, its prev/next wiring and every invocation come out; the FILE
# `.konductor/config.yml` stays documented, because `init` writes it and `doctor`
# validates it, and removing the file too would leave both of those pointing at
# something undescribed. check-guide-facts.py records the carve-out explicitly in
# WITHDRAWN_COMMANDS, so "documents every command except the ones we chose to
# withhold" is still an assertion rather than a gap.
SOP_EDITS += [
    ("init page: replace the config cross-link",
     "<p style=\"margin:0;font-size:16px;line-height:1.75;color:var(--mu)\">Full detail in <a href=\"#/config\">Read and change configuration</a>.</p>",
     "<p style=\"margin:0;font-size:16px;line-height:1.75;color:var(--mu)\"><span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">init</span> writes a verbatim copy of the CLI's own preset defaults, comments included, so the file documents its own fields. Field meanings are in the <a href=\"#/reference\">CLI reference</a>.</p>"),
    ("init page: next goes to Diagnose problems",
     "<button sc-camel-on-click=\"{{ goConfig }}\" style=\"all:unset;cursor:pointer;font-size:14px;font-weight:600;color:var(--vi)\" style-hover=\"color:var(--lav)\">Next: Read and change configuration →</button>",
     "<button sc-camel-on-click=\"{{ goDiagnose }}\" style=\"all:unset;cursor:pointer;font-size:14px;font-weight:600;color:var(--vi)\" style-hover=\"color:var(--lav)\">Next: Diagnose problems →</button>"),
    ("diagnose page: previous goes to Initialize a project",
     "<button sc-camel-on-click=\"{{ goConfig }}\" style=\"all:unset;cursor:pointer;font-size:14px;color:var(--mu)\" style-hover=\"color:var(--vi)\">← Configuration</button>",
     "<button sc-camel-on-click=\"{{ goInit }}\" style=\"all:unset;cursor:pointer;font-size:14px;color:var(--mu)\" style-hover=\"color:var(--vi)\">← Initialize a project</button>"),
    ("reference: seven commands, no config group",
     "\"Eight commands. config is a group with three subcommands. konductor help [COMMAND] prints help for a command, and --help works at every level.\"",
     "\"Seven commands. konductor help [COMMAND] prints help for a command, and --help works at every level.\""),
    ("reference: config-file path no longer names --config",
     "Path: .konductor/config.yml, relative to the current working directory, or whatever --config points at.",
     "Path: .konductor/config.yml, relative to the current working directory. konductor init writes it and konductor doctor validates it; edit it by hand."),
    ("reference: precedence drops --config",
     "then <cwd>/.konductor/config.yml or --config <PATH>.",
     "then <cwd>/.konductor/config.yml."),
    ("reference: exit-64 rows drop the config examples",
     "{\"k\":\"Missing required argument\",\"v\":\"konductor config get\"},",
     "{\"k\":\"Missing required argument\",\"v\":\"konductor install without --harness\"},"),
    ("reference: exit-64 rows drop config key/value/load",
     "{\"k\":\"Unknown config key\",\"v\":\"konductor config get colour_scheme\"},{\"k\":\"Invalid config value\",\"v\":\"konductor config set version 9\"},{\"k\":\"Malformed config on load\",\"v\":\"konductor config list against a broken config.yml\"},",
     "{\"k\":\"Malformed config on load\",\"v\":\"any command, against a broken .konductor/config.yml\"},"),
    ("reference: layout row drops config set",
     "{\"k\":\".konductor/config.yml\",\"v\":\"konductor init, konductor config set · no\"}",
     "{\"k\":\".konductor/config.yml\",\"v\":\"konductor init · no\"}"),
    ("troubleshooting 8: drop the config commands",
     "sec(\"t-8\", \"8 — config value is wrong\", \"8. A config value is not what I set\", {\n        paras: [\"SYMPTOM — konductor config list shows a value you did not put in your project config.\"",
     "sec(\"t-8\", \"8 — config value is wrong\", \"8. A config value is not what I set\", {\n        paras: [\"SYMPTOM — a finding severity or change tier is not what your project config says.\""),
    ("troubleshooting 8: drop the config set snippet",
     "code: \"cat ~/.konductor/config.yml\\nkonductor config set severities_source my-severities.yml\" })",
     "code: \"cat ~/.konductor/config.yml\" })"),
    ("getting help: drop config list from the bug-report commands",
     "code: \"konductor --version\\nwhich konductor\\nkonductor config list\",",
     "code: \"konductor --version\\nwhich konductor\\ncat .konductor/config.yml\","),
    ("init page: success chip stops naming config list",
     "<span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">konductor config list</span> prints the config keys.",
     "<span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">.konductor/config.yml</span> parses — <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">konductor doctor</span> reports <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">config</span> as <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">ok</span>."),
    ("init page: verify block reads the file instead",
     "<pre style=\"margin:0 0 10px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;color:var(--tx)\">konductor config list</pre>\n              <pre style=\"margin:0;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.75;color:var(--mu)\">version = 1\nseverities_source = severity-schema.yml\ntiers_source = scope-table.yml</pre>",
     "<pre style=\"margin:0 0 10px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;color:var(--tx)\">cat .konductor/config.yml</pre>\n              <pre style=\"margin:0;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.75;color:var(--mu)\">version: 1</pre>"),
    ("diagnose page: drop config list from the precedence snippet",
     "cat .konductor/config.yml\ncat ~/.konductor/config.yml\nkonductor config list</pre>",
     "cat .konductor/config.yml\ncat ~/.konductor/config.yml</pre>"),
    ("diagnose page: precedence label drops MERGED",
     "PROJECT, THEN USER, THEN MERGED</span>",
     "PROJECT, THEN USER</span>"),
    ("update page: success chip uses doctor",
     "<span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">konductor config list</span> still exits <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">0</span>, confirming your config is still valid against the new release.",
     "<span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">konductor doctor</span> reports <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">config</span> as <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">ok</span>, confirming your config is still valid against the new release."),
    ("reference: empty-config note drops config list",
     "\"note\":\"An empty config.yml is not an error — every field falls through and config list exits 0.\"",
     "\"note\":\"An empty config.yml is not an error — every field falls through to its default.\""),
    ("uninstall: artifact row drops config set",
     "{ where: \"<project>/.konductor/config.yml\", by: \"konductor init, config set\", gone: \"you, manually\" }",
     "{ where: \"<project>/.konductor/config.yml\", by: \"konductor init\", gone: \"you, manually\" }"),
    ("update page: schema-change warning uses doctor",
     "If <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">config list</span> reports <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">config ",
     "If <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">konductor doctor</span> reports <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">config "),
]

# The quick start was the last page still showing invented CLI transcripts. Its
# install and doctor panels are now prose too, matching the install pages. No
# check loses its input: the package totals are still asserted from the hero
# banner, the stat tiles and the layout tree, and the doctor check NAMES are
# asserted from reference.md, not from a transcript.
SOP_EDITS += [
    ("quick start: drop the mock install output",
     "<div style=\"border:1px solid var(--bd);border-radius:12px;overflow:hidden;background:var(--bg2);margin-bottom:18px\">\n              <div style=\"padding:8px 12px;border-bottom:1px solid var(--bd);font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.16em;color:var(--mu2)\">OUTPUT</div>\n              <pre style=\"margin:0;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.75;color:var(--mu);overflow-x:auto\">Installing Konductor 0.1.0\n  agents          11 registered\n  skills          82 registered\n  SOPs            19 registered\n  context files    1 registered\n\nInstalled. Start a session with:\n  kiro-cli chat --agent konductor</pre>\n            </div>\n            ",
     "<p style=\"margin:0 0 22px;font-size:16px;line-height:1.75;color:var(--mu)\">It reports a count per content type and the command to start a session with, and exits <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">0</span>.</p>\n            "),
    ("quick start: drop the mock doctor output",
     "<pre style=\"margin:0;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.75;color:var(--mu);overflow-x:auto\">source             parsed, all cross-references resolve        ok\nruntime            Kiro CLI detected                           ok\nmanifest           complete, no hash drift                     ok\nconfig             .konductor/config.yml valid                 ok\ncontainer_runtime  docker found on PATH                      info\nindex_status       matches the manifest                        ok\n\nAll checks passed.</pre>",
     "<p style=\"margin:0;font-size:14px;line-height:1.6;color:var(--mu)\">Six checks — <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">source</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">runtime</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">manifest</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">config</span>, <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">container_runtime</span> and <span style=\"font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--tx)\">index_status</span> — each with a status.</p>"),
]

# Documented version is 1.0.0 for the v1 launch, by explicit decision. NOTE: no
# source file declares it yet -- cli/konductor-rs/Cargo.toml is 0.1.1 and
# package.json is 0.1.0 -- so this is the one number in the guide that cannot be
# verified against the source tree. Deliberately NOT gated by a check for that
# reason; see docs/user-guide/notes.md, and bump the source before launch.
SOP_EDITS += [
    ("version: sidebar badge",
     "USER GUIDE · 0.1.0</span>",
     "USER GUIDE · 1.0.0</span>"),
    ("version: --version checkpoint",
     ">konductor 0.1.0</pre>",
     ">konductor 1.0.0</pre>"),
]

# Further review findings.
SOP_EDITS += [
    ("k-full-sdlc: add the reply-channel parameter",
     "param(\"feature_isolation\", false, \"branch; only worktree allows parallel feature work\")]",
     "param(\"feature_isolation\", false, \"branch; only worktree allows parallel feature work\"), param(\"reply_channel_available\", false, \"true — set false for a batch or CI run with no one to ask\")]"),
    ("reference: --from row stops asserting the release path is broken",
     "{\"k\":\"install --from <PATH>\",\"v\":\"path · no · source repo root with synthed content. Omitted, it tries a GitHub Release then main's dist/ — neither works yet, so pass it\"}",
     "{\"k\":\"install --from <PATH>\",\"v\":\"path · no · install from a local repo root with already-synthed content instead of fetching a release. A maintainer path — the documented workflows all install from a release\"}"),
]

# Kiro IDE added to the runtimes table at a reviewer's request. The facts come
# from cli/README.md's own "kiro-cli-v2 vs kiro-v3 is not an IDE-vs-CLI split"
# note: v2 ships the CLI and IDE as separate products and kiro-cli-v2 content
# does not work in the IDE, while v3 unifies them behind one kiro-v3 harness.
# The reference row also loses a stale claim that kiro-v3 "has no install
# strategy yet" -- KiroCliV3InstallStrategy is registered in registry.rs's
# STRATEGIES and installs for real.
SOP_EDITS += [
    ("concepts: runtimes table gains Kiro IDE",
     "<div style=\"display:grid;grid-template-columns:1.1fr 2fr 1.2fr;border-bottom:1px solid var(--bd);font-size:14.5px\">\n                <div style=\"padding:13px 16px;font-weight:600\">Kiro CLI</div><div style=\"padding:13px 16px;color:var(--mu)\">Amazon's command-line AI assistant</div><div style=\"padding:13px 16px;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--lav)\">kiro-cli</div>\n              </div>\n              <div style=\"display:grid;grid-template-columns:1.1fr 2fr 1.2fr;font-size:14.5px\">\n                <div style=\"padding:13px 16px;font-weight:600\">Claude Code</div><div style=\"padding:13px 16px;color:var(--mu)\">Anthropic's command-line AI assistant</div><div style=\"padding:13px 16px;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--lav)\">claude</div>\n              </div>",
     "<div style=\"display:grid;grid-template-columns:1.1fr 2fr 1.2fr;border-bottom:1px solid var(--bd);font-size:14.5px\">\n                <div style=\"padding:13px 16px;font-weight:600\">Kiro CLI</div><div style=\"padding:13px 16px;color:var(--mu)\">Amazon's command-line AI assistant, invoked as kiro-cli</div><div style=\"padding:13px 16px;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--lav)\">--harness kiro-cli-v2</div>\n              </div>\n              <div style=\"display:grid;grid-template-columns:1.1fr 2fr 1.2fr;border-bottom:1px solid var(--bd);font-size:14.5px\">\n                <div style=\"padding:13px 16px;font-weight:600\">Kiro IDE</div><div style=\"padding:13px 16px;color:var(--mu)\">Amazon's AI editor</div><div style=\"padding:13px 16px;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--lav)\">--harness kiro-v3</div>\n              </div>\n              <div style=\"display:grid;grid-template-columns:1.1fr 2fr 1.2fr;font-size:14.5px\">\n                <div style=\"padding:13px 16px;font-weight:600\">Claude Code</div><div style=\"padding:13px 16px;color:var(--mu)\">Anthropic's command-line AI assistant, invoked as claude</div><div style=\"padding:13px 16px;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--lav)\">--harness claude</div>\n              </div>"),
    ("concepts: runtimes header column is the harness flag",
     "<div style=\"padding:11px 16px\">RUNTIME</div><div style=\"padding:11px 16px\">WHAT IT IS</div><div style=\"padding:11px 16px\">COMMAND</div>",
     "<div style=\"padding:11px 16px\">RUNTIME</div><div style=\"padding:11px 16px\">WHAT IT IS</div><div style=\"padding:11px 16px\">INSTALL WITH</div>"),
    ("concepts: three runtimes, not two",
     "it configures one you already have. Two are supported:",
     "it configures one you already have:"),
    ("concepts: explain the v2 CLI/IDE split",
     "<p style=\"margin:0;font-size:16px;line-height:1.75;color:var(--mu)\">Konductor ships e",
     "<p style=\"margin:0 0 20px;font-size:16px;line-height:1.75;color:var(--mu)\"><strong style=\"color:var(--tx);font-weight:600\">Kiro CLI and Kiro IDE are one harness or two depending on the Kiro version.</strong> In Kiro v2 the CLI and the IDE are separate products: kiro-cli-v2 installs CLI-only content and does not work in the IDE at all. In Kiro v3 they are unified into a single product, so the one kiro-v3 harness covers both — there is no separate CLI-versus-IDE choice to make.</p>\n            <p style=\"margin:0;font-size:16px;line-height:1.75;color:var(--mu)\">Konductor ships e"),
]

# Further review findings: the reviewer asked for the agent named rather than the
# role, and flagged two sentences that contrast two spellings of the SAME agent
# name -- rename artifacts, same class as the glossary prefix claim. Also: the
# critique SOP DOES write its report, so "never modifies files" was contradictory
# (its own source says "never modifies SOURCE files"), and the use-case
# prerequisites never said where the target directory comes from.
SOP_EDITS += [
    ("use cases: drop the names-differ-by-runtime line",
     "\n        <p style=\"margin:0 0 44px;font-size:16px;line-height:1.75;color:var(--mu)\">Agent names differ by runtime: <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">k-developer</code> in Kiro CLI, <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">k-developer</code> in Claude Code.</p>\n",
     "\n"),
    ("understand-a-codebase: drop the per-runtime agent-name split",
     "start a session with the developer agent directly — <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">k-developer</code> in Kiro CLI, or <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">k-developer</code> in Claude Code.</p>",
     "start a session with the developer agent directly: <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">k-developer</code>, on either runtime.</p>"),
    ("understand-a-codebase: read-only claim names source files",
     "It never modifies files, runs your build, or creates commits.",
     "It never modifies <strong style=\"color:var(--tx);font-weight:600\">source</strong> files, runs your build, or creates commits — the critique document above is the only thing it writes."),
    ("understand-a-codebase: prerequisites name the target directory",
     "<div style=\"display:flex;gap:12px;align-items:baseline\"><span style=\"width:6px;height:6px;border-radius:3px;background:var(--vi);flex:0 0 6px;margin-top:8px\"></span><span style=\"font-size:16px;line-height:1.7;color:var(--mu)\">Nothing else. Both SOPs default every parameter and need no config files, environment variables, or network access.</span></div>",
     "<div style=\"display:flex;gap:12px;align-items:baseline\"><span style=\"width:6px;height:6px;border-radius:3px;background:var(--vi);flex:0 0 6px;margin-top:8px\"></span><span style=\"font-size:16px;line-height:1.7;color:var(--mu)\"><strong style=\"color:var(--tx);font-weight:600\">Start the session from inside that repository.</strong> Neither SOP asks you for a target: both default to the working directory your runtime was launched in — <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">k-pre-cr-critique</code> critiques the uncommitted changes there, <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">k-codebase-analysis</code> reads the current directory. To point either somewhere else, name the path in your request, and it becomes the SOP's <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">critique_scope</code> or <code style=\"font-family:'JetBrains Mono',monospace;font-size:.87em;color:var(--tx)\">codebase_path</code> parameter.</span></div>\n          <div style=\"display:flex;gap:12px;align-items:baseline\"><span style=\"width:6px;height:6px;border-radius:3px;background:var(--vi);flex:0 0 6px;margin-top:8px\"></span><span style=\"font-size:16px;line-height:1.7;color:var(--mu)\">Both SOPs default every other parameter and need no config files, environment variables, or network access.</span></div>"),
    ("concepts: hub caption names konductor",
     "you talk only to the orchestrator;",
     "you talk only to konductor;"),
    ("concepts: step 1 names konductor",
     "You describe what you want to the orchestrator",
     "You describe what you want to the konductor agent"),
    ("concepts: step 5 names konductor",
     "The orchestrator verifies the result",
     "konductor verifies the result"),
    ("faq: read-only heading names konductor",
     "sec(\"faq-readonly\", \"Why the orchestrator won't edit\", \"Why does the orchestrator refuse to edit files itself?\"",
     "sec(\"faq-readonly\", \"Why konductor won't edit\", \"Why does konductor (or the other orchestrators) refuse to edit files itself?\""),
]

# Reviewer found this package's own name leaking into reader-facing content. All
# three were bundle-only. The frontmatter sample was also stale on two counts --
# the shipped skill's description was rewritten and its version is 1.4.0, not
# 1.2.0 -- so it is now generated from skills/delegation-protocol/SKILL.md.
SOP_EDITS += [
    ("concepts: frontmatter sample matches the shipped skill",
     "---\nname: delegation-protocol\ndescription: Structured delegation format for the ASDLC orchestrator. Defines the\n  8-field prompt format (mandatory target agent + 7 sections), agent registry,\n  parallel execution rules, and handoff patterns.\nversion: 1.2.0\ntags: [skill, behavioral, orchestration, delegation, multi-agent]\n---",
     "---\nname: delegation-protocol\ndescription: Use when spawning any subagent, deciding which agent should handle a piece of work, coordinating parallel or sequential agent execution, or handing off artifacts between agents. Defines the mandatory 8-field delegation prompt format, agent registry, and handoff patterns.\nversion: 1.4.0\ntags: [skill, behavioral, orchestration, delegation, multi-agent]\n---"),
    ("plan-and-verify: eyebrow drops the retired SOP name",
     "ASDLC-ANALYZE SAYS THIS OUT LOUD",
     "THE SOP SAYS THIS OUT LOUD"),
]

# Reviewer found a "Declared by" cell short two agents. The count checks pass on
# this page -- they verify how MANY skills each agent declares, not which agents
# each skill row names -- so a new section now cross-checks both directions.
SOP_EDITS += [
    ("skills: socratic-elicitation declared-by adds PM and researcher",
     "your own plan attacked. · DECLARED BY: architect, developer, all 3 orchestrators\"}",
     "your own plan attacked. · DECLARED BY: architect, developer, product-manager, researcher, all 3 orchestrators\"}"),
]

# Reviewer asked for the prefix notes out of the guide. This sentence was the same
# fossil in a third place: "the unprefixed form is the Kiro CLI convention" implies
# a prefixed Claude Code form that does not exist.
SOP_EDITS += [
    ("install-claude: drop the unprefixed-form framing",
     "The unprefixed form is the Kiro CLI convention — see <a href=\"#/install-kiro\">Install for Kiro CLI</a>.",
     "The same agent names work on Kiro CLI — see <a href=\"#/install-kiro\">Install for Kiro CLI</a>."),
]

# ── Spent deletions, retired ──────────────────────────────────────────────────
# Thirteen edits here removed content from the bundle (`new` empty). All have run;
# their anchors are gone from both bundles, so none can ever fire again. They are
# retired rather than kept, because a deletion cannot prove it is "already
# applied" -- `new in page` is `"" in page` for one, which is why `apply_all` used
# to treat a DRIFTED deletion as a silent no-op. `apply_all` now fails a deletion
# that does not match, so a spent one left in place would fail the build forever.
#
# What they protected is now asserted instead of re-applied: `konductor config`
# and the withdrawn page are checked absent from both bundles by
# check-guide-facts.py's command-surface section, which covers the regeneration
# path a spent edit never could.

# `konductor init` copies cli/gate-config/config.yml VERBATIM (init.rs writes
# config::PRESET_CONFIG_CONTENTS), so the starter file carries all six keys and
# their comments -- not just `version`. The quick start claimed otherwise and
# contradicted the initialize-a-project page, which had it right.
SOP_EDITS += [
]

# Reviewer: the "no prefix" sentences say nothing now that the prefix topic is out
# of the guide, and one of them claimed "Claude Code differs", which is false. The
# glossary's CLI entry also still listed the withdrawn `config` command -- a leak
# the command-surface check missed, because it looked for "konductor config" and
# this was a bare backticked name in a comma list. That check is tightened too.
SOP_EDITS += [
    ("install-kiro: drop the prefix sentence",
     "<p style=\"margin:0 0 34px;font-size:16px;line-height:1.75;color:var(--mu)\">Agent names have <strong style=\"color:var(--tx);font-weight:600\">no prefix</strong> in Kiro CLI — it is exactly <span style=\"font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx)\">konductor</span>. (Claude Code differs; see <a href=\"#/install-claude\">Install for Claude Code</a>.)</p>",
     "<p style=\"margin:0 0 34px;font-size:16px;line-height:1.75;color:var(--mu)\">The same agent name works on Claude Code — see <a href=\"#/install-claude\">Install for Claude Code</a>.</p>"),
    ("install-claude: drop the no-package-prefix clause",
     "Agents install under their own names — there is no package prefix:",
     "Agents install under their own names:"),
    ("review-code: drop the no-prefix clause",
     "The same names work on both runtimes — Claude Code applies no prefix.",
     "The same names work on both runtimes."),
    ("glossary: Claude Code entry drops the prefix clause",
     "One of the two supported runtimes. Agents install under their own names — claude --agent konductor, with no package prefix.\"",
     "One of the two supported runtimes. Agents install under their own names — claude --agent konductor.\""),
    ("glossary: Konductor entry drops the prefix clause",
     "and every specialist is named k-*. Agent names are the same on both runtimes and carry no package prefix.\"",
     "and every specialist is named k-*. Agent names are the same on both runtimes.\""),
    ("glossary: Konductor CLI entry drops the withdrawn config command",
     "diagnostics: install, update, uninstall, doctor, init, config, and synth.",
     "diagnostics: install, update, uninstall, doctor, init, synth, and metrics."),
]
