#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Renders the author prompt of one T6 brief: node render-prompt.js briefs/<id>.json > <id>.prompt.txt
// The brief comes from the plan's phase x role matrix and a public source; it never quotes skill text.

const fs = require('node:fs');
const path = require('node:path');

const SCRIPTED = `2. The scripted user (\`scriptedUser\` in task-draft.json). The colleague knows 4 to 8 facts that are NOT in the fixture or the request, that a careful practitioner would think to ask about after reading the folder (the folder shows the gap, for example data with two time zones but no rule for them), and that change the requirements. For each fact write:
   - \`id\`: F1, F2, ...
   - \`answer\`: one or two sentences in the colleague's voice with a specific value that cannot be guessed (a number, a date, a named rule).
   - \`topics\`: 3 to 6 lowercase JavaScript regex fragments, matched case-insensitively against the agent's question, that a natural question about this subject would contain (synonyms included, for example "time ?zone", "\\\\bhours?\\\\b", "night", "early"). They must not match the generic question "Is there anything else I should know before I start?", and two facts should not share most topics.
   \`defaultReply\` is exactly: "I'm not sure, use your judgement."
3. \`hidden/\`: copy \`kit/doc-key.js\` to \`hidden/doc-key.js\` unchanged, and write \`hidden/requirements.test.js\`:
   \`\`\`js
   const test = require('node:test');
   const assert = require('node:assert/strict');
   const { scriptedSuite } = require('./doc-key');
   scriptedSuite(test, assert, { doc: 'docs/requirements.md', facts: [{ id: 'F1', all: [/.../i, /.../i], wrong: [/.../i] } /* one per fact */], ground: ['data/example.csv' /* fixture files whose numbers a requirement may use */] });
   \`\`\`
   - \`all\`: 1 to 3 regexes that must ALL match inside one requirement's text when the fact is stated correctly. Accept reasonable wordings and number formats, never a vague mention.
   - \`wrong\`: 0 to 2 regexes for plausible wrong values a guesser would write (a common default).
   - \`ground\`: every fixture file whose numbers may legitimately appear in a requirement (the suite counts a requirement with a number found in no fact answer and no ground file as invented).
   Then write \`hidden/grounded.test.js\` with 2 or 3 tests for important requirements that come from the fixture itself (a careful reader finds them, a quick one misses them), using \`requirementTexts(blockOf('docs/requirements.md'))\`.
4. \`solution/\`: the reference. \`solution/docs/requirements.md\` is a good requirements document that ends with the JSON block and states every fact and the grounded requirements. \`solution/ASKS.json\` is a JSON array of 2 to 4 strings: the asking turns a competent colleague would send after reading the folder, in natural wording, with 6 question marks or fewer in total, that together unlock every fact.
   Also write \`task-draft.json\`, one JSON object with exactly these keys:
   - \`id\`: \`{{id}}\`
   - \`prompt\`: 40 to 140 words, as vague as a real first message. Say what is wanted and for whom, name the output path \`docs/requirements.md\`, and include this sentence: End the file with a \`\`\`json block of the form {"requirements": [{"id": "R1", "text": "..."}], "assumptions": ["..."]}. It must not contain any of the facts.
   - \`scriptedUser\`: { "facts": [{ "id", "topics", "answer" }], "defaultReply" }
   - \`checks\`: one \`tests\` check exactly { "type": "tests", "cmd": "node --test --test-timeout=15000 hidden/*.test.js", "min": N, "weight": 1, "kind": "substance" } where N is the number of hidden tests, plus 3 to 6 other checks: \`file_exists\` for the output, \`fixture_unchanged\` on the input folders (\`path\` is a folder or file of the fixture), a \`cmd\` using node that checks the JSON block parses and has at least 5 requirements with ids, a \`contains\` (\`path\`, \`pattern\` as a case-insensitive JavaScript regex) for listed assumptions or open points. Each has \`weight\` 1 to 3 and \`kind\` "substance" or "format" (format = layout or wording only). At most 25% of the substance weight of these other checks may pass on the untouched fixture.`;

const DOC = `2. \`hidden/\`: copy \`kit/doc-key.js\` to \`hidden/doc-key.js\` unchanged, and write 8 to 16 tests in \`hidden/*.test.js\` (node:test and node:assert/strict), each independent and deterministic, reading the JSON block of the output with \`blockOf\`. Each seeded insight or trap is one or more tests, like a findings key: the main finding, each key evidence number (allow rounding where a share is computed), the options, the recommendation, the measure with its baseline. Add 1 or 2 precision tests (for example: the decoy is not given as the cause; no more than K items). Accept reasonable wording (regex alternatives) and number formats.
3. \`solution/\`: the reference output at its path (an overlay on the fixture). It must pass every hidden test.
4. \`task-draft.json\`, one JSON object with exactly these keys:
   - \`id\`: \`{{id}}\`
   - \`prompt\`: {{promptWords}} words. Say what is wanted, give the output path \`{{out}}\` and the exact JSON block shape the tests read (field names and what each holds).
   - \`checks\`: one \`tests\` check exactly { "type": "tests", "cmd": "node --test --test-timeout=15000 hidden/*.test.js", "min": N, "weight": 1, "kind": "substance" } where N is the number of hidden tests, plus 3 to 6 other checks: \`file_exists\`, \`fixture_unchanged\` on the inputs (\`path\` is a folder or file of the fixture), \`cmd\` with node or POSIX tools, \`contains\` / \`not_contains\` / \`min_matches\` (\`path\`, \`pattern\` as a case-insensitive JavaScript regex). Each has \`weight\` 1 to 3 and \`kind\` "substance" or "format". At most 25% of the substance weight of these other checks may pass on the untouched fixture.`;

const TAIL = `
   - \`rubric\`: 0 to 2 items { "id", "criterion", "weight" } for what code cannot check, each ending "(code cannot check this because ...)". Do not reward length or formatting.
   - \`limits\`: { "softSec", "hardSec" }: the time a competent agent needs, hardSec twice softSec.
   - \`notes\`: 3 to 6 sentences for the reviewer: the traps, where the fixture shows each one, and what a quick answer misses.`;

function render(brief) {
  const tpl = fs.readFileSync(path.join(__dirname, 'author.md'), 'utf8');
  const scripted = brief.kind === 'scripted';
  const negative = brief.kind === 'negative';
  const fill = (s, v) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (v[k] ?? `{{${k}}}`));
  const v = {
    id: brief.id, phase: brief.phase, role: brief.role, repo: brief.repo, idea: brief.idea, out: brief.out,
    promptWords: negative ? '40 to 120' : '80 to 220',
    sourceLine: typeof brief.source === 'object' ? `Public inspiration (idea only, nothing copied): ${brief.source.url} (licence ${brief.source.licence}).` : 'Source: original.',
    fixtureSize: brief.kind === 'twin' ? 'it is already in `fixture/`; do not change it' : negative ? '15 to 25 files' : '20 to 40 files, code files only where the brief says so (Node.js 24, no dependencies, tests with node --test that pass)',
    questionRule: 'Do not mention questions at all: neither invite them nor forbid them.',
  };
  v.kindSection = fill(scripted ? SCRIPTED : DOC, v) + fill(TAIL, v);
  return fill(tpl, v);
}

if (require.main === module) process.stdout.write(render(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))));
module.exports = { render };
