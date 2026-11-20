You are writing the FIRST HALF of ONE benchmark task for AI agents that do product and planning work. The agent under test receives a realistic folder of documents (and sometimes a small code repo) and a request written the way a busy colleague writes it. Hidden tests, which the agent never sees, decide how well it did; a separate step, not you, writes the hidden tests, the reference answer and the checks later from your files. Work only inside the current directory. Do not read or write anything outside it. You have no network. Write everything fresh: invent the organisation, people, numbers and text; copy nothing from any public source.

## The brief

Task id: {{id}}. Phase: {{phase}}. Role of the person the agent works for: {{role}}.
Folder: {{repo}}
Idea: {{idea}}
{{sourceLine}}

## What to produce

1. `fixture/`: the folder the agent starts in. It must look like a real, lived-in project folder: {{fixtureSize}}. Mix document kinds: notes from meetings and interviews (with names, dates, half-finished thoughts), data exports as CSV with realistic messiness, policy or handbook excerpts, a README that says what the folder is, an older draft or two. Vary file sizes. Nothing in the fixture may contain the answer key or a note that tells the agent what to look for. Seeded numbers that a hidden script will recompute (rates, percentiles, counts) must be produced by a small generator script you run once (keep the script OUT of `fixture/`, in `gen/`), never typed by hand, and the CSV must be the script's output. Where the brief names code, it must run and its tests must pass.
2. `task-draft.json`: one JSON object with exactly these keys:
   - `id`: `{{id}}`
   - `prompt`: {{promptWords}} words, in the voice of the colleague. Say what is wanted and for whom, give the output path `{{out}}`, and give every interface the hidden tests will rely on: the exact JSON block shape (field names and what each holds) and, where the brief names one, the exact command line and output shape of a script the agent writes. Do NOT name any method, framework, template or process for how to work (no "interview", "user stories", "acceptance criteria", "hypothesis template", "prioritise with a framework"). Do not tell the agent what the traps are or where to look. Do not mention hidden tests, checks, fixtures, scoring, benchmarks or AI. {{questionRule}} Do not tell the agent to leave the folder unchanged unless the brief says so.
   - `limits`: { "softSec": 600, "hardSec": 1200 }
   - `notes`: 4 to 8 sentences for the key writer: the traps, which fixture file shows each one, the exact seeded numbers and how the generator makes them (say where `gen/` is), what a quick answer misses, and which names the prompt gives.
3. Run the fixture's own tests if it has any, and open the files once to make sure nothing in them gives the answer away. Write each file once, verify at most twice, and finish within about 50 tool calls. Do not write hidden tests, a reference answer or checks.

## Rules

- Keep everything original: invent the organisation, people, numbers and text; no real company names, host paths, usernames or secrets.
- Stop when the files are written.
