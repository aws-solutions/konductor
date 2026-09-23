// SPDX-License-Identifier: Apache-2.0
/**
 * Unit + integration tests for scripts/generate-agent-files.js.
 *
 * Uses Node's built-in test runner (`node --test`) — stdlib only, no new
 * runtime dependency, consistent with the rest of this harness.
 *
 * Run: node --test tests/scripts/generate-agent-files.test.js
 *      (or `npm test`, which runs every tests/scripts/*.test.js)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gen = require('../../scripts/generate-agent-files.js');

test('stripFrontmatter drops a leading YAML block and leading blank lines', () => {
  const input = '---\nname: foo\ndescription: bar\n---\n\n\n# Heading\n\nBody text.\n';
  assert.equal(gen.stripFrontmatter(input), '# Heading\n\nBody text.\n');
});

test('stripFrontmatter is a no-op (modulo trailing newline) when there is no frontmatter', () => {
  const input = '# Heading\n\nBody text.';
  assert.equal(gen.stripFrontmatter(input), '# Heading\n\nBody text.\n');
});

test('parseArgs handles --flag value and bare boolean flags', () => {
  const opts = gen.parseArgs(['--agent', 'k-developer', '--install', '--out-dir', '/tmp/out']);
  assert.equal(opts.agent, 'k-developer');
  assert.equal(opts.install, true);
  assert.equal(opts['out-dir'], '/tmp/out');
});

test('renderFrontmatter emits name, description, model, tools, and skills', () => {
  const spec = {
    name: 'asdlc-example',
    config: { description: 'An example agent.', model: 'claude-sonnet-5' },
    clientConfig: { claudeCli: { tools: ['Read', 'mcp__aws-mcp__*'], skills: ['constraints', 'git-workflow'] } },
  };
  const fm = gen.renderFrontmatter(spec);
  assert.match(fm, /^---\n/);
  assert.match(fm, /name: asdlc-example/);
  assert.match(fm, /description: "An example agent\."/);
  assert.match(fm, /model: claude-sonnet-5/);
  // `tools:` MUST be the inline comma-separated scalar Claude Code's
  // sub-agent docs document (https://code.claude.com/docs/en/sub-agents) --
  // a YAML block sequence here is silently ignored at runtime (verified
  // empirically: the init event's tool list dropped every declared entry
  // and fell back to Claude Code's default set). This assertion previously
  // expected the block-sequence form, which was encoding that bug.
  assert.match(fm, /tools: Read, mcp__aws-mcp__\*/);
  // `skills:` stays a block sequence -- the docs' own "Preload skills into
  // subagents" example renders it that way, so this format is correct.
  assert.match(fm, /skills:\n {2}- constraints\n {2}- git-workflow/);
  assert.match(fm, /\n---\n$/);
});

test('buildInlinedBlock inlines a real skill and includes the BEGIN/END markers', () => {
  const { blockText, report } = gen.buildInlinedBlock('asdlc-example', ['git-workflow'], 40000);
  assert.match(blockText, new RegExp(gen.BEGIN_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(blockText, new RegExp(gen.END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(blockText, /## Skill: git-workflow/);
  // git-workflow/SKILL.md's own body content should be inlined verbatim.
  assert.match(blockText, /Conventional Commit Messages/);
  assert.deepEqual(report.inlined, ['git-workflow']);
  assert.deepEqual(report.skippedBudget, []);
  assert.deepEqual(report.unresolved, []);
});

test('buildInlinedBlock records an unresolved skill without throwing', () => {
  const { blockText, report } = gen.buildInlinedBlock('asdlc-example', ['this-skill-does-not-exist'], 40000);
  assert.deepEqual(report.inlined, []);
  assert.deepEqual(report.unresolved, ['this-skill-does-not-exist']);
  assert.match(blockText, /UNRESOLVED/);
});

test('buildInlinedBlock skips a skill that does not fit the budget without throwing', () => {
  // A budget too small to fit even the first skill's content -- every
  // skill lands on skippedBudget (this alone can't distinguish sticky vs.
  // per-skill budget checks; see the next test for that).
  const { report } = gen.buildInlinedBlock('asdlc-example', ['git-workflow', 'code-review'], 10);
  assert.deepEqual(report.inlined, []);
  assert.deepEqual(report.skippedBudget, ['git-workflow', 'code-review']);
});

test('buildInlinedBlock applies the budget check per-skill, not as a sticky one-shot cutoff', () => {
  // Budget fits git-workflow + document-formats together but not
  // git-workflow + code-review (much larger) + document-formats. A STICKY
  // policy (stop inlining everything once one skill overflows) would skip
  // document-formats too, once code-review overflows; a PER-SKILL policy
  // inlines document-formats because it still fits on its own after
  // code-review is skipped. This is the distinction
  // generate-agent-files.test.js's own history describes as "budget checks
  // apply per-skill in declaration order (not all-or-nothing)" -- the
  // previous version of this test used maxChars: 10 (nothing fits at all),
  // which can't actually distinguish the two policies; this budget can.
  const blockLen = (name, content) => content.length + name.length + '## Skill: \n\n'.length;
  const gitWorkflowBlockLen = blockLen('git-workflow', gen.loadSkillContent(gen.SKILLS_ROOT, 'git-workflow'));
  const documentFormatsBlockLen = blockLen(
    'document-formats',
    gen.loadSkillContent(gen.SKILLS_ROOT, 'document-formats'),
  );
  const budget = gitWorkflowBlockLen + documentFormatsBlockLen + 10;

  const { report } = gen.buildInlinedBlock(
    'asdlc-example',
    ['git-workflow', 'code-review', 'document-formats'],
    budget,
  );
  assert.deepEqual(report.inlined, ['git-workflow', 'document-formats']);
  assert.deepEqual(report.skippedBudget, ['code-review']);
});

test('renderAgentFile produces a full agent .md with frontmatter, body, and inlined skills', () => {
  const spec = {
    name: 'asdlc-example',
    config: { description: 'An example agent.', model: 'claude-sonnet-5', systemPrompt: '# Example Agent\n\nDo the thing.' },
    clientConfig: { claudeCli: { tools: ['Read'], skills: ['git-workflow'] } },
  };
  const { text, report } = gen.renderAgentFile(spec, 40000);
  assert.match(text, /^---\n/);
  assert.match(text, /# Example Agent/);
  assert.match(text, /Do the thing\./);
  assert.match(text, /## Skill: git-workflow/);
  assert.deepEqual(report.inlined, ['git-workflow']);
});

test('generateAgents renders every *.agent-spec.json to disk and returns a report per agent', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-gen-test-'));
  try {
    const result = gen.generateAgents({ outDir });
    assert.ok(result.reports.length >= 10, `expected at least 10 rendered agents, got ${result.reports.length}`);
    const developerReport = result.reports.find((r) => r.agent === 'k-developer');
    assert.ok(developerReport, 'expected a k-developer report');

    const rendered = fs.readFileSync(path.join(outDir, 'k-developer.md'), 'utf-8');
    assert.match(rendered, /name: k-developer/);
    assert.match(rendered, new RegExp(gen.BEGIN_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // A known, load-bearing skill heading must actually be present in the
    // rendered file — this is the concrete "did skill content get baked in"
    // check the design's verification step asks for.
    assert.match(rendered, /## Skill: backend-review/);
    assert.match(rendered, /Architectural Patterns/); // from backend-review/SKILL.md's own body
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('generateAgents with --agent renders exactly one file', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-gen-test-single-'));
  try {
    const result = gen.generateAgents({ outDir, agent: 'k-quality-assurance' });
    assert.equal(result.reports.length, 1);
    assert.equal(result.reports[0].agent, 'k-quality-assurance');
    assert.ok(fs.existsSync(path.join(outDir, 'k-quality-assurance.md')));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('generateAgents throws a clear error for an unknown agent name', () => {
  assert.throws(() => gen.generateAgents({ agent: 'asdlc-does-not-exist' }), /No agent-spec found/);
});

test('generateAgents is deterministic modulo the "Resolved <timestamp>" comment', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-gen-test-idempotent-'));
  try {
    gen.generateAgents({ outDir, agent: 'k-quality-assurance' });
    const first = fs.readFileSync(path.join(outDir, 'k-quality-assurance.md'), 'utf-8');
    gen.generateAgents({ outDir, agent: 'k-quality-assurance' });
    const second = fs.readFileSync(path.join(outDir, 'k-quality-assurance.md'), 'utf-8');
    const stripTimestamp = (t) => t.replace(/<!-- Resolved .*? -->/, '<!-- Resolved -->');
    assert.equal(stripTimestamp(first), stripTimestamp(second));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('generateAgents with install=true also writes a copy into installDir', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-gen-test-outdir-'));
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-gen-test-installdir-'));
  try {
    gen.generateAgents({ outDir, installDir, install: true, agent: 'k-quality-assurance' });
    assert.ok(fs.existsSync(path.join(installDir, 'k-quality-assurance.md')));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.rmSync(installDir, { recursive: true, force: true });
  }
});
