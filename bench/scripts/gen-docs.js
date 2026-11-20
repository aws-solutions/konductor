#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Fills the generated parts of the bench docs from the code, so they cannot go stale.
// A generated part sits between `<!-- gen:NAME -->` and `<!-- /gen:NAME -->` in a Markdown file under bench/.
//   node bench/scripts/gen-docs.js           rewrite every generated part in place
//   node bench/scripts/gen-docs.js --check   change nothing; exit 1 and name each part that differs from the code
// Only facts that change when the code changes are generated: the arms, the runtimes, the suite names, the verdict
// words and the command list. Counts that move whenever a task or a debt row lands (coverage, DEBT.md) are not:
// a doc check on them would fail every other change on the branch. Readers run the command for those instead.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BENCH = path.join(__dirname, '..');
const BENCH_JS = path.join(BENCH, 'runner', 'bench.js');
const DOCS = ['README.md', 'docs/agents.md', 'docs/skills.md', 'docs/physical-ai.md', 'docs/konductor-bench.md',
  'docs/repeat-it-yourself.md', 'docs/reference.md'];

const cli = (...args) => execFileSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fence = (text) => ['```text', text.trimEnd(), '```'].join('\n');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const yes = (b) => (b ? 'yes' : 'no');

const GENERATORS = {
  // `list-arms` reads no git state for its text, so its output is the same on every host.
  arms: () => fence(cli('list-arms')),

  runtimes: () => {
    const { registry } = require('../runner/lib/harness/index.js');
    return table(['Runtime', 'Name', 'Arm prefix', 'Cost unit', 'Multi-turn tasks', '`cap` commands', 'Per-skill study'],
      Object.entries(registry).map(([id, m]) => [`\`${id}\``, m.label, m.armPrefix ? `\`${m.armPrefix}\`` : '(none)',
        m.costUnit === 'usd' ? 'USD' : 'credits', yes(m.supports.multiTurn), yes(m.supports.capCommands), yes(m.supports.skillStudy)]));
  },

  suites: () => {
    const { SUITE_NAMES } = require('../runner/lib/tasks.js');
    return SUITE_NAMES.map((n) => `\`${n}\``).join(', ');
  },

  'verdict-words': () => {
    const { PROTOCOL, MARGIN } = require('../scenarios/protocol.js');
    const { verdictWord } = require('../scenarios/bootstrap.js');
    const examples = [[6, 9], [1, 3], [-2, 4], [-3, -1], [-8, -6], [-7, 2]];
    const rule = table(['Word', 'Rule on the 95% interval [L, U]'],
      PROTOCOL.verdictOrder.map((w) => [`**${w}**`, PROTOCOL.verdictWords[w]]));
    const ex = table(['Interval (points)', 'Word'], examples.map(([low, high]) => [`${low} to ${high}`, verdictWord({ low, high })]));
    return [`Margin: ${MARGIN} points. The first word that fits, in this order, wins.`, '', rule, '', 'Examples, computed by the same code:', '', ex].join('\n');
  },

  commands: () => {
    const names = new Set();
    for (const m of cli('--help').matchAll(/^ {2}node bench\/runner\/bench\.js ([a-z0-9-]+(?: (?!-)[a-z0-9-]+)?)/gm)) {
      const [cmd, sub] = m[1].split(' ');
      names.add(['cap', 'scenarios'].includes(cmd) && sub ? `${cmd} ${sub}` : cmd);
    }
    return [...names].map((n) => `\`${n}\``).join(', ');
  },
};

const REGION = /(<!-- gen:([a-z-]+) -->\n)([\s\S]*?)(<!-- \/gen:\2 -->)/g;

function render(text, cache) {
  const unknown = [];
  const out = text.replace(REGION, (m, open, name, body, close) => {
    if (!GENERATORS[name]) { unknown.push(name); return m; }
    if (!cache.has(name)) cache.set(name, GENERATORS[name]());
    return `${open}${cache.get(name)}\n${close}`;
  });
  return { out, unknown };
}

// Returns one line per generated part that differs from the code (empty when all match).
function run({ write = false, files = DOCS } = {}) {
  const cache = new Map();
  const problems = [];
  for (const rel of files) {
    const file = path.join(BENCH, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const { out, unknown } = render(text, cache);
    for (const u of unknown) problems.push(`${rel}: unknown generated part "${u}"`);
    if (out === text) continue;
    if (write) fs.writeFileSync(file, out);
    else for (const m of text.matchAll(REGION)) if (render(m[0], cache).out !== m[0]) problems.push(`${rel}: gen:${m[2]} is stale`);
  }
  return problems;
}

module.exports = { run, GENERATORS, DOCS };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const problems = run({ write: !check });
  for (const p of problems) console.log(p);
  if (check && problems.length) console.log('run `node bench/scripts/gen-docs.js` to regenerate them');
  else if (!problems.length) console.log(check ? 'ok: every generated part matches the code' : 'generated parts written');
  process.exit(problems.length ? 1 : 0);
}
