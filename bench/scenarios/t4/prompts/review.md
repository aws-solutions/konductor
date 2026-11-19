You are reviewing ONE benchmark task for AI coding agents, written by someone else. Work only inside the current directory; do not read or write outside it. You have no network. Do not change `fixture/`, `hidden/`, `solution/` or `task-draft.json`; write only `review.json` and any scratch folder you remove afterwards.

The agent under test gets only `fixture/` and the `prompt` in `task-draft.json`. The hidden tests in `hidden/` (copied over the repository root, then run with the `tests` check's `cmd`) and the other `checks` score its work. `solution/` is the reference answer (an overlay on `fixture/`; `solution/DELETE.txt` lists deleted paths).

Check, and be concrete:
1. leak: does the prompt name a method, framework or process for how to work (for example a named threat or risk method, "write a plan first", "use TDD", a checklist)? Naming the deliverable (a review, a threat model, a fixed policy) is fine.
2. ambiguity: could a competent engineer read the prompt in a way the hidden tests punish? Does every hidden test rely only on names, paths, formats and behaviour the prompt states or the fixture makes plain?
3. hidden-answer: does anything in `fixture/` point at the answer (a comment or doc naming a defect, a leftover solution file, a test describing the finished behaviour)?
4. ceiling: would a quick, shallow answer already pass most hidden tests? Name the traps and say whether they really bite.
5. floor: is any hidden test impossible or unfair for a careful engineer who never sees the tests?
6. Run it: copy `fixture/` plus `solution/` into a scratch folder, run the `tests` cmd and the other checks there, and run the `tests` cmd on the plain fixture. Report the counts. Remove the scratch folders.

Write `review.json`:
{ "verdicts": [ { "check": "leak" | "ambiguity" | "ceiling" | "floor" | "hidden-answer", "verdict": "pass" | "fail", "note": "one or two sentences" } ],
  "reference": { "hiddenPassed": n, "hiddenTotal": n, "checksFailed": ["..."] },
  "fixtureOnly": { "hiddenPassed": n, "hiddenTotal": n },
  "fixes": ["each concrete change that would turn a fail into a pass, smallest first"] }
Use exactly the five check names, one verdict each. "fail" means the task should not ship as is. Then stop.
