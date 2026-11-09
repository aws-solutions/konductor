# Canary layers

Which konductor layers reach the model without being forced?

`canary-layers.js build` extracts a konductor ref into a scratch directory and adds one distinct token to each layer:

| Layer | Where the token goes | Default site |
| --- | --- | --- |
| `rules` | end of a context file every agent lists | `context/k-core-rules.md` |
| `prompt` | end of `config.systemPrompt` in every agent spec | all `agents/*.agent-spec.json` |
| `index` | the `description:` line of one skill, which is the text `find_skills` returns | `workspace-skills` |
| `skill` | end of the body of a different skill | `humanize-writing` |
| `sop` | end of the body of one SOP per entry agent that has SOPs | `k-plan`, `k-design-doc-creation`, `k-code-review-workflow`, `k-test-coverage-review` |
| `ctx` | end of a context file only the orchestrators list | `context/k-orchestrator-routing-rules.md` |

Tokens look like `kd-cl-<layer>-<8 hex>`. They are made once per ref and kept on rebuild, and stored in `layers.json` (mode 600) under the base directory, never in the repository.

## Run it

```
node bench/scripts/canary-layers.js build --ref <sha> --base /var/tmp/canary-layers
node bench/scripts/canary-layers.js commands --base /var/tmp/canary-layers --replicates 3   # one bench.js run per entry agent
node bench/runner/bench.js canary-report --run /var/tmp/canary-layers/runs --layers-file /var/tmp/canary-layers/layers.json --out OUT
```

The suite `canary-layers` has three ordinary tasks (`cl-plain` lists files, `cl-writing` writes release notes, `cl-plan` plans four work items). Each ends by asking the model to list any `kd-cl-...` token it saw in its instructions, context, skill lists or tool results, or to say none. Two tasks make a skill relevant (`cl-writing`) or an SOP relevant (`cl-plan`); `cl-plain` is the baseline for the passive layers.

## What the report can and cannot say

The report is per layer, per entry agent, per task and per agent and task. Nothing is pooled across agents.

- Tool result: the token came back in a tool or skill result. Direct evidence that the layer reached the model.
- Echo: the token is in the model's text, thinking or a call it wrote. Inferred: the model had it, and the layer is known from the token.
- Not logged: the system prompt, context files and the skill index text are not in `stream.jsonl` or the session files. A layer that arrives but is not reported looks like a layer that never arrived, so a zero for `rules`, `prompt` or `ctx` is weaker evidence than a zero for `skill`, `sop` or `index`.
- `index`, `skill` and `sop` need a tool call to show at all. A zero there means the model did not call `find_skills`, load the skill or load the SOP.
- The `spec` label next to each cell says whether the agent spec declares that layer, so a zero where the spec says no is expected.
- A token of the right shape that is not one of the six is listed as forged.

Tests: `node --test --test-concurrency=1 bench/runner/test/canary-layers.test.js` (no runner, no model).
