#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * generate-agent-files.js — render Claude Code agent `.md` files from
 * `agents/*.agent-spec.json`, with each agent's declared skills'
 * `SKILL.md` content inlined directly into the file body.
 *
 * Why this exists: this is a public, `aim`-free, dependency-free stand-in for
 * turning agent specs into files Claude Code can load directly. External
 * users (no internal-only build system, no `aim`) need a way to turn this
 * repo's `agents/*.agent-spec.json` sources into files `claude --agent
 * <name>` can actually load. It is deliberately a *stopgap*: once
 * `konductor synth` (currently a stub — see cli/konductor/konductor/install.py
 * and cli/konductor-rs/src/cli.rs) ships real functionality, this script
 * should be retired in its favor. Keep this to "JSON in, Markdown out,
 * inline the skill bodies" — no new templating language, no parallel
 * long-term system.
 *
 * The problem this solves: raw `claude --agent NAME -p ...` headless spawns
 * get NO frontmatter-based skill injection at all -- that loading path only
 * runs for interactive sessions. Inlining the resolved SKILL.md body
 * straight into the agent's own `.md` file fixes this: the content travels
 * with the agent file itself, independent of spawn mode.
 *
 * ASDLCCoreAICapabilities is a single package with no `includes` chain --
 * every agent's declared skill list already equals its own
 * `clientConfig.claudeCli.skills` array in full, so there is no
 * own-vs-inherited reordering to do and no second skills root to search.
 * This generator therefore has only ONE skills root (`skills/`).
 *
 * Implements: strip_frontmatter / build_inlined_block / budget-truncation,
 * in Node, so the public harness needs nothing beyond Node.js + the
 * `claude` CLI -- no Python, no third-party packages.
 *
 * Usage:
 *   node scripts/generate-agent-files.js [--agent <name>] [--out-dir <dir>]
 *                                        [--install] [--install-dir <dir>]
 *                                        [--max-inline-chars <n>]
 *
 *   --agent <name>        Only render this one agent (e.g. k-developer).
 *                          Omit to render every agents/*.agent-spec.json.
 *   --out-dir <dir>       Where to write the rendered .md files (default:
 *                          <repoRoot>/agents/claude).
 *   --install             Also copy each rendered file into the Claude Code
 *                          user agents directory (see --install-dir) so
 *                          `claude --agent <name>` can find it without any
 *                          separate install tool.
 *   --install-dir <dir>   Override the install destination (default: the env var
 *                          named by constants.json's claude_agents_dir_env field,
 *                          or ~/.claude/agents).
 *   --max-inline-chars N  Per-agent skill-inlining character budget (default: the
 *                          env var named by constants.json's max_inline_chars_env
 *                          field, or 250000 -- generous on
 *                          purpose: a single public agent's own full
 *                          skill set tops out around ~220K chars today
 *                          (k-quality-assurance) well within a
 *                          200K-token model context window. Agents with a
 *                          much larger skill inventory (e.g. k-architect,
 *                          ~472K chars across 30 skills) will still skip
 *                          some at this default -- pass a higher value if
 *                          you need full coverage for those).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { CONSTANTS, isAgentSpecFilename } = require('./brand-config/lib/constants.js');

const REPO_ROOT = path.join(__dirname, '..');
const AGENTS_SPEC_DIR = path.join(REPO_ROOT, 'agents');
const SKILLS_ROOT = path.join(REPO_ROOT, 'skills');

const BEGIN_MARKER = '<!-- BEGIN INLINED SKILLS (generate-agent-files.js) -->';
const END_MARKER = '<!-- END INLINED SKILLS -->';

/** Parse CLI args into a plain object of flag -> value (booleans for flags with no value). */
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i++;
    }
  }
  return opts;
}

/**
 * Find every agent-spec.json this package owns (or just the one matching
 * `agentName`). Delegates the "is this an agent of ours" decision to
 * `isAgentSpecFilename` (brand-config/lib/constants.js) rather than a bare prefix glob --
 * see that module's doc comment for why a single `startsWith` check is not
 * sufficient once the orchestrator becomes a bare (non-prefixed) name.
 */
function findAgentSpecs(agentName) {
  const files = fs
    .readdirSync(AGENTS_SPEC_DIR)
    .filter((f) => isAgentSpecFilename(f))
    .sort();
  const specs = files.map((f) => path.join(AGENTS_SPEC_DIR, f));
  if (!agentName) return specs;
  const wanted = specs.filter((p) => path.basename(p) === `${agentName}.agent-spec.json`);
  if (wanted.length === 0) {
    throw new Error(`No agent-spec found for "${agentName}" in ${AGENTS_SPEC_DIR}`);
  }
  return wanted;
}

/** Drop a leading YAML frontmatter block (if present) and leading blank lines. */
function stripFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0] && lines[0].trim() === '---') {
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        end = i;
        break;
      }
    }
    if (end !== -1) {
      let body = lines.slice(end + 1);
      while (body.length && body[0].trim() === '') body.shift();
      return `${body.join('\n').replace(/\n+$/, '')}\n`;
    }
  }
  return `${text.replace(/\n+$/, '')}\n`;
}

function loadSkillContent(skillsRoot, name) {
  const skillPath = path.join(skillsRoot, name, 'SKILL.md');
  if (!fs.existsSync(skillPath)) return null;
  return stripFrontmatter(fs.readFileSync(skillPath, 'utf-8'));
}

/** YAML-serialize a flat string array as a block list under `key:`. Skips the key entirely if the list is empty. */
function yamlList(key, items) {
  if (!items || items.length === 0) return '';
  const lines = [`${key}:`];
  for (const item of items) {
    // Quote only when the bare scalar would be ambiguous YAML (wildcards,
    // colons, leading/trailing whitespace) -- keeps output readable for the
    // common case (plain tool/skill names).
    const needsQuotes = /[:#*]|^\s|\s$/.test(item);
    lines.push(`  - ${needsQuotes ? JSON.stringify(item) : item}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * YAML-serialize a flat string array as a single inline comma-separated
 * scalar under `key:` (e.g. `tools: Read, Grep, Glob`). This is the format
 * Claude Code's sub-agent docs actually document and every example uses for
 * `tools:` -- https://code.claude.com/docs/en/sub-agents ("Write subagent
 * files" + every example subagent). A YAML *block sequence* form
 * (`tools:\n  - Read`) is not shown anywhere in those docs and is silently
 * ignored at runtime (verified empirically: the declared list is dropped
 * entirely and Claude Code falls back to its default tool set). Skips the
 * key entirely if the list is empty.
 */
function yamlInlineList(key, items) {
  if (!items || items.length === 0) return '';
  // Quote an individual entry only when the bare scalar would be ambiguous
  // YAML on its own -- `:` (looks like a mapping) or leading/trailing
  // whitespace. `*` is NOT ambiguous here: it only denotes a YAML alias as
  // the *first* character of a scalar, and every entry we render (tool
  // names, `mcp__server__*` globs) has that `*` in the middle or at the
  // end, never the start.
  const rendered = items.map((item) => (/[:]|^\s|\s$/.test(item) ? JSON.stringify(item) : item));
  return `${key}: ${rendered.join(', ')}\n`;
}

// Emits tools: and skills: only. mcpServers: is deliberately not emitted —
// MCP servers are customer-installed, not bundled.
/** Render the frontmatter block for one agent-spec. */
function renderFrontmatter(spec) {
  const tools = (spec.clientConfig && spec.clientConfig.claudeCli && spec.clientConfig.claudeCli.tools) || [];
  const skills = (spec.clientConfig && spec.clientConfig.claudeCli && spec.clientConfig.claudeCli.skills) || [];
  const description = (spec.config && spec.config.description) || '';
  const model = (spec.config && spec.config.model) || '';

  const parts = ['---', `name: ${spec.name}`, `description: ${JSON.stringify(description)}`];
  if (model) parts.push(`model: ${model}`);
  // `tools:` must be the inline comma-separated form -- see yamlInlineList's
  // comment. `skills:` stays a block sequence: the docs' own
  // "Preload skills into subagents" example renders it that way.
  const toolsLine = yamlInlineList('tools', tools);
  const skillsBlock = yamlList('skills', skills);
  if (toolsLine) parts.push(toolsLine.replace(/\n$/, ''));
  if (skillsBlock) parts.push(skillsBlock.replace(/\n$/, ''));
  parts.push('---');
  return `${parts.join('\n')}\n`;
}

/**
 * Inline every skill in `declared` (in order) into a single marker block,
 * respecting `maxChars`. Returns { blockText, report } where report tracks
 * what got inlined/skipped/unresolved for the summary table.
 */
function buildInlinedBlock(agentName, declared, maxChars) {
  const report = { agent: agentName, declared: declared.length, inlined: [], skippedBudget: [], unresolved: [] };
  const sections = [];
  let budgetUsed = 0;

  for (const name of declared) {
    const content = loadSkillContent(SKILLS_ROOT, name);
    if (content === null) {
      report.unresolved.push(name);
      continue;
    }
    const blockLen = content.length + name.length + '## Skill: \n\n'.length;
    if (budgetUsed + blockLen > maxChars) {
      report.skippedBudget.push(name);
      continue;
    }
    budgetUsed += blockLen;
    report.inlined.push(name);
    sections.push(`\n## Skill: ${name}\n\n${content.replace(/\n+$/, '')}`);
  }

  const header = [
    BEGIN_MARKER,
    '<!-- Generated by scripts/generate-agent-files.js. Do not edit by hand -- re-run the script instead. -->',
    `<!-- Resolved ${new Date().toISOString()} -->`,
  ];
  const footer = [];
  if (report.skippedBudget.length) {
    footer.push(`\n<!-- SKIPPED (token budget exceeded): ${report.skippedBudget.join(', ')} -->`);
  }
  if (report.unresolved.length) {
    footer.push(`\n<!-- UNRESOLVED (SKILL.md not found under skills/): ${report.unresolved.join(', ')} -->`);
  }
  const blockText = `${[...header, ...sections, ...footer, END_MARKER].join('\n')}\n`;
  return { blockText, report };
}

/** Render one agent-spec.json into the full contents of its Claude Code `.md` file. */
function renderAgentFile(spec, maxChars) {
  const skills = (spec.clientConfig && spec.clientConfig.claudeCli && spec.clientConfig.claudeCli.skills) || [];
  const frontmatter = renderFrontmatter(spec);
  const body = (spec.config && spec.config.systemPrompt) || '';
  const { blockText, report } = buildInlinedBlock(spec.name, skills, maxChars);

  let text = frontmatter;
  if (!text.endsWith('\n')) text += '\n';
  text += `\n${body.replace(/\n+$/, '')}\n\n${blockText}`;
  return { text, report };
}

function formatSummaryTable(reports) {
  const headers = ['agent', 'declared', 'inlined', 'skipped-budget', 'unresolved'];
  const rows = reports.map((r) => [
    r.agent,
    String(r.declared),
    String(r.inlined.length),
    String(r.skippedBudget.length),
    String(r.unresolved.length),
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const lines = [
    headers.map((h, i) => h.padEnd(widths[i])).join('  '),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map((row) => row.map((c, i) => c.padEnd(widths[i])).join('  ')),
  ];
  return lines.join('\n');
}

/**
 * Programmatic entry point — object options in, structured result out. This
 * is the "clean interface" boundary a future `konductor` CLI subcommand
 * (post-launch) can call or port directly, without needing to mimic this
 * file's argv parsing. `main(argv)` below is a thin CLI wrapper over this
 * function; it is the only caller that touches `process.env`/argv.
 *
 * @param {{agent?: string, outDir?: string, install?: boolean, installDir?: string, maxInlineChars?: number}} [options]
 * @returns {{outDir: string, installDir: string|null, reports: object[]}}
 */
function generateAgents(options = {}) {
  const outDir = options.outDir ? path.resolve(options.outDir) : path.join(REPO_ROOT, 'agents', 'claude');
  const maxChars = options.maxInlineChars || parseInt(process.env[CONSTANTS.max_inline_chars_env] || '250000', 10);
  const install = Boolean(options.install);
  const installDir = options.installDir
    ? path.resolve(options.installDir)
    : process.env[CONSTANTS.claude_agents_dir_env] || path.join(os.homedir(), '.claude', 'agents');

  const specPaths = findAgentSpecs(options.agent || null);
  fs.mkdirSync(outDir, { recursive: true });
  if (install) fs.mkdirSync(installDir, { recursive: true });

  const reports = [];
  for (const specPath of specPaths) {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    const { text, report } = renderAgentFile(spec, maxChars);
    const outPath = path.join(outDir, `${spec.name}.md`);
    fs.writeFileSync(outPath, text);
    if (install) {
      fs.writeFileSync(path.join(installDir, `${spec.name}.md`), text);
    }
    reports.push(report);
  }

  return { outDir, installDir: install ? installDir : null, reports, maxChars };
}

/** Prints the human-readable report for a generateAgents() result. Side-effect-only (console); returns true if any warnings were printed. */
function reportGenerateAgents({ outDir, installDir, reports, maxChars }) {
  console.log(`Rendered ${reports.length} agent file(s) to ${outDir}`);
  if (installDir) console.log(`Installed a copy of each into ${installDir}`);
  console.log('');
  console.log(formatSummaryTable(reports));

  let anyWarnings = false;
  for (const r of reports) {
    if (r.skippedBudget.length) {
      anyWarnings = true;
      console.warn(`WARN: ${r.agent}: skipped ${r.skippedBudget.length} skill(s) over budget (${maxChars} chars): ${r.skippedBudget.join(', ')}`);
    }
    if (r.unresolved.length) {
      anyWarnings = true;
      console.warn(`WARN: ${r.agent}: could not resolve ${r.unresolved.length} skill(s): ${r.unresolved.join(', ')}`);
    }
  }
  if (anyWarnings) {
    console.warn('\nSee warnings above. Generation is NOT failed by unresolved/skipped skills.');
  }
  return anyWarnings;
}

/** CLI wrapper: argv -> generateAgents() options -> printed report. Returns a process exit code. */
function main(argv) {
  const opts = parseArgs(argv);
  const result = generateAgents({
    agent: typeof opts.agent === 'string' ? opts.agent : null,
    outDir: opts['out-dir'],
    install: Boolean(opts.install),
    installDir: opts['install-dir'],
    maxInlineChars: opts['max-inline-chars'] ? parseInt(opts['max-inline-chars'], 10) : undefined,
  });
  reportGenerateAgents(result);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  parseArgs,
  findAgentSpecs,
  stripFrontmatter,
  loadSkillContent,
  renderFrontmatter,
  buildInlinedBlock,
  renderAgentFile,
  formatSummaryTable,
  generateAgents,
  reportGenerateAgents,
  main,
  BEGIN_MARKER,
  END_MARKER,
  SKILLS_ROOT,
  AGENTS_SPEC_DIR,
};
