You are writing the ANSWER KEY and the REFERENCE ANSWER for one benchmark task. Someone else wrote the input data: `fixture/` (the folder the agent will get), made by `authoring/generate.py`, with the planted facts in `authoring/seeds.json`. The request the agent gets is `prompt` in `task-draft.json`. Do not change `fixture/`, `authoring/generate.py`, `authoring/seeds.json` or `task-draft.json`. Work only inside the current directory; you have no network.

The agent writes `{{OUTPUT}}` holding one fenced JSON block with info string `{{BLOCK}}` and this shape: {{SHAPE}}. A hidden script reads that block and checks it against `hidden/key.json` with `hidden/plan-grade.cjs`; read that file's header for the assertion ops. Do not change `hidden/plan-grade.cjs` or `hidden/plan.test.cjs`.

## Write exactly these files, then stop

1. `authoring/compute_key.py` (Python 3.12, standard library): reads ONLY files under `fixture/` (it may read `authoring/seeds.json` to know which ids were planted, never to copy a number) and computes every id, number and date the key needs, under the conventions in `fixture/README.md`. It writes `hidden/key.json`: `{"output": "{{OUTPUT}}", "block": "{{BLOCK}}", "assertions": [...]}`, each assertion `{"id", "desc", "op", ...}`. Rules:
   - 10 to 16 assertions. Every planted trap has one or more; every decoy has an `absent` or `excludes`; every list of risks, items or tickets that a padded answer could inflate gets a `precision` with a `maxCount` of about 1.5 times the true count plus 1.
   - Check facts in the data, never wording: no assertion on an id or name the agent invents, no exact match on free text, no `order` inside one group, no assertion that only echoes a value the request states.
   - Numbers and dates get a tolerance that covers honest ways of computing them under the README's conventions and excludes the obvious wrong reading.
2. Run `python3 authoring/compute_key.py`.
3. `solution/{{OUTPUT}}`: the reference answer a strong practitioner would send, with the block, written from the data.
4. Check: copy `fixture/`, overlay `solution/`, copy `hidden/` in, in a scratch folder inside the current directory, and from there run `node --test --test-timeout=15000 hidden/plan.test.cjs`; every test must pass. Run it on the bare fixture too; every test must fail. Delete the scratch folder. Print the two pass counts.

Use few tool calls. Stop when the files are written and checked.
