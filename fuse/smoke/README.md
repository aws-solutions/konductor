# fuse-flow smoke test

The smoke test runs one fuse-flow workflow end to end with two agents. The fuse agent works in a
fresh project and builds a small hello world program with the workflow. The orchestrator agent
plays the user: it talks to the fuse agent, answers its questions, and then judges whether an
ordinary engineer who knows nothing about fuse-flow could get through the workflow. The test looks
for high-level problems, such as a step that cannot be completed, a missing guide, a gate that
never passes, or a confusing hand-over. A pass does not show that the workflow is useful for real
work.

## Warning: the agents run with every tool approved

Both agents run unattended, so every tool call they make is approved without asking you.

- With Kiro CLI, an agent runs as `kiro-cli chat --no-interactive --trust-all-tools` in your real
  home directory. It can read and change any file your user can, run any command, and use your
  Kiro CLI sign-in and any credentials in your home directory.
- With OpenCode, an agent runs as `opencode run --pure --auto`. `--auto` approves every permission
  request that is not explicitly denied. The agent gets a private home directory inside the run's
  folder, so your own OpenCode configuration, skills and instructions do not leak into the test.
  This private home is not a sandbox. The agent still runs as your user, can reach any path your
  user can, inherits your environment, and sees your AWS configuration through a link to `~/.aws`.

Run the smoke test in a disposable container or virtual machine, or under an operating system
account and AWS account that have no access to anything sensitive. Give the AWS credentials it uses
no permissions beyond invoking the Amazon Bedrock models listed below.

## Prerequisites

- A clone of the `fuse` branch of this repository. The smoke test installs fuse-konductor from
  that clone into each test project.
- `git`, `bash`, coreutils (`timeout`, `mktemp`) and [Bun](https://bun.sh) on your path. If
  `fuse/flow/node_modules` is missing, `run.sh` runs `bun install --frozen-lockfile` there first.
- [Kiro CLI](https://kiro.dev) (`kiro-cli`) on your path. `run.sh` always checks for it, because
  the summary reads Kiro CLI's session list to report credits. A role that runs on Kiro CLI also
  needs you to be signed in (`kiro-cli login`). Kiro CLI uses its own sign-in and Kiro credits,
  not your AWS account.
- [OpenCode](https://opencode.ai) (`opencode`) on your path when either role runs on OpenCode,
  which is the default for both.
- For the OpenCode roles: an AWS account with access to the models below in Amazon Bedrock, and
  credentials for it.

## Amazon Bedrock model access

The OpenCode roles call models in Amazon Bedrock through OpenCode's `amazon-bedrock` provider.

| Model | Used for | OpenCode model id |
| --- | --- | --- |
| GPT 6 Luna | the fuse agent (default) | `amazon-bedrock/global.openai.gpt-6-luna` |
| GPT 6.1 Sol | the orchestrator (default); the reviewer in the review launch example of `fuse/flow/src/schemas/policy.ts` | `amazon-bedrock/global.openai.gpt-6.1-sol`; the launch example uses `amazon-bedrock/us.openai.gpt-6.1-sol` |
| Claude Opus 5.5 | optional, with `--fuse-model` or `--orchestrator-model` | `amazon-bedrock/global.anthropic.claude-opus-5-5` |

The `global.` and `us.` prefixes name cross-region inference profiles. A `global.` profile can
route a request to any supported Region; a `us.` profile routes only within the United States, so
it needs a United States Region as its source.

To make the models available:

1. In the Amazon Bedrock console, open **Model catalog** in the Region you will use and check that
   your account can use each model. Some models require you to request access or accept the model
   provider's terms first.
2. Give the identity that runs the test permission to call the models:
   `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the inference profiles you
   use and on the foundation models behind them.
3. Check the model ids your OpenCode version knows with `opencode models amazon-bedrock`.

## Credentials and region

The OpenCode roles use the standard AWS credential chain. Set credentials in one of these ways
before you start `run.sh`:

- a named profile: `export AWS_PROFILE=my-profile`, after `aws configure --profile my-profile`
  or `aws sso login --profile my-profile`;
- access keys: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` for
  temporary keys;
- an Amazon Bedrock API key: `AWS_BEARER_TOKEN_BEDROCK`. When it is set, OpenCode uses it instead
  of every other credential;
- a web identity token (`AWS_WEB_IDENTITY_TOKEN_FILE` and `AWS_ROLE_ARN`) or container
  credentials, as Kubernetes and Amazon Elastic Container Service provide them.

OpenCode turns its Bedrock provider on only when it finds one of these. An instance role alone,
with none of them set, is not enough; on an Amazon EC2 instance, define a profile that uses the
instance role and set `AWS_PROFILE` to it.

Set the region with `export AWS_REGION=us-east-1`, or whichever Region you enabled the models in.
OpenCode reads `AWS_REGION`, not `AWS_DEFAULT_REGION` or the profile's `region` setting, and uses
`us-east-1` when no region is set.

`--opencode-profile <profile>` and `--opencode-region <region>` override `AWS_PROFILE` and
`AWS_REGION` for the smoke run. `run.sh` writes them into the private OpenCode configuration of
each OpenCode role.

Each OpenCode role's private home contains a link to your `~/.aws`, so profiles, AWS IAM Identity
Center sign-ins and `credential_process` settings there keep working. `AWS_CONFIG_FILE` and
`AWS_SHARED_CREDENTIALS_FILE` work as usual when they hold absolute paths.

## Running the smoke test

From the clone:

```bash
fuse/smoke/run.sh --workflow <name or file>
```

`run.sh --help` prints every option:

| Option | Default | Meaning |
| --- | --- | --- |
| `--workflow <name or file>` | `_k-phase-chain` | The workflow under test. |
| `--fuse-harness kiro\|opencode` | `opencode` | Where the fuse agent runs. |
| `--fuse-model <model>` | `amazon-bedrock/global.openai.gpt-6-luna` | The fuse agent's model. |
| `--orchestrator-harness kiro\|opencode` | `opencode` | Where the orchestrator runs. |
| `--orchestrator-model <model>` | `amazon-bedrock/global.openai.gpt-6.1-sol` | The orchestrator's model. |
| `--out <dir>` | `~/fuse-smoke-runs` | Where run folders go. |
| `--max-turns <n>` | `30` | Messages the orchestrator may send to the fuse agent. |
| `--timeout-min <n>` | `60` | Time limit for the whole run, in minutes. |
| `--turn-timeout-min <n>` | `30` | Time limit for one fuse agent turn, in minutes. |
| `--opencode-profile <profile>` | `AWS_PROFILE` | AWS profile for the OpenCode roles. |
| `--opencode-region <region>` | `AWS_REGION`, then `us-east-1` | AWS Region for the OpenCode roles. |

For an OpenCode role, a model is an OpenCode model id such as those above. For a Kiro CLI role,
pass a Kiro CLI model id such as `claude-opus-5.5`; the defaults are OpenCode ids, so a Kiro CLI
role always needs its model option.

A workflow name is looked up at any depth of `fuse/flow/workflows/`, then in `fuse/smoke/fixtures/`.
Pass a file path for a personal or project workflow. A workflow that does not ship with fuse-flow
is copied into the test project's `.konductor/workflows/`. A `<workflow>.policy-overrides` file
next to the workflow file becomes the project's `.konductor/policy-overrides.yml`, and a
`<workflow>.library/` folder next to it is copied to `.konductor/library/`.

A run takes up to an hour, so start it in the background if you want to keep working.

## What a run does

1. It creates a run folder under `--out`, with a short name based on the start time.
2. It creates the test project: an empty git repository with fuse-konductor installed by
   `install.sh --project`, the workflow and its sibling files copied in, and everything committed.
   A local bare repository in the run folder serves as the project's `origin`, so a workflow that
   pushes branches never reaches a real remote.
3. It writes the orchestrator's brief and a `say` command. Each `say` call sends one message to the
   fuse agent and prints its reply; the fuse agent keeps its conversation between calls.
4. It starts the orchestrator, which drives the fuse agent until the workflow is done, the turn
   budget is spent, or the time limit is reached, and then writes its verdict.
5. It checks the project mechanically: every step finished, every artifact is accounted for, and
   every mechanical gate still passes. The check uses the clone's copy of the workflow, so an edit
   to the project's copy cannot make a run pass.
6. It prints a summary with the wall-clock time, the fuse agent's turns, the cost, and the
   verdicts.

## Results

The run folder holds, among other files:

- `verdict.md`: the orchestrator's verdict. Its first three lines rate the engine, the workflow and
  the agent's guidance; the rest gives reasons, findings and every message sent;
- `mechanical.txt`: the mechanical check;
- `summary.json`: the summary;
- `transcript.md`, `timings.tsv` and `turns.d/`: every message and reply, with timings;
- `project/`: the test project as the fuse agent left it.

`run.sh` exits with 0 when the mechanical check, the engine and the workflow pass and the guidance
passes, with 2 when the same pass but the guidance has friction, with 64 for a usage error, and
with 1 otherwise.

## The `review-readonly` OpenCode agent

The review launch example in `fuse/flow/src/schemas/policy.ts` starts a reviewer with
`opencode run --agent review-readonly`. The smoke test does not use it, and OpenCode does not ship
an agent with that name; define it yourself before you use that launch command. Add it to your
global OpenCode configuration, `~/.config/opencode/opencode.json`, or to an `opencode.json` in the
project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "review-readonly": {
      "description": "Reviews what it is given and reports findings without changing anything.",
      "mode": "primary",
      "prompt": "You are an independent reviewer. Read what you need, then report your findings in your reply. Do not try to change files or run commands.",
      "permission": {
        "*": "deny",
        "read": { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" },
        "glob": "allow",
        "grep": "allow"
      }
    }
  }
}
```

The `"*": "deny"` rule comes first and the specific rules after it, because OpenCode applies the
last rule that matches. The agent can read, list and search files in the directory where OpenCode
starts, and nothing else: no edits, no shell commands, no web access, no subagents and no files
outside that directory. `"mode": "primary"` lets `opencode run --agent` start it directly. If your
reviewers need history, you can allow specific read-only commands, for example
`"bash": { "*": "deny", "git log *": "allow", "git show *": "allow" }`. Check the result with
`opencode debug agent review-readonly`, which lists the agent's tools and permission rules.
