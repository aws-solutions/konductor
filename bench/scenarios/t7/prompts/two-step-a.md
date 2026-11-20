You are writing the INPUT DATA and the REQUEST for one benchmark task for AI agents that do program management work. Another person writes the answer key later, from your data alone, so do not write any answer, key, solution or analysis. Work only inside the current directory; read and write nothing outside it. You have no network. All names, teams, tickets and numbers are invented; copy nothing from any public project.

## The brief

- Situation: {{SCENARIO}}
- Traps to plant in the data (a careful practitioner finds them, a quick reader misses them): {{SEEDS}}
- The agent will write `{{OUTPUT}}` holding one fenced JSON block with info string `{{BLOCK}}` and this shape: {{SHAPE}}

## Write exactly these files, then stop

1. `authoring/generate.py`: Python 3.12, standard library only, `random.seed(...)` fixed. It writes `fixture/`: a README (what each file is, what the columns mean, the "as of" date that counts as today, and plain DATA conventions such as which statuses are open, how a holiday or on-call week changes capacity, what a blank estimate means), and 4 to 8 data files (CSV or JSON, 60 to 200 rows in the main export, with ordinary noise: closed and cancelled rows, blank cells, odd spellings, comments). Use 2027 dates whose weekdays are right. Rules:
   - Planted rows take ids from the ordinary sequence, scattered among other rows, with titles and comments like their neighbours. No comment, label, column or README sentence names a trap, a decoy, the answer, or how to analyse the data.
   - Every fact the answer needs must be computable from the fixture files under the README's stated conventions.
2. `authoring/seeds.json`: the planted facts, for the key writer: `{"traps": [{"trap": "<which brief trap>", "ids": [...], "fact": "<one sentence>"}], "decoys": [{"ids": [...], "fact": "..."}], "conventions": ["..."]}`. List facts only; compute no totals or answers.
3. Run `python3 authoring/generate.py` once so `fixture/` exists. Do not edit `fixture/` by hand.
4. `task-draft.json` with exactly these keys:
   - `prompt`: the request in the requester's voice, 60 to 180 words: what they want and why, the file `{{OUTPUT}}`, and the block's info string and every key of the shape with its type, as a plain format note. Name no method, framework or process. Do not hint at any trap or decoy, and do not list what to look for. Do not tell the agent to ask or not to ask questions. Do not mention benchmarks, keys or scoring.
   - `rubric`: 1 or 2 items `{ "id", "criterion", "weight" }` (weight 1 to 3) for what code cannot check; each criterion ends with "(code cannot check this because ...)".
   - `limits`: `{ "softSec": 600, "hardSec": 1200 }`.
   - `dataFile`: the main export's path relative to `fixture/`.
   - `notes`: 3 to 5 short sentences for a reviewer: each trap and the quick reading it catches.

Use few tool calls: write each file in one go. Stop when the four items exist.
