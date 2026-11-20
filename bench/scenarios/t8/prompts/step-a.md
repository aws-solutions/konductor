## This step

This is step 1 of 2. In this step you write only the folder, its generator and the request. A separate step, later, writes the hidden key and the reference document from what you write here.

The agent will write a document at `{{OUTFILE}}` that ends with a fenced ```json block holding one JSON object with these fields: {{BLOCKFIELDS}}

Write:
1. `gen/generate.py` and `fixture/`, following the fixture rules above. Run the generator twice and check that it writes the same bytes.
2. `task-draft.json`, one JSON object with exactly the keys `id` (`{{ID}}`), `prompt`, `limits` and `notes`:
   - `prompt`: the request, in the voice of {{VOICE}}. Plain words, 80 to 260 words. Say what is wanted and why. Name the output path and describe every field of the JSON block in plain words (names, types, units; times are ISO 8601 UTC; log evidence is cited as `path:line`, the path relative to the folder root and the 1-based line number). Do not paste an example block with real values from the folder. Do NOT name any method, framework or process for how to work. Do NOT list the causes, suspects, constraints, owners or risks to look for: the agent has to find them in the folder. Do NOT tell the agent to ask or not to ask questions. Do not mention hidden checks, keys, scoring or benchmarks.
   - `limits`: `{ "softSec": number, "hardSec": number }`; hardSec is twice softSec.
   - `notes`: 3 to 6 short sentences for a reviewer: the traps you built in and what a quick answer would get wrong.
3. `design.md` (outside `fixture/`): for the key writer, every seeded fact, trap and decoy, with the file and line (or document section) where it lives, and the correct value of every block field. Be complete and exact: the key is written from this file and the fixture alone.

{{SEEDEXTRA}}

Do not write a key, a reference document, `solution/` or `hidden/`. Then print a short list of what you verified. Stop when the files are written.
