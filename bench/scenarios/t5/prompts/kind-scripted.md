## What the hidden part is: facts only a question unlocks

This fixture is documents only (Markdown): ignore the fixture rules above about source, tests, package files and CI; keep the README, docs and a template. The person who sends the request (the scripted user) will answer the agent's questions from a list of hidden facts. The agent must ask, then write `docs/ACCEPTANCE.md`. A hidden test reads that file and checks that each fact appears in testable form.

Write in `task-draft.json`, besides the usual keys, `scriptedUser`: `{ "facts": [ { "id", "topics": [words a question about this fact would contain], "answer": "what the user says" } ], "defaultReply": "what the user says to a question that matches no fact (vague, not helpful)" }`. Write 6 facts: five that are plain business rules with exact numbers, names or limits that a thin feature note omits, and one fact that CONTRADICTS something in the fixture's glossary or the thin note (the criteria must follow the user's answer, not the glossary). The facts must not be present anywhere in `fixture/`.

Write `hidden/acceptance.test.js` (node:test): 12 tests, two per fact. Per fact: one test that `docs/ACCEPTANCE.md` (read relative to the repository root, resolved from `process.cwd()`) matches a regular expression for the exact value (accept reasonable formats: '14 days', '14-day', 'fourteen'), and one that the line holding it is phrased as an observable outcome (the regex looks for the value inside a sentence that also holds a verb such as 'is', 'must', 'shall', 'should', 'receives', 'sees', 'is refused', not a bare list item). Write the file so no test depends on another. The contradicting fact's first test also requires that the glossary's wrong value does NOT appear in `docs/ACCEPTANCE.md` as the criterion.

The `tests` check in `task-draft.json` has `cmd` exactly `node --test --test-timeout=15000 acceptance.test.js` and `min` 12. Add checks that look at things the hidden tests cannot: `file_exists` for `docs/ACCEPTANCE.md`, `fixture_unchanged` for `docs/GLOSSARY.md` (or the glossary file you write) and the thin feature note, and `min_matches` of at least 8 criteria lines in `docs/ACCEPTANCE.md` (a pattern for list items or table rows).

`solution/` holds the reference `docs/ACCEPTANCE.md` that satisfies every test and was written as if the user had answered every question.

The request must make clear that the user is available to answer questions, and must not list the facts or topics.

Verify: put `fixture/` plus `solution/` plus `hidden/` in a scratch folder; run `node --test hidden/../acceptance.test.js` from its root (the file sits at the root of the scratch folder); confirm 12 of 12 pass, and on the plain fixture at most 2.
