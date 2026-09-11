# Benchmarking ASDLCCoreAICapabilities agents

A benchmark harness for this package's agents that has **zero dependency on `aim`
or any internal-only build tooling**. If you can run the `claude` CLI, you
can benchmark a change to this repo's agents/skills.

## ⚠️ Sandbox warning — read this before running anything

The scenario runner (`tests/judges/claude-code-agent-runner.js`) invokes
`claude --agent <name> --permission-mode bypassPermissions` **unconditionally**,
for every scenario, on every attempt. That flag disables Claude Code's normal
interactive approval prompts — the agent under test can read, write, and
execute anything the invoking process can reach, with no confirmation step.

**Only run this harness:**

- inside a disposable container, VM, or scratch directory, **never** against
  a real project checkout you care about, and
- **never** with credentials (cloud, git, API keys) you would not hand to an
  untrusted script.

This is the same posture the [Konductor CLI engineering design][konductor-design]
requires for its own headless/no-review execution mode — sandboxing is a hard
requirement of running any agent with approvals bypassed, not a suggestion.

[konductor-design]: https://github.com/aws-solutions/konductor

## Prerequisites

1. **Claude Code CLI installed and authenticated** — `claude` on `PATH`, with
   a valid Anthropic API key or subscription. This is the one genuinely
   required external prerequisite; if you already use Claude Code, you have
   it.
2. **Node.js** (v18+; developed against v24). No other language runtime, no
   Python, no third-party npm packages — every script here is Node stdlib
   only.
3. **Nothing else.** No internal-only build system, no `aim`, no internal
   authentication tooling, no internal MCP registration of any kind.

## Quick start

```bash
# From this package's root:
npm run benchmark -- --agent k-quality-assurance --replicates 1
```

This does two things, in order:

1. Renders `agents/k-quality-assurance.agent-spec.json` into a Claude
   Code agent file with every declared skill's `SKILL.md` body inlined
   directly into it, and installs a copy into `~/.claude/agents/` (see
   [How agent files get generated](#how-agent-files-get-generated) below).
2. Runs every scenario in `tests/asdlc-quality-assurance/` against that
   agent via `claude --agent k-quality-assurance -p ...`, writes results
   to `benchmark-results/k-quality-assurance.json`, and prints a
   pass/fail summary.

The scenario directory is still named `asdlc-*` while the agent is `k-*`:
`--agent` is matched against the subset's `name` in `tests/registry.json`, and
the directory is read from that same entry's `datasetPath`. The two are
independent, so you always pass the agent name and never the directory name.
A later phase renames the directories and their `datasetPath` values together.

Flags (all optional except `--agent`):

| Flag                 | Default              | Meaning                                                                 |
| -------------------- | --------------------- | ------------------------------------------------------------------------ |
| `--agent <name>`     | *(required)*          | Which agent/subset to benchmark, e.g. `k-developer`.                 |
| `--replicates <N>`   | `1`                   | Run each scenario `N` times; useful for the bootstrap-CI regression check.|
| `--parallel <N>`     | `3`                   | Max concurrent `claude` processes.                                       |
| `--output <dir>`     | `benchmark-results`   | Where to write `<agent>.json`.                                           |
| `--model <id>`       | subset's `subjectModel` in `tests/registry.json`, else the CLI's default | Pins the subject model.        |
| `--scenarios <list>` | *(all)*                | Comma-separated taskId substrings — only run matching scenarios.        |
| `--skip-generate`    | off                    | Skip the generate/install step (use an already-installed agent file).   |

### A note for scenario authors: tool availability under `--agent`

Top-level `claude --agent <name> -p ...` sessions (the invocation shape this
harness uses) have been empirically observed to expose only
`Read, Write, Edit, Bash, WebFetch` to the model at runtime, regardless of
what the agent file's `tools:` frontmatter declares. `Glob`, `Grep`,
`WebSearch`, `TodoWrite`, and any `mcp__*` tool are dropped even when listed.
When writing a new scenario, don't require a tool outside that observed set
— a scenario built around a dropped tool will not be passable until this
runtime limitation is resolved upstream.

### MCP servers are not configured by this harness

`tools:` is emitted verbatim from the agent spec, so a glob like
`mcp__aws-mcp__*` appears there — but no `mcpServers:` block is written, and
`dependencies.mcpRegistry` is not read. Konductor does not bundle MCP servers;
install any server a scenario needs yourself. `requiredMcpServer` in
`tests/registry.json` records that expectation, it does not provision anything.

## How agent files get generated

`agents/*.agent-spec.json` are the source of truth for each agent
(system prompt, model, tools, declared skills). They are **not** directly
loadable by `claude --agent` — something has to render them into the `.md`
frontmatter+body shape Claude Code expects, with skill content resolved and
inlined (headless `claude --agent NAME -p ...` spawns get no interactive
skill-loading UI, so a skill's content has to travel inside the agent file
itself, not be loaded separately at runtime).

`scripts/generate-agent-files.js` does exactly that — stdlib-only Node, no
templating engine, no third-party deps:

```bash
node scripts/generate-agent-files.js --agent k-developer --install
```

- `--install` additionally copies the rendered file into
  `~/.claude/agents/` (override with `--install-dir <dir>` or the
  `ASDLC_CLAUDE_AGENTS_DIR` env var) so `claude --agent k-developer`
  finds it with no separate install tool.
- Omit `--agent` to render every agent at once.
- `--max-inline-chars <N>` (default 250000, or `ASDLC_MAX_INLINE_CHARS`)
  caps how much skill content gets inlined per agent; skills beyond the
  budget are recorded as skipped, not silently dropped (see the printed
  summary table). 250000 covers every skill for both MVP agents
  (`k-quality-assurance` needs ~217K chars across 9 skills,
  `k-developer` ~136K across 17) with headroom inside a 200K-token model
  context window. Agents with a much larger skill inventory (e.g.
  `k-architect`, ~472K chars across 30 skills — out of scope for this
  MVP's scenario set) will still skip some skills at this default; pass a
  higher `--max-inline-chars` if you extend the harness to benchmark them.

This generator is deliberately a **stopgap**. It exists only until a real
`konductor synth` content transformer ships full functionality — at that
point this script is retired in its favor, with no further public users
needing to change anything.

## Roadmap: becoming a `konductor` CLI subcommand

The `konductor` CLI launches with 8 commands —
`install | update | uninstall | synth | init | doctor | config | metrics` —
and no workflow-run subcommand: running an SDLC workflow is agent-driven at
launch, with CLI-headless workflow-run features landing **post-launch**. A
`konductor benchmark` subcommand fits that same post-launch, CLI-headless
pattern, and this harness is written so that migration is a wrap-or-port,
not a rewrite:

- All CLI argument parsing and orchestration lives in one place,
  `scripts/benchmark.js` — not spread across chained npm scripts.
- The actual work is two library functions with a clean, object-in/object-out
  interface and no `process.exit`/argv parsing of their own:
  `generateAgents(options)` (`scripts/generate-agent-files.js`) and
  `runSubset(options)` (`scripts/run-claude-subset.js`). A future
  `konductor benchmark` subcommand (Rust or Python) can call or port the
  equivalent logic directly.
- Flag names/semantics (`--agent`, `--replicates`, `--output`, `--scenarios`)
  are chosen to survive that migration unchanged.

**Planned, not available yet:**

```bash
konductor benchmark --agent k-developer --replicates 3
```

Until then, use the `npm run benchmark` invocation documented above.

## Regression checking

Once you have two result files (e.g. a `baseline.json` captured before your
change and a fresh run after it), compare them with a 95%-bootstrap-CI gate
on the per-attempt success rate. The deterministic `toolUse` score is
reported per task as an advisory secondary signal only — it does not gate.

```bash
npm run benchmark:regression -- benchmark-results/k-developer.json baselines/k-developer.json
```

Exits non-zero only when the confidence interval on the score delta is
**entirely** below zero — a single noisy replicate cannot flip the verdict,
and comparisons across different `--model` pins are refused outright rather
than silently mis-attributed to a regression. See
`tests/scripts/check-benchmark-regression.js`'s header for the full design
rationale.

## What's in this MVP, and what's deferred

This is the **MVP** phase of a phased build-out (see the design history for
the full plan):

**Included:**

- The generator (`scripts/generate-agent-files.js`), covering every
  agent (not just one — the algorithm is agent-count-agnostic).
- The runner (`tests/judges/claude-code-agent-runner.js`) and driver
  (`scripts/run-claude-subset.js`), plus the one-command CLI entry
  (`scripts/benchmark.js`).
- Two scenario subsets: `k-quality-assurance` (4 scenarios) and
  `k-developer` (12 scenarios) — see `tests/registry.json`.
- `tests/scripts/check-benchmark-regression.js` and `stats.js`, both fully
  portable with no internal-only dependency.
- Unit tests for the generator, the runner's pure helpers, and the subset
  driver's argument/filter/registry helpers (`node --test`, stdlib only).

**Deferred (not in this MVP):**

- Scenario coverage for the other 9 public agents (architect, product
  manager, researcher, TPM, media analyzer, browser, orchestrator,
  mux/cmux-orchestrator). Extending `tests/registry.json` and porting their
  scenario sets is mechanical repetition of the pattern already established
  here.
- `agents/kiro/<name>.json` generation and a Kiro-CLI-backed judge —
  Kiro CLI's headless path (`KIRO_API_KEY`, `--no-interactive`,
  `--trust-all-tools`) is externally usable, but has lower gate-fidelity
  (no structured JSON stream, no turn cap) and needs its own
  scoring-robustness work.
- A CI wiring example (GitHub Actions job running
  `check-benchmark-regression.js` against a committed baseline) —
  the script itself is already CI-ready (pure Node, deterministic exit
  code); only the workflow YAML is missing.
- The `konductor benchmark` CLI subcommand itself (see the roadmap section
  above) — depends on the separate Konductor CLI program's own timeline.
