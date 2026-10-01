# Stale Documentation Review

## Overview

Use this SOP when a code change (a PR, commit range, or branch) may have left documentation elsewhere wrong, or left comments that no longer earn their keep: a renamed function whose callers' doc comments still describe the old name, a moved file whose other references still point at the old path, a changed default whose README still describes the old one, or a comment that only restates code the change has since made obviously self-explanatory. Use it when a reviewer flags stale comments on a PR, when a change touched behavior that many files describe in comments (not just the files the change itself edited), or before merge to sweep documentation drift the change introduced.

Do not use it for a general style/lint pass unrelated to a specific change. `topic_filter` and `change_ref` keep this scoped to one change's blast radius, not a catch-all doc linter.

It works in three phases:

1. **Ground truth** (Step 1): read the actual diff and write down what changed, so every later check has something concrete to check against, not the agent's memory of the conversation.
2. **Inventory and fan out** (Steps 2-4): list every file under the given directories (not just the changed ones, see Parameters), split them into balanced batches, and dispatch one subagent per batch. Each subagent reads its files one at a time, checks every comment/doc/prose claim against the ground truth, fixes what no longer matches, and deletes a comment outright when the code it describes no longer needs it.
3. **Verify and report** (Steps 5-6): confirm the edits are documentation-only and the build/tests still pass, then hand back one consolidated report.

## Parameters

- **change_ref** (required): What defines the change to check documentation against. A PR number/URL, a commit range (`base..head`), or a branch name to diff against its merge base.
- **target_paths** (required): One or more directories or files to inventory and review (e.g. `cli/`, `shared/`, `src/payments/`). Each is reviewed in full, not just its changed files. A change can make a caller's or parent's documentation stale without touching that file.
- **repo_root** (optional, default: current directory): Root of the git repository.
- **build_command** (optional, default: auto-detect per project root): Overrides auto-detection with a single command, for a repo that is one project at `repo_root` (e.g. `cargo check --all-targets`). Leave unset for a monorepo with multiple independent projects under different `target_paths` (e.g. a Rust CLI crate and a separate shared crate, each with its own `Cargo.toml`). Step 1 then resolves one build command per nearest project root instead of a single global one, since running the wrong project's command from the wrong directory silently builds (or fails to build) the wrong thing.
- **scratch_dir** (optional, default: a freshly created temp directory outside `repo_root`, e.g. via `mktemp -d`): Where this SOP writes its own working files (the ground-truth brief, batch lists) that are not meant to be reviewed, committed, or diffed. Kept outside `repo_root` so Step 1's clean-tree check is never tripped by this SOP's own leftover artifacts from a prior or concurrent run.
- **topic_filter** (optional): A short phrase narrowing which documentation claims count as in-scope (e.g. "telemetry", "the retry logic"). Omit to review every claim the change could affect.
- **batch_target_lines** (optional, default: 12000): Approximate total line count per review batch, used to size subagent fan-out.
- **report_path** (optional, default: `.konductor/stale-docs-report.md`): Where the consolidated report is written. Unlike `scratch_dir`, this file is meant to be kept and reviewed, so it defaults inside `repo_root`.

**Constraints for parameter acquisition:**

- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding
- When asking for parameters, You MUST request all parameters in a single prompt
- When asking for parameters, You MUST use the exact parameter names as defined
- You MUST ask for `target_paths` even if `change_ref` touches a narrower set of files, because the goal is to catch documentation made stale by the change in files the change itself didn't touch

## Steps

### 1. Scope the Change and Capture a Baseline

Build a ground-truth understanding of what the change actually did. Every later step checks documentation claims against this brief, not against memory or assumption. This step exists because a wrong or incomplete brief makes every downstream fix unreliable, and because Step 5's verification needs a known-clean starting point to diff against.

**Constraints:**

- You MUST create a fresh `scratch_dir` (`mktemp -d` if not supplied) before anything else, because reusing a fixed path risks collision with a concurrent run of this same SOP
- You MUST confirm the working tree in `repo_root` has no uncommitted changes before proceeding (`git status --porcelain` must be empty). If it is not empty, You MUST stop and ask the user to commit or stash first, because Step 5 cannot otherwise distinguish the user's own pending edits from this SOP's edits when it diffs against this baseline. This check is reliable only because `scratch_dir` lives outside `repo_root`, so this SOP's own working files never appear in this status check.
- You MUST record the current commit hash (`git rev-parse HEAD`) as the baseline for Step 5's verification diff.
- You MUST resolve `change_ref` to a concrete diff:
  - PR number/URL: You MUST use the `gh` CLI (`gh pr view`, `gh pr diff`) if available; if `gh` is unavailable or unauthenticated, fetch the PR's base and head refs directly with `git fetch` and diff them with `git diff`. Do NOT guess at PR content from a web page summary.
  - Commit range: use `git diff` on the range directly
  - Branch name: diff against its merge base with the repo's default branch (`main`/`mainline`) using `git merge-base` then `git diff`
- You MUST run a stat-level diff first (file list + line counts), then read the full diff of the changed files
- If `build_command` is supplied, You MUST use it as the single override for every file. If not supplied, You MUST resolve one build command per project root: for each `target_paths` entry, walk up from it to the nearest ancestor containing `Cargo.toml`, `package.json`, or a `Makefile` (in that order), resolve that root's build command, and record a `{project_root: command}` mapping in the brief, deduplicating roots shared by multiple `target_paths` entries. Steps 4 and 5 read this mapping rather than re-detecting it, so a batch spanning two project roots runs the correct command for each.
- You MUST write a short ground-truth brief covering: what changed (new/removed/renamed functions, changed signatures, changed file locations, changed defaults or behavior), the resolved build-command mapping, and a list of claims that commonly go stale from this specific change (e.g. "a function renamed from X to Y", "a file moved from A to B", "a behavior that used to be true and now isn't")
- You MUST write the brief to `scratch_dir` rather than carrying it only in conversation, since every subagent in Step 4 needs it
- If `topic_filter` is set, You MUST narrow the brief to claims related to that topic
- You MUST NOT guess at behavior from commit messages alone, because a commit message can omit or misdescribe what the diff actually does, read the actual diff

**Expected Output:** A ground-truth brief file in `scratch_dir`, covering what changed, the resolved build-command mapping, and the stale-claim patterns to look for. A recorded baseline commit hash and a confirmed-clean working tree.

### 2. Build the File Inventory

Enumerate every file under `target_paths` that can carry documentation worth checking, the full set, not only the files `change_ref` touched. The point of this SOP is to catch stale documentation in files the change didn't edit (a caller's comment describing a callee that moved), so inventorying only the diff would defeat it.

**Constraints:**

- You MUST run, for each path in `target_paths`: `git ls-files <path>` (tracked files only, never review untracked/build output)
- You MUST exclude lock files, generated files, binary files, and vendored dependencies (e.g. `Cargo.lock`, `package-lock.json`, `*.png`, `*.tar.gz`, `node_modules/`, `dist/`, `build/`)
- You MUST include source files, test files, Markdown, YAML, config files, and Makefiles, any file that can contain a comment or a prose claim about behavior
- You MUST write the inventory to a file in `scratch_dir`, one path per line, via a script (not hand-typed), since enumeration and filtering are deterministic and error-prone to do by hand across a large inventory
- You MUST NOT skip a file because it looks small or unlikely to have stale docs, since the per-file review in Step 4 is what makes that judgment, this step only enumerates

**Expected Output:** An inventory file in `scratch_dir` listing every file to review.

### 3. Split Into Balanced Batches

Divide the inventory into batches sized for parallel subagent review. One subagent per file would waste dispatch overhead on small files; one subagent for everything would exhaust its context on a large inventory. Batching by line count balances the two.

**Constraints:**

- You MUST compute line counts and the batch split with a script, not by hand: get each file's line count (e.g. `wc -l`), then greedily assign files to the batch with the current lowest total, so batches end up balanced rather than first-N/next-N. Line counting and bin-packing have a single correct answer; doing this by hand over dozens or hundreds of files invites arithmetic error.
- You MUST size each batch to approximately `batch_target_lines` total lines across its files, not a fixed file count, so a few large files and many small files each produce a reasonably sized batch
- You MUST cap the number of batches at 8, the concurrency limit Step 4 dispatches under. If the line-balanced split would produce more than 8 batches, You MUST increase `batch_target_lines` and re-split rather than producing a 9th batch, so every batch dispatches in the same wave
- If, even at 8 batches, the resulting average batch size exceeds 3x `batch_target_lines`, You MUST stop and ask the user to narrow `target_paths` or raise `batch_target_lines` explicitly, rather than silently dispatching a subagent whose batch is likely to exhaust its context
- You MUST write each batch as its own file in `scratch_dir`, listing the files assigned to it in a fixed order (so the subagent reviews them in that order and its report lines up with the list)
- You MUST ensure every file in the inventory from Step 2 appears in exactly one batch
- You SHOULD target 6-8 batches for a typical review, fewer if the inventory is small, since a batch with one file doesn't justify subagent dispatch overhead

**Expected Output:** N batch files in `scratch_dir`, each listing a balanced subset of the inventory, together covering every file exactly once.

### 4. Review Each Batch

Dispatch one subagent per batch to review its files in order and fix stale documentation. Each subagent repeats the same loop on its own file list: read, find claims, check against the brief, fix, move on. This is the step that does the actual work; Steps 1-3 only prepared its inputs.

**Constraints:**

- You MUST dispatch all batches from Step 3 at once, one subagent per batch file, since Step 3 already capped the batch count at the concurrency limit
- You MUST give each subagent, in its prompt: the absolute path to the ground-truth brief from Step 1 (which carries the resolved `build_command`), its own batch file's exact file list (in order), and the absolute repo root
- You MUST instruct each subagent to process its files ONE AT A TIME, in the given order: read the whole file, find every comment/doc comment/module header/test doc comment/prose claim relevant to the change (per the brief, or `topic_filter` if set), check each claim against the current code or the brief, fix stale ones in place, then move to the next file
- You MUST instruct each subagent to also delete a comment or doc comment outright, not just correct it, when the code it describes is self-explanatory (the comment only restates what the next line already says, with no non-obvious rationale, constraint, or platform quirk left once the stale part is removed). A comment that is accurate but adds nothing beyond what clear code and names already convey is as much a target of this review as one that is wrong, since both leave documentation to go stale again later for no benefit now.
- You MUST instruct each subagent to edit ONLY documentation/comment/prose text, never code, never test assertions' logic, never non-doc config values, and to report (not fix) any code or test problem it notices
- You MUST instruct each subagent to avoid em dashes, en dashes, and promotional language in anything it writes, and to keep fixes crisp and short
- You MUST instruct each subagent to run, for the files it touched, the build command the brief recorded for each of those files' nearest project root (not re-detect it independently); if its batch spans multiple project roots, run each root's command once, scoped to that root, and report whether each passed
- You MUST instruct each subagent to report one line per file, covering every file in its batch list with no omissions: `<path>: clean`, `<path>: fixed - <short what>`, `<path>: trimmed - <short what was deleted and why it was self-explanatory>`, or `<path>: flagged - <issue, not fixed>`
- You MUST instruct subagents to touch only files in their own batch, since other subagents edit other files concurrently
- You MUST NOT let a subagent create commits or run destructive git commands, since a mechanical doc-fix pass across many files should land as one reviewable change, not scattered uncontrolled commits

**Expected Output:** Every batch subagent returns a per-file report line for every file in its batch, with none skipped.

### 5. Verify the Edits Are Documentation-Only

Confirm no subagent changed code, logic, or test behavior. Subagents in Step 4 are instructed to touch only documentation, but instruction isn't enforcement. This step is the check that catches a subagent that misread a doc comment as dead code and "fixed" it by deleting the code underneath, or similar.

**Constraints:**

- You MUST run `git diff <baseline-commit-from-step-1>` across the whole working tree, not a line-pattern filter, since no single comment syntax covers every language in the inventory (Rust, YAML, Markdown, Makefiles). A line-pattern "comment filter" would miss a prose edit inside a multi-line doc block and would misclassify a one-line config change as a comment in a YAML file.
- You MUST also run `git status --porcelain` scoped to `target_paths` and treat any new untracked file as a finding to report, not silently ignore, since `git diff` against a tracked baseline never shows a file a subagent created rather than edited in place. Do NOT run `git clean` or otherwise auto-delete an unexpected file; report it and let the user decide.
- For each changed file, You MUST read the diff hunks and judge, file by file, whether every changed line is a comment, doc comment, or prose/string-literal text, versus a change to executable code, a config value that affects behavior, or test assertion logic
- If any file's diff contains a non-documentation change, You MUST treat this as a failure for that file: run `git checkout <baseline-commit-from-step-1> -- <path>` to revert exactly that file, then report it as flagged rather than fixed
- You MUST run, once after all batches complete and all doc-only files are confirmed (not per-batch), the recorded build command for every project root that had at least one file touched. If the brief recorded no build command for a root, You MUST skip that root's check and note it was skipped in the report
- If a build or test run fails, You MUST identify which file(s) in that project root introduced the failure and revert those specific changes via `git checkout <baseline-commit-from-step-1> -- <path>`, then re-run that root's build/test check
- You MUST NOT proceed to Step 6 while the build or tests are failing, because reporting success on a broken build would mislead the user into merging it

**Expected Output:** A diff against the Step 1 baseline containing only comment/doc/prose changes, and a passing build/test run (or a documented skip when no build command exists), with any reverted files recorded alongside their reason.

### 6. Consolidate and Present the Report

Merge every batch's per-file report into one document and summarize for the user. This is the only step whose output the user sees directly. Steps 1-5 produce intermediate files for the agent's own use.

**Constraints:**

- You MUST reconcile the per-file report lines from Step 4 against Step 2's inventory with a script, not by hand, before writing the report: every inventoried file MUST have exactly one outcome line. If a subagent's batch is missing a line for one of its files, You MUST treat that file as unreviewed and flag it explicitly, rather than letting the report silently under-report its own coverage.
- You MUST write the consolidated report to `report_path`, listing every file from Step 2's inventory with its outcome (clean / fixed / trimmed / flagged / unreviewed), grouped by batch or by directory
- You MUST include a short summary: file count reviewed, count fixed, count trimmed, count flagged, count unreviewed (if any), and the one-line "what was stale" or "what was deleted" for each fixed or trimmed file
- You MUST list every flagged code/test issue separately and explicitly, since those need a human or a separate change to resolve, not silently dropped
- ⚠️ MANDATORY OUTPUT STEP: You MUST present the summary directly in your response. Do NOT just say "see the report." Show file counts and the flagged issues inline.
- You MUST NOT commit the changes yourself unless the user explicitly asks, because an unreviewed batch of mechanical edits across many files benefits from a human diff review before it lands
- You MUST remove `scratch_dir` and its contents once the report is written, because the brief and batch files were working inputs for this run only and serve no purpose once the report exists

**Expected Output:** A report file at `report_path`, plus an inline summary in the response covering counts and every flagged or unreviewed file. `scratch_dir` removed.

## Examples

### Example 1: Review a merged PR's blast radius

**Input:**
- change_ref: `pull/20` (or a `base..head` commit range for that PR)
- target_paths: `cli/`, `shared/`
- topic_filter: "telemetry"

**Expected Behavior:** With no `build_command` supplied, Step 1 resolves two project roots (`cli/konductor-rs/Cargo.toml` and `shared/Cargo.toml`) and records one build command per root. The agent reads the PR diff, writes a brief on what changed in telemetry behavior, inventories every tracked file under `cli/` and `shared/`, splits them into balanced batches, dispatches subagents that fix only telemetry-related stale comments (each running the correct per-root build command for the files it touched), verifies the result builds and passes tests per root, and reports counts plus any flagged code issues.

### Example 2: Narrow review on one package

**Input:**
- change_ref: `feature/new-retry-logic..main`
- target_paths: `src/payments/retry/`

**Expected Behavior:** With no `topic_filter`, the agent checks every documentation claim in that directory against the full diff, not just retry-specific ones, since the parameter was omitted.

## Troubleshooting

### The working tree isn't clean at Step 1

If the user has uncommitted changes, do not proceed and do not stash on their behalf. Ask them to commit or stash first. Stashing automatically risks losing their work if the stash is later forgotten, and Step 5's revert logic depends on a known baseline commit, not a stash entry.

### The ground-truth brief misses a behavior change

If a subagent's fix looks wrong, re-check Step 1's brief against the actual diff. A brief built from commit messages or a stat-only diff instead of the full diff will miss renamed functions or changed defaults. Rebuild the brief by reading the complete diff before re-running Step 4.

### Batches finish wildly unevenly

If one batch takes far longer than others, check that Step 3's greedy assignment used real line counts, not file counts. A batch with one 7,000-line file and nine tiny files is still "balanced" by file count but not by review effort.

### A subagent reports a change outside its batch

Each subagent list in Step 3 must be fixed before dispatch. If subagents are told to "pick up whatever's left," two subagents can claim the same file and overwrite each other's fix. Re-split with explicit, non-overlapping lists.

### Verification keeps failing after revert

If reverting one flagged file doesn't clear a build failure, another file in the same batch (or in the same project root) may have also crossed from doc-only into code. Re-run the Step 5 diff review across every file in that project root, not just the first flagged file.

### A build command runs from the wrong directory

If a batch spans multiple project roots (e.g. two crates in a monorepo) and a build check fails with an unrelated-looking error, confirm Step 1's build-command mapping actually recorded one entry per root, and that Step 4/5 ran each root's command scoped to that root rather than running one root's command from the repo root against the other root's files.
