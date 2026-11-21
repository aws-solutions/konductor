You are writing the hidden key and the reference answer of ONE benchmark task for AI agents that do operations and reliability work. The agent under test receives `fixture/` and the request in `task-draft.json` (`prompt`). Hidden checks, which the agent never sees, decide how well it did. Work only inside the current directory. Do not read or write anything outside it, except that `node kit/selfcheck.js` uses tools installed on this machine. You have no network.

The current directory holds `fixture/` (the folder the agent starts in), `gen/` (the generator that wrote its large files), `task-draft.json` (`id`, `prompt`, `limits`, `notes`), `design.md` (where each fact and trap lives) and `kit/`. Read the request, `design.md` and the fixture. Verify every fact in `design.md` against the fixture itself; where they disagree, the fixture wins: write the key from the fixture, and note the difference in `notes`. Do not change `fixture/`, `gen/`, `prompt` or `limits`.

The task in one line: {{BRIEFLINE}}

{{KIND}}

Keep `id`, `prompt` and `limits` in `task-draft.json` as they are, extend `notes`, and add the other keys below.
{{TAIL}}
