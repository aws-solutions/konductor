## What the hidden part is: seeded mutants

The task asks the agent to write tests. The hidden part is a set of seeded mutants of the fixture's source. The score is the fraction of mutants that the agent's new tests kill, counted only when the agent's tests pass on the real code.

Write:
1. `hidden/mutation-kit/mutants.json`:
   `{ "runner": "{{RUNNER}}", "testCmd": "{{MUTCMD}}", {{PYCFG}}"pristine": ["<each source file any mutant changes>"], "mutants": [ { "id": "m01", "files": ["<path>"], "note": "<what changed and what a test must check>" } ] }`
2. `hidden/mutation-kit/pristine/<path>`: a copy of each real source file named in `pristine`.
3. `hidden/mutation-kit/mutants/<id>/<path>`: the mutated version of each file the mutant lists (a full file, differing from the real one only by the mutation).
4. `solution/`: the reference solution as an overlay: the new or changed test files, at their paths, in full. A file here replaces the same path in `fixture/`.
5. Nothing else is needed for the scorer: do not write the runner. A bench-provided runner is in `kit/mutants.js` (do not change it or copy it into the output).

Mutant rules:
- {{NMUT}} mutants, each a realistic defect a developer could introduce: a boundary off by one, a flipped or loosened comparison, a dropped guard or error branch, a wrong constant or unit, swapped arguments, a missed state reset, wrong rounding or ordering, an early return. At most one may be an infinite loop or hang.
- Each mutant must be valid code, must keep the whole fixture suite as it stands passing for at least {{SURVIVE}} of the mutants (the weak existing tests must let them through), and must be catchable by a reasonable test of the documented behaviour. No equivalent mutants (a change no test could ever observe).
- Spread them over several source files and over different behaviours; some need a test of an error path, some a boundary, one needs a test of a state that persists between calls.
- The fixture's existing tests may kill at most 2 mutants. They should look decent (high line coverage, many assertions on easy paths) but miss these behaviours.
- The reference tests must kill every mutant and pass on the real code.

Verify: (a) in a scratch folder put `fixture/` plus `solution/`, run the suite, confirm it passes; (b) run `node kit/mutants.js <that scratch folder> hidden/mutation-kit` and confirm `score` is 1 and `realPass` is true; (c) run it on a scratch folder holding only `fixture/` and confirm at most 2 mutants are killed. Print the JSON of (b) and (c).
