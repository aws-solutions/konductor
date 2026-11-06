<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workflow engine

The Rust workspace behind `konductor flow`. It reads a workflow file, checks it against the rules in
[the specification](../docs/design/workflows-spec.md) and runs it. The design and the plan are in
[docs/design/workflows.md](../docs/design/workflows.md) and [docs/design/workflows-plan.md](../docs/design/workflows-plan.md).

This is step 1e of the plan: the file format and its checks (1c), the stage prompt and the runner on the `fake`
harness (1d), and trust (1e). It has no real harness and no canvas server yet.

## Crates

- `core` holds the format: the YAML loader, the key table, the checks, the diagnostics, the limits, the path rules and
  the stable JSON. It also holds the stage prompt (`prompt.rs`), the stage result parser (`result.rs`), the run, stage
  and check states (`run.rs`) and the runner (`runner.rs`), which also holds the guard that stops a session when the repo
  tool configuration changed after the confirmation. It does no IO. `core/tests/purity.rs` fails the build if the
  crate reads a file, opens a socket, starts a process, reads the environment, the clock or a random source, uses
  `unsafe`, or depends on a crate that is not in its allow list. The world reaches it through ports: `WorkflowSource`,
  `Clock`, `Harness`, `RunStore`, `RunLock`, `TrustStore`, `Terminal` and `AgentCatalog` (`ports.rs`). `trust.rs` holds the
  trust hash and its byte layout, the verdict on a `--trust` hash, and the summary the user reads before confirming.
- `adapters` holds what touches the world: the file source and the lookup of a bare name in `.konductor/workflows/` of
  the project and then of the home folder; the run store and the workspace lock under `.konductor/runs/`; the system
  clock; the trust record `~/.konductor/trust.json`; the scan of the repo tool configuration files; the agent catalog,
  which reads the tools of a Kiro or Claude agent definition; the terminal; and the `fake` harness, which replays
  scripted replies and is for tests only. `harness_choice.rs` decides
  which harness a run may use.

The golden files of the stage prompt are in `core/tests/golden/`. They hold the exact text, with no final newline.

`examples/hello-plan.yml` is the example that the tests check.

## Keys and slices

`core/src/keys.rs` has the one table that tags every key with the slice that adds it. A build at slice N honors the
keys of slices 1 to N. A key of a later slice is `NOT_SUPPORTED_BY_THIS_BUILD`, and a key that no slice plans is
`UNKNOWN_KEY`. The message is plain, and the slice is in the `slice` field of the diagnostic. `BUILD_SLICE` is the slice
of this build. Raising it, and adding the code that reads the new keys, is how a slice ships.

## Reading agent definitions

The trust summary of `konductor flow` shows what the harness lets an agent run without asking, and for that the
adapters read the agent file the way the harness does (`adapters/src/agent_catalog.rs`). The user-facing rules are in
[the CLI README](../cli/README.md#flow). This section holds the edge cases. The Claude front matter is read by a small
reader of top-level keys and not by a YAML parser. Wherever the reader cannot be sure what the harness reads, it fails
closed: the file is an unreadable candidate, and the tools are not shown.

### The `tools` value

A `tools` list is shown as `tools: unreadable` with the reason when it has an item outside `A-Z a-z 0-9 _ * : . -`
(other than the `Agent(a, b)` form), such as `Bash(git status)`, a quoted item in a `[...]` list, or an indented line
after a `tools:` value that has text on its own line (`tools: Read` then `  , Write`), which the harness reads as a
longer list. A list with the item `*` grants every tool and is shown as `*` alone. An empty list,
`tools:` with no items or `[]`, pre-approves no tool. The items of a block list may be indented or start in column 0
right under `tools:`, as installed agent files write them, and the list ends at the next key. A column-0 `- item` under
any other key, or after an indented item, makes the file unreadable. None of this changes the trust hash.

A Claude agent file with `memory: user`, `project` or `local` gets Read, Write and Edit from the harness besides its
`tools` list. YAML writes those values in many forms (quoted, with an escape, an alias or a tag, a block scalar, after a
tab and a comment, or on the next line), so when the file has a `tools` list and a `memory` key, the tools are shown as
unreadable unless the value is a plain word of letters that is not one of the three (`memory: none`). `memory` is listed
on the "also sets" line. The install manifest never exempts a markdown file that has a `memory` key.

### Which file declares the agent

Claude Code identifies an
agent by the exact `name` in the front matter of the `.md` files under `.claude/agents/` and its subfolders (a link to a
regular file counts as that file, as in the scan of the tool configuration), with no trimming and no case folding. Only
that `name` key declares an agent: the id in the body, in a comment, in another key's value or in a file name does not.
A file with no front matter or no `name` is not an agent. One rule covers the forms this build cannot read: when the
front matter is not fully readable (a quoted key, a space before the colon, an indented root mapping, a `{...}` front
matter), or the plain `name:` value is double-quoted with a backslash escape, the file is an unreadable candidate if the
text that may hold a `name` key mentions the id, either as written or once `\x`, `\u` and `\U` escapes are decoded. So
is a file whose `name:` value is the id followed by a tab and a comment (`name: <id><TAB># x`), and a file with an alias
(`*n`) in a `name` entry or in any entry whose key this build cannot read (`"name": *n`, `name : *n`, `<<: *n`) when the
id is anywhere in the front matter. A double-quoted value continued at column 0 is read as one text. A line break other
than a line feed or a CRLF pair (a lone carriage return, U+0085, U+2028 or U+2029) makes the front matter unreadable
when it mentions the id, and so does an opening `---` line this build does not take (a byte order mark, a blank line
first, `---yaml`). A `---` anywhere in the front matter but on the closing line of its own (inside a value, a comment or
an indented block) does the same, because a reader may end the front matter at the first `---`. The id counts only when
it is in the front matter, up to that first `---`: another agent's file that names the id in its body, or in a
description after a `---`, is not this agent and is not unreadable. A value with two hyphens in a row (`a--b`) is not
affected. The install manifest never exempts such a file in the config scan. A byte that is not UTF-8 in an agent file
reads as U+FFFD, so the file is still looked at. It is then shown as `tools: unreadable` instead of the home folder's
agent. A plain name that is another agent, such as `<id>-helper`, or a comment that names the id on another agent's
`name` line, is not this agent and is not unreadable. A front matter this build reads in full, with no `name`, is not an
agent, even if its `description` mentions the id. In the nearest folder that has the id, two files that declare it, or a
declaring file whose name is not `<id>.md`, make the agent unknown: `flow run` and `flow trust` exit `77` with the code
`tool_config_unreadable` and name the agent, whatever `--trust` or `--yes` says, while `flow check` still prints the
hash. A file that declares another name blocks nothing.

### Kiro agent files

Kiro CLI 2 loads the top-level `.kiro/agents/*.json` files. Kiro CLI 3 also loads `.json` files in subfolders and `.md`
files at any depth, dotfiles included, and a markdown file's id is its front matter `name`, or its file stem when there
is none. This build cannot tell which engine a run uses, so it looks at all of them, as deep as the config scan goes. A
markdown agent is shown with unknown tools, and one that opens a front matter block with no `name` and the id for its
stem is an ambiguous candidate, as is one whose front matter cannot be read in full and may name the id. Kiro ends the
front matter at the first line that starts with `---` (`----`, `---x` and `--- # c` end it too, an indented ` ---`
does not), so a `---` inside a line is ordinary text and the `name` after it counts. A markdown file with no front
matter block, such as the prompt file of a JSON agent (`<id>.md` or `prompts/<id>.md`), is not loaded by Kiro and is
not a candidate. A subfolder `.json` file follows the rules below.

Kiro CLI loads a `.json` agent file that a strict JSON reader refuses: a trailing comma, `//` or `/* */`
comments, a repeated key, nesting of up to 127 levels, and invalid UTF-8 inside a string it ignores. This build reads
such a file leniently to find the id: it accepts nesting up to 128 levels and a repeated key that it does not read
(`name` and `allowedTools` repeated are not accepted, as the two Kiro engines disagree about them, and neither is a
number too large for an f64, such as `1e999`, which both engines refuse). A file that is not
UTF-8, does not parse or repeats one of those keys is never shown as a definition. When its text mentions the id, as
written or once the JSON escapes are decoded, it is an ambiguous candidate whatever its file name is. An
`<id>.json` that is an object with no `name` (or only `Name`, or `{}`) is an ambiguous candidate too, because Kiro 3
takes the file name for the id then.

## Build and test

```bash
cd workflow-engine
cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked
```

The crates declare `rust-version = "1.89"`, the first release with `File::try_lock`, which the workspace lock uses.
