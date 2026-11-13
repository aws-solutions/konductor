# agenteval

agenteval prepares scenario candidates for an agent that is not a Konductor agent. It takes the output of the Strands Evals test case generator, filters out what is obviously broken, and writes the rest as a reviewable list. It does not run an agent, and it does not score anything.

> [!IMPORTANT]
> This is the first step only. Mocks for the agent's tools, negative twins, reference-run grounding, a bench task emitter, trajectory checks and an agent runtime are **not built yet and are not supported**. bench still cannot benchmark an arbitrary agent (see [Other agents](../GUIDE.md#other-agents)). What you get here is a reviewed list of scenario candidates, nothing more.

## Why every proposal needs a human

Strands Evals can generate test cases from a description of the agent: an input, an expected output, and an expected sequence of tool calls. Those fields are written by a model. They are proposals.

We tried it once, on one small sample of generated cases for a customer service agent with five tools. The numbers below come from that one spike, so read them as a rough warning and not as a measurement:

- About 43 percent of the cases were usable as they came.
- About a quarter of the proposed trajectories broke rules the task description stated, for example a refund before an order lookup.
- About 6 percent of the inputs were placeholders or titles instead of a customer message.
- The generator wrote no negative twins: no case where the same request should end differently.
- Mocks were always needed. A trajectory names tools, but nothing in the output says what those tools return.

So the importer is a deterministic filter and normalizer. It never decides what the agent should do. The expected output text is kept as a hint, and the generated rubric stays one block of text. Anything a person has not read is a proposal.

## The two-step workflow

Step 1 runs in a Python virtual environment, because the generator is a separate Python tool. Step 2 is plain Node.

Install the generator (Python 3.11 or newer):

```
python3 -m venv .venv
.venv/bin/pip install strands-agents-evals
```

Describe your agent in a context file. Put one bullet per tool, in the form `- name(arguments) -> result`:

```
You are a customer service assistant for an online shop.
Tools:
- lookup_order(order_id: str) -> dict
- check_refund_policy(order_id: str) -> str
- issue_refund(order_id: str, amount: float) -> str
- send_email(to: str, subject: str, body: str) -> str
- escalate_to_human(summary: str) -> str
```

Step 1, generate. This calls a model through the generator, so it can cost money and needs the credentials the generator itself expects in the environment. agenteval passes the environment through unchanged and never logs or stores it.

```
node bench/agenteval/agenteval.js generate-strands \
  --context-file context.md \
  --task-description "Customer service assistant for an online shop" \
  --out work/experiment.json \
  --num-cases 20 --num-topics 4 --evaluator OutputEvaluator \
  --strands-bin .venv/bin/strands-evals
```

This runs `strands-evals generate` with an argument array (no shell), writes `work/experiment.json`, checks that the file loads as an experiment, and writes `work/experiment.generation.json` next to it (see [The provenance sidecar](#the-provenance-sidecar)). Without `--strands-bin` it looks for `strands-evals` on `PATH`. A missing binary prints the install hint and exits 1.

Step 2, import:

```
node bench/agenteval/agenteval.js import-strands \
  --experiment work/experiment.json \
  --tools-from-text context.md \
  --generation work/experiment.generation.json \
  --rules rules.json --batches 4 \
  --out work/candidates
```

Read `work/candidates/review.md` first, then edit or drop candidates in `candidates.json`.

### Does the generator write expected trajectories?

Not from its command line. We read the installed source of strands-agents-evals 1.9.0. The `generate` command builds its generator with `include_expected_trajectory` left at its default of `False`, and nothing in the command or in `from_context_async` sets it for `TrajectoryEvaluator`. The `--evaluator` choice only decides which rubric text the generator writes. So with this version the cases from `generate-strands` come back with `expected_trajectory` set to null, and every candidate has trajectory quality `none`.

To get trajectories, call `ExperimentGenerator(..., include_expected_trajectory=True)` from Python, save the experiment with `to_file`, and give that file to `import-strands`. The sample fixture in this directory has trajectories for that reason. When no candidate has a proposed tool, `review.md` says so, because a status of `ok` then does not mean any tool use was checked.

Finding from one version of the package. Re-check it when you upgrade.

## Worked example on the sample fixtures

The directory `test/fixtures/` holds a 14-case experiment from the spike (`strands-sample.json`) and a rules file (`rules.json`). Declare the five tools and import:

```
echo '["lookup_order","check_refund_policy","issue_refund","send_email","escalate_to_human"]' > /tmp/agenteval-tools.json

node bench/agenteval/agenteval.js import-strands \
  --experiment bench/agenteval/test/fixtures/strands-sample.json \
  --tools /tmp/agenteval-tools.json \
  --rules bench/agenteval/test/fixtures/rules.json \
  --batches 2 \
  --out /tmp/agenteval-sample
```

It prints one line:

```
14 candidates: ok 3, needs-edit 8, reject 3; written to /tmp/agenteval-sample
```

The top of `/tmp/agenteval-sample/review.md`:

```
# Candidate review

Imported from `strands-sample.json` by agenteval import-strands.

**Warning: every expected output, trajectory and rubric here was written by a model. They are proposals only. Read each candidate before it becomes a scenario.**

- Candidates: 14
- By status: ok 3, needs-edit 8, reject 3
- By reason code: input:multi-turn 2, trajectory:not-clean 7, rule:forbidUnless 3, tool:undeclared 1, output:placeholder 4, trajectory:unreadable 1, input:placeholder 1, input:title-like 1, duplicate 1
- By trajectory quality: clean 1, structured 2, extracted 7, none 4
- Provenance: not recorded (no --generation file was given), so the fields below are null.
  ...
- Declared tools (5): lookup_order, check_refund_policy, issue_refund, send_email, escalate_to_human
- Declared tools that never appear in any proposed trajectory: none
```

Running the same command a second time fails with `already exists; pass --force`. Add `--force` to replace `candidates.json` and `review.md` in the existing directory.

## Commands

### generate-strands

```
generate-strands --context-file FILE --task-description TEXT --out FILE
                 [--num-cases N] [--num-topics K]
                 [--evaluator OutputEvaluator|TrajectoryEvaluator|InteractionsEvaluator]
                 [--model ID] [--strands-bin PATH] [--force]
```

- `--out` must end in `.json`. The sidecar is the same path with `.json` replaced by `.generation.json`.
- Without `--force` the command refuses when either file exists. With `--force` it deletes both first, so a failed run leaves neither behind.
- The context text goes to the generator as one `--context=TEXT` argument, so it must be under about 120 KB.
- The generator's output goes to stderr. A non-zero exit, a missing output file, or a file that does not load as an experiment is an error (exit 1) and no sidecar is written.

### import-strands

```
import-strands --experiment FILE (--tools FILE | --tools-from-text FILE)
               [--rules FILE] [--generation FILE] [--batches N]
               [--duplicate-threshold X] --out DIR [--force]
```

- `--tools` is a JSON array of tool names, or `{"tools": [{"name": "lookup_order", ...}]}`.
- `--tools-from-text` reads declared tool names from a descriptive file. A line counts when it starts with a bullet (`-`, `*`, `+`, or a number and a dot) followed by an identifier and an opening parenthesis, as in `- lookup_order(order_id: str) -> dict`. The names found are printed on stderr. If none are found the command fails. Give exactly one of the two flags.
- `--rules` is described in [rules.json](#rulesjson).
- `--generation` is the sidecar from `generate-strands`. Without it the provenance fields are null and the review says so.
- `--batches N` labels cases by position as coming from topic 0 to N-1 (`batchIndex`, with `batchInferred: true`, because the experiment file does not record it).
- `--duplicate-threshold X` is the token overlap (Jaccard, default 0.6) at which an input counts as a near-duplicate of an earlier one.

Exit codes for both commands: 0 ok, 1 error (unreadable file, existing output, generator failure), 2 usage (unknown flag, missing value, missing required flag). `--help` works on the tool and on each command.

## The candidate record

`candidates.json` is:

```
{
  "schemaVersion": 1,
  "source": { "experiment": "experiment.json", "generation": "experiment.generation.json" or null,
              "version": ..., "model": ..., "contextSha256": ..., "taskDescription": ... },
  "tools": ["lookup_order", ...],
  "summary": { "total": 14, "byStatus": {...}, "byReason": {...}, "byQuality": {...} },
  "rubricHint": "text of the generated rubric, or null",
  "candidates": [ ... ]
}
```

The experiment and sidecar are stored by file name only, so the output is safe to share.

Each candidate:

| Field | Meaning |
| --- | --- |
| `id` | Slug of the case name plus its position, such as `custom-item-non-refundable-0`. Stable for the same experiment file. |
| `input` | The customer message, after removing a leading `Customer:` label and wrapping quotes. |
| `inputNormalized` | True when `input` differs from what the generator wrote. |
| `rawInput` | The original text. Present only when `inputNormalized` is true. |
| `expectedOutputText` | The generated expected output as text, or null. A hint, not a ground truth. |
| `proposedTools` | Tool names in the proposed order, recovered from the trajectory. |
| `trajectoryQuality` | `clean`, `structured`, `extracted` or `none` (table below). |
| `trajectoryNotes` | What the extractor ignored or recovered. |
| `undeclaredTools` | Tool-like names in the trajectory that the agent does not declare. |
| `multiTurn` | The input holds more than one speaker-labelled turn. |
| `placeholderOutput` | The expected output holds unfilled slots such as `[status]` or `<tool call>`. |
| `duplicateOf` | The id of the earlier candidate this one repeats, or null. |
| `batchIndex`, `batchInferred` | Present only with `--batches`. The label is a guess from position. |
| `generatorMetadata` | The `metadata` object the generator wrote, untouched. |
| `generatorTrajectory` | The raw `expected_trajectory`, untouched. |
| `status` | `ok`, `needs-edit` or `reject`. |
| `reasons` | List of `{code, text}`; empty for `ok`. |
| `source` | `version`, `model`, `contextSha256`, `taskDescription` (from the sidecar), plus `generator`, `sourceFile`, `caseIndex`, `sessionId`. |

### Trajectory quality

| Quality | Steps in the trajectory | Effect |
| --- | --- | --- |
| `clean` | Call strings only, such as `lookup_order(ORD-1)` or a bare tool name. | Accepted. |
| `structured` | Dicts that name a declared tool and carry only arguments, such as `{"tool": "lookup_order", "args": {...}}`, `{"tool_name": ..., "parameters": ...}` or `{"action": "lookup_order", ...}`, with no prose. May be mixed with call strings. | Accepted. No reason is added. |
| `extracted` | Prose, nested lists such as `[name, args]` or alternatives, `tool_response` noise, dicts with a prose key such as `reason` or `purpose`, generator chatter, or an undeclared tool name. | `trajectory:not-clean`. A person checks the tool list. |
| `none` | No tool recovered. An empty or missing trajectory is a valid no-tool case. Steps with no declared tool name are `trajectory:unreadable`. | |

A dict is structured only when its name field is exactly a declared tool. Other keys must be argument containers (`args`, `arguments`, `parameters`, `params`, `input`, `inputs`, `kwargs`) or short flat values such as an id or step number. A key such as `reason`, `purpose`, `description` or `note`, or a string longer than three words, makes it prose.

### Status

| Status | Meaning |
| --- | --- |
| `ok` | No reason was raised. Still a proposal; read it. |
| `needs-edit` | The case may be usable after a person fixes the listed reasons. |
| `reject` | The input is not a usable scenario, or it repeats an earlier one. |

### Reason codes

| Code | Status it causes | Raised when |
| --- | --- | --- |
| `input:empty` | reject | The input is missing or blank. |
| `input:placeholder` | reject | The input is a schema word such as `string`. |
| `input:chatter` | reject | The input is generator chatter such as "Here are a few test cases". |
| `input:title-like` | reject | The input is a short title, or the task description itself. |
| `input:too-short` | reject | Fewer than 15 characters. |
| `duplicate` | reject | Token overlap with an earlier valid input is at or above the threshold. |
| `input:multi-turn` | needs-edit | The input holds more than one speaker-labelled turn. |
| `trajectory:not-clean` | needs-edit | The quality is `extracted`. |
| `trajectory:unreadable` | needs-edit | The trajectory has steps but no declared tool name. |
| `tool:undeclared` | needs-edit | The trajectory names a tool the agent does not declare. |
| `output:placeholder` | needs-edit | The expected output holds unfilled slots. |
| `rule:before`, `rule:forbidUnless` | needs-edit | A rule from `--rules` is broken. |

A candidate gets the worst status among its reasons. Rules are not checked on a rejected input, because they read the input.

## rules.json

Optional owner-written rules about the proposed tool sequence. The file is a JSON array (or an object with a `rules` array). Tool names are checked against the declared tools, and a bad rule fails the import.

`before`: whenever the second tool appears, the first appears earlier.

```json
{ "before": ["lookup_order", "issue_refund"] }
```

`forbidUnless`: the tool may appear only if the input matches a regular expression (case-insensitive).

```json
{ "tool": "send_email", "inputPattern": "e-?mail|send me", "note": "the agent never emails unless asked" }
```

Both kinds take an optional `note`, which is repeated in the reason text. The file `test/fixtures/rules.json` has four rules and is a working example. A rule is a check on the proposal, not a statement of what the agent should do, so write rules you would defend.

## Reading review.md

The file has a header and a table.

1. The warning line says all generated fields are proposals.
2. The counts by status, reason code and trajectory quality show how much of the batch survived. A large `trajectory:not-clean` count means the generator wrote trajectories in many shapes, so check the tool names by hand.
3. The provenance lines show the generator version, model, context hash and task description from the sidecar, or say they were not recorded.
4. The coverage lines list declared tools that no proposed trajectory uses, and tools used only by rejected candidates. A tool that no candidate exercises is untested, whatever the status counts say.
5. If no candidate proposes any tool, a note says the generator may not have written trajectories.
6. The table has one row per candidate: id, status, reasons, trajectory quality, proposed tools, the first 100 characters of the input, and `duplicateOf`.

Work from the `reject` rows to confirm the drops, then the `needs-edit` rows, then read the `ok` rows too. The full text of each reason is in `candidates.json`.

## The provenance sidecar

`generate-strands` writes `<experiment>.generation.json`:

```json
{
  "schemaVersion": 1,
  "tool": "strands-evals",
  "toolVersion": "output of --version, or null",
  "command": ["strands-evals", "generate", "--context=<contents of contextFile>", "--task-description", "...", "-o", "experiment.json"],
  "contextSha256": "sha256 of the context file",
  "contextFile": "context.md",
  "taskDescription": "...",
  "numCases": null,
  "numTopics": null,
  "evaluator": null,
  "model": null,
  "startedAt": "2026-01-01T00:00:00.000Z",
  "durationMs": 0,
  "exitCode": 0
}
```

`command` is the argument list without the context text, with the binary and output path reduced to file names. `numCases`, `numTopics`, `evaluator` and `model` are null when the flag was not passed. `toolVersion` comes from `<bin> --version` with a 5 second limit and is null when that fails. The sidecar holds no environment values.

## What is not built

These are future work and are **not supported**:

- Mocks for the agent's tools, so a scenario can run without the real backends.
- Negative twins: a second case per scenario where the outcome should differ.
- Reference-run grounding: running the real agent once and comparing the proposals with what it did.
- A bench task emitter that turns reviewed candidates into bench tasks and suites.
- Trajectory checks that score a run against `proposedTools`.
- An agent runtime that launches an agent built with Strands or any other SDK.

Until those exist, a reviewed `candidates.json` is an input for a person writing scenarios.

## Tests

Plain Node, no dependencies, no network, no Python. The command line tests use a fake `strands-evals` script in a temporary directory.

```
nice -n 19 node --test bench/agenteval/test/*.test.js
```

Modules in `lib/`:

- `experiment.js`: reads the experiment JSON.
- `tool-names.js`: recovers tool names and a quality level from the untyped trajectory.
- `validity.js`: rejects placeholder inputs and flags unfilled output slots.
- `dedup.js`: marks near-duplicate inputs.
- `rules.js`: the `before` and `forbidUnless` rules.
- `candidates.js`: composes the checks into candidate records.
- `tools-file.js`, `review.js`, `args.js`: tool declarations, `review.md` and flag parsing.
- `import-strands.js`, `generate-strands.js`: the two commands.
