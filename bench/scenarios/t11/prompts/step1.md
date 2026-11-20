This is step 1 of 2. In this step you write only the project folder and the request. A separate step, later, writes the hidden checks and the answers from what you write here.

Write:
1. `fixture/`, following the fixture rules above.
2. `task-draft.json`, one JSON object with exactly the keys `id` (`{{ID}}`), `prompt`, `limits` and `notes`:
   - `prompt`: the request, in the voice of {{VOICE}}. Plain words, 80 to 250 words. Say what is wanted, why, and what must not change. Name every output path, file name, format and field that a checker would need. Do NOT name any method, tool, framework or process for how to work. Do NOT list the traps, edge cases or risks to look for. Do NOT tell the agent to ask or not to ask questions. Do not mention checks, scoring or benchmarks.
   - `limits`: `{ "softSec": number, "hardSec": number }`; hardSec is twice softSec.
   - `notes`: 3 to 6 short sentences for a reviewer: the traps you built in and what a quick answer would get wrong.
3. `design.md` (outside `fixture/`): for the key writer, every fact, trap and decoy you placed, with the file and line (or document section) where it lives, and the correct outcome for each. Be complete and exact: the key is written from this file and the fixture alone.

Then print a short list of what you verified (the visible tests pass, generators run twice give the same bytes). Stop when the files are written.
