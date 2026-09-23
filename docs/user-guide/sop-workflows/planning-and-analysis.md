<!-- SPDX-License-Identifier: Apache-2.0 -->

# SOPs: planning, analysis, and verification

[← SOP workflows](README.md) · [Guide index](../README.md)

Four of the SOPs the orchestrators declare. Together they cover the front and back ends of a
piece of work: plan it, gather context for it, delegate it, and verify it is actually done.

| SOP | Source file | Declared by |
| --- | --- | --- |
| [`k-plan`](#k-plan) | `agent-sops/k-plan.sop.md` | all three orchestrators |
| [`k-context-gathering`](#k-context-gathering) | `agent-sops/k-context-gathering.sop.md` | all three orchestrators |
| [`k-verify`](#k-verify) | `agent-sops/k-verify.sop.md` | all three orchestrators |
| [`k-delegate`](#k-delegate) | `agent-sops/k-delegate.sop.md` | `konductor` only |

---

## `k-plan`

### What it does

Turns an objective into a work breakdown: measurable success criteria, prioritized tasks with
effort estimates, a dependency map, per-task agent assignments, a buffered timeline, and a
phased execution plan.

### When to invoke it

Multi-step tasks needing coordination, complex features needing structure, before starting any
non-trivial implementation, or when the scope itself needs clarification.

### How to invoke it

```bash
kiro-cli chat --agent konductor
```

```text
Run the k-plan SOP. objective: add rate limiting to the public API
```

### Parameters

| Parameter | Required | Default |
| --- | --- | --- |
| `objective` | **Yes** | — |
| `scope` | No | none — boundaries such as specific directories, services, or components |
| `constraints` | No | none — deadlines, technology restrictions, team availability |

### Flow

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontSize':'14px','primaryColor':'#eef2f7','primaryTextColor':'#0f172a','primaryBorderColor':'#40556e','lineColor':'#7a8899','textColor':'#0f172a','edgeLabelBackground':'#ffffff','clusterBkg':'#fafbfc','clusterBorder':'#c9d2dc'}}}%%
flowchart TD
    P{"objective<br/>provided?"} -->|No| Ask["Ask for it, wait"]
    Ask --> P
    P -->|Yes| S1

    S1["1. Define success criteria<br/>Functional / Observable / Pass-Fail"]
    S1 --> G1{"Criteria<br/>defined?"}
    G1 -->|No| S1
    G1 -->|Yes| S2["2. Break down tasks<br/>each with effort estimate<br/>+ High / Medium / Low priority"]
    S2 --> S3["3. Map dependencies<br/>blocking · parallel · external<br/>no circular dependencies"]
    S3 --> S4["4. Assign to agents<br/>via the SOP's assignment table"]
    S4 --> S5["5. Estimate timeline"]

    S5 --> B["Group into phases<br/>Sum serial effort<br/>Apply buffer: 20% known / 40% novel<br/>= Total Estimated Effort (baseline)"]
    B --> AP{"Can k-tpm<br/>be reached?"}
    AP -->|Yes — preferred| D1["Delegate Agentic Projection to k-tpm<br/>(runs legacy-to-agentic-estimate + its script)<br/>pass each task individually"]
    AP -->|"No, but the method<br/>can be applied"| D2["Self-compute using the skill's<br/>documented formula<br/>state: not script-verified"]
    AP -->|"No, and no defensible<br/>tier can be inferred"| D3["Skip the projection for that item<br/>state why in one line<br/>report its baseline alone<br/>(per item, not the whole run)"]

    D1 --> S6
    D2 --> S6
    D3 --> S6

    S6["6. Create execution plan<br/>phases ordered by dependencies<br/>parallel tasks marked<br/>Verification phase included<br/>Documentation phase if user-facing"]

    class Ask gate
    class B focus
    class D3 muted

    classDef gate fill:#fdf3e0,stroke:#a06800,stroke-width:1.5px,color:#0f172a;
    classDef focus fill:#dbe7f5,stroke:#2a5d8f,stroke-width:2px,color:#0f172a;
    classDef muted fill:#f4f4f5,stroke:#8a8a8a,stroke-width:1.2px,color:#0f172a,stroke-dasharray:4 3;
```

*`k-plan`: six steps, with a three-way fallback on the agentic estimate.*

### What you get

A success-criteria block, a prioritized task list, a dependency map, an agent assignment table,
a timeline table with a **Total Estimated Effort (baseline)**, and a phased execution plan.

Where the plan assigns agents, it uses the SOP's own table — for example codebase search and
external research to `k-researcher`, implementation and tests to `k-developer`,
architecture review to `k-architect`, media analysis to `k-media-analyzer`, plan review
and effort estimation to `k-tpm`.

### Things to know

- **The baseline is the commitment; the projection is not.** The SOP requires the buffered
  baseline to be presented as authoritative, and forbids presenting the Agentic Projection as
  the committed estimate.
- **The buffer has a floor.** 20% for well-understood work, 40% for novel or uncertain work.
  There is no zero-buffer tier.
- **The projection's precision is not real.** The SOP requires carrying the caveat that tier
  presets are uncalibrated defaults pending team telemetry, and instructs treating differences
  finer than about 15 minutes as noise. It also forbids narrowing or collapsing the low–high
  band to just the mid point.
- **A skipped projection is not a failure.** The SOP says so explicitly: the baseline is
  authoritative and complete without it.

---

## `k-context-gathering`

### What it does

Gathers comprehensive context before implementation begins — parallel research agents plus
direct tool searches — then answers a fixed set of questions, checks whether the work needs
architect escalation, and synthesizes findings into a structured summary.

### When to invoke it

Before implementing in unfamiliar code, for complex multi-system changes, when debugging after
2+ failed attempts, for architecture decisions, or to understand existing patterns.

### How to invoke it

```text
Run the k-context-gathering SOP. target: the authentication middleware
```

### Parameters

| Parameter | Required | Default |
| --- | --- | --- |
| `target` | **Yes** | — |
| `analysis_questions` | No | none — added to the five standard questions |
| `scope` | No | none — directories, services, or components to focus on |

### Flow

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontSize':'14px','primaryColor':'#eef2f7','primaryTextColor':'#0f172a','primaryBorderColor':'#40556e','lineColor':'#7a8899','textColor':'#0f172a','edgeLabelBackground':'#ffffff','clusterBkg':'#fafbfc','clusterBorder':'#c9d2dc'}}}%%
flowchart TD
    P{"target<br/>provided?"} -->|No| Ask["Ask for it, wait"]
    Ask --> P
    P -->|Yes| S1

    subgraph S1["1. Gather context — in parallel"]
        A1["k-researcher ×1–2<br/>codebase patterns, structure"]
        A2["k-researcher ×1–2<br/>external library docs<br/>(if external deps involved)"]
        A3["Direct tools: grep / rg<br/>ast-grep for structural search"]
    end

    S1 --> S2["2. Answer 5 standard questions<br/>+ any supplied analysis_questions"]
    S2 --> G1{"All questions<br/>answered?"}
    G1 -->|No| S1
    G1 -->|Yes| S3["3. Assess complexity<br/>check every escalation indicator"]

    S3 --> E{"Any indicator true?"}
    E -->|Yes| Esc["Recommend escalation<br/>to k-architect, with reason"]
    E -->|No| S4
    Esc --> S4["4. Synthesize findings<br/>Current State · Patterns · Dependencies<br/>Constraints · Recommended Approach"]

    S4 --> Big{"Findings<br/>over ~100 lines?"}
    Big -->|Yes| File["Write to .konductor/handoff/&lt;name&gt;.md<br/>return the path"]
    Big -->|No| S5
    File --> S5

    S5{"Questions all answered AND<br/>escalation resolved?"}
    S5 -->|No| Block["Do not proceed to implementation"]
    S5 -->|Yes| Done["5. Hand off to k-plan<br/>define success criteria before any code"]

    class Ask gate
    class Block stop
    class Done focus

    classDef gate fill:#fdf3e0,stroke:#a06800,stroke-width:1.5px,color:#0f172a;
    classDef stop fill:#fdeaef,stroke:#a1123f,stroke-width:1.5px,color:#0f172a;
    classDef focus fill:#dbe7f5,stroke:#2a5d8f,stroke-width:2px,color:#0f172a;
```

*`k-context-gathering`: parallel gathering, then two hard gates before implementation may begin.*

### The five standard questions

Always answered, plus anything you add:

1. How does the existing system work?
2. What patterns are currently used?
3. What dependencies are involved?
4. What are the integration points?
5. What tests exist?

### The escalation indicators

Any one of these triggers a recommendation to consult `k-architect`:

| Indicator | Action |
| --- | --- |
| Architecture decision required | Escalate |
| Multi-system coordination (3+ components) | Escalate |
| Debugging after 2+ failed fix attempts | Escalate |
| Security implications | Escalate |
| Simple implementation with clear patterns | Proceed |

### Things to know

- **Test files are never skipped** during context gathering — the SOP forbids it.
- **Large findings go to a file.** Over roughly 100 lines, the synthesis is written to
  `.konductor/handoff/<analysis-name>.md` and only the path is returned. Note this is a
  different `.konductor/` subdirectory from anything the CLI creates.
- **This SOP does not write code.** It ends by handing off to `k-plan`, or by recommending
  escalation with specific questions.
- **Execution context matters.** The SOP notes its steps run shell commands and may write files;
  an agent without those tools delegates them to specialists per its routing rules. This is why
  the read-only orchestrator can still run it.

---

## `k-verify`

### What it does

Runs the full verification battery — build, tests, lint, CDK checks where applicable, and
manual verification — then collects everything into one evidence report with a final checklist.

### When to invoke it

After completing implementation, before declaring any task done, when you ask for verification,
or after a bug fix to confirm the fix.

### How to invoke it

```text
Run the k-verify SOP. source_dir: src/
```

### Parameters

| Parameter | Required | Default |
| --- | --- | --- |
| `source_dir` | **Yes** | — |
| `success_criteria` | No | none — typically carried over from `k-plan` |
| `build_system` | No | auto-detect. One of `npm`, `cargo`, `go`, `python`, `gradle`, `maven` |

### Flow

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontSize':'14px','primaryColor':'#eef2f7','primaryTextColor':'#0f172a','primaryBorderColor':'#40556e','lineColor':'#7a8899','textColor':'#0f172a','edgeLabelBackground':'#ffffff','clusterBkg':'#fafbfc','clusterBorder':'#c9d2dc'}}}%%
flowchart TD
    S1["1. Pre-check<br/>success criteria defined?<br/>all TODOs complete?"]
    S1 --> G0{"Prerequisites<br/>met?"}
    G0 -->|No| Ask["Ask the user to define<br/>success criteria, or extract<br/>them from task context"]
    Ask --> S1
    G0 -->|Yes| S2["2. Run build<br/>auto-detected from project files"]

    S2 --> G1{"Build<br/>passed?"}
    G1 -->|No| Stop1["STOP — fix build errors first"]
    G1 -->|Yes| S3["3. Run tests<br/>capture pass / fail counts<br/>plus any integration suite or CI job"]

    S3 --> G2{"Tests<br/>passed?"}
    G2 -->|No| Stop2["STOP — fix test failures first"]
    G2 -->|Yes| S4["4. Run lint<br/>capture errors + warnings"]

    S4 --> G3{"Lint<br/>errors?"}
    G3 -->|"Errors present"| Stop3["STOP — fix lint errors<br/>(warnings are acceptable)"]
    G3 -->|"None"| S5{"CDK code<br/>present?"}

    S5 -->|Yes| CDK["5. cdk ls → cdk diff → cdk synth<br/>flag unexpected stack changes"]
    S5 -->|No| S6
    CDK --> S6["6. Manual verification<br/>what was tested, steps, observed<br/>— cannot be skipped"]

    S6 --> G4{"Observed matches<br/>expected?"}
    G4 -->|No| Stop4["Do not declare success"]
    G4 -->|Yes| S7["7. Collect evidence<br/>every step's command, exit code,<br/>output, and status"]

    S7 --> G5{"Every checklist<br/>item passes?"}
    G5 -->|No| Fail["Report failures — task not complete"]
    G5 -->|Yes| Pass["All criteria met. Task complete."]

    class Stop1,Stop2,Stop3,Stop4,Fail stop
    class Pass good

    classDef stop fill:#fdeaef,stroke:#a1123f,stroke-width:1.5px,color:#0f172a;
    classDef good fill:#e6f6ef,stroke:#199e70,stroke-width:1.5px,color:#0f172a;
```

*`k-verify`: a strict gate chain. Any failing step halts the sequence.*

### Build-system auto-detection

| Project file found | Build | Test | Lint |
| --- | --- | --- | --- |
| `package.json` | `npm run build` | `npm test` | `npm run lint` |
| `Cargo.toml` | `cargo build` | `cargo test` | `cargo clippy` |
| `go.mod` | `go build ./...` | `go test ./...` | `golangci-lint run` |
| `pyproject.toml` or `setup.py` | `python -m build` | `pytest` | `ruff check .` |
| `build.gradle.kts` or `build.gradle` | `gradle build` | `gradle test` | `gradle checkstyleMain`, or the project's configured plugin |
| `pom.xml` | `mvn compile` | `mvn test` | `mvn checkstyle:check`, or the project's configured plugin |

The SOP also requires preferring the project's wrapper or lockfile-indicated tool: `./gradlew`
over `gradle` when `gradlew` exists, `pnpm` or `yarn` over `npm` when `pnpm-lock.yaml` or
`yarn.lock` exists. For Gradle and Maven it requires inspecting the build configuration for a
configured lint plugin before choosing the lint command, since Java and Kotlin linting is
project-specific.

### Things to know

- **Lint warnings are acceptable; lint errors are not.** That distinction is explicit.
- **Manual verification cannot be skipped.** The SOP states automated tests alone are
  insufficient.
- **The final checklist is all-or-nothing.** Seven items: success criteria met, build passes,
  tests pass, lint passes, manual verification complete, no regressions, documentation updated
  if applicable. Any failure means the task is not complete.

---

## `k-delegate`

### What it does

Builds the 7-section delegation prompt the orchestrator sends to a specialist, then verifies
what comes back.

### When you would invoke it

Normally you would not. This is internal machinery — the orchestrator uses it on every
delegation. Reading it is still worthwhile, because it tells you exactly what the orchestrator
is sending on your behalf, and its 8-step structure explains the "up to 2 fix cycles" behavior
you will see in practice.

### Parameters

| Parameter | Required | Default |
| --- | --- | --- |
| `task_description` | **Yes** | — |
| `target_agent` | **Yes** | — e.g. `k-researcher`, `k-developer`, `k-media-analyzer`, `k-browser` |
| `context_paths` | No | none — relevant paths, directories, or URLs |
| `language` | No | auto-detect from project |

### Flow

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontSize':'14px','primaryColor':'#eef2f7','primaryTextColor':'#0f172a','primaryBorderColor':'#40556e','lineColor':'#7a8899','textColor':'#0f172a','edgeLabelBackground':'#ffffff','clusterBkg':'#fafbfc','clusterBorder':'#c9d2dc'}}}%%
flowchart TD
    P{"task_description AND<br/>target_agent present?"} -->|No| Ask["Ask for the missing one, wait"]
    Ask --> P
    P -->|Yes| Build

    subgraph Build["Steps 1–6 — build each section"]
        direction TB
        S1["1. TASK — exactly one atomic action"]
        S2["2. EXPECTED OUTCOME — measurable deliverables"]
        S3["3. REQUIRED SKILLS + TOOLS — explicit allowlist"]
        S4["4. MUST DO — exhaustive, nothing implicit"]
        S5["5. MUST NOT DO — includes a response size limit"]
        S6["6. CONTEXT — root path, source dirs, ignore list, patterns"]
        S1 --> S2 --> S3 --> S4 --> S5 --> S6
    end

    Build --> S7["7. Assemble the 7-section prompt<br/>substitute the real target agent<br/>omit no section"]
    S7 --> Send["Send to the target agent"]
    Send --> S8["8. Verify results against<br/>the 6-item checklist"]

    S8 --> G{"All checks<br/>pass?"}
    G -->|Yes| Done["Results usable — continue"]
    G -->|No| Retry{"Fewer than<br/>2 fix cycles used?"}
    Retry -->|Yes| Re["Re-delegate"]
    Re --> Send
    Retry -->|No| Give["Stop re-delegating<br/>(2-cycle cap reached)"]

    class Ask gate
    class Done good
    class Give stop

    classDef gate fill:#fdf3e0,stroke:#a06800,stroke-width:1.5px,color:#0f172a;
    classDef good fill:#e6f6ef,stroke:#199e70,stroke-width:1.5px,color:#0f172a;
    classDef stop fill:#fdeaef,stroke:#a1123f,stroke-width:1.5px,color:#0f172a;
```

*`k-delegate`: build all seven sections, send, verify, re-delegate up to twice.*

### The verification checklist

Every delegation result is checked against all six:

1. Did the agent complete the TASK?
2. Did it provide the EXPECTED OUTCOME?
3. Did it use only the REQUIRED TOOLS?
4. Did it follow the MUST DO requirements?
5. Did it avoid the MUST NOT DO prohibitions?
6. Are the results usable for next steps?

### Things to know

- **Every section is mandatory.** The SOP forbids omitting any of the seven.
- **The tool allowlist exists to prevent tool sprawl** — giving an agent only what the task
  needs.
- **A response size limit belongs in MUST NOT DO.** The SOP's example is "Do not return
  responses exceeding ~100 lines", alongside "do not return raw file contents or complete
  source code — summarize with file paths and key snippets".
- **It carries a language reference table** mapping eight concepts — source files, test files,
  HTTP client, dependency directory, package manager, config file, build command, test command —
  across Go, Java, Kotlin, Python, Swift, and TypeScript, so examples written in TypeScript can be
  adapted to whatever the project uses.

---

[← SOP workflows](README.md) · [Next: Design →](design.md)
