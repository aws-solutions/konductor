<!-- SPDX-License-Identifier: Apache-2.0 -->

# FAQ

[← Back to guide index](README.md)

---

## What do I actually get when I install Konductor?

Configuration, registered with your runtime. Specifically:

| | Count | What it is |
| --- | --- | --- |
| Agents | 11 | Three orchestrators plus eight specialists |
| Skills | 82 | On-demand knowledge modules |
| SOPs | 19 | Written multi-step procedures |
| Context files | 1 | The orchestrator routing rules, always active |

No servers, no database, no cloud resources. The agents are files your existing Kiro CLI or Claude
Code installation reads and executes.

Confirm what is registered at any time:

```bash
konductor doctor
```


---

## Do I need the CLI to use the agents?

No. They are independent.

The agents are configuration your runtime reads; the CLI is a setup and build utility. Once an
install path exists you will be able to run the agents without ever building the CLI, and you can
build the CLI today without touching a runtime.

Which you want:

| Goal | Need the CLI? |
| --- | --- |
| Talk to `konductor` and get work done | No |
| Run a SOP | No |
| Read what a SOP or skill does | No |
| Scaffold `.konductor/config.yml` | Yes |
| Generate `dist/kiro-cli-v2/agents/*.json` from the specs | Yes |
| Validate that every spec, skill, and SOP parses | Yes — `konductor synth` |

---

## Which agent should I start with?

`konductor`, essentially always.

```bash
kiro-cli chat --agent konductor
```

It reads the routing rules, knows which specialist owns what, writes a proper 7-section
delegation, and verifies the result. Starting with a specialist directly skips all of that.

Go direct only when you know exactly which SOP you need and which agent declares it — for
example `k-architect` for `k-design-doc-creation`. See
[which agent owns which SOP](sop-workflows/README.md#which-agent-owns-which-sop).

Use `konductor-mux-orchestrator` or `konductor-cmux-orchestrator` instead if you want specialists in
visible parallel panes rather than as background subagents.

---

## Why does `konductor` (or the other orchestrators) refuse to edit files itself?

By design. `context/k-orchestrator-routing-rules.md` makes it read-only:

> You are a read-only orchestrator. You NEVER directly execute mutating operations or shell
> commands.

This is not even relaxed for apparently harmless commands — the file says there is "no read-only
carve-out for shell", so `ls` and `grep` are delegated too.

The reason is separation of concerns: the orchestrator is a dispatcher, and its own file says
"Having a tool available does NOT mean you should use it." File writes, git operations, shell
commands, and infrastructure changes all route to `k-developer`.

If the orchestrator *is* editing files directly, the context file did not load — see
[Troubleshooting #3](troubleshooting.md#3-the-orchestrator-does-the-work-itself-instead-of-delegating).

---

## Why does the CLI exit `64` instead of `1` or `2`?

Because `2` is taken by something more important.

`64` is `EX_USAGE` from BSD `sysexits.h`, and it means *you typed something wrong*. The exit-code
contract reserves `2` for "unresolved CRITICAL gate" — the signal that a quality gate failed and
CI should fail with it. Both argument parsers in use default usage errors to `2`, so both
implementations explicitly intercept and remap them to `64`.

The consequence matters if you script against the CLI: `2` will never mean "bad command line",
so a typo can never be mistaken for a real gate failure. Full table:
[Reference → exit codes](reference.md#exit-code-contract).

---

## What is the difference between a skill and a SOP?

**A skill is knowledge; a SOP is procedure.**

| | Skill | SOP |
| --- | --- | --- |
| Answers | "How should I think about this?" | "What do I do, in what order?" |
| Lives at | `skills/<name>/SKILL.md` | `agent-sops/<name>.sop.md` |
| Structure | YAML frontmatter plus guidance | Overview, Parameters, numbered Steps with MUST/MUST NOT constraints |
| Loaded | On demand — name and description at session start, full content when relevant | On demand, and only for agents whose spec declares it |
| Count | 82 | 19 |

A SOP usually *invokes* skills. `k-test-coverage-review` is a good example: the SOP is the
sequence and the gates, while `test-coverage-analysis`, `e2e-test-strategy`, and
`security-test-generation` supply the expertise at each step.

---


---

## Can I edit the agents, skills, and SOPs?

Yes — that is much of the point. They are JSON and Markdown in this repository, so you can read
exactly what each agent will do and change it.

Common edits, in ascending order of blast radius:

| Edit | File | Effect |
| --- | --- | --- |
| Change routing | `context/k-orchestrator-routing-rules.md` | Which specialist gets which kind of request |
| Change a procedure | `agent-sops/<name>.sop.md` | The steps, constraints, and gates of one workflow |
| Change knowledge | `skills/<name>/SKILL.md` | How an agent reasons about one topic |
| Change an agent | `agents/<name>.agent-spec.json` | Its prompt, model, tools, or declared SOPs and skills |

Three things to know before you do:

- **Routing lives in two places.** The routing rules file says so itself: `delegation-protocol`
  (`skills/delegation-protocol/SKILL.md`) is the authoritative source, and the context file's table is
  a quick-reference summary. When they conflict, the skill wins — so update **both**.
- **Validate your edits with `synth`.** It parses every spec, skill, and SOP and reports the first
  failure with a file and reason. Silence plus 11 agent JSONs in `dist/kiro-cli-v2/agents/` means
  everything parsed. (That directory also holds `_skill_scopes.json` and `_sop_scopes.json`, so a
  bare `ls | wc -l` reports 13.)
- **`konductor update` destroys local modifications.** It is an unconditional overwrite of every
  tracked file under `.kiro/agents/`, `.konductor/skills/`, and `.konductor/manifest`. Commit your
  edits, and run `konductor update --dry-run` before every update to see what would be clobbered.

Full detail in [Contributing and customizing](appendix/contributing.md).

---

## How do I make a setting apply to every project?

Create a user-level config. Precedence is preset → user → project, merged per field, project
winning.

```bash
mkdir -p ~/.konductor
```

Then put only the fields you want to override into `~/.konductor/config.yml`:

```yaml
version: 1
tier: major
```

Any project's own `.konductor/config.yml` still overrides this for the fields it sets.

This is also the answer to "why is my config not what I expect?" — a forgotten user-level file is
the usual culprit, since it applies everywhere and nothing surfaces it. See
[Diagnose problems → which layer supplied a value](tasks/diagnose-problems.md#why-is-a-config-value-what-it-is).

---

## Is any of my data sent anywhere?

The CLI touches the network in one place only: `install`, fetching the release it installs from.
Everything else — `update`, `doctor`, `init`, `synth`, `metrics` — is entirely local.
Neither `update` nor `doctor` makes any release call: neither has version
awareness. It writes to `.konductor/`, `dist/`, your runtime's configuration directory,
and `~/.konductor/` — nowhere else.

Three things to be aware of nonetheless:

1. **Your runtime sends your prompts to a model provider.** That is Kiro CLI's or Claude Code's
   behavior, not Konductor's, and it applies whether or not Konductor is installed.
2. **The AWS MCP integration reaches an AWS endpoint** — `https://aws-mcp.us-east-1.api.aws/mcp`,
   declared in the `k-architect` and `k-developer` specs — when those agents look up AWS
   documentation. It is opt-in in the sense that it needs `uvx` and credentials present.
3. **The project's `README.md` includes a data-collection notice** stating that the solution sends
   operational metrics to AWS about its use, subject to the
   [AWS Privacy Notice](https://aws.amazon.com/privacy/).

The invocation log at `~/.konductor/logs/konductor.log` is local, mode `0600`, and never
transmitted. Delete it whenever you like.

---

## Why did my code review skip the security pass?

Because it always does. `k-code-review-workflow` step 6 tries to spawn `k-architect` for an
adversarial pass, and **the only agent that owns the SOP cannot spawn the architect** — in Kiro CLI
`k-developer`'s `availableAgents` list does not include it, and in Claude Code it has no
`Agent(...)` tool.
The SOP is written to skip the step quietly when the capability is missing, so you get standard
review with no error.

Routing through `konductor` does not fix it either: the orchestrator does not declare
`k-code-review-workflow`, so it hands the SOP to the developer, which hits the same wall.

Run the adversarial pass yourself against the agent that owns it:

```text
Run k-adversarial-pull-request-review against my current diff.
```

Detail, with the verification, is in
[Agents reference](agents.md#why-this-matters-a-real-consequence).

---

## Where do the SOP output files go?

Each SOP has its own default output location. Most accept an override.

| SOP | Default output |
| --- | --- |
| `k-code-review-workflow` | `code-review-report.md` |
| `k-code-cleanup` | `cleanup-report.md` |
| `k-pre-cr-critique` | `.agents/scratchpad/critique-NNN.md` |
| `k-adversarial-pull-request-review` | `adversarial-review-report.md` |
| `k-existing-design-review` | `design-review-report.md` |
| `k-design-doc-creation` | `docs/design/<slugified-topic>.md`, plus `-aws-validation.md` and `-tradeoffs.md` |
| `k-test-coverage-review` | `test-coverage-review/` — four files |
| `k-codebase-analysis` | `codebase-analysis.md` |
| `kiro-spec-workflow` | `.kiro/specs/<feature-name>/` — three files |
| `k-context-gathering` | `.konductor/handoff/<name>.md`, only when findings exceed ~100 lines |

Nearly all of these SOPs are required to reference the file path rather than print the report
inline, so if you get a one-paragraph summary and a path, that is correct behavior — the file is
the deliverable.

Note none of these paths are gitignored by default. Add them to your `.gitignore` if you would
rather not commit generated reports.

---

[← Troubleshooting](troubleshooting.md) · [Back to guide index](README.md) · [Next: Glossary →](glossary.md)
