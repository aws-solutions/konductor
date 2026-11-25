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

3. Draft 8 tasks that test the skill once it is loaded (one model call, two if the first reply is unusable; it prints the credits it used).
   `--budget-credits` is required: the run is refused before any call when 15 credits per possible call
   (two per skill) would pass it, so 30 covers one skill.

   ```bash
   node bench/runner/bench.js cap scenarios --cap skill:NAME --n 8 --budget-credits 30 --out /tmp/scn
   ```

4. Draft 10 requests that should load the skill, and near misses that should not (one model call).

   ```bash
   node bench/runner/bench.js cap scenarios --cap skill:NAME --mode trigger --n 10 --budget-credits 30 --out /tmp/scn
   ```

5. Read every draft in `/tmp/scn/scenarios/`. Delete the scenarios you do not want.

6. Start a task from one good scenario (free). `--hidden-writer` names the model that will write the hidden tests;
   a Claude model is refused. The command writes a skeleton with TODO checks and lists what is left to write.

   ```bash
   node bench/runner/bench.js scenarios emit /tmp/scn/scenarios/skill-NAME.json --scenario s01 \
     --hidden-writer gpt-5 --out /tmp/tasks
   ```

7. Write the fixture, the checks and the rubric, then check the task files (free).

   ```bash
   node bench/tasks/validate-tasks.js --extra-tasks /tmp/tasks --only-extra
   ```

## Path B: any agent, from its tool list

1. Write `context.md` with one line per tool, such as `- lookup_order(order_id: str) -> dict`.

2. Generate cases. This calls a model, so it may cost money. The bench cannot count or cap that spend, so
   the command refuses to run without `--yes-paid`; pass it only for a run you approved.

   ```bash
   node bench/agenteval/agenteval.js generate-strands --trajectories --context-file context.md \
     --task-description "what your agent does" --out work/experiment.json --python .venv/bin/python --yes-paid
   ```

3. Sort the cases into `ok`, `needs-edit` and `reject`, with reasons (free).

   ```bash
   node bench/agenteval/agenteval.js import-strands --experiment work/experiment.json \
     --tools-from-text context.md --generation work/experiment.generation.json --out work/candidates
   ```

4. A person reads `work/candidates/review.md` and every case, `ok` ones too.

## Missing today

No command writes a runnable task. On path A, `scenarios emit` writes the skeleton, and a person still writes the
fixture, the checks and the rubric. Path B has no emitter: the bench cannot run an agent that is not a Konductor
agent yet (DEBT row D-112).

## Go deeper

- [Capability playbook](../cap-playbook.md): the order of work, trigger tests and reviewing drafts.
- [Benchmark a skill](../skills.md): what to do with the tasks once they exist.
- [agenteval guide](../../agenteval/README.md): rules, filters and limits of path B.
- [Benchmark tasks](../tasks.md): the task file format.
- [Reference: the cap family](../reference.md#capability-benchmarking-cap): every `cap` flag.
