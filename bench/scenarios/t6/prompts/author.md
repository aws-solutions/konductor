You are writing ONE benchmark task for AI agents that do product and planning work. The agent under test receives a realistic folder of documents (and sometimes a small code repo) and a request written the way a busy colleague writes it. Hidden tests, which the agent never sees, decide how well it did. Work only inside the current directory. Do not read or write anything outside it. You have no network. Write everything fresh: invent the organisation, people, numbers and text; copy nothing from any public source.

## The brief

Task id: {{id}}. Phase: {{phase}}. Role of the person the agent works for: {{role}}.
Folder: {{repo}}
Idea: {{idea}}
{{sourceLine}}

## Files you have

- `kit/doc-key.js`: a helper for hidden tests. Copy it unchanged to `hidden/doc-key.js`. It exports `readDoc(rel)`, `lastJsonBlock(text)`, `blockOf(rel)` (the parsed last ```json block of a workspace file, or `{}`), `itemTexts(list)`, `requirementTexts(block)`, `numbersIn(text)` and `scriptedSuite(test, assert, opts)`. Read it before you write tests.
- `kit/check-draft.js`: run `node kit/check-draft.js` when you are done; it scores your reference and a do-nothing stub.

## What to produce

1. `fixture/`: the folder the agent starts in. It must look like a real, lived-in project folder: {{fixtureSize}}. Mix document kinds: notes from meetings and interviews (with names, dates, half-finished thoughts), data exports as CSV with realistic messiness, policy or handbook excerpts, a README that says what the folder is, an older draft or two. Vary file sizes. Nothing in the fixture may contain the answer key or a note that tells the agent what to look for.
{{kindSection}}
5. Run `node kit/check-draft.js`. The reference must score at least 95 and the stub 20 or less. Fix and rerun until it does. Then print a short list of what you verified.

## Rules for the request (`prompt`)

- Write it in the voice of the colleague described above. Plain words.
- Do NOT name any method, framework, template or process for how to work (no "interview the stakeholder", "write user stories", "use acceptance criteria", "prioritise with a framework", "do a gap analysis"). Say only what outcome is wanted.
- {{questionRule}}
- Do not tell the agent what the traps are or where to look (no "watch out for the duplicate", "check the calendar for holidays", "keep X and Y distinct"): finding them is the task.
- Do not mention hidden tests, checks, fixtures, scoring, benchmarks or AI.
- Give every interface the hidden tests rely on: the output path and the exact shape of the JSON block (field names). A test that needs a name the request does not give is unfair.

Keep everything original and free of any real company names, host paths, usernames or secrets. Stop when the files are written and verified.
