# Quick start: benchmark a Strands agent

[← bench home](../../README.md) · detailed guides: [Reference: Strands plant arms](../reference.md#strands-plant-arms-kind-b-phase-2) ·
[Benchmark a physical AI agent](../physical-ai.md)

A [Strands](https://strandsagents.com/) agent runs on the simulated plant only, never on code tasks. Steps 1 to 4
and step 6 are free. Step 5 spends USD on Amazon Bedrock.

**You need:** Linux, Node 22 or later, Python 3.10 or later. Run every command from the repository root.

1. Make two Pythons: one for your agent, one for the plant policy.

   ```bash
   python3.12 -m venv ~/strands-venv && ~/strands-venv/bin/pip install strands-agents
   python3.12 -m venv .venv && .venv/bin/pip install cedarpy==4.12.2
   ```

2. Build the public toy release and run the Strands controls on a scripted fake model (free, about a minute).
   A good run prints a `finished:` line for each Strands control.

   ```bash
   TOY_WORK=/tmp/toy TOY_STRANDS_PYTHON=~/strands-venv/bin/python bash bench/physical/toy/walkthrough.sh
   ```

3. Write your agent as `AGENT.py`, with a function `build_agent(model, tools)` that returns a Strands `Agent`.
   Keep the file outside the checkout.

4. Run your agent on the toy release with a scripted model (free). This is a control run and never counts.
   `SCRIPT.json` is `{"turns": [{"tools": [{"name": ..., "input": ...}]}, ..., {"text": ...}]}`: one model turn per
   call. A turn has `tools` or `text`, not both, and the last turn is a text turn. A turn with both ends the trial
   `error` with a stream mismatch.
   The task ids are on the `tasks:` line of `/tmp/toy/release.txt`.

   ```bash
   SHA=$(sed -n 's/^manifest SHA-256: //p' /tmp/toy/release.txt)
   node bench/runner/bench.js run --suite lite --tasks ID --arms st-plant-policy,st-plant-allowall --model fake:SCRIPT.json --strands-python ~/strands-venv/bin/python --strands-agent AGENT.py --plant-python .venv/bin/python --plant-release /tmp/toy/release --plant-release-sha256 $SHA --extra-tasks /tmp/toy/release/tasks --out /tmp/st-run
   ```

   From a shell that cannot use `unshare` (an agent shell), add `--isolate none --allow-unisolated`, as the
   walkthrough does.

5. Run on a real model (paid; get the owner's go-ahead and a cap first). This needs a signed release from its
   owner, not the toy one.

   ```bash
   node bench/runner/bench.js run --suite lite --tasks ID --arms st-plant-policy,st-plant-allowall --model bedrock:qwen.qwen3-coder-next --budget-usd 2 --aws-profile NAME --strands-python ~/strands-venv/bin/python --strands-agent AGENT.py --plant-python .venv/bin/python --plant-release DIR --plant-release-sha256 HEX --extra-tasks DIR/tasks --out /tmp/st-real
   ```

6. Read the result: the three numbers, then one run call by call (free).

   ```bash
   node bench/runner/bench.js plant-report --run /tmp/st-run --release /tmp/toy/release --out /tmp/st-report
   node bench/runner/bench.js plant-trace --run /tmp/st-run/st-plant-allowall/ID/1 --out /tmp/st-trace.html
   ```

An agent with its own tool hooks runs on `st-plant-policy-hooked,st-plant-allowall-hooked`, so its numbers stay apart.

## Missing today

- **No code tasks.** No command runs a Strands agent on code or scenario tasks. The Strands plugin
  (`bench/plugins/strands/meta.js`) is plant only and single turn.
- **One real model.** Only `qwen.qwen3-coder-next` in us-east-1, pinned in
  `bench/physical/strands/plant_strands/bedrock_models.json`. Any other model id is refused.
  A price last checked more than 30 days ago (`pricesReadOn`) also stops the run, until you check the price page and update it.
- **No public release.** The toy release is taken for control runs only. A real-model run needs your team's own
  signed release (`bench/physical/ci/plant-release.js`; see the reference).
- **Counted runs.** A real-model run counts only when the release pins `versions.strands.version`. Release
  plant-r2 has no pin, so its Strands runs are marked NOT COUNTED.

## Go deeper

- [Reference: Strands plant arms](../reference.md#strands-plant-arms-kind-b-phase-2): every flag, the spend cap,
  the least-privilege IAM role and the hook census.
- [Benchmark a physical AI agent](../physical-ai.md): the plant, the two arms, the controls and adding an agent.
- [Write a plugin](../write-a-plugin.md#worked-example-the-strands-plugin): how the Strands plugin is built.
- [Reading the plant report](../physical-ai-report.md).
