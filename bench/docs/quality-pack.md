# Quality dimensions pack

The task rubrics check whether a run did what its task asked. They do not say whether the code is well factored, whether the tests would catch a regression, or whether the README is something a person wants to read. The quality pack adds anchored criteria for those dimensions and runs them as a separate judging pass over finished runs.

By default the pack does not touch the numbers. `qualityOfRun` (hidden tests, checks, rubric), every existing `report` table and every task's rubric revision stay as they are, and pack scores are reported beside them. A scoring file can make the pack a fourth component of the quality score (see In the quality score). Pack scores are indicative until a person has rated a sample (see Calibration).

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
| Change discipline | any code change, of any size | the added debug line, the skipped test, the hunk the task did not ask for |
| Requirements clarity | requirements documents | a requirement with no check that can pass or fail, a vague term with no number |
| Non-functional requirements across milestones | requirements, design documents | a performance target with no unit, a capacity target with no design mechanism |
| Scalability and resilience of design | design documents | what limits the system first at 10 times the load, what happens when a dependency fails |
| Task breakdown | plans | a task that uses an output no listed dependency provides, a task with no done check |
| Diagrams in design documents | design documents | a diagram line and the prose line it must match |
| Operability and rollout of design | design documents | an alarm with no operator action, a rollout step with no undo |
| Guide quality | guides | a sentence that is wrong about the code, a term the reader cannot know |
| Concurrency in code | changed code of a task that names concurrent calls | the read, wait and write of shared state with no lock, a promise no one awaits or catches, a wait with no timeout |
| Extensibility | changed code of a task that says a new case comes later | one line from each file that lists every case by name |
| Non-functional requirements in code | changed code of a task whose design names targets | the cache, limit, retry or index line together with the target it serves |
| Enterprise patterns | changed code of a task whose answer key asks for one | the line that crosses the boundary the Pattern key names |
| Ideation and problem framing | a problem framing a task asks for | the problem sentence and the data line behind it, the option that differs most from the request |
| Proof of concept and spike | a spike a task asks for | the question with its threshold, a result with its unit and the command that made it |
| Architecture deliberation | a decision record a task asks for | the matrix row of the chosen option and of one it ruled out, the review trigger |
| Production readiness in code | product code and runbook of a task that asks for readiness | the structured log on a failure path, the configuration check, the drain bound, the cost line |
| Review findings | reviews, code reviews and review audits | a finding's severity with its impact, the least specific finding, the style remarks, the verdict line |
| Design review findings | a review of a given design | a gap with its section and the design text that leaves it open, its consequence |
| Review audit | an audit of someone else's code review | a missed defect with why it was missed, a refutation with its code line, a severity correction with its reason |

`bench/criteria/quality-pack.json` holds 116 criteria, each in one of 13 SDLC phases (see SDLC phases). Each has an id, a dimension, the artifact types it applies to, a weight, and three anchors (fail, partial, pass). An anchor is one or two sentences that name something countable or quotable ("a function longer than 40 lines", "3 or more em dashes", "an assertion that only checks a result exists"). A lint in `validatePack` rejects an anchor that uses a vague word (good, clean, clear, robust and similar), runs past two sentences, repeats another level's text, or contains an em or en dash.

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
| cq-plain-typography | Documentation content quality | readme, guide, design, review, threat-model, requirements, plan | 2 | program | Does the prose avoid em dashes, en dashes and curly quotation marks? |
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
| des-consistency | Design doc structure and accuracy | design | 3 | judge | Do the data model, the API and the diagrams agree? |
| des-conflicts-surfaced | Design doc structure and accuracy | design | 2 | judge | Are conflicts and gaps in the requirements named? |
| des-technical-accuracy | Design doc structure and accuracy | design | 3 | judge | Are the technical claims true, and can the mechanisms work as written? |
| des-testable-acceptance | Design doc structure and accuracy | design | 2 | judge | Can the stated checks be run and pass or fail? |
| des-diagram-present | Diagrams in design documents | design | 2 | judge | Does the design draw each view its content needs (sequence, component or class, data flow, data model, API schema)? |
| des-diagram-fit | Diagrams in design documents | design | 3 | judge | Does every diagram match the prose that describes the same flow, structure or data? |
| des-diagram-labels | Diagrams in design documents | design | 1 | judge | Is every arrow and relationship labeled with what it carries? |
| des-architecture | Design doc structure and accuracy | design | 2 | judge | Does the design name each component and state what it owns and how it connects to its neighbors? |
| des-goals-nongoals | Design doc structure and accuracy | design | 1 | judge | Does the design state its goals and what it leaves out? |
| des-adr-consequences | Design doc structure and accuracy | design | 2 | judge | Does each major decision state its status and its consequences? |
| des-operability | Operability and rollout of design | design | 2 | judge | Does the design say how an operator sees the health of the system and what the operator does when it degrades? |
| des-rollout-migration | Operability and rollout of design | design | 2 | judge | Does the design say how it is rolled out, how existing data and clients move over, and how a step is undone? |
| chg-no-leftovers | Change discipline | change | 2 | program | Does the change leave out debug output, focus markers, TODO notes and commented-out code? |
| chg-tests-intact | Change discipline | change | 3 | program | Does the change keep every existing test running? |
| chg-scoped | Change discipline | change | 2 | judge | Does the change touch only what the task asks for? |
| req-unambiguous | Requirements clarity | requirements | 2 | program | Do the requirement statements avoid unquantified vague terms? |
| req-testable | Requirements clarity | requirements | 3 | judge | Does each requirement come with a check that can pass or fail? |
| req-failure-and-edge-cases | Requirements clarity | requirements | 2 | judge | Do the requirements say what happens on invalid input, a failed dependency and a boundary value? |
| req-no-solution-leak | Requirements clarity | requirements | 2 | judge | Do the requirements say what the system does and leave out how? |
| req-conflicts-and-gaps | Requirements clarity | requirements | 3 | judge | Are the conflicts, gaps and undefined terms in the request named? |
| req-assumptions-and-questions | Requirements clarity | requirements | 2 | judge | Are assumptions and open questions stated with the effect of being wrong? |
| req-prioritized | Requirements clarity | requirements | 1 | judge | Does each requirement carry a priority? |
| req-traceable | Requirements clarity | requirements | 1 | judge | Does each requirement have an id and name the request statement it comes from? |
| req-nfr-coverage | Non-functional requirements across milestones | requirements | 3 | judge | Is there a requirement for each non-functional need the request implies? |
| req-nfr-measurable | Non-functional requirements across milestones | requirements | 3 | judge | Does each non-functional requirement state a number, a unit and the operation it applies to? |
| des-nfr-addressed | Non-functional requirements across milestones | design | 3 | judge | Is each throughput, latency, availability or capacity target tied to a design mechanism? |
| des-scale-bottleneck | Scalability and resilience of design | design | 2 | judge | Does the design say what limits it first when load or data grows? |
| des-failure-modes | Scalability and resilience of design | design | 2 | judge | Does the design say what happens when a component or dependency fails? |
| plan-independent-tasks | Task breakdown | plan | 3 | judge | Can each task be done without an output that no listed dependency provides? |
| plan-done-criteria | Task breakdown | plan | 3 | judge | Does each task have a done check that can pass or fail? |
| plan-dependencies-order | Task breakdown | plan | 3 | judge | Are the dependencies listed, the order consistent with them, and independent tasks marked parallel? |
| plan-coverage | Task breakdown | plan | 3 | judge | Does every required part of the request map to a task, and every task to a part? |
| plan-sizing | Task breakdown | plan | 2 | judge | Does each task cover one concern? |
| plan-risks | Task breakdown | plan | 2 | judge | Are the main risks and unknowns listed with a mitigation or a spike? |
| plan-test-tasks | Task breakdown | plan | 2 | judge | Does the plan schedule tests for the functional parts and for the non-functional requirements? |
| plan-delegation-fit | Task breakdown | delegation | 2 | judge | Does each task name an owner whose type matches the work? |
| guide-accuracy | Guide quality | guide | 3 | judge | Does every checkable statement in the guide match the code, files or facts it describes? |
| guide-audience-fit | Guide quality | guide | 2 | judge | Does the guide use the vocabulary and depth of the reader the task names, or of a new team member when the task names none? |
| guide-troubleshooting | Guide quality | guide | 2 | judge | Does the guide cover what goes wrong: a failing step, an error, a wrong result or a case that surprises the reader? |
| guide-scannability | Guide quality | guide | 1 | judge | Can a reader find a section from its heading and take in each block at a glance? |
| guide-consistent-terms | Guide quality | guide | 2 | judge | Does the guide call each thing by one name, the same name the code or the task uses? |
| conc-shared-state | Concurrency in code | concurrency | 3 | judge | Is every update of state that concurrent calls share made as one atomic step? |
| conc-async-errors | Concurrency in code | concurrency | 2 | judge | Does every promise or callback the change starts have an owner for its failure? |
| conc-timeout-cancel | Concurrency in code | concurrency | 2 | judge | Does every wait on another party have a timeout or a cancel path that also frees what the wait held? |
| ext-one-place | Extensibility | extension | 3 | judge | How many existing files must be edited to add one more case of the kind the task names? |
| ext-closed-core | Extensibility | extension | 2 | judge | Does the code that uses the cases call them through one contract without naming any case? |
| code-nfr-mechanism | Non-functional requirements in code | nfr-code | 3 | judge | For each non-functional target the task or design names, does the code use the mechanism named for it? |
| code-nfr-bounded | Non-functional requirements in code | nfr-code | 2 | judge | Is every cache, queue, retry and concurrency limit in the change bounded by a named number? |
| mod-pattern-missing | Modularity and design patterns | pattern-key | 2 | judge | Does the change use each pattern the answer key names under Pattern key, or an equivalent the key accepts? |
| ent-pattern-applied | Enterprise patterns | enterprise-pattern | 2 | judge | Does the change use the enterprise pattern the Pattern key asks for, at the boundary the key names? |
| idea-problem-evidence | Ideation and problem framing | framing | 3 | judge | Does the framing state the problem the evidence shows, with the numbers that show it? |
| idea-options-range | Ideation and problem framing | framing | 2 | judge | Are at least three options weighed, including doing nothing and one that is not the requested solution? |
| idea-success-measure | Ideation and problem framing | framing | 2 | judge | Is success defined by a measure with a baseline, a target and a way to read it? |
| idea-kill-criteria | Ideation and problem framing | framing | 1 | judge | Does the framing list the assumptions to test first and a signal that would stop the work? |
| spike-question | Proof of concept and spike | spike | 2 | judge | Does the spike state one question, the decision it informs and the threshold for an answer before the results? |
| spike-evidence | Proof of concept and spike | spike | 3 | judge | Are the results measured numbers with units, input size and a command that reproduces them? |
| spike-scope-throwaway | Proof of concept and spike | spike | 1 | judge | Is the spike code kept apart from product code and marked as throwaway? |
| spike-recommendation | Proof of concept and spike | spike | 2 | judge | Does the recommendation follow from the measured numbers and state the limits of the measurement? |
| arch-criteria-explicit | Architecture deliberation | decision | 2 | judge | Are the decision criteria listed, each tied to a stated constraint with its number, and ranked? |
| arch-tradeoff-matrix | Architecture deliberation | decision | 3 | judge | Is every option rated against every criterion, with a reason for each rating? |
| arch-option-fair | Architecture deliberation | decision | 2 | judge | Is each rejected option given the conditions under which it would win? |
| arch-reversibility | Architecture deliberation | decision | 2 | judge | Does the record say what reversing the decision costs and which signal would trigger a review? |
| prod-observability | Production readiness in code | production | 3 | judge | Does every failure path log a structured record with an id and the cause, and count the outcome? |
| prod-config-secrets | Production readiness in code | production | 3 | judge | Is configuration read and checked at start, with no secret written in the code? |
| prod-graceful-lifecycle | Production readiness in code | production | 2 | judge | Does the code report its health and shut down by draining in-flight work within a bound? |
| prod-cost-estimate | Production readiness in code | production | 2 | judge | Does the runbook estimate the monthly cost from the stated volume and unit price, and name the biggest cost driver? |
| prod-runbook-actions | Production readiness in code | production | 2 | judge | Does each alarm in the runbook have a metric, a threshold and the action an operator takes? |
| rev-severity-impact | Review findings | review, code-review, design-review, review-audit | 2 | judge | Does each finding's severity come with the impact that justifies it? |
| cr-actionable | Review findings | code-review, review-audit | 3 | judge | Does each finding give its location, the input or sequence that triggers it, and a fix? |
| cr-signal | Review findings | code-review | 2 | judge | Are style remarks kept apart from defects and few enough not to bury them? |
| cr-coverage-areas | Review findings | code-review | 2 | judge | Does the review say which risk areas it checked: tests, security of input, concurrency and non-functional limits? |
| cr-verdict | Review findings | code-review, review-audit | 2 | judge | Does the review end with one verdict that follows from its findings? |
| dr-gap-specific | Design review findings | design-review | 3 | judge | Does each gap cite the section of the design it concerns and quote or name the text that leaves it open? |
| dr-consequence | Design review findings | design-review | 2 | judge | Does each gap say what goes wrong if it ships as written and what to add or ask? |
| dr-prioritized | Design review findings | design-review | 1 | judge | Are the gaps ranked, with those that block launch marked? |
| ra-missed-explained | Review audit | review-audit | 3 | judge | Does each missed defect come with its location, its impact and the reason the review did not catch it? |
| ra-claim-evidence | Review audit | review-audit | 3 | judge | Is each claim called wrong refuted with the code or test that disproves it? |
| ra-severity-reason | Review audit | review-audit | 2 | judge | Does each severity correction give the old level, the new level and the impact that justifies the change? |

## Code-quality criteria for concurrency, extension, targets and patterns

These nine criteria rate code against a need the task states. Code with no such need has nothing to rate, so each criterion applies to one artifact type that a task must declare in `taskArtifacts`: `concurrency`, `extension`, `nfr-code`, `pattern-key` or `enterprise-pattern`. The five types are `declaredOnly`, and they read the changed product code with the same 8-line floor as `code`. Any other task gets n/a with the reason, for example "the task does not ask for concurrent code".

- Concurrency (`conc-*`) counts reads of shared state that wait before they write, promises with no owner for their failure, and waits with no timeout or cancel path.
- Extensibility (`ext-*`) counts the existing files that list every case by name, which is the number of files the next case edits. `ext-closed-core` asks whether the core code branches on a case name.
- Targets in code (`code-nfr-*`) ties each target in the task or design to its mechanism and number. `des-nfr-addressed` asks the same of a design document; these ask it of the code.
- Pattern fit works both ways. `mod-pattern-fit` is unchanged and still punishes extra abstraction on any code. `mod-pattern-missing` punishes a pattern the change needed and left out.
- Enterprise patterns (`ent-pattern-applied`) covers a repository, a unit of work, an anti-corruption layer and similar. It is judged only when the task's answer key asks for one.

`mod-pattern-missing` and `ent-pattern-applied` are judged only against the task's answer key, never by taste. The fixture's `.bench-answer-key.md` holds a `## Pattern key` section with `- needed:` lines (and `- accepted:` equivalents) for `pattern-key`, and an `- enterprise:` line for `enterprise-pattern`. The task validator fails a task that declares a type and has no such line (`patternKeyProblems` in `judge/pack/load.js`). Both criteria, and `code-nfr-mechanism`, take two quotes: the code line, then the Pattern key or design line it is checked against.

Three hard tasks need these criteria, and each has hidden tests that measure the same thing without a judge.

| Task | Declares | Hidden tests | What the hidden tests measure |
|---|---|---|---|
| `hard-seat-holds` | code, tests, concurrency | 13 | 200 calls at once on 10 seats, one user at once, declined charges under load, a charge that never settles, an abort while paying, a failing notifier with no unhandled rejection |
| `hard-export-formats` | code, tests, extension, pattern-key | 14 | TSV behaviour, plus the hidden extension step: the number of existing source files that name every format, at most 2 and at most 1 |
| `hard-catalog-limits` | code, tests, nfr-code, enterprise-pattern | 14 | supplier calls over 1000 lookups, expiry and eviction, at most 4 calls in flight, retry waits, work per category listing over 10,000 items, supplier field names read in one module |

Three more tasks declare `pattern-key` since 2026-11-27 (prompt-fix step 0). Their hidden tests check behaviour only, so
the Pattern key is judged by the pack alone, and each key names the equivalents a fair answer may use.

| Task | Declares | Pattern key asks for |
|---|---|---|
| `cx-carddemo-batchday` | code, tests, readme, pattern-key | one shared fixed-width record layer, one edited-amount formatter, one handler per job behind one contract and one dispatching entry (owner sign-off needed: the task is signed) |
| `t12-split-three-modules` | code, tests, pattern-key | a table-driven Roman numeral conversion and one standard-form rule for parsing |
| `t12-split-four-jobs` | code, tests, pattern-key | pure `run(input)` steps, fixed-point money, calendar dates as day numbers |

`t12-split-shared-file` has no Pattern key: no pattern is clearly right for two small options in one file, and
`mod-pattern-fit` covers it.

The hidden extension step counts files and does not run a second agent turn: a file whose code names every format is a file the next format must edit. A file that keeps the list in a plain loop over a copy, or hides the names in a computed string, is not caught. The NFR-4 test counts snapshot reads and array visits; a plain index loop over a copy is not counted.

The diagram criteria read the design document as a whole, fenced blocks included. A view is needed when the content calls for it:

- Sequence: a flow with 3 or more parties.
- Component or class: 3 or more named components.
- Data flow: data moving between 2 or more stores or services.
- Data model: 2 or more entities.
- API schema: 3 or more endpoints.

The judge quotes a diagram line as it appears inside the fence, together with the prose line it must match. A document with no diagram scores fail on all three, as for any artifact the task asked for and did not get. `des-consistency` also treats a diagram as a source, so a field or step that a diagram shows and the data model or API does not define counts as a disagreement. The counted prose criteria still skip fenced code, so text inside a diagram is not counted for typography, filler or sentence length.

The other design criteria follow the usual sections of a design document and of an architecture decision record.

- `des-architecture` reads the component list: one responsibility per component, no responsibility claimed twice, a named interface between connected components.
- `des-goals-nongoals` wants a goal that can be checked against a requirement or a number, and a non-goal with its reason.
- `des-adr-consequences` wants a status (accepted, proposed or superseded) and a consequence for each major decision. `des-decision-rationale` still rates the reason, and `des-alternatives` the options weighed.
- `des-operability` wants signals (metric, log line, alarm) with a threshold and the operator action each triggers.
- `des-rollout-migration` wants rollout steps, how each is undone, and what happens to existing data and clients. A new system with no existing data passes by saying so.

A task that never asked for these sections scores them the same way for every arm, so they separate arms only by what the design volunteered.

The guide criteria apply to a task that declares `guide` and to no other. `guide-accuracy` is a guide variant of `doc-accuracy`, which is unchanged. `doc-accuracy` asks for a comment or README sentence together with the code line that confirms it, and a guide about code the agent did not change has that line in neither the output nor the diff. `guide-accuracy` asks for the guide sentence only, and the judge checks it against the answer key and the task. The other four criteria rate audience fit (terms the stated reader cannot know), what the guide says about failures and surprising cases, layout for scanning (headings, paragraph length, lists), and one name per thing.

The change discipline, requirements, non-functional, design scalability and task breakdown groups follow the deliverables of the SDLC skills in this repository, so a run is rated at the milestones it produced.

- Change discipline applies to a code change of any size, so a one-line fix is rated too. The leftovers and skipped-test checks are counted by a program; `chg-scoped` is judged against the task text. The changed-file set leaves out the caches a test or lint run writes: `.pytest_cache`, `__pycache__`, `*.pyc`, `.mypy_cache` and `.ruff_cache`. `node_modules`, and so `node_modules/.cache`, is skipped as tool state. Running the tests therefore does not count as touching files the task did not ask for. The list is in `judge/ephemeral.js`, and the judge bundle and the artifact byte counts in reports use it too.
- Requirements clarity follows the requirements quality gates (EARS keywords, a check that can pass or fail, error cases, no implementation detail, a source for each requirement).
- Non-functional requirements across milestones follows the non-functional requirements skill and the design review dimensions. `req-nfr-coverage` and `req-nfr-measurable` read the requirements document, and `des-nfr-addressed` reads the design: each throughput, latency, availability or capacity target needs a number and a mechanism that meets it. Test work for these requirements is rated in the plan (`plan-test-tasks`).
- Scalability and resilience of design follows the scalability, performance and failure handling review areas: what limits the design first at 10 times the load, and what each dependency does when it fails.
- Task breakdown follows the task decomposition and plan review skills. It rates independent tasks, a done check for each, explicit dependencies, coverage of the request, sizing and risks. It also rates tests for functional and non-functional parts, and owners that fit the work.

A review document uses the threat model criteria that make sense for a code review (scope, mitigations, residual risk, grounding). `tm-stride` applies only to a document the task asked to be a threat model.

## SDLC phases

The pack lists 13 phases in `phases`, and each criterion sits in exactly one (the lint refuses a gap or a double). `report-2x2 --criteria-pack quality` scores each phase on its own (see Reports).

| Phase | Criteria | Ids |
|---|---|---|
| Ideation and problem framing | 6 | `des-problem-first`, `des-goals-nongoals`, `idea-problem-evidence`, `idea-options-range`, `idea-success-measure`, `idea-kill-criteria` |
| Proof of concept and spike | 4 | `spike-question`, `spike-evidence`, `spike-scope-throwaway`, `spike-recommendation` |
| Architecture and design deliberation | 15 | `des-alternatives`, `des-decision-rationale`, `des-adr-consequences`, `des-architecture`, `des-consistency`, `des-technical-accuracy`, `des-conflicts-surfaced`, `des-testable-acceptance`, `des-diagram-present`, `des-diagram-fit`, `des-diagram-labels`, `arch-criteria-explicit`, `arch-tradeoff-matrix`, `arch-option-fair`, `arch-reversibility` |
| Requirements | 8 | `req-unambiguous`, `req-testable`, `req-failure-and-edge-cases`, `req-no-solution-leak`, `req-conflicts-and-gaps`, `req-assumptions-and-questions`, `req-prioritized`, `req-traceable` |
| Non-functional requirements | 5 | `req-nfr-coverage`, `req-nfr-measurable`, `des-nfr-addressed`, `code-nfr-mechanism`, `code-nfr-bounded` |
| Production readiness | 14 | `tm-scope`, `tm-stride`, `tm-mitigations`, `tm-residual`, `tm-grounded`, `des-operability`, `des-rollout-migration`, `des-scale-bottleneck`, `des-failure-modes`, `prod-observability`, `prod-config-secrets`, `prod-graceful-lifecycle`, `prod-cost-estimate`, `prod-runbook-actions` |
| Implementation | 16 | `mod-single-responsibility`, `mod-no-duplication`, `mod-isolation`, `mod-pattern-fit`, `mod-pattern-missing`, `maint-naming`, `maint-size-nesting`, `maint-dead-code`, `maint-error-handling`, `maint-magic-constants`, `conc-shared-state`, `conc-async-errors`, `conc-timeout-cancel`, `ext-one-place`, `ext-closed-core`, `ent-pattern-applied` |
| Testing | 8 | `test-asserts-behavior`, `test-rule-would-fail`, `test-scenario-spread`, `test-no-tautology`, `test-one-scenario`, `test-names`, `test-deterministic`, `scn-traced` |
| Documentation | 18 | `doc-why-not-what`, `doc-accuracy`, `doc-no-stale-or-noise`, `doc-concise`, `cq-plain-typography`, `cq-no-filler-terms`, `cq-sentence-length`, `cq-lead-with-point`, `cq-concrete`, `cq-human-voice`, `cq-no-repetition`, `cq-reader-order`, `cq-direct-instructions`, `guide-accuracy`, `guide-audience-fit`, `guide-troubleshooting`, `guide-scannability`, `guide-consistent-terms` |
| Change discipline | 3 | `chg-no-leftovers`, `chg-tests-intact`, `chg-scoped` |
| Code review and review audit | 8 | `rev-severity-impact`, `cr-actionable`, `cr-signal`, `cr-coverage-areas`, `cr-verdict`, `ra-missed-explained`, `ra-claim-evidence`, `ra-severity-reason` |
| Design review | 3 | `dr-gap-specific`, `dr-consequence`, `dr-prioritized` |
| Delegation and planning | 8 | `plan-independent-tasks`, `plan-done-criteria`, `plan-dependencies-order`, `plan-coverage`, `plan-sizing`, `plan-risks`, `plan-test-tasks`, `plan-delegation-fit` |

Coverage before this map. Requirements, non-functional targets, implementation, testing, documentation and planning each had 5 or more criteria and a task. Four phases were thin or missing:

- Ideation had 2 criteria, both inside a design document, and no task.
- Proof of concept had none.
- Architecture deliberation had alternatives, rationale and consequences, but no trade-off matrix, no fair case for rejected options and no reversal cost.
- Production readiness had threat model and design-document criteria, and nothing for configuration, secrets, logs, health, shutdown or cost in code.

Review had only the threat model criteria. Three review areas were missing and now have their own types, criteria and tasks. They are doing a code review (`code-review`), finding the gaps in a design (`design-review`), and finding what someone else's review missed or got wrong (`review-audit`). `rev-severity-impact` applies to all three and to `review`, so the new criteria extend it rather than repeat it.

The review tasks are scored in two parts. Recall, false alarms and severity are counted by hidden tests against a fixed key of planted items, with no judge. A finding is a list item that starts with its severity in brackets and then a `file:line` or a section. It is matched to a planted item by location (within a few lines of an anchor text in the file) or by a short list of distinctive phrases. Each finding goes to at most one item, so a finding between two neighbours is not counted twice. The matcher is `hidden/<task>/hidden/review-key.js`; the three copies are kept identical by a test. The judge rates only how each finding is explained (`cr-*`, `dr-*`, `ra-*`).

| Task | Phase | Declares | Planted | Hidden tests |
|---|---|---|---|---|
| `sdlc-code-review` | code review | code-review | 6 defects (race, path traversal, negative amount, off by one, unbounded retry, weak test) and 2 decoys | 10: each defect, severity of the three that lose money or data, no decoy flagged, at most 3 unmatched findings, the verdict |
| `sdlc-design-review-gaps` | design review | design-review | 7 gaps (latency target, clock assumption, payment failure, admin access, rollout, diagram against text, data retention) and 3 covered topics | 10: each gap, severity of the two security and failure gaps, at most 1 false alarm about a covered topic, a section named in 80% of findings |
| `sdlc-review-audit` | code review | review-audit | 3 missed defects, 2 wrong claims, 2 severity errors, 3 correct findings | 10: each missed defect, each wrong claim, no correct finding called wrong, both severity corrections, the verdict, at most 2 unmatched missed items |

The key lives only in the hidden tests and the fixture's answer key, which the agent never sees; a test checks that no fixture file names a planted id.

Each new criterion applies to one declared-only type (`framing`, `spike`, `decision`, `production`) or to `review`. Each of the four types has its own task in `bench/sdlc/`:

| Task | Phase | Declares | Deterministic checks |
|---|---|---|---|
| `sdlc-problem-framing` | ideation | framing | 11 checks: the 41 of 66 tickets cited, findability named near export, the hidden print button, a do-nothing option, 3 options, a success number, a stop signal |
| `sdlc-spike-dedupe` | proof of concept | spike | 11 checks: `node spike/run.js` finishes and prints at least 2 measurements with `sameOutput` true at 50,000, the command and units in the write-up, `src/` and `test/` unchanged |
| `sdlc-arch-decision` | architecture | decision | 10 checks: 3 options, the 120 partners without an endpoint near webhooks, a decision that serves both kinds of partner, a matrix of 4 or more rows, consequences and a review trigger |
| `sdlc-prod-readiness` | production readiness | code, tests, production | 12 hidden tests (settings and their errors, no key literal, structured failure logs with no key, health, a drained and a timed-out stop) and a runbook cost of 600 USD |

`suites/sdlc.json` runs the seven `sdlc-*` tasks with eight earlier ones, so every phase has at least one task. `runner/test/sdlc-report.test.js` checks that coverage.

## Written content

Documents, READMEs and guides are judged for content, not only for presence. Three criteria are counted by a program, because a count is more reliable than a judge's impression:

- `cq-plain-typography` counts em dashes, en dashes, ` -- ` and curly quotation marks in the added prose.
- `cq-no-filler-terms` counts whole-word matches of the `fillerTerms` list in the pack (words and phrases such as "delve", "seamless", "it is worth noting"). The list is data in the pack, so it can be reviewed and changed with a revision bump.
- `cq-sentence-length` counts sentences over 35 words.

Three more criteria are counted from other text. `req-unambiguous` counts terms from the `vagueTerms` list ("fast", "as needed", "etc" and similar) in requirement sentences that hold no number. It reads table rows too. It skips sections about assumptions, questions, conflicts and the request itself, and lines that flag the term as vague. `chg-no-leftovers` counts added debug output, test focus markers, TODO and FIXME notes and commented-out code, using the `leftoverPatterns` groups. `chg-tests-intact` counts skip markers added to tests, test declarations removed with no replacement, and deleted test files, using `weakenedTestPatterns`. The three lists are data in the pack, so they can be reviewed and changed with a revision bump.

For the prose counts, fenced code, inline code, tables and URLs are left out of the count. Only added lines count, so an existing README is not penalized for text the agent did not write. The evidence for a counted criterion is the list of hits, so a person can audit it. A term used as a literal feature name is a known false positive; read the evidence before acting on a low score.

The other `cq-` criteria need reading and go to the judges. Does the document lead with its purpose? Does each instruction carry a command or example? Does it repeat itself? Are steps in order and instructions direct? Does the prose avoid formulaic patterns: a negative contrast, a padded list of three, a question the text answers itself, a chatbot phrase, or a closing paragraph that restates the opening?

One tell alone is weak evidence of machine-written text. The anchors therefore use counts (1 or 2 instances is partial, 3 or more is fail) and the program counts several tells together.

## Which criteria apply to a run

The pack decides per run, from the task and from what the run produced.

1. **Declared artifacts.** The task asks for some artifact types: code, tests, readme, guide, review, design, threat-model, requirements, plan. Two more are derived. `change` is declared by any task that declares `code`. `delegation` (the owner named for each plan task) is declared only by a task that lists it in `taskArtifacts`, so `plan-delegation-fit` applies to a task that asks for assignments and to no other. The pack lists it under `declaredOnly`, so it is never the reason a whole dimension is n/a, and its n/a text says "assignments" and not the type name. `taskArtifacts` in the pack declares them for the lite tasks and for the tasks that name a document type, such as `simple-readme-section` (`readme`), so the README criteria score it. For any other task they are inferred from the task class and prompt (a design task declares `design`, a prompt that says "add tests" declares `tests`, and so on).
2. **Present, absent or not judgeable.**
   - Declared and produced: the criteria for that type are judged.
   - Not declared: n/a with the reason "the task does not ask for X". Nothing is credited, even if the agent wrote it.
   - Declared and not produced (for example the task asks for tests and none were written): the criteria score fail without a model call, with the reason recorded. Leaving the artifact out is not rewarded with n/a. A missing README or missing comments is the exception, because the task's own checks cover a missing README and a run with no comments has nothing to be wrong.
   - Code changes under 8 added lines are n/a for the structure criteria ("too small to judge"), because a one-line fix has no structure to rate. The change discipline criteria have no size floor.
   - `comments` applies only when the agent added comments to changed code.
3. **Only the agent's changes are graded.** The judge sees the usual bundle plus a diff of what the agent added (`+`) and removed (`-`). The prompt tells it to grade changed lines and treat the rest as context.

For the lite suite this gives:

| Task | Declared | Pack criteria that apply |
|---|---|---|
| simple-fix-failing-test | code | change discipline; the structure criteria only if the fix is 8 or more added lines |
| simple-explain-file | guide | documentation content quality |
| orch-input-validation | code, tests, readme | change discipline, modularity, maintainability, inline docs (if comments), test quality, scenario coverage, documentation content quality for the README diff |
| review-inventory-security | review | threat model scope, mitigations, residual risk, grounding; documentation content quality |
| design-hold-service | design | design doc criteria, non-functional requirements (`des-nfr-addressed`), design scalability, scenario coverage, documentation content quality |

The `requirements` suite (see `README-tasks.md`) adds two tasks:

| Task | Declared | Pack criteria that apply |
|---|---|---|
| req-vague-request | requirements | requirements clarity, non-functional requirements (`req-nfr-coverage`, `req-nfr-measurable`), documentation content quality |
| plan-multipart-feature | plan | task breakdown, documentation content quality |

A declared type with no produced file scores fail on its criteria without a model call, as for the other types.

A design task that asks for diagrams is available as the optional variant `design-hold-service-diagrams` (see `README-tasks.md`, Variants). The original `design-hold-service` is unchanged, so its saved judgments keep their task revision.

## How a criterion is judged

- **Separate call.** The pack runs as a second call per judge and run, not as extra items in the rubric call. The rubric prompt, its cache keys and its reply validation stay byte-identical. A judge answers 8 to 20 items instead of those plus the task rubric. The pack prompt can carry the diff and the quote rules without growing the rubric prompt. A failure in one pass does not discard the other. The cost is that the bundle is sent twice. The prompt holds the usual bundle (at most 150,000 characters), a diff capped at 12,000 characters, the task text, the answer key and only the criteria that apply. A prompt over the backend's byte limit (120,000 for kiro, which passes it as an argument; 400,000 for opencode) is refused with an error, as in the rubric pass.
- **Same panel, blinding and aggregation.** The judges come from the same resolution as the rubric pass: `--judges`, then the suite, then the default panel. The bundle and the diff go through the same redaction. Scores are the median over judges per run (SR-24), and NO DATA when fewer than three judges scored the run. The tables also show each judge's own score.
- **Evidence is quoted and checked.** Each judged criterion has a `quote` rule that says what to copy: the weakest assertion, the longest function's signature, and so on. The reply is checked with `judge/quote.js`, always with the strict rule (every segment between ellipses must appear in the output, in order), whatever evidence-quote rule the rubric uses. The pack tables say "quality pack quotes: strict". The pack asks for exact text, and its second quote may come from the answer key, so a looser match would blur what the criterion checks; `judge --criteria-pack` refuses `--quote-match`. A pass or partial whose quote is not found in the output drops one level, and the judge's own verdict is kept as `verdictRaw`. `doc-accuracy` and `des-consistency` need two quotes separated by ` @@ ` (the comment and the code it describes; the API line and the data model line). The first quote must be in the output. The second may come from the answer key when the code was not changed and so is not in the output.
- **Anchors say how to break ties.** The prompt tells the judge to count where an anchor gives a number and to choose the lower level when the output sits between two.
- **Score.** Per dimension: the weighted mean of pass 1, partial 0.5, fail 0 over the criteria that were judged, counted or scored absent. n/a criteria are left out. The median over judges is taken per run (NO DATA under three judges, counted apart from n/a), then the mean over runs on a 0 to 100 scale.

## In the quality score (opt-in)

By default the pack is descriptive: `qualityOfRun` is hidden tests, checks and rubric, and no pack number enters it. A scoring file can give the pack a weight as a fourth component. `profiles/scoring-quality.json` does (hidden 0.4, checks 0.16, rubric 0.24, pack 0.2); `profiles/scoring.json` is unchanged. `profiles/scoring-quality-fractional.json` has the same weights and also scores the checks term as passed / total (see the scoring section of `README.md`). Only one `--scoring` file is read, so that file is the way to combine the pack with fractional checks.

- **One number per run.** The pack score of a run is the weighted mean over every criterion that applied to it (pass 1, partial 0.5, fail 0, weighted by criterion), then the judges' median. A run scored by fewer than three judges is NO DATA (SR-24). With a pack weight, `report` and `report-2x2` stop with a message on such a run. It does not depend on how many criteria applied, so a one-line fix and a design document sit on the same 0 to 1 scale.
- **Small tasks count.** The change discipline criteria apply to a code change of any size, and a task that asks for code always declares them. A run where no criterion applied has no pack component, and the other weights are renormalised, as for any missing component. Nothing is imputed.
- **No quiet gaps.** With a pack weight, `report` and `report-2x2` stop with a message when an executed run has no current pack judgment (never judged, or made against another pack or task revision). Mixing runs that have the component with runs that do not would compare arms on different inputs.
- **Verdicts.** `report --verdict platform` and `report --verdict orchestrator-pass` take `--criteria-pack quality` with a scoring file that weights the pack (`profiles/scoring-quality-fractional.json` or `profiles/scoring-quality.json`). The pack then enters the quality score of every run. The paired intervals, the A/A noise floor and the keep or discard rule all use that score. A run without a current pack judgment stops the verdict with the same message as `report`. The flag without a scoring file that weights the pack is refused, and so is such a scoring file without the flag. Without the flag the verdict is unchanged.
- **Where it works.** Only `report` and `report-2x2` with `--criteria-pack` accept a scoring file with a pack weight. Every other command refuses it, so no number is computed with the component silently dropped.
- **The dimension table stays.** It is the same data cut by dimension, now labelled as part of the quality score.

## Process signals

The judge never sees the transcript, so the "Quality dimensions" section adds a small table of signals read from the recorded results. They describe how a run was carried out, are not judged and are not scored.

| Signal | Source | n/a when |
|---|---|---|
| Spawns per run, runs that delegated | `orch.spawns`, else `claudeCode.spawned`, else `subagentCalls` in result.json | no stream was parsed (the run ended first). A vanilla arm with no subagent tool records 0, which is a count |
| Distinct agents per run | agent names in `capInvocation.delegatedTo` (unnamed calls left out and listed) | the run has no stream aggregate |
| Assumptions section in a document | a heading, bold label or short line that opens an assumptions or open-questions list, in a changed markdown file | the task or workspace cannot be read |
| Assumptions section in the final message | the same test on `finalText` | no final message was recorded |
| Ended on a question | `askedUser` in result.json, the runner's end-of-turn check | the run did not finish with a final message |

Kiro CLI and Claude Code record all five. Claude Code spawns come from Agent tool calls and the result line; Kiro spawns come from the subagent tool, one per stage. The question check is a heuristic on the last message in both harnesses. A harness or a run that did not record a signal shows n/a with the reason under the table.

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

`report-2x2 --criteria-pack quality` also adds the SDLC view (`report/sdlc.js`):

- **Quality, cost and time.** One row per cell: quality mean, median, sd and range over the per-task means, cost per run in the cell's own unit, and seconds per run. Quality is each run's repository score: the median of the three judges' rubric scores with the hidden tests and checks.
- **By SDLC phase.** One row per phase. For each cell it gives the quality of the tasks in that phase, the pack score of that phase's criteria alone (median over the judges, mean over runs), the cost and the seconds. A task counts in every phase whose criteria apply to what it declares, so a code task also counts in change discipline. A phase with no task says so.
- **Paired by task.** One table per harness: each task's vanilla and konductor mean with its sd and n, the quality difference, and the cost and time ratios inside the harness. Under it: the median, mean, sd and range of the differences, and how many tasks konductor won, lost or tied (within 0.5 points).

Credits and USD are never compared; only ratios inside one harness are.

## Calibration

No pack score has been compared with a person's rating. Until that happens, treat dimension scores as a way to find where arms differ, not as a measure.

`calibrate export --run RUN --criteria-pack quality` adds a `pack` block to each sampled item in `sheet.json` and `sheet.md`: the criteria a judge was asked, their three anchors, the quote rule, the agent's diff, and empty `labels`. It also lists the criteria scored by a program or as absent, so a person does not rate those. After labeling, `calibrate score --labels sheet.json --criteria-pack quality` reports judge versus human agreement and kappa per judge and per dimension. No rating is filled in by the tool.

New criteria have no run to sample yet. `calibrate export-reference` builds a blind sheet from the bench's own trees instead: the reference solution, each partial solution and the keyword stub of the named tasks, laid over the fixture. A stub is laid over the reference, as the validator lays it. `--extra-tasks bench/sdlc` reads the SDLC tasks. It calls no model and runs no agent.

```
node bench/runner/bench.js calibrate export-reference --out DIR --seed 7 \
  --tasks hard-seat-holds,hard-export-formats,hard-catalog-limits \
  --criteria conc-shared-state,conc-async-errors,conc-timeout-cancel,ext-one-place,ext-closed-core,code-nfr-mechanism,code-nfr-bounded,mod-pattern-missing,ent-pattern-applied,mod-pattern-fit
```

It writes 9 items (3 trees per task) with each tree's diff, the task, the answer key, the criteria that apply and empty labels. `key.json` says which tree each item is. The partial solutions carry no comment that names them, so the diff does not give the tree away. Comparing a judge with these labels needs a judge pass over the same trees. No command does that yet, and it spends credits, so it needs the owner's approval first. At the panel of three judges it is 27 pack calls (9 items, 3 judges). At the observed cost per call in `profiles/judge-cost-observed.json` that is about 4 to 8 credits on the kiro backend (0.16 credits per call, 0.29 at p90), or about 0.25 USD on opencode.

For the SDLC criteria:

```
node bench/runner/bench.js calibrate export-reference --out DIR --seed 11 --extra-tasks bench/sdlc \
  --tasks sdlc-problem-framing,sdlc-spike-dedupe,sdlc-arch-decision,sdlc-prod-readiness,sdlc-code-review,sdlc-design-review-gaps,sdlc-review-audit,review-inventory-security \
  --criteria idea-problem-evidence,idea-options-range,idea-success-measure,idea-kill-criteria,spike-question,spike-evidence,spike-scope-throwaway,spike-recommendation,arch-criteria-explicit,arch-tradeoff-matrix,arch-option-fair,arch-reversibility,prod-observability,prod-config-secrets,prod-graceful-lifecycle,prod-cost-estimate,prod-runbook-actions,rev-severity-impact,cr-actionable,cr-signal,cr-coverage-areas,cr-verdict,dr-gap-specific,dr-consequence,dr-prioritized,ra-missed-explained,ra-claim-evidence,ra-severity-reason
```

It writes 24 items (reference, partials and stub of each task) with 106 criteria to rate. A judge pass over them would be 72 pack calls, about 12 to 21 credits on kiro; it needs the owner's approval first.

`cap review` (the side-by-side page) is not extended. Its ratings file, import and scoring are built around the task rubric ids, and adding pack ids there would either be dropped silently on import or mix with the rubric score. Use `calibrate export` for pack ratings.

## Sources

The wording of the criteria follows these public references.

- Google engineering practices, "What to look for in a code review": design first, then complexity, tests, naming and comments. Shapes the modularity, maintainability, test and comment criteria.
- Test smell research (tsDetect and the study of smells in LLM-generated unit tests): assertion roulette (many assertions in one test), tests with no assertion, magic numbers. Shapes `test-asserts-behavior`, `test-one-scenario`.
- Wikipedia, "Signs of AI writing", and its caution that one tell proves nothing and a cluster is stronger. Shapes the written-content criteria and their count thresholds.
- RULERS (locked rubrics and evidence-anchored scoring) and the AWS blog post on the rubric-based Nova judge. Both use fixed, versioned rubrics, a justification tied to each criterion, weights that sum to one, and scores mapped to 0 to 1. RULERS also checks evidence in code instead of trusting the judge. They shape the revision hash, the quote rule and the weighted dimension score.
- INCOSE, "Guide to Writing Requirements", and the EARS syntax papers: the list of vague terms, one measurable statement per requirement, a check for each. Shapes `req-unambiguous`, `req-testable` and `req-traceable`.
- The repository's own SDLC skills: requirements generation, non-functional requirements, design evaluation, task decomposition, plan review and test coverage analysis. Their quality gates are the source of the requirements, non-functional, design scalability and task breakdown criteria.
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
