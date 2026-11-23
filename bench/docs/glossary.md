<!-- SPDX-License-Identifier: Apache-2.0 -->
# Glossary

[← bench home](../README.md) · [quick start](quickstart.md) · [scoring](scoring.md) · [safety and caps](safety-and-caps.md)

One line per word used across the bench docs. Grouped by topic; the first column is the word as the docs and the
reports print it.

## Runs

| Word | What it means |
| --- | --- |
| **Arm** | One setup under test. `vanilla` is the bare agent; `main` (or `konductor`) is the agent with Konductor. |
| **Runtime** | The agent program an arm runs on: Kiro CLI, Claude Code, opencode or Strands. A prefix picks it: `cc-main` is Konductor on Claude Code, `st-` is Strands. |
| **Task** | A request in a user's words, a small starting project (the fixture), and the checks that score the result. |
| **Run** | One agent working one task once, in a fresh sandbox. |
| **Replicate** | One more run of the same task and arm. Several replicates show how much results jump around. |
| **A/A pair** | The same arm run twice under two names. The gap between the two is the noise. |
| **Suite** | A named set of tasks and arms for `run --suite NAME`, such as `hard`. |
| **Pack** | The scenario tasks T1 to T12 (`bench/scenarios/`, listed in `suites/pack.json`). |
| **Run level** | LITE, STANDARD or FULL: how much of the pack one study runs ([run levels](run-levels.md)). Not the same as `--suite lite`. |
| **DEV, HELD-OUT** | Every pack task is split by a fixed hash of its id. Tuning happens on DEV; a FULL verdict comes from HELD-OUT only. |
| **Sandbox** | The walls a run gets: its own home and scratch dir, with the rest of the host hidden or read-only (`--isolate unshare` on Linux, `sandbox-exec` on macOS). |
| **NOT COUNTED** | A run that ran outside the sandbox, or on a host that is not quiet. It is kept apart and never feeds a verdict. |

## Scores

| Word | What it means |
| --- | --- |
| **Checks, hidden tests** | Code that scores a run: tests the agent never saw, and checks of its files. They score first. |
| **Rubric** | The items a judge scores, only for what code cannot check. |
| **Answer key** | A hidden list of points a good answer must cover, given to the judges of design and decision tasks. |
| **Judge panel** | Three judge models from three model families, never the agent's own family. The score is their median. |
| **Interval** | The 95% range a mean gap could plausibly have. A gap whose interval contains 0 is not shown to exist. |
| **Verdict word** | The fixed words a FULL study may use: beats by the margin, beats, ties, loses, loses by the margin, unsettled ([scoring](scoring.md)). |
| **NO DATA** | bench could not read a result, and says why (too few tasks counted, a stale baseline, a failed control, too few judge families). |
| **Unsettled** | The interval fits no other verdict word. More tasks narrow it. |
| **Control** | A run whose right answer is known, run beside the real one. If a control fails, no verdict is read. |

## Money

| Word | What it means |
| --- | --- |
| **Credit** | A Kiro CLI credit. Claude Code, opencode and the opencode judges bill in USD instead. |
| **Budget** | `--budget-credits N` (or `--budget-usd N`): new runs stop at 90% of N. |
| **Cap** | A hard limit a script checks before every paid call; the call is refused if it could pass the cap. |
| **Counted credit** | The owner's spend rule for paid calls: each call counts as at least 15 credits, or its real cost when that is more. |

## Physical AI (the plant)

| Word | What it means |
| --- | --- |
| **Plant** | A simulated machine an agent drives: the conveyor line, or the robot arm cell. |
| **Gateway** | The program that checks every plant call against the policy, then runs or refuses it, and logs it. |
| **Shim** | The small program between the agent and the gateway. It decides nothing. |
| **Policy arm, allow-all arm** | `plant-policy` lets the policy decide; `plant-allowall` runs every call and only writes down the policy's answer. |
| **Probe** | A task built to tempt an unsafe move. A **variant** is one version of a probe. |
| **Release** | The signed, private bundle of policy, probes and seeds a counted run uses. The **toy release** is public and never counts. |
| **R1 to R5** | The five safety rules (speed, open guard while moving, start with a person or open guard, driving a jam, open without approval). |
| **Unsafe try** | An unsafe call the agent sent, whether the gateway ran it or stopped it. |
| **Harm** | Something bad the simulator logged in the world. **Settle harm** is harm after the agent's last call, from something it left running ([reading the plant report](physical-ai-report.md)). |

## Keep or prune

| Word | What it means |
| --- | --- |
| **Unit** | One skill, agent file, SOP or always-loaded context file whose worth is measured. |
| **Keep arm, drop arm** | The answer with the unit, and without it. |
| **Quick depth, deep depth** | One answer per task and arm in one turn; or three full sessions per arm, plus an A/A repeat. |
| **Baseline** | A unit's 16 frozen tasks with their rubrics, written by one model family, reviewed by another, signed off by a person. |
| **Reading A, reading B** | Two scores of every answer: A against a checklist written from the request alone, B against the unit's own rubric. |
| **Stub provider** | A built-in stand-in for the models, so a whole check runs free. Its numbers are never a measurement. |
| **Sign-off** | A person who did not write the tasks reads them and records their name (`source.signedOffBy`). |
