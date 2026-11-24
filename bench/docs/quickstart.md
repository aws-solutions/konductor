<!-- SPDX-License-Identifier: Apache-2.0 -->
# Quick start: bench in 15 minutes, for free

[← bench home](../README.md) · [glossary](glossary.md) · [scoring](scoring.md) · [troubleshooting](troubleshooting.md)

**Quick start:** after this free tour, [benchmark my agent](how-to/benchmark-an-agent.md) is the first paid run in seven steps.

Everything on this page is free: no model call, no credits, no AWS keys, no login. You need Linux (macOS runs part 1 only), Node 22
or later, `git`, a clone of this repository, and (for part 2) Python 3.10 or newer, or 3.12 for the robot arm. Run every command from the repository root.

| Part | What you see | Time |
| --- | --- | --- |
| 1. A keep-or-prune scoreboard | how bench reports a result, and why it says NO DATA | 2 minutes |
| 2. The toy plant walkthrough | an agent driving a simulated machine, with every unsafe move counted | 5 minutes |
| 3. The test suites (optional) | the scorer, the gateway and the controls checking themselves | about 10 minutes |
| 4. Where to go next | which guide answers your question | 1 minute |

## 1. A keep-or-prune scoreboard

```bash
git fetch origin main
node bench/runner/bench.js cap keep-prune --skill plan-review --run stub-pilot --out /tmp/kp
node bench/runner/bench.js cap list --base main
node bench/runner/bench.js list-arms
```

The first command prints a scoreboard made from built-in stub data, never a measurement. Read its shape: each row is
a measure with its 95% interval, the controls had to pass first, three judges from three model families scored it,
and the answer is **NO DATA** with its reasons. The README shows the output and explains each row. The other two
commands list every agent, skill and SOP in the repo with who reaches it, and every arm you can run.

## 2. The toy plant walkthrough

```bash
python3.12 -m venv .venv && .venv/bin/pip install cedarpy==4.12.2
bash bench/physical/toy/walkthrough.sh
```

It builds a public toy release, tests its policy cell by cell, runs a careful scripted agent and an unsafe one on both
arms, and writes a plant report and a trace page. A good run ends with `11 of 11 cells pass` and `yes` in every
`met` cell of the Controls table. Open the `trace.html` it names in a browser: on the allow-all arm the unsafe call
runs; on the policy arm the gateway blocks it. [Benchmark a physical AI agent](physical-ai.md#try-it) explains each
step, and [reading the plant report](physical-ai-report.md) explains the report's words.

With a Python 3.12 venv that has MuJoCo (`pip install mujoco==3.13.0 numpy==2.5.5 cedarpy==4.12.2`), set
`TOY_ARM_PYTHON` to it and the same script also runs the robot arm.

## 3. The test suites

```bash
.venv/bin/python -m unittest discover -s bench/physical/test -p 'test_*.py'
TMPDIR=/tmp node --test bench/runner/test/plant-*.test.js bench/runner/test/cap-*.test.js
```

The tests use fake agents and stub models, so they spend nothing. A test that needs a tool you lack (MuJoCo, user
namespaces) skips and says why.

## 4. Where to go next

| You want to | Read |
| --- | --- |
| Test a skill | [Benchmark a skill](skills.md) |
| Test an agent, or compare two setups | [Quick start](how-to/benchmark-an-agent.md), then [Benchmark an agent](agents.md) |
| Test an agent that drives a machine | [Quick start](how-to/physical-ai-agent.md), then [Benchmark a physical AI agent](physical-ai.md) |
| Test a Strands agent | [Quick start](how-to/strands-agent.md) |
| Test an agent on Amazon Bedrock AgentCore | [Quick start](how-to/agentcore-agent.md): not supported yet, and what is missing |
| Draft test tasks or cases for an agent | [Quick start](how-to/generate-scenarios.md) |
| Bring an agent that is not Kiro CLI or Konductor | [Bring your own agent](agents.md#bring-your-own-agent) |
| Run your first paid comparison | [Repeat it yourself](repeat-it-yourself.md), then [safety and caps](safety-and-caps.md) |
| Understand the numbers | [How scoring works](scoring.md) |
| Run a Konductor study (LITE, STANDARD, FULL) | [Run levels](run-levels.md) |
| Look up a command or flag | [The reference](reference.md) |
