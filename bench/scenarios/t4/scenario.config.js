// SPDX-License-Identifier: Apache-2.0
'use strict';

// T4's batch config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t4/scenario.config.js [id ...]
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t4/scenario.config.js <id>
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t4/scenario.config.js seed <id> <work-dir>
// `seed` readies the author's empty work dir with the bench-provided hidden helpers the prompt names (iam-eval.js,
// findings.js, the Python bridge, from bench/scenarios/lib/hidden). `assemble.js` (this batch's) writes the task; the
// hidden dirs name the helpers in .bench-lib.json instead of committing copies.

const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const LIB_HIDDEN = path.join(DIR, '..', 'lib', 'hidden');

const NODE_TESTS = 'Hidden tests are `hidden/*.test.js` files using node:test and node:assert.';
const NODE_CMD = '`node --test --test-timeout=15000 hidden/*.test.js`';

const STACKS = {
  node: 'Node.js 24, CommonJS, no dependencies and no install step. Tests use node:test and node:assert and run with `node --test`.',
  python: 'Python 3.12, standard library only, no install step. Tests use unittest and run with `python3 -m unittest`.',
  docs: 'Mostly Markdown documents, plus a few small source files in Node.js 24 (CommonJS, no dependencies) where the brief asks for a prototype. If the fixture has any tests they run with `node --test`.',
  terraform: 'Terraform HCL files (`.tf`, `.tfvars`) with realistic module structure; nothing needs to run, there is no terraform binary. A tiny Node.js 24 helper script (no dependencies) with a `node --test` test is fine for the visible tests.',
};

const KINDS = {
  policy: {
    hidden: `${NODE_TESTS} A bench-provided IAM evaluator already exists at \`hidden/iam-eval.js\`; read it, use it, and do not change it. Its API: \`evaluate(docs, req)\` returns 'deny', 'allow' or 'implicit'; \`isAllowed(docs, req)\`; \`decide({identity, resource, boundary, scp}, req)\` for several layers; \`lint(doc)\` returns a list of problems (empty when valid). A request is \`{ action, resource, principal: { AWS | Service: string }, context: { key: value or [values] } }\`. It supports Action/NotAction, Resource/NotResource, Principal, Condition operators (String*, Arn*, Numeric*, Date*, Bool, IpAddress, Null, IfExists, ForAnyValue/ForAllValues) and policy variables such as \${aws:PrincipalTag/x}. Hidden tests require it as \`require('./iam-eval.js')\` and read the policy files the agent edits, from the paths the request names.`,
    notes: `   - Hidden tests for policies: each test states one request and the expected outcome. Have needed requests (what the code really does, every path and stage the brief names) that must be allowed, and dangerous ones that must be denied, roughly half each, plus one lint test per policy file the agent edits. Requests must use concrete ARNs from the fixture's config, so a policy that is right in spirit passes however it is written (several statements or one, wildcards inside the product's own names or exact ARNs). Never test the policy's text or layout, only its decisions. Do not test a request whose right answer depends on taste.
   - Tests that "must be denied" must not pass on the untouched fixture only because the fixture policy fails to parse; the fixture policies must be valid and broad.`,
    cmd: NODE_CMD,
  },
  twin: { hidden: null, notes: null, cmd: null },
  code: {
    hidden: null,
    notes: '   - Drive the code through the functions, modules and files the request names. Check behaviour, not the source text.',
    cmd: null,
  },
  findings: {
    hidden: `${NODE_TESTS} A bench-provided helper already exists at \`hidden/findings.js\`; read it, use it, and do not change it. \`readFindings(file)\` returns the list from the first fenced json block of the agent's document (or [] when missing); \`findItem(list, { where: [names], about: [word or [synonyms], ...], min })\` returns the first item whose text names one of \`where\` and at least \`min\` of the \`about\` groups; \`atLeast(item, 'high')\` checks severity. Hidden tests require it as \`require('./findings.js')\`.`,
    notes: `   - The agent writes one document at the path the request names, ending with one fenced json block in the shape the request gives. Hidden tests read that block. One test per seeded item: it is found (its location or component, and its key idea, with generous synonyms so honest wording passes). A few tests check severity for the most serious items and the fix idea for some. One test per decoy that it is not reported at high or critical severity, and a padding test with a stated cap. Every decoy and padding test must ALSO fail when the block is missing or has fewer than 3 items, so an empty answer scores near zero.
   - \`solution/\` holds the reference document only (an honest, complete review, not a list tuned to the tests).
   - The seeded items must be findable from the fixture alone by a careful reader; none may be pointed at by a comment, a TODO or a doc that calls it a problem.`,
    cmd: NODE_CMD,
  },
};

const PY_HIDDEN = () => `Hidden tests are unittest modules \`hidden/py/test_*.py\` that subclass \`TimedCase\` from \`hidden/py/timeouts.py\` instead of unittest.TestCase (a per-test time limit). Add the paths your tests need to sys.path yourself; the repository root is on PYTHONPATH. The bench-provided files \`hidden/py/timeouts.py\` and \`hidden/py_bridge.test.js\` already exist; do not change them. The bridge runs the Python tests once and makes node:test see one test per Python test. To run your hidden tests use \`node --test hidden/py_bridge.test.js\` from the repository root (fixture plus solution).`;

function parts(b) {
  const k = KINDS[b.kind];
  if (!k) throw new Error(`unknown kind ${b.kind}`);
  if (b.kind === 'code' && b.stack === 'python') return { hidden: PY_HIDDEN(), cmd: '`node --test --test-timeout=15000 hidden/py_bridge.test.js`', notes: k.notes };
  if (b.kind === 'code') return { hidden: NODE_TESTS, cmd: NODE_CMD, notes: k.notes };
  if (b.kind === 'twin') return { hidden: NODE_TESTS, cmd: NODE_CMD, notes: `${KINDS.code.notes}\n   - \`fixture/\` is already written (it belongs to another task). Do not change it; ignore the fixture rules in item 1. Add a \`fixture_unchanged\` check for every IAM policy file in it.` };
  return k;
}

function render(id, lib) {
  const b = lib.brief(id);
  const p = parts(b);
  const brief = `${b.brief}\n\n${lib.sourceLine(b.source)}`;
  const vars = { BRIEF: brief, SIZE: b.size, STACK: STACKS[b.stack], HIDDEN: p.hidden, TESTCMD: p.cmd, ID: b.id, KINDNOTES: p.notes };
  for (const [k, v] of Object.entries(vars)) if (v === undefined) throw new Error(`no value for {{${k}}}`);
  return lib.fill(lib.read('prompts/author.md'), vars, { strict: true });
}

function seed(s, id, workDir) {
  const b = s.brief(id);
  const put = (name, to) => { fs.mkdirSync(path.dirname(path.join(workDir, to)), { recursive: true }); fs.copyFileSync(path.join(LIB_HIDDEN, name), path.join(workDir, to)); };
  if (b.twinOf) fs.cpSync(path.join(workDir, '..', b.twinOf, 'fixture'), path.join(workDir, 'fixture'), { recursive: true, verbatimSymlinks: true });
  if (b.kind === 'policy') put('iam-eval.js', 'hidden/iam-eval.js');
  if (b.kind === 'findings') put('findings.js', 'hidden/findings.js');
  if (b.kind === 'code' && b.stack === 'python') { put('timeouts.py', 'hidden/py/timeouts.py'); put('py_bridge.test.js', 'hidden/py_bridge.test.js'); }
  return { id, workDir };
}

module.exports = {
  dir: DIR,
  canary: { node: 'hidden/zz-canary.test.js', python: 'hidden/py/test_zz_canary.py' },
  prompt: { render },
  stage: { commands: { seed } },
};
