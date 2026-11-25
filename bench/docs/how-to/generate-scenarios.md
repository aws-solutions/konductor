# Quick start: generate scenarios for my agent

[← bench home](../../README.md) · detailed guides: [Capability playbook](../cap-playbook.md) ·
[agenteval](../../agenteval/README.md)

Two ways in. Path A drafts tasks for a Konductor skill or agent. Path B drafts test cases for any agent from its
tool list. Both give drafts for a person to read. Neither runs your agent.

**You need:** for path A, a Kiro CLI login. For path B, a Python with `strands-agents-evals`.

## Path A: a Konductor skill or agent

1. Find the skills and agents that have no test task (free).

   ```bash
   node bench/runner/bench.js cap list --base main
   ```

2. See the prompt the drafter would send (free). Put `--out` outside your home folder: the `cap` commands refuse
   an output folder under the home.

   ```bash
   node bench/runner/bench.js cap scenarios --cap skill:NAME --dry-run --out /tmp/scn
   ```

3. Draft 8 tasks that test the skill once it is loaded (one model call; it prints the credits it used).

   ```bash
   node bench/runner/bench.js cap scenarios --cap skill:NAME --n 8 --out /tmp/scn
   ```

4. Draft 10 requests that should load the skill, and near misses that should not (one model call).

   ```bash
   node bench/runner/bench.js cap scenarios --cap skill:NAME --mode trigger --n 10 --out /tmp/scn
   ```

5. Read every draft in `/tmp/scn/scenarios/`. Write the good ones as task files by hand.

6. Check your task files (free).

   ```bash
   node bench/tasks/validate-tasks.js --extra-tasks DIR --only-extra
   ```

## Path B: any agent, from its tool list

1. Write `context.md` with one line per tool, such as `- lookup_order(order_id: str) -> dict`.

2. Generate cases. This calls a model, so it may cost money.

   ```bash
   node bench/agenteval/agenteval.js generate-strands --trajectories --context-file context.md \
     --task-description "what your agent does" --out work/experiment.json --python .venv/bin/python
   ```

3. Sort the cases into `ok`, `needs-edit` and `reject`, with reasons (free).

   ```bash
   node bench/agenteval/agenteval.js import-strands --experiment work/experiment.json \
     --tools-from-text context.md --generation work/experiment.generation.json --out work/candidates
   ```

4. A person reads `work/candidates/review.md` and every case, `ok` ones too.

## Missing today

No command turns an approved draft into a runnable task file, on either path. A person writes the task JSON
(fixture, checks, rubric) by hand. For agenteval this is DEBT row D-112.

## Go deeper

- [Capability playbook](../cap-playbook.md): the order of work, trigger tests and reviewing drafts.
- [Benchmark a skill](../skills.md): what to do with the tasks once they exist.
- [agenteval guide](../../agenteval/README.md): rules, filters and limits of path B.
- [Benchmark tasks](../tasks.md): the task file format.
- [Reference: the cap family](../reference.md#capability-benchmarking-cap): every `cap` flag.
