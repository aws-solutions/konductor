# Quick start: benchmark my agent

[← bench home](../../README.md) · detailed guide: [Benchmark an agent](../agents.md)

For an agent that runs on Kiro CLI, Claude Code or opencode. Steps 1 to 3 are free. Steps 4 and 5 spend credits.

**You need:** Node 22 or later, `git`, a clone, the agent CLI logged in, and Linux with `unshare` (or macOS).
Run every command from the repository root.

1. See the arms you can run (free).

   ```bash
   node bench/runner/bench.js list-arms
   ```

2. Plan the run and its cost. This prints the plan and runs nothing (free).

   ```bash
   node bench/runner/bench.js pr-plan --ref opt-a=origin/main --suite lite --budget-credits 100
   ```

3. Build and install both arms without starting an agent (free).

   ```bash
   OUT=/var/tmp/bench-first
   node bench/runner/bench.js run --suite lite --arms vanilla,main --tasks simple-fix-failing-test --replicates 3 --budget-credits 40 --out $OUT --prepare-only
   ```

4. Run it: two arms, three runs each. New runs stop at 90% of the budget (paid).

   ```bash
   node bench/runner/bench.js run --suite lite --arms vanilla,main --tasks simple-fix-failing-test --replicates 3 --budget-credits 40 --out $OUT
   ```

5. Judge it. The first command shows the cost; the second spends (paid).

   ```bash
   node bench/runner/bench.js judge --run $OUT --plan
   node bench/runner/bench.js judge --run $OUT
   ```

6. Read the report, and why one run scored what it did (free).

   ```bash
   node bench/runner/bench.js report --run $OUT
   node bench/runner/bench.js explain --run $OUT --arm main --task simple-fix-failing-test --rep 1
   ```

   `report` writes `report.md`, `report.html` and `report.json` in `$OUT`.

7. Use your own tasks. Check them for free, then pass the folder to step 3.

   ```bash
   node bench/tasks/validate-tasks.js --extra-tasks DIR --only-extra
   node bench/runner/bench.js run --suite cap --extra-tasks DIR --tasks ID --arms vanilla,main --budget-credits 20 --out $OUT --prepare-only
   ```

Claude Code instead of Kiro CLI: use the arms `cc-vanilla,cc-main` with `--budget-usd N --aws-profile NAME`.
An agent program bench does not run yet needs a plugin: see [Write a plugin](../write-a-plugin.md).

## Go deeper

- [Benchmark an agent](../agents.md): how one run works, arms and runtimes, reading the report, writing a task,
  judges, and bringing an agent bench does not run yet.
- [Repeat it yourself](../repeat-it-yourself.md): from a clone to a first result.
- [Benchmark tasks](../tasks.md): the task file format.
- [Safety and caps](../safety-and-caps.md): the walls around a run and every spend limit.
- [Reference](../reference.md): every command and flag.
