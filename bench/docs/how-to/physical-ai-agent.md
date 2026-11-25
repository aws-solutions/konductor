# Quick start: benchmark a physical AI agent through simulation

[← bench home](../../README.md) · detailed guide: [Benchmark a physical AI agent](../physical-ai.md)

Your agent drives a simulated machine through a gateway. Fixed rules in code count every unsafe move; no AI judge
decides safety. Steps 1 to 4 and step 6 are free. Step 5 spends.

**You need:** Linux, Node 22 or later, Python 3.10 or later (3.12 for the robot arm). Run every command from the
repository root.

1. Install the policy engine.

   ```bash
   python3.12 -m venv .venv && .venv/bin/pip install cedarpy==4.12.2
   ```

2. Prove the bench works, with the public toy release and scripted agents (free, under a minute).
   A good run shows `11 of 11 cells pass`, and `yes` in every `met` cell of the Controls table.

   ```bash
   bash bench/physical/toy/walkthrough.sh
   ```

3. Run the plant tests (free).

   ```bash
   node --test bench/runner/test/plant-*.test.js
   .venv/bin/python -m unittest discover -s bench/physical/test -p 'test_*.py'
   ```

4. With your team's signed release `DIR`, check the host and the policy (free).

   ```bash
   node bench/runner/bench.js plant-host-check --release DIR --release-sha256 HEX
   node bench/runner/bench.js plant-policy-test --release DIR --python .venv/bin/python
   ```

5. Run your agent on both arms, policy on and policy off (paid; get the owner's go-ahead and a cap first).

   ```bash
   node bench/runner/bench.js run --suite lite --tasks ID --arms plant-policy,plant-allowall --plant-release DIR --plant-release-sha256 HEX --extra-tasks DIR/tasks --hide CHECKOUT --budget-credits 20 --out OUT
   ```

   Claude Code: use the arms `cc-plant-policy,cc-plant-allowall`. Strands: see
   [Quick start: benchmark a Strands agent](strands-agent.md).

6. Read the three numbers, then one run call by call (free).

   ```bash
   node bench/runner/bench.js plant-report --run OUT --release DIR --out REPORT
   node bench/runner/bench.js plant-trace --run TRIAL_DIR --out trace.html
   ```

**The robot arm:** make the venv with `mujoco==3.13.0 numpy==2.5.5 cedarpy==4.12.2` on Python 3.12, then run
`TOY_ARM_PYTHON=.venv/bin/python bash bench/physical/toy/walkthrough.sh`.

## Missing today

- **No public release, by design.** A team makes and signs its own with `bench/physical/ci/plant-release.js`
  (`keygen`, `pin`, `sign`, `verify`). Only the reference explains it.
- **No counted run yet (2026-11-24).** Every run so far is marked NOT COUNTED. What a counted run needs:
  [the first counted run](../physical-ai-counted-set.md#the-first-counted-run).

## Go deeper

- [Benchmark a physical AI agent](../physical-ai.md): the loop, the two plants, the controls, the release, and
  adding your own agent.
- [Reading the plant report](../physical-ai-report.md): unsafe tries, harm and harm after the last call.
- [The counted test set](../physical-ai-counted-set.md): the probes and how they are kept secret.
- [Reference: plant suite](../reference.md#plant-suite-simulator): every plant flag and release signing.
