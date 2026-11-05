# Quality dimensions pack

The task rubrics check whether a run did what its task asked. They do not say whether the code is well factored, whether the tests would catch a regression, or whether the README is something a person wants to read. The quality pack adds anchored criteria for those dimensions and runs them as a separate judging pass over finished runs.

The pack never touches the default numbers. `qualityOfRun` (hidden tests, checks, rubric), every existing `report` table and every task's rubric revision stay as they are. Pack scores are reported beside them and are indicative until a person has rated a sample (see Calibration).

## What it measures

| Dimension | Looks at | Example of what the judge must find |
|---|---|---|
| Modularity and design patterns | changed code | the signature of the function that does the most jobs |
| Maintainability and readability | changed code | the longest changed function, the worst name, the inline literal |
| Inline documentation | comments, README | a comment together with the code line it describes |
| Documentation content quality | README, guides, design docs, reviews | the most formulaic sentence, the vaguest instruction |
| Test quality | changed tests | the weakest assertion, the least covered rule |
| Scenario coverage | tests, design docs | one end-to-end scenario with the requirement it traces to |
| Threat model completeness | reviews, threat models | the sentence naming an asset, the most generic mitigation |
| Design doc structure and accuracy | design docs | an API line and a data model line that disagree |

`bench/criteria/quality-pack.json` holds 42 criteria. Each has an id, a dimension, the artifact types it applies to, a weight, and three anchors (fail, partial, pass). An anchor is one or two sentences that name something countable or quotable ("a function longer than 40 lines", "3 or more em dashes", "an assertion that only checks a result exists"). A lint in `validatePack` rejects an anchor that uses a vague word (good, clean, clear, robust and similar), runs past two sentences, repeats another level's text, or contains an em or en dash.

### Criteria

| id | dimension | applies to | weight | scored by | question |
|---|---|---|---|---|---|
| mod-single-responsibility | Modularity and design patterns | code | 2 | judge | Does each function the agent wrote or changed do one job? |
| mod-no-duplication | Modularity and design patterns | code | 2 | judge | Is any logic written twice in the agent's change? |
| mod-isolation | Modularity and design patterns | code | 2 | judge | Can the rule logic run without real I/O, clock or global state? |
| mod-pattern-fit | Modularity and design patterns | code | 1 | judge | Is every abstraction used by a real need, and is no needed one missing? |
| maint-naming | Maintainability and readability | code | 1 | judge | Do names say what the value holds or the function does? |
| maint-size-nesting | Maintainability and readability | code | 2 | judge | Are the changed functions short and shallow? |
| maint-dead-code | Maintainability and readability | code | 1 | judge | Does the change leave unused code behind? |
| maint-error-handling | Maintainability and readability | code | 2 | judge | Are failures handled one way, with a message that names the cause? |
| maint-magic-constants | Maintainability and readability | code | 1 | judge | Are limits and status values named? |
| doc-why-not-what | Inline documentation | comments | 2 | judge | Do the added comments give a reason instead of repeating the code? |
| doc-accuracy | Inline documentation | comments, readme | 3 | judge | Does every checkable statement in a comment or README match the code? |
| doc-no-stale-or-noise | Inline documentation | comments | 1 | judge | Is any comment stale or a log of the edit? |
| doc-concise | Inline documentation | comments | 1 | judge | Is each comment as short as its reason allows? |
| cq-plain-typography | Documentation content quality | readme, guide, design, review, threat-model | 2 | program | Does the prose avoid em dashes, en dashes and curly quotation marks? |
| cq-no-filler-terms | Documentation content quality | same | 2 | program | Does the prose avoid the stock filler terms listed in the pack? |
| cq-sentence-length | Documentation content quality | same | 1 | program | Are sentences short enough to read in one pass? |
| cq-lead-with-point | Documentation content quality | same | 2 | judge | Does the document say what it is for before anything else? |
| cq-concrete | Documentation content quality | same | 2 | judge | Does each instruction or claim carry a command, path, value or example? |
| cq-human-voice | Documentation content quality | same | 3 | judge | Does the prose read like a person wrote it, without formulaic patterns? |
| cq-no-repetition | Documentation content quality | same | 2 | judge | Does any sentence or section repeat something already said? |
| cq-reader-order | Documentation content quality | readme, guide | 2 | judge | Can a reader follow the steps in the order given? |
| cq-direct-instructions | Documentation content quality | readme, guide | 1 | judge | Do instructions start with a direct verb addressed to the reader? |
| test-asserts-behavior | Test quality | tests | 3 | judge | Does each test check a result a wrong implementation would not give? |
| test-rule-would-fail | Test quality | tests | 3 | judge | For each rule in the task, is there a test that fails if the rule is removed? |
| test-scenario-spread | Test quality | tests | 2 | judge | Do the tests go beyond the happy path? |
| test-no-tautology | Test quality | tests | 2 | judge | Is every expected value independent of the code under test? |
| test-one-scenario | Test quality | tests | 1 | judge | Does each test check one scenario? |
| test-names | Test quality | tests | 1 | judge | Does each test name state the scenario? |
| test-deterministic | Test quality | tests | 1 | judge | Does any test depend on time, randomness, network or another test? |
| scn-traced | Scenario coverage | tests, design | 3 | judge | Are end-to-end scenarios identified and traced to requirements? |
| tm-scope | Threat model completeness | review, threat-model | 2 | judge | Does the document say what is protected and where untrusted input enters? |
| tm-stride | Threat model completeness | threat-model | 3 | judge | Is each STRIDE category considered? |
| tm-mitigations | Threat model completeness | review, threat-model | 3 | judge | Is each threat or finding paired with a specific control? |
| tm-residual | Threat model completeness | review, threat-model | 2 | judge | Are assumptions and remaining risk stated? |
| tm-grounded | Threat model completeness | review, threat-model | 3 | judge | Does every named component, file or route exist? |
| des-problem-first | Design doc structure and accuracy | design | 2 | judge | Does the document state the problem and requirements before the solution? |
| des-alternatives | Design doc structure and accuracy | design | 1 | judge | Are alternatives weighed against the chosen approach? |
| des-decision-rationale | Design doc structure and accuracy | design | 2 | judge | Does each major decision carry its reason? |
| des-consistency | Design doc structure and accuracy | design | 3 | judge | Do the data model and the API agree? |
| des-conflicts-surfaced | Design doc structure and accuracy | design | 2 | judge | Are conflicts and gaps in the requirements named? |
| des-technical-accuracy | Design doc structure and accuracy | design | 3 | judge | Are the technical claims true, and can the mechanisms work as written? |
| des-testable-acceptance | Design doc structure and accuracy | design | 2 | judge | Can the stated checks be run and pass or fail? |

A review document uses the threat model criteria that make sense for a code review (scope, mitigations, residual risk, grounding). `tm-stride` applies only to a document the task asked to be a threat model.

## Written content

Documents, READMEs and guides are judged for content, not only for presence. Three criteria are counted by a program, because a count is more reliable than a judge's impression:

- `cq-plain-typography` counts em dashes, en dashes, ` -- ` and curly quotation marks in the added prose.
- `cq-no-filler-terms` counts whole-word matches of the `fillerTerms` list in the pack (words and phrases such as "delve", "seamless", "it is worth noting"). The list is data in the pack, so it can be reviewed and changed with a revision bump.
- `cq-sentence-length` counts sentences over 35 words.

Fenced code, inline code, tables and URLs are left out of the count. Only added lines count, so an existing README is not penalized for text the agent did not write. The evidence for a counted criterion is the list of hits, so a person can audit it. A term used as a literal feature name is a known false positive; read the evidence before acting on a low score.

The other `cq-` criteria need reading and go to the judges. Does the document lead with its purpose? Does each instruction carry a command or example? Does it repeat itself? Are steps in order and instructions direct? Does the prose avoid formulaic patterns: a negative contrast, a padded list of three, a question the text answers itself, a chatbot phrase, or a closing paragraph that restates the opening?

One tell alone is weak evidence of machine-written text. The anchors therefore use counts (1 or 2 instances is partial, 3 or more is fail) and the program counts several tells together.

## Which criteria apply to a run

The pack decides per run, from the task and from what the run produced.

1. **Declared artifacts.** The task asks for some artifact types: code, tests, readme, guide, review, design, threat-model. `taskArtifacts` in the pack declares them for the lite tasks. For any other task they are inferred from the task class and prompt (a design task declares `design`, a prompt that says "add tests" declares `tests`, and so on).
2. **Present, absent or not judgeable.**
   - Declared and produced: the criteria for that type are judged.
   - Not declared: n/a with the reason "the task does not ask for X". Nothing is credited, even if the agent wrote it.
   - Declared and not produced (for example the task asks for tests and none were written): the criteria score fail without a model call, with the reason recorded. Leaving the artifact out is not rewarded with n/a. A missing README or missing comments is the exception, because the task's own checks cover a missing README and a run with no comments has nothing to be wrong.
   - Code changes under 8 added lines are n/a ("too small to judge"), because a one-line fix has no structure to rate.
   - `comments` applies only when the agent added comments to changed code.
3. **Only the agent's changes are graded.** The judge sees the usual bundle plus a diff of what the agent added (`+`) and removed (`-`). The prompt tells it to grade changed lines and treat the rest as context.

For the lite suite this gives:

| Task | Declared | Pack criteria that apply |
|---|---|---|
| simple-fix-failing-test | code | code criteria only if the fix is 8 or more added lines; usually n/a |
| simple-explain-file | guide | documentation content quality |
| orch-input-validation | code, tests, readme | modularity, maintainability, inline docs (if comments), test quality, scenario coverage, documentation content quality for the README diff |
| review-inventory-security | review | threat model scope, mitigations, residual risk, grounding; documentation content quality |
| design-hold-service | design | design doc criteria, scenario coverage, documentation content quality |

## How a criterion is judged

- **Separate call.** The pack runs as a second call per judge and run, not as extra items in the rubric call. The rubric prompt, its cache keys and its reply validation stay byte-identical. A judge answers 8 to 20 items instead of those plus the task rubric. The pack prompt can carry the diff and the quote rules without growing the rubric prompt. A failure in one pass does not discard the other. The cost is that the bundle is sent twice. The prompt holds the usual bundle (at most 48,000 characters), a diff capped at 12,000 characters, the task text, the answer key and only the criteria that apply. A prompt over the 120,000 byte argument limit is refused with an error, as in the rubric pass.
- **Same panel, blinding and aggregation.** The judges come from the same resolution as the rubric pass: `--judges`, then the suite, then the default panel. The bundle and the diff go through the same redaction. Scores are the mean over judges.
- **Evidence is quoted and checked.** Each judged criterion has a `quote` rule that says what to copy: the weakest assertion, the longest function's signature, and so on. The reply is checked with `judge/quote.js`. A pass or partial whose quote is not found in the output drops one level, and the judge's own verdict is kept as `verdictRaw`. `doc-accuracy` and `des-consistency` need two quotes separated by ` @@ ` (the comment and the code it describes; the API line and the data model line). The first quote must be in the output. The second may come from the answer key when the code was not changed and so is not in the output.
- **Anchors say how to break ties.** The prompt tells the judge to count where an anchor gives a number and to choose the lower level when the output sits between two.
- **Score.** Per dimension: the weighted mean of pass 1, partial 0.5, fail 0 over the criteria that were judged, counted or scored absent. n/a criteria are left out. The mean over judges is reported per run, then the mean over runs on a 0 to 100 scale.

## Files and commands

Written by the pack pass: `RUN/judgments-quality.json` (records with each criterion's verdict, raw verdict, evidence, whether the quote was found, the n/a list with reasons, and the dimension scores). `judgments.json` is not read or written. A rerun replaces a record for the same judge, run and revision. A record made against another pack revision or another task revision is ignored by the reports and counted as stale. The pack does not change any task's rubric revision.

```
# how many calls, no model call
node bench/runner/bench.js judge --run RUN --criteria-pack quality --plan

# judge (same backend and flags as the earlier judging of RUN)
node bench/runner/bench.js judge --run RUN --criteria-pack quality [--judges a,b,c] [--judge-backend kiro|opencode ...]

# tables
node bench/runner/bench.js report --run RUN --criteria-pack quality
node bench/runner/bench.js report-2x2 --kiro-vanilla D1 --kiro-konductor D2 --cc-vanilla D3 --cc-konductor D4 --criteria-pack quality --out OUT
```

Without `--criteria-pack`, every command behaves and writes exactly as before.

## Reports

`report` and `report-2x2` add a "Quality dimensions" section when `--criteria-pack quality` is given. Rows are dimensions, columns are arms (or the four cells). Each cell shows the 0 to 100 score, the number of runs where the dimension applied, and the number where it was n/a. `JUDGES DIFFER` appears when the mean spread between the highest and lowest judge exceeds 0.2 on the 0 to 1 scale. A list under the table gives the n/a reasons. The section says in its first line that the scores are not human-calibrated and are not part of the quality score. `report-2x2` refuses cells whose pack judgments come from different panels or backends. The SVG charts are unchanged.

## Calibration

No pack score has been compared with a person's rating. Until that happens, treat dimension scores as a way to find where arms differ, not as a measure.

`calibrate export --run RUN --criteria-pack quality` adds a `pack` block to each sampled item in `sheet.json` and `sheet.md`: the criteria a judge was asked, their three anchors, the quote rule, the agent's diff, and empty `labels`. It also lists the criteria scored by a program or as absent, so a person does not rate those. After labeling, `calibrate score --labels sheet.json --criteria-pack quality` reports judge versus human agreement and kappa per judge and per dimension. No rating is filled in by the tool.

`cap review` (the side-by-side page) is not extended. Its ratings file, import and scoring are built around the task rubric ids, and adding pack ids there would either be dropped silently on import or mix with the rubric score. Use `calibrate export` for pack ratings.

## Sources

The wording of the criteria follows these public references.

- Google engineering practices, "What to look for in a code review": design first, then complexity, tests, naming and comments. Shapes the modularity, maintainability, test and comment criteria.
- Test smell research (tsDetect and the study of smells in LLM-generated unit tests): assertion roulette (many assertions in one test), tests with no assertion, magic numbers. Shapes `test-asserts-behavior`, `test-one-scenario`.
- Wikipedia, "Signs of AI writing", and its caution that one tell proves nothing and a cluster is stronger. Shapes the written-content criteria and their count thresholds.
- RULERS (locked rubrics and evidence-anchored scoring) and the AWS blog post on the rubric-based Nova judge. Both use fixed, versioned rubrics, a justification tied to each criterion, weights that sum to one, and scores mapped to 0 to 1. RULERS also checks evidence in code instead of trusting the judge. They shape the revision hash, the quote rule and the weighted dimension score.
- Anchored scales from rubric practice: a level is defined by what an observer can see, with counts where possible.

## Known limits

- Judges read text. Counting lines, nesting and assertions is approximate for a model; the objective signals listed below would replace those anchors for code.
- Without a task fixture's source in the bundle, "the code line that confirms" a README claim comes from the answer key, which exists for the lite tasks only. Tasks without an answer key will score `doc-accuracy` and `tm-grounded` with less support.
- The task rubrics are unchanged on purpose, so the same task text stays comparable with runs made before the pack. Written-content quality is in the pack's rubric block, judged and shown beside the task rubric score. To make a task's own rubric include it, add rubric items to that task and accept a new rubric revision, which makes earlier judgments for the task stale.
- Inline-documentation criteria say nothing about code with no comments. Not commenting is not penalized.

## Cost

One extra judge call per judge per run that has at least one judged criterion. Runs whose criteria are all n/a, absent or counted by a program cost nothing. On the lite suite that is up to four of five tasks. The prompt is larger than a rubric call (bundle, diff, criteria text), so plan for roughly 1.0 to 1.3 times the cost of one rubric pass over the same runs. `--plan` prints the exact number of calls; multiply by the per-call cost in the credit ledger of the earlier judging.

## Next

Objective signals that would replace or support judge anchors for code. None is implemented.

| Signal | Replaces or supports | How to measure offline for the node fixtures | Cost |
|---|---|---|---|
| Cyclomatic complexity and function length | `maint-size-nesting`, `mod-single-responsibility` | Run an AST-based complexity tool (ESLint `complexity` and `max-lines-per-function`, or a small acorn walker) over changed functions only, using the diff's line ranges | Seconds per run, no model call; needs the tool in the toolchain |
| Duplication | `mod-no-duplication` | A token-based clone detector (jscpd) over the changed files, threshold at 3 lines or 30 tokens | Seconds per run |
| Lint findings | `maint-naming`, `maint-dead-code`, `maint-magic-constants` | ESLint with a fixed config (`no-unused-vars`, `no-unreachable`, `no-magic-numbers`, `id-length`), counting findings on changed lines | Seconds per run |
| Mutation testing | `test-rule-would-fail`, `test-asserts-behavior` | Stryker (or a minimal mutator for the fixtures) mutating only the changed source files, running the agent's tests against each mutant, reporting the share killed | Minutes per run; the fixtures are small, so a few dozen mutants each; CPU heavy |
| Coverage of changed lines | `test-scenario-spread` | c8 or `node --test --experimental-test-coverage`, share of changed lines executed | Seconds per run |
| Test smell detector | `test-one-scenario`, `test-no-tautology` | A small AST check for tests with no assertion, assertions comparing a value to itself, and tests with many assertions | Seconds per run |
| Readability scores for prose | `cq-sentence-length` extension | Average sentence length and a reading-ease score on the added prose | Milliseconds per document |

When these exist, the judge anchors for the matching criteria should be reduced to what a count cannot see (is the abstraction justified, is the assertion meaningful), and the counts reported beside them.
