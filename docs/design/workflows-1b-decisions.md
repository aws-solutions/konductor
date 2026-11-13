<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workflows step 1b: decisions

Choices made in the canvas for step 1b (the Designer and Execution tabs on the first-release contract) where
[the plan](workflows-plan.md), [the specification](workflows-spec.md) and the contract in
`workflow-canvas/api/openapi.yaml` are silent or open. The spec and the contract stay the authority on the rules.

## Saving in place

- **The writer never rewrites a file whole.** It replaces only the bytes of the `name` or `agent` value that changed,
  so a stage keeps its `prompt`, `prompt_file`, comments and layout, and every byte outside the block of stages stays
  as it was. A change it cannot write that way is refused. The reason is that these are the cases where a line-based
  writer cannot find the exact bytes of one value, and the rule of "Saving a file" in the spec is to keep every other
  byte.
- **The writer works on lines, not on a YAML parser.** This step edits only `name` and `agent`, which are single
  scalars that the line writer edits exactly. The import test of the Designer core
  (`workflow-canvas/test-support/designer-purity.test.ts`) allows no YAML parser, and `yaml` in the page would become a
  runtime dependency and grow the bundle. Deleting, adding and reordering stages move whole items, with their comments
  and kept blank lines, which value ranges alone do not cover. D13 checks a file with the engine's validator, not a
  second one in the page.
- **It refuses any change of the stages** when they are in brackets on the key line (`stages: [...]`) or on the line
  below, when there is no top-level `stages:` key of the block form, or when the dash items cannot be matched one to
  one with the stages of the view.
- **It refuses a change of one stage** when that stage is not written with one key to a line under its dash, as in
  `- {name: a, agent: b}` or a tab after the dash. Deleting, adding and reordering stages still work next to such a
  stage, because they move whole items.
- **It refuses a change of one value** when the value is not a single scalar on the line of its key: a value on the
  next line, a block scalar, a tag, an anchor or alias, a flow collection, a quoted value that does not close on its
  line, a plain value that goes on to the next line, a double-quoted value with an escape that JSON does not read, a
  value that does not read as the view says, or a key the item lacks.
- **A refused change stays in the draft, and Save stays off with the reason.** The page offers no write for that change,
  and the person can still undo it. A file-wide reason shows in a note before any change; a reason for one stage or
  value shows in a warning once the change is made.
- **A save with no change returns the input byte for byte**, even in a refused layout.
- **A new stage with exactly the name and agent of a deleted one takes the deleted item.** A draft the page calls
  "No changes" then writes the file unchanged.
- **At the end of an item, blank lines and comments no further in than the dashes go with the next stage.** Deeper
  comments, lines of a block scalar that start with `#`, and the trailing blank lines of a block scalar that keeps them
  (`|+`) stay with their stage. Deleting or adding a stage must not change another stage's prompt, for the forms the
  spec allows.
- **The writer does not see a block scalar that keeps its blank lines after an anchor or a tag** (`&a |+`, `!!str |+`).
  The spec forbids anchors and tags, and the check error blocks Save first, so reordering cannot move such a prompt's
  kept blank lines.
- **The editor keeps a stage's identity across saves in its state (`bases` and `sent`), not by matching names.** A
  renamed stage keeps its other keys.
- **A value the writer quotes is double-quoted JSON text, with U+007F, U+0080 to U+009F, U+2028 and U+2029 as `\u`
  escapes.** JSON leaves them raw. YAML does not take U+007F to U+009F raw, and a YAML 1.1 reader takes U+0085, U+2028
  and U+2029 for line breaks inside double quotes (libyaml reads U+0085 there as a space). A `\u` escape reads the same
  in YAML and JSON, so the writer can read its own output back.
- **The page keeps the writer's result for each draft.** On a 256 KiB file with 40 stages one write takes about 2 ms,
  and a render asks for it from Save, the alerts and the editor. The result is kept per draft object and used again
  while the saved document and `bases` are the same objects, and the file-wide reason is kept per saved document.
- **A reload drops a draft the writer cannot write.** The text kept for **Copy my version** is the text a save would
  write, and such a draft has none, so the conflict alert offers no copy and the load keeps nothing. The README says
  so. There is no recovery view for it in this step.

## Execution tab

- **A blocked stage shows under the status line, in a label and value block**, with its `reason` code and one plain
  sentence for each code the contract lists under **How a run goes**. An unknown code is shown alone. The visible status
  sentence stays as it was, and the block is no alert, since a blocked stage is a result, not an error. The live status
  of a halted run ends with the same sentence, or the code alone, so a screen reader hears why the stage stopped while
  the Designer tab is open. A stage with no reason adds nothing.
- **The sentences of the reasons:** `RESULT_MISSING` "The final message of the session has no result line."
  `RESULT_INVALID` "The result line of the session is not valid." `RESULT_FAILURE` "The agent reported that it could not
  do the work." `SESSION_FAILED` "The session could not start, its agent was not found, it ended with an error, the
  run's owner stopped, or the tool configuration changed. The stage message gives the cause." `TIMEOUT` "The stage, or
  one of its checks, ran out of time." `OUTPUT_MISSING` "A file that the stage must leave behind does not exist."
  `OUTPUT_UNCHANGED` "A file that the stage must leave behind was not created or changed by the stage." `CHECK_FAILED`
  "A check that the stage must pass failed."
- **The trust dialog offers a command, with Copy, only when the `fix` has one pair of backticks and the text between
  them matches `^konductor flow trust [a-z0-9][a-z0-9-]{0,63}$`**, the contract's `Name` pattern after the command, and
  the name is the one of the workflow on the page. Otherwise it shows the `fix` sentence alone, as plain text, and Run
  again still works. The text comes from the server
  and is meant to be pasted into a terminal, so the page offers to copy only the one command the contract describes. A
  `trust_required` with no `fix` stays an ordinary error.
- **The dialog's opening sentence mentions "the command" only when one is shown.** With no command it would point at
  something that is not on the screen.
- **The dialog keys its closed state on a refusal number in the core state (`trust.refusal`), not on the state
  object.** It counts the trust refusals in a row from 1, and a start after a refusal carries the count on. The inner
  part of the dialog unmounts while no refusal shows, so a count that starts again at 1 after another outcome cannot
  meet a stale closed number. A state rebuilt with the same content keeps its number and stays closed, and each new
  refusal opens the dialog, even when React draws no frame for the start in between.
- **Run again uses the goal of the refused start, kept in the core state.** Close leaves the error under the Run button.
  The page grants no trust, and the contract has no call for it.

## Wire types

- **The harness is any string that is not empty**, in the session, the run and the kept session, and an unknown value
  is shown as it is. The contract says a response enum may gain values, and the page only shows the harness. An empty
  or missing harness is a bad reply. There is no control to pick a harness.
- **`RunView.harness` is parsed so the reply stays in line with the contract**, though the page shows only the
  session's harness.
- **A blocked stage with a missing or empty `reason` is a blocked stage with no reason.** It shows its name and no
  reason block. The contract requires the reason, and also says a client treats an unknown reason like any other
  blocked stage, so the page reads the stage rather than refusing the whole run. A `reason` that is not a string is a
  bad reply, and a `reason` on any other stage is ignored.
- **Run and stage statuses stay strict.** A status the page does not list is a bad reply, since the page draws the run
  from them.
- **`ApiError` keeps the `fix` of the error body apart from the sentence.**

## Messages

- **A lost session tells the user to start `flow view` again and open the address it prints.** This covers a 401, the
  server not knowing the kept token, a server that may have stopped and an address with no launch code, so the page
  gives one instruction for getting a new address. The stub stands in for `flow view`.
- **A name in backticks shows as code where the page can draw it**: the Run alert, the Designer's save alert and the
  notes on a refused change. Where it cannot, the same sentence is plain text without the ticks, from the split that
  draws the code (`message-parts.ts`): the live region of a run error and the reason in Save's tooltip.

## Tests and screenshots

- **The canvas CI `paths` filter lists `workflow-engine/examples/hello-plan.yml`**, for pull requests and pushes. A
  Playwright test reads that file and names the workflow `hello`, the one the stub serves, so a change to it alone must
  run the canvas tests.
- **The committed `execution-trust-required.png` is the one CI draws on x86-64.** With the dialog open, arm64 Chromium
  draws the dimmed page in the 256 px tiles next to the dialog one level of colour off (31,35,50 there and 31,34,50
  elsewhere, for the same header), while CI draws 31,34,50 everywhere. The other captures match on both. The check
  stays byte-exact, and the capture spec and the README say where to take that file from.
