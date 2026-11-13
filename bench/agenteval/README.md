# agenteval

Turns a Strands Evals experiment file (output of `strands-evals generate`) into scenario candidates for review. The importer is a deterministic filter and normalizer. It never decides what the agent should do, and the generated rubric stays one text hint.

This directory holds the library modules only. The command line, mocks, twins and reference-run grounding come later.

Run the tests (plain Node, no dependencies, no network):

```
nice -n 19 node --test bench/agenteval/test/*.test.js
```

Modules in `lib/`:

- `experiment.js`: `loadExperiment(path)` reads the experiment JSON.
- `tool-names.js`: `extractTools(trajectory, declaredTools)` recovers tool names from the untyped trajectory.
- `validity.js`: `checkInput` and `checkExpectedOutput` reject placeholder inputs and flag unfilled output slots.
- `dedup.js`: `findDuplicates` marks near-duplicate inputs (token Jaccard, 0.6).
- `rules.js`: optional `before` and `forbidUnless` rules from a JSON file.
- `candidates.js`: `buildCandidates(experiment, { tools, rules, batches, source })` composes the above.
